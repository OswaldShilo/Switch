# M5 — Finvu Adapter + Connector Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Everything spec §14's final phases need for the live demo: a real bearer-token auth story for the MCP connector (spec §11, §3), the adapter interface formalized so a real Finvu sandbox integration slots in behind `MOCK_MODE` without touching any of the 12 already-built MCP tools, the real Finvu/Finsense sandbox wired in for real (no longer a stub — see Task 3), and the connector installed and reachable from Claude.ai.

**Architecture:** All four code tasks (1-3, plus the schema addition inside Task 3) get full TDD like every prior milestone. **The key architectural correction from the original draft of this plan**: `fetchAccounts`/`fetchTransactions` are *not* adapter-swappable — in both mock and real mode they only ever read our own Postgres (`accounts`/`transactions` tables), exactly as M1 already built them. The only place mock vs. real actually diverges is *how data gets into those tables in the first place* — mock mode does it synchronously inside `requestFinancialData`; real Finvu is asynchronous (FIRequest → poll FIStatus → FIDataFetch once ready), so the real adapter does the fetch-parse-insert work lazily inside `getDataStatus`, the first time it observes Finvu's `fiRequestStatus: READY`. This keeps every MCP tool's public contract (spec §8) byte-for-byte identical between modes. `AaAdapter` therefore only has the 6 methods that actually talk to an external AA network: `listSupportedBanks`, `initiateConsent`, `checkConsentStatus`, `getConsentDetails`, `requestFinancialData`, `getDataStatus`.

Tasks 4-5 stay checklists (deployment/account operations, not code) — no agent should create/pay for cloud infrastructure or touch your Claude.ai account unattended.

**Tech Stack:** Tasks 1-2 reuse `pg`, `drizzle-orm`, `express`, `crypto`. Task 3 adds `fast-xml-parser` (the real Finvu FI-data response is XML, REBIT `FISchema/deposit` namespace, not JSON) and Node's built-in `fetch` for the Finsense REST calls.

## Global Constraints

- **Finvu/Finsense sandbox access confirmed and captured live** (2026-07-26): a full walkthrough was run against `https://dhanaprayoga.fiu.finfactor.in/finsense/API/V2` (the "Dhanaprayoga" shared demo FIU tenant — `channel@dhanaprayoga` / a password documented in Finfactor's own onboarding kit, not a leaked secret, it's how the sandbox is meant to be tried) — Login → `ConsentRequestPlus` → browser OTP+approval on Finvu's hosted page → `ConsentStatus` poll → `FIRequest` → `FIStatus` poll → `FIDataFetch`. A real XML response was captured and is the fixture Task 3's tests are written against. This plan is no longer a stub for Task 3.
- **The FI data response is XML** (`xmlns="http://api.rebit.org.in/FISchema/deposit"`), one `<Account>` element per FIP containing `<Profile><Holders>`, `<Summary>`, and repeated `<Transaction>` elements — not the JSON shape earlier drafts of this plan assumed.
- **Decision: do not parse or persist `<Profile><Holders>` at all.** It's real PII (name, DOB, mobile, address, email, PAN, KYC compliance) that nothing in this project's feature set needs — `summarize_finances`/`fetch_transactions`/the dashboard only ever need `Summary` + `Transactions`. Skipping it entirely is less risk than storing PII a hackathon build has no plan to protect or purge.
- **Schema addition**: `transactions` gets one new nullable column, `sourceMetadata: jsonb` — holds `{txnId, reference, mode, transactionTimestamp}` verbatim from the FIP response. Real bank data won't always have `txnId === reference` (the sandbox sample happened to, don't rely on that), and `transactionTimestamp` (exact instant) can legitimately differ from `valueDate` (settlement date, which maps to our existing `txnDate`) — both are preserved, unparsed, rather than collapsed. This is also the field real-adapter-ingested rows use for idempotent re-fetch (`sourceMetadata->>'txnId'` dedup key); mock-mode rows leave it `null`, unaffected.
- **Consent status mapping is best-effort beyond what was directly observed.** The walkthrough confirmed `PENDING` → `ACCEPTED` on Finvu's `ConsentStatus` endpoint once a human approves in-browser. The webhook-notification docs (not directly exercised) list `ACTIVE|PENDING|REVOKED|PAUSED|REJECTED|EXPIRED|FAILED` as possible statuses — map `ACCEPTED`/`ACTIVE` → our `ACTIVE`, `REJECTED`/`REVOKED`/`EXPIRED` pass through unchanged, `PAUSED`/`FAILED` are edge cases mapped defensively (`PAUSED`→`ACTIVE` with a log line, `FAILED`→`REJECTED`) since they weren't observed live — revisit if the sandbox ever actually returns one.
- **`listSupportedBanks` (`GET /fips/`) response shape was not captured** — every Postman example for it had an empty saved response. Implemented defensively: parse the response, and if its shape doesn't match what's expected, log a warning and fall back to a small hardcoded list built from the Simulator Bank picker's own known entries (Finvu Bank, Dhanagar Bank, Finsure, Finrepo, Finvu GSTN, MFC) rather than crash the whole adapter over one low-stakes endpoint.
- **Real consent approval is a genuine off-site browser redirect** — unlike mock mode's instant self-contained flow, `initiateConsent`'s `approvalUrl` in real mode is Finvu's own hosted consent page, and a human has to complete OTP + account selection + approve there before `checkConsentStatus` will ever report `ACTIVE`. This is a real UX difference the demo script needs to account for if `MOCK_MODE=false` is ever used live on stage (spec's own P0 success metric explicitly keeps `MOCK_MODE=true` as the safe default for exactly this reason).
- **Note for future categorization tuning (not a task here, M2 stays as shipped):** the sandbox's simulator-generated narrations ("Salary Credit", "Grocery Purchase") are far cleaner than real bank narrations (`UPI-JOHNDOE-9876543210@YBL-SBIN0001234`). Messy real narrations mostly won't hit M2's merchant-pattern rules and will fall through to the LLM batch fallback — that's the rule engine working as designed (fast-path known patterns, LLM catches the rest), not a gap to fix here.
- Bearer token auth (Task 2) is scoped exactly to spec §3's stated bar: "Full OAuth 2.1 flow for the MCP connector... bearer token acceptable for demo; note as roadmap." No OAuth flow in this plan.
- `connector_tokens` (userId, tokenHash, createdAt, revokedAt) already exists in the M0 schema — Task 2 is the first milestone to actually use it.
- No commit steps included — one commit per completed task-group, done by the user.

