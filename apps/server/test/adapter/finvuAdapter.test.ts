import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { accounts, transactions } from '../../src/db/schema.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { getDemoUserId } from '../../src/adapter/demoUser.js';
import { SUPPORTED_BANKS } from '../../src/adapter/banks.js';
import { resetFinvuTokenCache } from '../../src/adapter/finvuAuth.js';
import { createFinvuAdapter } from '../../src/adapter/finvuAdapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'finvu-fi-data-sample.xml');

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function textResponse(body: string, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as Response;
}

// Stub HTTP client — never touches the real Finfactor sandbox. Response shapes below mirror
// what was actually observed in the live walkthrough (login -> token; ConsentRequestPlus ->
// {ConsentHandle, url}; ConsentStatus -> PENDING then ACCEPTED; FIRequest -> {sessionId};
// FIStatus -> PENDING then READY; FIDataFetch -> the real captured XML fixture).
function buildStubFetch(xmlFixture: string) {
  let consentStatusCalls = 0;
  let fiStatusCalls = 0;
  const calls: string[] = [];

  const stub = vi.fn(async (url: string) => {
    calls.push(url);

    if (url.includes('/User/Login')) {
      return jsonResponse({ body: { token: 'stub-finvu-token' } });
    }
    if (url.includes('/ConsentRequestPlus')) {
      return jsonResponse({
        body: { ConsentHandle: 'handle-abc-123', url: 'https://finvu.example/approve/handle-abc-123' },
      });
    }
    if (url.includes('/ConsentStatus/')) {
      consentStatusCalls += 1;
      if (consentStatusCalls === 1) {
        return jsonResponse({ body: { consentStatus: 'PENDING', consentId: null } });
      }
      return jsonResponse({ body: { consentStatus: 'ACCEPTED', consentId: 'real-consent-id-789' } });
    }
    if (url.includes('/FIRequest')) {
      return jsonResponse({ body: { sessionId: 'fi-session-456' } });
    }
    if (url.includes('/FIStatus/')) {
      fiStatusCalls += 1;
      if (fiStatusCalls === 1) {
        return jsonResponse({ body: { fiRequestStatus: 'PENDING' } });
      }
      return jsonResponse({ body: { fiRequestStatus: 'READY' } });
    }
    if (url.includes('/FIDataFetch/')) {
      return textResponse(xmlFixture);
    }
    throw new Error(`Unexpected stub fetch call: ${url}`);
  });

  return { stub, calls };
}

const baseInput = {
  mobile: '9876543210',
  purpose: 'Personal finance management',
  fromDate: '2024-01-01',
  toDate: '2025-02-12',
  expiryDays: 365,
  fiTypes: ['DEPOSIT'],
};

