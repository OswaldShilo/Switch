import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { accounts, consents, transactions } from '../db/schema.js';
import type { AaAdapter } from './AaAdapter.js';
import type { Bank } from './banks.js';
import { SUPPORTED_BANKS } from './banks.js';
import { getFinvuConfig } from './finvuConfig.js';
import { getFinvuToken } from './finvuAuth.js';
import { parseFinvuAccountXml } from './finvuXml.js';

// Finvu-side identifiers we need to remember per consent, stored (unparsed) in
// consents.rawJson — mirrors how rawJson is already used by mock mode (see consent.ts),
// no new table.
interface FinvuConsentRawJson {
  consentHandle: string;
  custId: string;
  consentId?: string;
  finvuSessionId?: string;
}

type FinvuFetch = (path: string, init?: RequestInit) => Promise<Response>;

function createFinvuFetch(fetchImpl: typeof fetch): FinvuFetch {
  return async (path, init = {}) => {
    const config = getFinvuConfig();
    const token = await getFinvuToken(fetchImpl);
    return fetchImpl(`${config.baseUrl}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
  };
}

// Best-effort beyond what was directly observed live (PENDING -> ACCEPTED was). The
// webhook-notification docs list ACTIVE|PENDING|REVOKED|PAUSED|REJECTED|EXPIRED|FAILED as
// possible statuses; PAUSED/FAILED are mapped defensively since they weren't exercised live.
function mapConsentStatus(finvuStatus: string): string {
  if (finvuStatus === 'ACCEPTED' || finvuStatus === 'ACTIVE') return 'ACTIVE';
  if (finvuStatus === 'PAUSED') {
    console.warn('FinvuAdapter: mapping unexercised PAUSED consent status defensively to ACTIVE');
    return 'ACTIVE';
  }
  if (finvuStatus === 'FAILED') {
    console.warn('FinvuAdapter: mapping unexercised FAILED consent status defensively to REJECTED');
    return 'REJECTED';
  }
  return finvuStatus; // PENDING, REJECTED, REVOKED, EXPIRED pass through unchanged
}

// fetchImpl is injectable (same DI seam as categorize/llmFallback.ts's classifyBatchWithClaude)
// so finvuAdapter.test.ts can stub the entire Finvu HTTP surface and never touch the real
// sandbox network. The AaAdapter interface itself has no room for an extra parameter (both
// adapters must satisfy the same fixed method signatures), so the seam lives one level up, at
// adapter construction time — getAdapter() uses the real default (see finvuAdapter export below).
export function createFinvuAdapter(fetchImpl: typeof fetch = fetch): AaAdapter {
  const finvuFetch = createFinvuFetch(fetchImpl);

  async function listSupportedBanks(): Promise<Bank[]> {
    // Response shape for GET /fips/ was never captured live (every Postman example had an
    // empty saved response) — parse defensively and fall back to the static list rather than
    // crash the whole adapter over one low-stakes endpoint.
    try {
      const res = await finvuFetch('/fips/');
      if (!res.ok) throw new Error(`status ${res.status}`);
      const json = (await res.json()) as unknown;
      if (Array.isArray(json)) {
        const banks = json
          .map((f) => (f && typeof f === 'object' ? (f as { fipId?: string; name?: string }) : null))
          .filter((f): f is { fipId: string; name: string } => !!f?.fipId && !!f.name)
          .map((f) => ({ fipId: f.fipId, name: f.name, logo: '' }));
        if (banks.length > 0) return banks;
        throw new Error('empty /fips/ response');
      }
      throw new Error('unexpected /fips/ response shape');
    } catch (err) {
      console.warn('FinvuAdapter.listSupportedBanks: falling back to static FIP list —', err);
      return SUPPORTED_BANKS;
    }
  }

  const initiateConsent: AaAdapter['initiateConsent'] = async (input) => {
    const config = getFinvuConfig();
    const custId = `${input.mobile}@finvu`;
    const res = await finvuFetch('/ConsentRequestPlus', {
      method: 'POST',
      body: JSON.stringify({
        header: { ts: new Date().toISOString(), channelId: 'finsense', rid: randomUUID() },
        body: {
          custId,
          consentDescription: input.purpose,
          templateName: config.templateName,
          userSessionId: input.userId,
          redirectUrl: config.redirectUrl,
          fip: [],
          ConsentDetails: {},
          aaId: config.aaId,
        },
      }),
    });
    if (!res.ok) {
      return { ok: false, error: { code: 'FINVU_ERROR', message: `ConsentRequestPlus failed: ${res.status}` } };
    }
    const json = (await res.json()) as { body: { ConsentHandle: string; url?: string } };

    const rawJson: FinvuConsentRawJson = { consentHandle: json.body.ConsentHandle, custId };
    const [consent] = await db
      .insert(consents)
      .values({
        userId: input.userId,
        fipId: input.fipId,
        status: 'PENDING',
        purpose: input.purpose,
        fiTypes: input.fiTypes,
        fromDate: input.fromDate,
        toDate: input.toDate,
        expiryAt: new Date(Date.now() + input.expiryDays * 24 * 60 * 60 * 1000),
        dataLife: '1 year',
        rawJson,
      })
      .returning();

    return {
      ok: true,
      data: { consentId: consent.id, approvalUrl: json.body.url ?? '', status: 'PENDING' },
    };
  };

  const checkConsentStatus: AaAdapter['checkConsentStatus'] = async (ourConsentId) => {
    const [consent] = await db.select().from(consents).where(eq(consents.id, ourConsentId));
    if (!consent) return { ok: false, error: { code: 'CONSENT_NOT_FOUND', message: ourConsentId } };
    const raw = consent.rawJson as FinvuConsentRawJson;

    const res = await finvuFetch(`/ConsentStatus/${raw.consentHandle}/${raw.custId}`);
    if (!res.ok) {
      return { ok: false, error: { code: 'FINVU_ERROR', message: `ConsentStatus failed: ${res.status}` } };
    }
    const json = (await res.json()) as { body: { consentStatus: string; consentId: string | null } };

    const status = mapConsentStatus(json.body.consentStatus);
    await db
      .update(consents)
      .set({
        status: status as 'PENDING' | 'ACTIVE' | 'REJECTED' | 'REVOKED' | 'EXPIRED',
        aaConsentId: json.body.consentId ?? consent.aaConsentId,
        rawJson: { ...raw, consentId: json.body.consentId ?? raw.consentId } satisfies FinvuConsentRawJson,
      })
      .where(eq(consents.id, ourConsentId));

    return { ok: true, data: { status } };
  };

  const getConsentDetails: AaAdapter['getConsentDetails'] = async (ourConsentId) => {
    const [consent] = await db.select().from(consents).where(eq(consents.id, ourConsentId));
    if (!consent) return { ok: false, error: { code: 'CONSENT_NOT_FOUND', message: ourConsentId } };
    return {
      ok: true,
      data: {
        purpose: consent.purpose,
        fiTypes: consent.fiTypes,
        dateRange: { from: consent.fromDate, to: consent.toDate },
        expiry: consent.expiryAt.toISOString(),
        dataLife: consent.dataLife,
      },
    };
  };

  const requestFinancialData: AaAdapter['requestFinancialData'] = async (ourConsentId) => {
    const [consent] = await db.select().from(consents).where(eq(consents.id, ourConsentId));
    if (!consent) return { ok: false, error: { code: 'CONSENT_NOT_FOUND', message: ourConsentId } };
    if (consent.status !== 'ACTIVE') {
      return { ok: false, error: { code: 'CONSENT_NOT_ACTIVE', message: `Consent is ${consent.status}` } };
    }
    const raw = consent.rawJson as FinvuConsentRawJson;
    const res = await finvuFetch('/FIRequest', {
      method: 'POST',
      body: JSON.stringify({
        header: { rid: randomUUID(), ts: new Date().toISOString(), channelId: 'finsense' },
        body: {
          custId: raw.custId,
          consentId: raw.consentId,
          consentHandleId: raw.consentHandle,
          dateTimeRangeFrom: consent.fromDate,
          dateTimeRangeTo: consent.toDate,
        },
      }),
    });
    if (!res.ok) return { ok: false, error: { code: 'FINVU_ERROR', message: `FIRequest failed: ${res.status}` } };
    const json = (await res.json()) as { body: { sessionId: string } };
    await db
      .update(consents)
      .set({ rawJson: { ...raw, finvuSessionId: json.body.sessionId } satisfies FinvuConsentRawJson })
      .where(eq(consents.id, ourConsentId));
    return { ok: true, data: { sessionId: ourConsentId, status: 'PROCESSING' } };
  };

  // The only place mock vs. real actually diverges in *when* data lands in Postgres: mock mode
  // does it synchronously inside requestFinancialData; real Finvu is async (FIRequest -> poll
  // FIStatus -> FIDataFetch once ready), so the real adapter does the fetch-parse-insert work
  // lazily here, the first time it observes fiRequestStatus: READY.
  const getDataStatus: AaAdapter['getDataStatus'] = async (sessionId) => {
    const [consent] = await db.select().from(consents).where(eq(consents.id, sessionId));
    if (!consent) return { ok: false, error: { code: 'SESSION_NOT_FOUND', message: sessionId } };
    const raw = consent.rawJson as FinvuConsentRawJson;

    const [existingAccount] = await db.select().from(accounts).where(eq(accounts.consentId, consent.id));
    if (existingAccount) {
      return { ok: true, data: { status: 'READY', fetchedAt: existingAccount.fetchedAt.toISOString() } };
    }

    // requestFinancialData hasn't run yet (no FIRequest session) — report PENDING rather than
    // constructing a malformed FIStatus URL.
    if (!raw.consentId || !raw.finvuSessionId) {
      return { ok: true, data: { status: 'PENDING', fetchedAt: null } };
    }

    const statusRes = await finvuFetch(
      `/FIStatus/${raw.consentId}/${raw.finvuSessionId}/${raw.consentHandle}/${raw.custId}`
    );
    if (!statusRes.ok) {
      return { ok: false, error: { code: 'FINVU_ERROR', message: `FIStatus failed: ${statusRes.status}` } };
    }
    const statusJson = (await statusRes.json()) as { body: { fiRequestStatus: 'PENDING' | 'READY' } };
    if (statusJson.body.fiRequestStatus !== 'READY') {
      return { ok: true, data: { status: 'PENDING', fetchedAt: null } };
    }

    const dataRes = await finvuFetch(`/FIDataFetch/${raw.consentHandle}/${raw.finvuSessionId}`);
    if (!dataRes.ok) {
      return { ok: false, error: { code: 'FINVU_ERROR', message: `FIDataFetch failed: ${dataRes.status}` } };
    }
    const xml = await dataRes.text();
    const parsed = parseFinvuAccountXml(xml);

    const now = new Date();
    const [account] = await db
      .insert(accounts)
      .values({
        userId: consent.userId,
        consentId: consent.id,
        bank: consent.fipId,
        type: parsed.account.accountType,
        maskedNumber: parsed.account.maskedAccNumber,
        balance: parsed.account.balance,
        currency: parsed.account.currency,
        fetchedAt: now,
      })
      .returning();

    const BATCH = 100;
    const rows = parsed.transactions.map((t) => ({
      accountId: account.id,
      txnDate: t.txnDate,
      amount: t.amount,
      direction: t.direction,
      narration: t.narration,
      merchant: null,
      sourceMetadata: t.sourceMetadata,
    }));
    for (let i = 0; i < rows.length; i += BATCH) {
      await db.insert(transactions).values(rows.slice(i, i + BATCH));
    }

    return { ok: true, data: { status: 'READY', fetchedAt: now.toISOString() } };
  };

  return {
    listSupportedBanks,
    initiateConsent,
    checkConsentStatus,
    getConsentDetails,
    requestFinancialData,
    getDataStatus,
  };
}

export const finvuAdapter: AaAdapter = createFinvuAdapter();