---

### Task 1: Formal `AaAdapter` interface + `MOCK_MODE` switch

**Files:** Create `apps/server/src/adapter/AaAdapter.ts` (interface), `apps/server/src/adapter/mockAdapter.ts` (wraps the existing mock-mode functions to implement it), `apps/server/src/adapter/index.ts` (exports `getAdapter(): AaAdapter`). Test: `apps/server/test/adapter/mockAdapter.test.ts`.

**Interfaces:** Defines the interface `listSupportedBanks`, `initiateConsent`, `checkConsentStatus`, `getConsentDetails`, `requestFinancialData`, `getDataStatus` already structurally satisfy — a **non-behavioral refactor**. `fetchAccounts`/`fetchTransactions` are deliberately *not* part of this interface (see Architecture note above) — `mcp/tools/accounts.ts` and `mcp/tools/transactions.ts` are untouched by this task.

- [ ] `apps/server/src/adapter/AaAdapter.ts`:
```ts
import type { Bank } from './banks.js';
import type { ConsentDetails, ConsentSummary } from './consent.js';
import type { ToolResult } from './types.js';

export interface AaAdapter {
  listSupportedBanks(): Bank[] | Promise<Bank[]>;
  initiateConsent(input: {
    userId: string; mobile: string; fipId: string; purpose: string;
    fromDate: string; toDate: string; expiryDays: number; fiTypes: string[];
  }): Promise<ToolResult<ConsentSummary>>;
  checkConsentStatus(consentId: string): Promise<ToolResult<{ status: string }>>;
  getConsentDetails(consentId: string): Promise<ToolResult<ConsentDetails>>;
  requestFinancialData(consentId: string): Promise<ToolResult<{ sessionId: string; status: string }>>;
  getDataStatus(sessionId: string): Promise<ToolResult<{ status: string; fetchedAt: string | null }>>;
}
```
- [ ] `apps/server/src/adapter/mockAdapter.ts` — import `listSupportedBanks`, `initiateConsent`, `checkConsentStatus`, `getConsentDetails`, `requestFinancialData`, `getDataStatus` from their existing files and assemble one object literal implementing `AaAdapter` (rename imports to avoid collisions, no logic changes).
- [ ] `apps/server/src/adapter/index.ts`:
```ts
import type { AaAdapter } from './AaAdapter.js';
import { mockAdapter } from './mockAdapter.js';
import { finvuAdapter } from './finvuAdapter.js';

export function getAdapter(): AaAdapter {
  return process.env.MOCK_MODE === 'false' ? finvuAdapter : mockAdapter;
}
```
(This imports `finvuAdapter` from Task 3 — build Task 1 and Task 3 together, or stub `finvuAdapter` as an empty object cast to `AaAdapter` temporarily if sequencing them strictly.)
- [ ] Update `apps/server/src/mcp/tools/{banks,consent,dataFetch}.ts` to call `getAdapter().xxx(...)` instead of importing the mock functions directly — the only behavior-relevant edit; it should change nothing observable (all existing tests for these three tool files must still pass unmodified).
- [ ] `apps/server/test/adapter/mockAdapter.test.ts` — confirms `mockAdapter` satisfies `AaAdapter` at the type level and that `getAdapter()` returns it when `MOCK_MODE` is unset or `'true'`.
- [ ] Run `pnpm test` (full suite) and `pnpm --filter @switch/server typecheck` — **zero** regressions across every prior milestone's tests is this task's real acceptance bar.