describe('finvuAdapter (createFinvuAdapter with a stub fetch — never hits the real sandbox)', () => {
  let userId: string;
  const xmlFixture = readFileSync(FIXTURE_PATH, 'utf-8');

  beforeAll(async () => {
    process.env.FINVU_CHANNEL_PASSWORD = 'test-password';
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    userId = await getDemoUserId();
  });

  afterEach(() => {
    resetFinvuTokenCache();
  });

  afterAll(async () => {
    await pool.end();
  });

  it(
    'runs initiateConsent -> checkConsentStatus -> requestFinancialData -> getDataStatus end to end, ' +
      'inserting all 373 real transactions from the captured fixture with correct credit/debit mapping, ' +
      'and getDataStatus is idempotent (no re-insert) on a repeat call',
    async () => {
      const { stub } = buildStubFetch(xmlFixture);
      const adapter = createFinvuAdapter(stub as unknown as typeof fetch);

      const initiated = await adapter.initiateConsent({ ...baseInput, userId, fipId: 'hdfc-bank' });
      expect(initiated.ok).toBe(true);
      if (!initiated.ok) return;
      expect(initiated.data.status).toBe('PENDING');
      expect(initiated.data.approvalUrl).toBe('https://finvu.example/approve/handle-abc-123');
      const consentId = initiated.data.consentId;

      const pendingCheck = await adapter.checkConsentStatus(consentId);
      expect(pendingCheck).toEqual({ ok: true, data: { status: 'PENDING' } });

      const activeCheck = await adapter.checkConsentStatus(consentId);
      expect(activeCheck).toEqual({ ok: true, data: { status: 'ACTIVE' } });

      const requested = await adapter.requestFinancialData(consentId);
      expect(requested).toEqual({ ok: true, data: { sessionId: consentId, status: 'PROCESSING' } });

      const pendingStatus = await adapter.getDataStatus(consentId);
      expect(pendingStatus).toEqual({ ok: true, data: { status: 'PENDING', fetchedAt: null } });

      const readyStatus = await adapter.getDataStatus(consentId);
      expect(readyStatus.ok).toBe(true);
      if (!readyStatus.ok) return;
      expect(readyStatus.data.status).toBe('READY');
      expect(readyStatus.data.fetchedAt).toEqual(expect.any(String));

      const [account] = await db.select().from(accounts).where(eq(accounts.consentId, consentId));
      expect(account).toBeDefined();
      expect(account.maskedNumber).toBe('XXXXXXXXXXXXX4712');
      expect(account.balance).toBe('166.67');
      expect(account.currency).toBe('INR');
      expect(account.type).toBe('SAVINGS');

      const txnRows = await db.select().from(transactions).where(eq(transactions.accountId, account.id));
      expect(txnRows).toHaveLength(373);
      const credits = txnRows.filter((t) => t.direction === 'credit').length;
      const debits = txnRows.filter((t) => t.direction === 'debit').length;
      expect(credits + debits).toBe(373);
      expect(credits).toBeGreaterThan(0);
      expect(debits).toBeGreaterThan(0);
      for (const row of txnRows) {
        expect(row.sourceMetadata).toHaveProperty('txnId');
        expect(row.sourceMetadata).toHaveProperty('reference');
      }

      // Idempotency: a second getDataStatus call after ingestion must not re-insert.
      const secondReady = await adapter.getDataStatus(consentId);
      expect(secondReady).toEqual({ ok: true, data: { status: 'READY', fetchedAt: readyStatus.data.fetchedAt } });
      const txnRowsAfter = await db.select().from(transactions).where(eq(transactions.accountId, account.id));
      expect(txnRowsAfter).toHaveLength(373);
    }
  );

  it('blocks requestFinancialData on a non-ACTIVE (still PENDING) consent with CONSENT_NOT_ACTIVE, matching mock mode', async () => {
    const { stub } = buildStubFetch(xmlFixture);
    const adapter = createFinvuAdapter(stub as unknown as typeof fetch);

    const initiated = await adapter.initiateConsent({ ...baseInput, userId, fipId: 'icici-bank' });
    if (!initiated.ok) throw new Error('setup failed');

    const result = await adapter.requestFinancialData(initiated.data.consentId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONSENT_NOT_ACTIVE');
  });

  it('getConsentDetails returns the same shape mock mode returns', async () => {
    const { stub } = buildStubFetch(xmlFixture);
    const adapter = createFinvuAdapter(stub as unknown as typeof fetch);

    const initiated = await adapter.initiateConsent({ ...baseInput, userId, fipId: 'hdfc-bank' });
    if (!initiated.ok) throw new Error('setup failed');

    const details = await adapter.getConsentDetails(initiated.data.consentId);
    expect(details).toEqual({
      ok: true,
      data: {
        purpose: baseInput.purpose,
        fiTypes: baseInput.fiTypes,
        dateRange: { from: baseInput.fromDate, to: baseInput.toDate },
        expiry: expect.any(String),
        dataLife: expect.any(String),
      },
    });
  });

  it('returns CONSENT_NOT_FOUND for unknown consent ids across all consent-scoped methods', async () => {
    const { stub } = buildStubFetch(xmlFixture);
    const adapter = createFinvuAdapter(stub as unknown as typeof fetch);
    const unknownId = '00000000-0000-0000-0000-000000000000';

    expect((await adapter.checkConsentStatus(unknownId)).ok).toBe(false);
    expect((await adapter.getConsentDetails(unknownId)).ok).toBe(false);
    expect((await adapter.requestFinancialData(unknownId)).ok).toBe(false);
  });

  it('returns SESSION_NOT_FOUND from getDataStatus for an unknown session id', async () => {
    const { stub } = buildStubFetch(xmlFixture);
    const adapter = createFinvuAdapter(stub as unknown as typeof fetch);
    const result = await adapter.getDataStatus('00000000-0000-0000-0000-000000000000');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('listSupportedBanks falls back to the static FIP list when GET /fips/ has an unexpected shape', async () => {
    const stub = vi.fn(async (url: string) => {
      if (url.includes('/User/Login')) return jsonResponse({ body: { token: 'stub-token' } });
      if (url.includes('/fips/')) return jsonResponse({ notAnArray: true });
      throw new Error(`Unexpected stub fetch call: ${url}`);
    });
    const adapter = createFinvuAdapter(stub as unknown as typeof fetch);

    const banks = await adapter.listSupportedBanks();
    expect(banks).toEqual(SUPPORTED_BANKS);
  });
});