---

### Task 2: Bearer token auth for `/mcp`

**Files:** Create `apps/server/src/auth/connectorToken.ts`, `apps/server/src/auth/requireConnectorToken.ts`, `apps/server/src/rest/connectorTokens.ts`, tests for all three. Modify `apps/server/src/index.ts` (gate `/mcp` behind the new middleware), `apps/server/src/rest/router.ts` (mount token management endpoints), `apps/server/src/mcp/server.ts` (accept a `userId` instead of always calling `getDemoUserId()`).

**Interfaces:** Produces `createConnectorToken(userId): Promise<{ token: string; tokenId: string }>` (returns the raw token exactly once — only the hash is stored), `verifyConnectorToken(token): Promise<string | null>`, `requireConnectorToken` (Express middleware for `/mcp`), `revokeConnectorToken(tokenId, userId)`.

- [ ] `apps/server/src/auth/connectorToken.ts`:
```ts
import { createHash, randomBytes } from 'node:crypto';
import { eq, isNull, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { connectorTokens } from '../db/schema.js';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createConnectorToken(userId: string): Promise<{ token: string; tokenId: string }> {
  const token = `switch_${randomBytes(32).toString('hex')}`;
  const [row] = await db.insert(connectorTokens).values({ userId, tokenHash: hashToken(token) }).returning();
  return { token, tokenId: row.id };
}

export async function verifyConnectorToken(token: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(connectorTokens)
    .where(and(eq(connectorTokens.tokenHash, hashToken(token)), isNull(connectorTokens.revokedAt)));
  return row?.userId ?? null;
}

export async function revokeConnectorToken(tokenId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(connectorTokens)
    .where(and(eq(connectorTokens.id, tokenId), eq(connectorTokens.userId, userId)));
  if (!row) return false;
  await db.update(connectorTokens).set({ revokedAt: new Date() }).where(eq(connectorTokens.id, tokenId));
  return true;
}
```
- [ ] `apps/server/src/auth/requireConnectorToken.ts` — reads `Authorization: Bearer <token>`, calls `verifyConnectorToken`, 401 if missing/invalid/revoked, otherwise attaches `req.userId`.
- [ ] Modify `apps/server/src/index.ts`: mount `requireConnectorToken` on the `/mcp` routes (all three: POST/GET/DELETE), before the existing session-transport logic.
- [ ] **The 12 MCP tool handlers in `mcp/server.ts` currently call `getDemoUserId()` internally.** Change this: `createMcpServer()` should accept a `userId: string` parameter and close over it, so each `server.tool(...)` callback uses that instead of resolving the demo user. `src/index.ts` passes `req.userId` (set by `requireConnectorToken`) when constructing the server per-session. Every other milestone's MCP tests construct `createMcpServer()` directly — update those call sites to pass a `userId` (use `getDemoUserId()` there explicitly, preserving current test behavior).
- [ ] `apps/server/src/rest/connectorTokens.ts` — `POST /api/connector-tokens` (create, returns the raw token once), `GET /api/connector-tokens` (list, hash never returned), `POST /api/connector-tokens/:id/revoke` — behind the existing Supabase `requireUser` (REST stays Supabase-authenticated; only `/mcp` uses connector tokens). Mount in `router.ts`.
- [ ] Tests: `createConnectorToken` + `verifyConnectorToken` round-trip resolves the right `userId`; a revoked token fails verification; `requireConnectorToken` 401s on missing/garbage/revoked tokens and sets `req.userId` on a valid one; REST endpoints create/list/revoke correctly and a revoked token immediately fails a subsequent `/mcp` call.
- [ ] Run full suite + typecheck, confirm green including every pre-existing MCP tool test (now passing an explicit `userId` into `createMcpServer`).

---

### Task 3: Real Finvu sandbox adapter

**Files:**
- Modify `apps/server/src/db/schema.ts` (add `sourceMetadata: jsonb('source_metadata')` nullable to `transactions`), generate + run the migration.
- Modify `apps/server/package.json` (add `fast-xml-parser`).
- Create `apps/server/src/adapter/finvuConfig.ts`, `apps/server/src/adapter/finvuAuth.ts`, `apps/server/src/adapter/finvuXml.ts`, `apps/server/src/adapter/finvuAdapter.ts`.
- Tests: `apps/server/test/adapter/finvuXml.test.ts` (parses the real captured XML fixture below), `apps/server/test/adapter/finvuAdapter.test.ts` (injects a stub HTTP client, never calls the real sandbox).

**Interfaces:** Consumes `AaAdapter` (Task 1). Produces `finvuAdapter: AaAdapter`, wired into `getAdapter()` when `MOCK_MODE=false`.

- [ ] **Schema migration first.** Add to `transactions` in `apps/server/src/db/schema.ts`:
```ts
sourceMetadata: jsonb('source_metadata'),
```
Run `pnpm --filter @switch/server db:generate` then `pnpm --filter @switch/server db:migrate`. Confirm `pnpm test` (full suite) still passes — this column is nullable and additive, no existing row/insert is affected.

- [ ] `apps/server/src/adapter/finvuConfig.ts`:
```ts
function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name} is not set (required when MOCK_MODE=false)`);
  return value;
}

export function getFinvuConfig() {
  return {
    baseUrl: required('FINVU_BASE_URL', 'https://dhanaprayoga.fiu.finfactor.in/finsense/API/V2'),
    channelUserId: required('FINVU_CHANNEL_USER_ID', 'channel@dhanaprayoga'),
    channelPassword: required('FINVU_CHANNEL_PASSWORD'),
    aaId: required('FINVU_AA_ID', 'cookiejar-aa@finvu.in'),
    templateName: required('FINVU_TEMPLATE_NAME', 'FINVUDEMO_TESTING'),
    redirectUrl: required('FINVU_REDIRECT_URL', 'https://google.co.in'),
  };
}
```
(No fallback for `FINVU_CHANNEL_PASSWORD` — that one has to come from the real onboarding kit's env, never hardcoded, even though it's a shared demo credential.)

- [ ] `apps/server/src/adapter/finvuAuth.ts` — token cache (24h validity per the docs), refreshed via `POST /User/Login`:
```ts
import { randomUUID } from 'node:crypto';
import { getFinvuConfig } from './finvuConfig.js';

let cachedToken: { token: string; expiresAt: number } | null = null;

function envelope(body: unknown) {
  return { header: { rid: randomUUID(), ts: new Date().toISOString(), channelId: 'finsense' }, body };
}

export async function getFinvuToken(fetchImpl: typeof fetch = fetch): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const config = getFinvuConfig();
  const res = await fetchImpl(`${config.baseUrl}/User/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(envelope({ userId: config.channelUserId, password: config.channelPassword })),
  });
  if (!res.ok) throw new Error(`Finvu login failed: ${res.status}`);
  const json = (await res.json()) as { body: { token: string } };

  cachedToken = { token: json.body.token, expiresAt: Date.now() + 23 * 60 * 60 * 1000 };
  return cachedToken.token;
}

export function resetFinvuTokenCache(): void {
  cachedToken = null;
}
```

- [ ] `apps/server/src/adapter/finvuXml.ts` — parses the REBIT deposit-schema XML, **deliberately skips `<Profile>`/`<Holders>`**:
```ts
import { XMLParser } from 'fast-xml-parser';

export interface ParsedFinvuAccount {
  maskedAccNumber: string;
  balance: string;
  currency: string;
  accountType: string;
}

export interface ParsedFinvuTransaction {
  direction: 'credit' | 'debit';
  amount: string;
  txnDate: string;
  narration: string;
  sourceMetadata: { txnId: string; reference: string; mode: string; transactionTimestamp: string };
}

export function parseFinvuAccountXml(xml: string): {
  account: ParsedFinvuAccount;
  transactions: ParsedFinvuTransaction[];
} {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
  const doc = parser.parse(xml);
  const account = doc.Account;
  const summary = account.Summary;

  const rawTxns = Array.isArray(account.Transactions?.Transaction)
    ? account.Transactions.Transaction
    : account.Transactions?.Transaction
      ? [account.Transactions.Transaction]
      : [];

  return {
    account: {
      maskedAccNumber: account.maskedAccNumber,
      balance: Number(summary.currentBalance).toFixed(2),
      currency: summary.currency,
      accountType: summary.type,
    },
    transactions: rawTxns.map((t: Record<string, string>) => ({
      direction: t.type === 'CREDIT' ? 'credit' : 'debit',
      amount: Number(t.amount).toFixed(2),
      txnDate: t.valueDate,
      narration: t.narration,
      sourceMetadata: {
        txnId: t.txnId,
        reference: t.reference,
        mode: t.mode,
        transactionTimestamp: t.transactionTimestamp,
      },
    })),
  };
}
```

- [ ] `apps/server/test/adapter/finvuXml.test.ts` — parse the **real captured fixture** (paste the full XML sample from this session — 36 transactions, account `XXXXX6065`, HDAFD2749G's account) as a constant in the test file. Assert: `account.maskedAccNumber === 'XXXXX6065'`, `account.balance === '39200.00'`, `transactions.length === 36`, first transaction `{direction: 'credit', amount: '1500.00', txnDate: '2025-01-05', narration: 'Salary Credit'}`, and that `sourceMetadata.txnId`/`sourceMetadata.reference` are both preserved even though they're equal in this sample (assert they're present as separate keys, not that they differ — the fixture happens to have them equal, the code must not assume that).

- [ ] `apps/server/src/adapter/finvuAdapter.ts` — the 6 `AaAdapter` methods. Uses `db` directly (same as every other adapter file) to read/update the `consents` row's `rawJson` for the Finvu-side identifiers (`consentHandle`, real `consentId`, `custId`, FI-request `sessionId`) — no new table, mirrors how `consents.rawJson` is already jsonb in the M0 schema:
```ts
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { accounts, consents, transactions } from '../db/schema.js';
import type { AaAdapter } from './AaAdapter.js';
import type { Bank } from './banks.js';
import { SUPPORTED_BANKS } from './banks.js';
import { getFinvuConfig } from './finvuConfig.js';
import { getFinvuToken } from './finvuAuth.js';
import { parseFinvuAccountXml } from './finvuXml.js';
import type { ToolResult } from './types.js';

async function finvuFetch(path: string, init: RequestInit = {}) {
  const config = getFinvuConfig();
  const token = await getFinvuToken();
  return fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

function mapConsentStatus(finvuStatus: string): string {
  if (finvuStatus === 'ACCEPTED' || finvuStatus === 'ACTIVE') return 'ACTIVE';
  if (finvuStatus === 'PAUSED') return 'ACTIVE';
  if (finvuStatus === 'FAILED') return 'REJECTED';
  return finvuStatus; // PENDING, REJECTED, REVOKED, EXPIRED pass through
}

async function listSupportedBanks(): Promise<Bank[]> {
  try {
    const res = await finvuFetch('/fips/');
    if (!res.ok) throw new Error(`status ${res.status}`);
    const json = (await res.json()) as unknown;
    if (Array.isArray(json)) {
      return json
        .map((f) => (f && typeof f === 'object' ? (f as { fipId?: string; name?: string }) : null))
        .filter((f): f is { fipId: string; name: string } => !!f?.fipId && !!f.name)
        .map((f) => ({ fipId: f.fipId, name: f.name, logo: '' }));
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
      header: { ts: new Date().toISOString(), channelId: 'finsense', rid: crypto.randomUUID() },
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
  if (!res.ok) return { ok: false, error: { code: 'FINVU_ERROR', message: `ConsentRequestPlus failed: ${res.status}` } };
  const json = (await res.json()) as { body: { ConsentHandle: string; url?: string } };

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
      rawJson: { consentHandle: json.body.ConsentHandle, custId },
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
  const raw = consent.rawJson as { consentHandle: string; custId: string; consentId?: string };

  const res = await finvuFetch(`/ConsentStatus/${raw.consentHandle}/${raw.custId}`);
  if (!res.ok) return { ok: false, error: { code: 'FINVU_ERROR', message: `ConsentStatus failed: ${res.status}` } };
  const json = (await res.json()) as { body: { consentStatus: string; consentId: string | null } };

  const status = mapConsentStatus(json.body.consentStatus);
  await db
    .update(consents)
    .set({
      status: status as 'PENDING' | 'ACTIVE' | 'REJECTED' | 'REVOKED' | 'EXPIRED',
      aaConsentId: json.body.consentId ?? consent.aaConsentId,
      rawJson: { ...raw, consentId: json.body.consentId ?? raw.consentId },
    })
    .where(eq(consents.id, ourConsentId));

  return { ok: true, data: { status } };
};

// getConsentDetails, requestFinancialData, getDataStatus follow the same shape:
// look up our consent row by id, read the Finvu identifiers out of rawJson,
// call the corresponding Finsense endpoint, update rawJson/status as needed.
// getDataStatus is the one that does real ingestion — see below.

const getDataStatus: AaAdapter['getDataStatus'] = async (sessionId) => {
  const [consent] = await db.select().from(consents).where(eq(consents.id, sessionId));
  if (!consent) return { ok: false, error: { code: 'SESSION_NOT_FOUND', message: sessionId } };
  const raw = consent.rawJson as {
    consentHandle: string; custId: string; consentId: string; finvuSessionId: string;
  };

  const [existingAccount] = await db.select().from(accounts).where(eq(accounts.consentId, consent.id));
  if (existingAccount) return { ok: true, data: { status: 'READY', fetchedAt: existingAccount.fetchedAt.toISOString() } };

  const statusRes = await finvuFetch(
    `/FIStatus/${raw.consentId}/${raw.finvuSessionId}/${raw.consentHandle}/${raw.custId}`
  );
  if (!statusRes.ok) return { ok: false, error: { code: 'FINVU_ERROR', message: `FIStatus failed: ${statusRes.status}` } };
  const statusJson = (await statusRes.json()) as { body: { fiRequestStatus: 'PENDING' | 'READY' } };
  if (statusJson.body.fiRequestStatus !== 'READY') return { ok: true, data: { status: 'PENDING', fetchedAt: null } };

  const dataRes = await finvuFetch(`/FIDataFetch/${raw.consentHandle}/${raw.finvuSessionId}`);
  if (!dataRes.ok) return { ok: false, error: { code: 'FINVU_ERROR', message: `FIDataFetch failed: ${dataRes.status}` } };
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

export const finvuAdapter: AaAdapter = {
  listSupportedBanks,
  initiateConsent,
  checkConsentStatus,
  getConsentDetails: async (ourConsentId) => {
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
  },
  requestFinancialData: async (ourConsentId) => {
    const [consent] = await db.select().from(consents).where(eq(consents.id, ourConsentId));
    if (!consent) return { ok: false, error: { code: 'CONSENT_NOT_FOUND', message: ourConsentId } };
    if (consent.status !== 'ACTIVE') {
      return { ok: false, error: { code: 'CONSENT_NOT_ACTIVE', message: `Consent is ${consent.status}` } };
    }
    const raw = consent.rawJson as { consentHandle: string; custId: string; consentId: string };
    const res = await finvuFetch('/FIRequest', {
      method: 'POST',
      body: JSON.stringify({
        header: { rid: crypto.randomUUID(), ts: new Date().toISOString(), channelId: 'finsense' },
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
      .set({ rawJson: { ...raw, finvuSessionId: json.body.sessionId } })
      .where(eq(consents.id, ourConsentId));
    return { ok: true, data: { sessionId: ourConsentId, status: 'PROCESSING' } };
  },
  getDataStatus,
};
```

- [ ] `apps/server/test/adapter/finvuAdapter.test.ts` — **never calls the real sandbox.** Inject a stub `fetch` (module-level override or a small seam parameter — follow whichever dependency-injection style `apps/server/src/categorize/llmFallback.ts` established for the same problem) that returns canned JSON/XML responses matching the shapes captured in this session (login → token; `ConsentRequestPlus` → `{ConsentHandle, url}`; `ConsentStatus` → `PENDING` then `ACCEPTED`; `FIRequest` → `{sessionId}`; `FIStatus` → `PENDING` then `READY`; `FIDataFetch` → the real captured XML fixture). Cover: the full `initiateConsent` → `checkConsentStatus` → `requestFinancialData` → `getDataStatus` chain ends with 36 real transactions inserted, correctly mapped (credit/debit, amounts, dates); `getDataStatus` called a second time after ingestion doesn't re-insert (idempotency, same pattern as every other data-ingestion path in this project); a non-`ACTIVE` consent blocks `requestFinancialData` with `CONSENT_NOT_ACTIVE`, matching mock mode's behavior exactly.

- [ ] Run full suite + typecheck, confirm green.

---

### Task 4: Deploy `apps/server` to Railway (checklist, not code)

Spec §6 calls for Railway specifically because Vercel serverless doesn't suit a long-lived MCP session. This is an account/billing action — walk through it yourself (or hand this checklist to an implementer who has your Railway credentials); no agent should create/pay for cloud infrastructure unattended.

- [ ] Create a Railway project, connect the GitHub repo, set the root/build context to `apps/server` (Nixpacks pointed at `apps/server`, or a `Dockerfile` — whichever Railway's current UI makes easiest when you're there).
- [ ] Provision a Postgres instance on Railway (or point `DATABASE_URL` at any reachable Postgres, including your existing Supabase project's Postgres — your call).
- [ ] Set env vars on Railway: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `ANTHROPIC_API_KEY`, `PORT` (Railway sets this automatically), and `MOCK_MODE` (`true` is the safe default per spec's own P0 metric; if you set it to `false` for a real-data demo, also set `FINVU_BASE_URL`, `FINVU_CHANNEL_USER_ID`, `FINVU_CHANNEL_PASSWORD`, `FINVU_AA_ID`, `FINVU_TEMPLATE_NAME`, `FINVU_REDIRECT_URL` — see Task 3).
- [ ] Run migrations against the Railway Postgres (`pnpm --filter @switch/server db:migrate`) and seed it (`pnpm --filter @switch/server db:seed`) so the deployed demo has data on first load.
- [ ] Confirm `https://<your-railway-domain>/mcp` responds (same shape as the local MCP Inspector check from M1 Task 7, just against the deployed URL).

---

### Task 5: Install the connector in Claude.ai (checklist, not code)

- [ ] In Claude.ai → Settings → Connectors → Add custom connector, point it at `https://<your-railway-domain>/mcp`.
- [ ] Generate a connector token for your demo user via `POST /api/connector-tokens` (Task 2) and supply it wherever Claude.ai's custom-connector UI asks for a bearer token / API key.
- [ ] Confirm Claude.ai's tool picker shows all 12 tools.
- [ ] Rehearse spec §13's demo script end-to-end against the deployed connector: the Goa-trip question (grounded via `summarize_finances`), the memory beat (`remember` a rule, later answer respects it via `recall`), and the consent-revoke trust close. If `MOCK_MODE=false`, budget extra time for the real OTP+browser consent approval step (see Global Constraints).

---

## What M5 does not include

- OAuth 2.1 for the connector (spec's own stated roadmap item, not a hackathon requirement).
- `apps/web` deployment to Vercel — spec mentions it but no milestone's success metric requires the *dashboard* to be publicly hosted for the demo (the MCP connector does need to be, since Claude.ai calls it remotely); add this only if the demo plan changes to need it.
- Parsing/persisting `<Profile><Holders>` PII from the FI data response — deliberate decision, see Global Constraints.
- Non-`deposit` FI types (insurance, equities, GSTN, mutual funds — all visible in the Simulator Bank picker) — the schema and adapter here only handle `DEPOSIT`/bank-account data, matching everything built in M0-M4. Extending to other FI types is a new schema + parsing effort, not assumed here.
