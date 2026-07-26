# M1 — MCP Core on Mock Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build MCP tools 1–8 from spec §8 (`list_supported_banks`, `initiate_consent`, `check_consent_status`, `get_consent_details`, `request_financial_data`, `get_data_status`, `fetch_accounts`, `fetch_transactions`) against the mock adapter, expose them over a real MCP server (Streamable HTTP transport), and prove they're callable end-to-end — so M2 (categorize + aggregate) has real consent/account/transaction plumbing to build on, and the project hits success metric "≥ 8 of 10 MCP tools callable and correct from an external MCP client."

**Architecture:** Two parallel layers per tool domain — a pure `adapter/*.ts` module (DB reads/writes against the M0 schema, no MCP concerns, directly integration-testable) and a thin `mcp/tools/*.ts` wrapper (audit logging + calling the adapter). `mcp/server.ts` registers all 8 wrappers with `@modelcontextprotocol/sdk`'s `McpServer` using Zod schemas from `mcp/schemas.ts`. `src/index.ts` exposes that server over Express via `StreamableHTTPServerTransport` at `/mcp`. Tools 9–10 (`categorize_transactions`, `summarize_finances`) are explicitly out of scope — that's M2, per spec §14 build plan ("Phase 1: Tools 1–8 on mock adapter" vs "Phase 3: categorize + aggregate").

**Tech Stack:** `@modelcontextprotocol/sdk` (TS, Streamable HTTP transport), `zod`, `express`, plus everything from M0 (Drizzle, `pg`, `date-fns`, Vitest, `tsx`).

## Global Constraints

- Language: TypeScript end-to-end (per `ideas/prd.md` §6). All new files under `apps/server/src`.
- MCP tool scope for M1 is exactly tools 1–8 from spec §8. Do not implement `categorize_transactions` or `summarize_finances` — those are M2.
- Single implicit demo user. Per spec, none of the 10 tool inputs take a `user_id` — auth (bearer token, spec §11) is out of scope until M5's connector deploy. Every tool handler resolves "the current user" via `getDemoUserId()`, which looks up the M0-seeded `demo@switch.app` user. If that user isn't seeded, tools must fail with a clear error telling the operator to run `pnpm db:seed`.
- No new DB tables. The spec's data model (§10) has no `sessions` table despite tools 5/6 (`request_financial_data`/`get_data_status`) being framed as an async two-step poll. For the mock adapter, `request_financial_data` completes synchronously (inserts account + transactions immediately) and reuses `consent_id` as the `session_id` — `get_data_status` re-derives READY/PENDING by checking whether an account exists for that consent. This is a mock-mode simplification; the real Finvu adapter (M5) will need genuine async session tracking, noted here so it isn't forgotten.
- Consent semantics: `initiate_consent` creates a `PENDING` consent. `check_consent_status`, when called on a `PENDING` consent, mock-approves it (flips to `ACTIVE`) — simulating the user having approved in the Finvu handle by the time the poll lands. This keeps the demo script's "poll until ACTIVE" beat truthful without real waiting or flakiness in tests.
- Server-side consent enforcement (FR1, spec §11): every data-serving tool (`fetch_accounts`, `fetch_transactions`) re-checks the underlying consent's status on every call and hard-blocks with a `CONSENT_NOT_ACTIVE` error if it isn't `ACTIVE` — never relies on a prior check. There is no `revoke_consent` MCP tool (revocation is a web-app/dashboard action per spec §5 demo script step 6 — that's M3); M1 only needs to prove that data tools already respect a non-ACTIVE consent, which we do by updating a consent's status directly in a test.
- `transactions.category` / `.confidence` will be `null` for all mock data until M2's categorizer runs. `fetch_transactions`'s `category` filter and output field both work today, they just won't match/populate anything until then.
- `packages/shared` remains deferred (per M0's plan) — there's still only one consumer of these types (`apps/server`) since M1 has no REST layer and no web app yet. Zod schemas and TS types live in `apps/server/src/mcp` and `apps/server/src/adapter`.
- REST (`/api/*`) is deferred. Spec §6/§7 mention it as a rationale for a single Express service, but no milestone needs it yet (M3's dashboard is the first web consumer). This plan only wires `/mcp`.
- Tool functions are unit/integration-tested directly with Vitest (per spec §6 "Dev/test: tsx, vitest (tool functions only)"). Full-protocol verification uses the MCP SDK's in-memory transport (Task 6, automated) and, manually, the MCP Inspector against the running HTTP server (Task 7, a documented manual step — not an automated test).
- All new integration tests seed their own data via `runSeed(new Date('2026-07-20T00:00:00Z'))` in `beforeAll`, matching the pattern established in `apps/server/test/db/seed.test.ts` — never assume a pre-seeded DB.
- Do not commit anything outside the files each task lists.

---

### Task 1: Adapter types + demo user resolver + audit logging

**Files:**
- Create: `apps/server/src/adapter/types.ts`
- Create: `apps/server/src/adapter/demoUser.ts`
- Create: `apps/server/src/mcp/audit.ts`
- Test: `apps/server/test/mcp/audit.test.ts`

**Interfaces:**
- Consumes: `db` from `apps/server/src/db/client.js` (M0); `users`, `auditLog` tables from `apps/server/src/db/schema.js` (M0); `runSeed` from `apps/server/src/db/seed/seed.js` (M0, test only).
- Produces: `ToolError`, `ToolResult<T>` types; `DEMO_USER_EMAIL`, `getDemoUserId(): Promise<string>`; `withAudit<T>(tool: string, userId: string | null, input: unknown, fn: () => Promise<T>): Promise<T>` — every later task's tool wrapper calls `withAudit`.

- [ ] **Step 1: Write the failing audit test**

`apps/server/test/mcp/audit.test.ts`:
```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { auditLog } from '../../src/db/schema.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { getDemoUserId } from '../../src/adapter/demoUser.js';
import { withAudit } from '../../src/mcp/audit.js';

describe('withAudit', () => {
  let userId: string;

  beforeAll(async () => {
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    userId = await getDemoUserId();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('records a successful call and returns the wrapped result', async () => {
    const result = await withAudit('test_tool_ok', userId, { a: 1 }, async () => 42);
    expect(result).toBe(42);

    const rows = await db.select().from(auditLog).where(eq(auditLog.tool, 'test_tool_ok'));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('ok');
    expect(rows[0].actor).toBe('mcp');
    expect(rows[0].userId).toBe(userId);
    expect(rows[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('records a failed call and rethrows', async () => {
    await expect(
      withAudit('test_tool_fail', userId, { a: 1 }, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    const rows = await db.select().from(auditLog).where(eq(auditLog.tool, 'test_tool_fail'));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('error');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Ensure Postgres is running (`pnpm db:up`, migrated via `pnpm db:migrate` if not already). Run:
`pnpm --filter @switch/server exec vitest run test/mcp/audit.test.ts`
Expected: FAIL — cannot find module `../../src/adapter/demoUser.js` (or `../../src/mcp/audit.js`).

- [ ] **Step 3: Write the shared adapter types**

`apps/server/src/adapter/types.ts`:
```ts
export interface ToolError {
  code: string;
  message: string;
}

export type ToolResult<T> = { ok: true; data: T } | { ok: false; error: ToolError };
```

- [ ] **Step 4: Write the demo user resolver**

`apps/server/src/adapter/demoUser.ts`:
```ts
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';

export const DEMO_USER_EMAIL = 'demo@switch.app';

export async function getDemoUserId(): Promise<string> {
  const [user] = await db.select().from(users).where(eq(users.email, DEMO_USER_EMAIL));
  if (!user) {
    throw new Error(`Demo user not found. Run "pnpm db:seed" first.`);
  }
  return user.id;
}
```

- [ ] **Step 5: Write the audit logger**

`apps/server/src/mcp/audit.ts`:
```ts
import { createHash } from 'node:crypto';
import { db } from '../db/client.js';
import { auditLog } from '../db/schema.js';

async function recordAudit(params: {
  userId: string | null;
  tool: string;
  input: unknown;
  status: 'ok' | 'error';
  latencyMs: number;
}) {
  const inputHash = createHash('sha256').update(JSON.stringify(params.input)).digest('hex');
  await db.insert(auditLog).values({
    userId: params.userId,
    actor: 'mcp',
    tool: params.tool,
    inputHash,
    status: params.status,
    latencyMs: params.latencyMs,
  });
}

export async function withAudit<T>(
  tool: string,
  userId: string | null,
  input: unknown,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    await recordAudit({ userId, tool, input, status: 'ok', latencyMs: Date.now() - start });
    return result;
  } catch (err) {
    await recordAudit({ userId, tool, input, status: 'error', latencyMs: Date.now() - start });
    throw err;
  }
}
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `pnpm --filter @switch/server exec vitest run test/mcp/audit.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/adapter/types.ts apps/server/src/adapter/demoUser.ts apps/server/src/mcp/audit.ts apps/server/test/mcp/audit.test.ts
git commit -m "feat(server): add adapter types, demo user resolver, and MCP audit logging"
```

---

### Task 2: `list_supported_banks`

**Files:**
- Create: `apps/server/src/adapter/banks.ts`
- Create: `apps/server/src/mcp/tools/banks.ts`
- Test: `apps/server/test/mcp/banks.test.ts`

**Interfaces:**
- Consumes: `withAudit` (Task 1), `getDemoUserId` (Task 1, test only).
- Produces: `Bank` type, `SUPPORTED_BANKS` array, `listSupportedBanks(): Bank[]`; `listSupportedBanksTool(userId: string | null): Promise<ToolResult<Bank[]>>` — consumed by `mcp/server.ts` (Task 6) and by Task 3's `initiate_consent` (which validates `fip_id` against `SUPPORTED_BANKS`).

- [ ] **Step 1: Write the failing test**

`apps/server/test/mcp/banks.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../src/db/client.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { getDemoUserId } from '../../src/adapter/demoUser.js';
import { listSupportedBanksTool } from '../../src/mcp/tools/banks.js';

describe('listSupportedBanksTool', () => {
  let userId: string;

  beforeAll(async () => {
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    userId = await getDemoUserId();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns the HDFC and ICICI mock banks with matching fip_ids', async () => {
    const result = await listSupportedBanksTool(userId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([
      { fipId: 'hdfc-bank', name: 'HDFC Bank', logo: expect.any(String) },
      { fipId: 'icici-bank', name: 'ICICI Bank', logo: expect.any(String) },
    ]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @switch/server exec vitest run test/mcp/banks.test.ts`
Expected: FAIL — cannot find module `../../src/mcp/tools/banks.js`

- [ ] **Step 3: Implement the bank catalog**

`apps/server/src/adapter/banks.ts`:
```ts
export interface Bank {
  fipId: string;
  name: string;
  logo: string;
}

export const SUPPORTED_BANKS: Bank[] = [
  { fipId: 'hdfc-bank', name: 'HDFC Bank', logo: 'https://mock-aa.switch.app/logos/hdfc-bank.png' },
  { fipId: 'icici-bank', name: 'ICICI Bank', logo: 'https://mock-aa.switch.app/logos/icici-bank.png' },
];

export function listSupportedBanks(): Bank[] {
  return SUPPORTED_BANKS;
}
```

Note: `fipId` values match exactly what `apps/server/src/db/seed/seed.ts` derives from `acc.bank` (`bank.toLowerCase().replace(/\s+/g, '-')`), so the M0-seeded consents/accounts line up with this catalog.

- [ ] **Step 4: Implement the tool wrapper**

`apps/server/src/mcp/tools/banks.ts`:
```ts
import { listSupportedBanks, type Bank } from '../../adapter/banks.js';
import type { ToolResult } from '../../adapter/types.js';
import { withAudit } from '../audit.js';

export async function listSupportedBanksTool(userId: string | null): Promise<ToolResult<Bank[]>> {
  return withAudit('list_supported_banks', userId, {}, async () => ({
    ok: true as const,
    data: listSupportedBanks(),
  }));
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm --filter @switch/server exec vitest run test/mcp/banks.test.ts`
Expected: PASS (1 test)

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/adapter/banks.ts apps/server/src/mcp/tools/banks.ts apps/server/test/mcp/banks.test.ts
git commit -m "feat(server): add list_supported_banks tool"
```

---

### Task 3: Consent tools — `initiate_consent`, `check_consent_status`, `get_consent_details`

**Files:**
- Create: `apps/server/src/adapter/consent.ts`
- Create: `apps/server/src/mcp/tools/consent.ts`
- Test: `apps/server/test/mcp/consent.test.ts`

**Interfaces:**
- Consumes: `SUPPORTED_BANKS` (Task 2); `withAudit`, `getDemoUserId` (Task 1); `consents` table (M0 schema).
- Produces: `InitiateConsentInput`, `ConsentSummary`, `ConsentDetails` types; `initiateConsent`, `checkConsentStatus`, `getConsentDetails` adapter functions; `initiateConsentTool`, `checkConsentStatusTool`, `getConsentDetailsTool` — consumed by `mcp/server.ts` (Task 6) and by Task 4's `request_financial_data` (which requires an `ACTIVE` consent produced by this flow).

- [ ] **Step 1: Write the failing test**

`apps/server/test/mcp/consent.test.ts`:
```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../src/db/client.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { getDemoUserId } from '../../src/adapter/demoUser.js';
import {
  checkConsentStatusTool,
  getConsentDetailsTool,
  initiateConsentTool,
} from '../../src/mcp/tools/consent.js';

describe('consent tools', () => {
  let userId: string;

  beforeAll(async () => {
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    userId = await getDemoUserId();
  });

  afterAll(async () => {
    await pool.end();
  });

  const baseInput = {
    mobile: '9876543210',
    fipId: 'icici-bank',
    purpose: 'Personal finance management',
    fromDate: '2025-01-01',
    toDate: '2026-07-20',
    expiryDays: 365,
    fiTypes: ['DEPOSIT'],
  };

  it('initiates a PENDING consent, flips ACTIVE on first status check, stays ACTIVE after', async () => {
    const initiated = await initiateConsentTool(userId, baseInput);
    expect(initiated.ok).toBe(true);
    if (!initiated.ok) return;
    expect(initiated.data.status).toBe('PENDING');
    expect(initiated.data.approvalUrl).toContain(initiated.data.consentId);

    const firstCheck = await checkConsentStatusTool(userId, { consentId: initiated.data.consentId });
    expect(firstCheck).toEqual({ ok: true, data: { status: 'ACTIVE' } });

    const secondCheck = await checkConsentStatusTool(userId, { consentId: initiated.data.consentId });
    expect(secondCheck).toEqual({ ok: true, data: { status: 'ACTIVE' } });
  });

  it('returns full consent details', async () => {
    const initiated = await initiateConsentTool(userId, baseInput);
    if (!initiated.ok) throw new Error('setup failed');

    const details = await getConsentDetailsTool(userId, { consentId: initiated.data.consentId });
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

  it('rejects an unsupported fip_id', async () => {
    const result = await initiateConsentTool(userId, { ...baseInput, fipId: 'unknown-bank' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNSUPPORTED_BANK');
  });

  it('returns CONSENT_NOT_FOUND for an unknown consent id', async () => {
    const result = await checkConsentStatusTool(userId, { consentId: '00000000-0000-0000-0000-000000000000' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONSENT_NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @switch/server exec vitest run test/mcp/consent.test.ts`
Expected: FAIL — cannot find module `../../src/mcp/tools/consent.js`

- [ ] **Step 3: Implement the consent adapter**

`apps/server/src/adapter/consent.ts`:
```ts
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { consents } from '../db/schema.js';
import { SUPPORTED_BANKS } from './banks.js';
import type { ToolResult } from './types.js';

const DATA_LIFE = '1 year';

export interface InitiateConsentInput {
  userId: string;
  mobile: string;
  fipId: string;
  purpose: string;
  fromDate: string;
  toDate: string;
  expiryDays: number;
  fiTypes: string[];
}

export interface ConsentSummary {
  consentId: string;
  approvalUrl: string;
  status: string;
}

export interface ConsentDetails {
  purpose: string;
  fiTypes: string[];
  dateRange: { from: string; to: string };
  expiry: string;
  dataLife: string | null;
}

export async function initiateConsent(input: InitiateConsentInput): Promise<ToolResult<ConsentSummary>> {
  const bank = SUPPORTED_BANKS.find((b) => b.fipId === input.fipId);
  if (!bank) {
    return {
      ok: false,
      error: { code: 'UNSUPPORTED_BANK', message: `No supported bank with fip_id "${input.fipId}"` },
    };
  }

  const expiryAt = new Date(Date.now() + input.expiryDays * 24 * 60 * 60 * 1000);

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
      expiryAt,
      dataLife: DATA_LIFE,
      rawJson: { mobile: input.mobile },
    })
    .returning();

  return {
    ok: true,
    data: {
      consentId: consent.id,
      approvalUrl: `https://mock-finvu.sandbox/approve/${consent.id}`,
      status: consent.status,
    },
  };
}

export async function checkConsentStatus(consentId: string): Promise<ToolResult<{ status: string }>> {
  const [consent] = await db.select().from(consents).where(eq(consents.id, consentId));
  if (!consent) {
    return { ok: false, error: { code: 'CONSENT_NOT_FOUND', message: `No consent with id "${consentId}"` } };
  }

  if (consent.status === 'PENDING') {
    const [updated] = await db
      .update(consents)
      .set({ status: 'ACTIVE', aaConsentId: `mock-consent-${consent.id}` })
      .where(eq(consents.id, consentId))
      .returning();
    return { ok: true, data: { status: updated.status } };
  }

  return { ok: true, data: { status: consent.status } };
}

export async function getConsentDetails(consentId: string): Promise<ToolResult<ConsentDetails>> {
  const [consent] = await db.select().from(consents).where(eq(consents.id, consentId));
  if (!consent) {
    return { ok: false, error: { code: 'CONSENT_NOT_FOUND', message: `No consent with id "${consentId}"` } };
  }
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
}
```

- [ ] **Step 4: Implement the tool wrappers**

`apps/server/src/mcp/tools/consent.ts`:
```ts
import {
  checkConsentStatus,
  getConsentDetails,
  initiateConsent,
  type ConsentDetails,
  type ConsentSummary,
  type InitiateConsentInput,
} from '../../adapter/consent.js';
import type { ToolResult } from '../../adapter/types.js';
import { withAudit } from '../audit.js';

export async function initiateConsentTool(
  userId: string,
  input: Omit<InitiateConsentInput, 'userId'>
): Promise<ToolResult<ConsentSummary>> {
  return withAudit('initiate_consent', userId, input, () => initiateConsent({ ...input, userId }));
}

export async function checkConsentStatusTool(
  userId: string,
  input: { consentId: string }
): Promise<ToolResult<{ status: string }>> {
  return withAudit('check_consent_status', userId, input, () => checkConsentStatus(input.consentId));
}

export async function getConsentDetailsTool(
  userId: string,
  input: { consentId: string }
): Promise<ToolResult<ConsentDetails>> {
  return withAudit('get_consent_details', userId, input, () => getConsentDetails(input.consentId));
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `pnpm --filter @switch/server exec vitest run test/mcp/consent.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/adapter/consent.ts apps/server/src/mcp/tools/consent.ts apps/server/test/mcp/consent.test.ts
git commit -m "feat(server): add initiate_consent, check_consent_status, get_consent_details tools"
```

---

### Task 4: Data fetch tools — `request_financial_data`, `get_data_status`

**Files:**
- Modify: `apps/server/src/db/seed/mockData.ts` (add `generateMockAccountData`)
- Test: `apps/server/test/db/mockData.test.ts` (add coverage for the new helper)
- Create: `apps/server/src/adapter/dataFetch.ts`
- Create: `apps/server/src/mcp/tools/dataFetch.ts`
- Test: `apps/server/test/mcp/dataFetch.test.ts`

**Interfaces:**
- Consumes: `initiateConsentTool`, `checkConsentStatusTool` (Task 3, test only); `withAudit`, `getDemoUserId` (Task 1); `accounts`, `transactions`, `consents` tables (M0 schema).
- Produces: `generateMockAccountData(fipId: string, now: Date): { account: MockAccount; transactions: MockTransaction[] } | null` (consumed by this task's adapter); `requestFinancialData`, `getDataStatus` adapter functions; `requestFinancialDataTool`, `getDataStatusTool` — consumed by `mcp/server.ts` (Task 6) and by Task 5 (`fetch_accounts`/`fetch_transactions` need this task's data to exist first).

- [ ] **Step 1: Write the failing test for the new mock-data helper**

Add to `apps/server/test/db/mockData.test.ts` (append inside the existing `describe('generateMockDataset', ...)` block's file, as a new top-level `describe`):
```ts
import { describe, expect, it } from 'vitest';
import { generateMockAccountData, generateMockDataset } from '../../src/db/seed/mockData.js';

describe('generateMockAccountData', () => {
  const now = new Date('2026-07-20T00:00:00Z');

  it('returns the HDFC account and its transactions for fip_id "hdfc-bank"', () => {
    const result = generateMockAccountData('hdfc-bank', now);
    expect(result).not.toBeNull();
    expect(result?.account.bank).toBe('HDFC Bank');
    expect(result?.transactions.every((t) => t.accountKey === result.account.key)).toBe(true);
  });

  it('returns null for an unknown fip_id', () => {
    expect(generateMockAccountData('unknown-bank', now)).toBeNull();
  });

  it('matches the transactions for that account in the full dataset', () => {
    const full = generateMockDataset(now);
    const result = generateMockAccountData('icici-bank', now);
    const expected = full.transactions.filter((t) => t.accountKey === 'acc2');
    expect(result?.transactions).toEqual(expected);
  });
});
```
(Note: this file already has its own top-level `import` statements from M0 — adding a second `import` block for `generateMockAccountData` in the same file will collide. In Step 1, edit the existing top import line instead of adding a new one — see Step 2.)

- [ ] **Step 2: Fix the import and run the test to confirm it fails**

Edit the top of `apps/server/test/db/mockData.test.ts` — change:
```ts
import { generateMockDataset } from '../../src/db/seed/mockData.js';
```
to:
```ts
import { generateMockAccountData, generateMockDataset } from '../../src/db/seed/mockData.js';
```
Then remove the duplicate `import` line added in Step 1's snippet (keep only the `describe('generateMockAccountData', ...)` block itself, appended after the existing `describe('generateMockDataset', ...)` block).

Run: `pnpm --filter @switch/server exec vitest run test/db/mockData.test.ts`
Expected: FAIL — `generateMockAccountData` is not exported by `mockData.ts`

- [ ] **Step 3: Add the helper to mockData.ts**

Append to the end of `apps/server/src/db/seed/mockData.ts`:
```ts
export function generateMockAccountData(
  fipId: string,
  now: Date
): { account: MockAccount; transactions: MockTransaction[] } | null {
  const dataset = generateMockDataset(now);
  const account = dataset.accounts.find((a) => a.bank.toLowerCase().replace(/\s+/g, '-') === fipId);
  if (!account) {
    return null;
  }
  const transactions = dataset.transactions.filter((t) => t.accountKey === account.key);
  return { account, transactions };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @switch/server exec vitest run test/db/mockData.test.ts`
Expected: PASS (11 tests — 8 original + 3 new)

- [ ] **Step 5: Write the failing integration test for the data-fetch tools**

`apps/server/test/mcp/dataFetch.test.ts`:
```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { accounts } from '../../src/db/schema.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { getDemoUserId } from '../../src/adapter/demoUser.js';
import { checkConsentStatusTool, initiateConsentTool } from '../../src/mcp/tools/consent.js';
import { getDataStatusTool, requestFinancialDataTool } from '../../src/mcp/tools/dataFetch.js';

describe('data fetch tools', () => {
  let userId: string;

  beforeAll(async () => {
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    userId = await getDemoUserId();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function activeConsentId(): Promise<string> {
    const initiated = await initiateConsentTool(userId, {
      mobile: '9876543210',
      fipId: 'icici-bank',
      purpose: 'Personal finance management',
      fromDate: '2025-01-01',
      toDate: '2026-07-20',
      expiryDays: 365,
      fiTypes: ['DEPOSIT'],
    });
    if (!initiated.ok) throw new Error('setup failed');
    await checkConsentStatusTool(userId, { consentId: initiated.data.consentId });
    return initiated.data.consentId;
  }

  it('fetches data synchronously, is idempotent, and reports READY via get_data_status', async () => {
    const consentId = await activeConsentId();

    const first = await requestFinancialDataTool(userId, { consentId });
    expect(first).toEqual({ ok: true, data: { sessionId: consentId, status: 'READY' } });

    const second = await requestFinancialDataTool(userId, { consentId });
    expect(second).toEqual({ ok: true, data: { sessionId: consentId, status: 'READY' } });

    const rows = await db.select().from(accounts).where(eq(accounts.consentId, consentId));
    expect(rows).toHaveLength(1);

    const status = await getDataStatusTool(userId, { sessionId: consentId });
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.data.status).toBe('READY');
    expect(status.data.fetchedAt).toEqual(expect.any(String));
  });

  it('rejects request_financial_data on a PENDING (not yet ACTIVE) consent', async () => {
    const initiated = await initiateConsentTool(userId, {
      mobile: '9876543210',
      fipId: 'hdfc-bank',
      purpose: 'Personal finance management',
      fromDate: '2025-01-01',
      toDate: '2026-07-20',
      expiryDays: 365,
      fiTypes: ['DEPOSIT'],
    });
    if (!initiated.ok) throw new Error('setup failed');

    const result = await requestFinancialDataTool(userId, { consentId: initiated.data.consentId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONSENT_NOT_ACTIVE');
  });

  it('reports PENDING from get_data_status before request_financial_data has run', async () => {
    const consentId = await activeConsentId();
    const status = await getDataStatusTool(userId, { sessionId: consentId });
    expect(status).toEqual({ ok: true, data: { status: 'PENDING', fetchedAt: null } });
  });

  it('returns SESSION_NOT_FOUND for an unknown session id', async () => {
    const result = await getDataStatusTool(userId, { sessionId: '00000000-0000-0000-0000-000000000000' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SESSION_NOT_FOUND');
  });
});
```

- [ ] **Step 6: Run the test and confirm it fails**

Run: `pnpm --filter @switch/server exec vitest run test/mcp/dataFetch.test.ts`
Expected: FAIL — cannot find module `../../src/mcp/tools/dataFetch.js`

- [ ] **Step 7: Implement the data-fetch adapter**

`apps/server/src/adapter/dataFetch.ts`:
```ts
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { accounts, consents, transactions } from '../db/schema.js';
import { generateMockAccountData } from '../db/seed/mockData.js';
import type { ToolResult } from './types.js';

export async function requestFinancialData(
  consentId: string
): Promise<ToolResult<{ sessionId: string; status: string }>> {
  const [consent] = await db.select().from(consents).where(eq(consents.id, consentId));
  if (!consent) {
    return { ok: false, error: { code: 'CONSENT_NOT_FOUND', message: `No consent with id "${consentId}"` } };
  }
  if (consent.status !== 'ACTIVE') {
    return {
      ok: false,
      error: { code: 'CONSENT_NOT_ACTIVE', message: `Consent "${consentId}" is ${consent.status}, expected ACTIVE` },
    };
  }

  const existing = await db.select().from(accounts).where(eq(accounts.consentId, consentId));
  if (existing.length === 0) {
    const mockData = generateMockAccountData(consent.fipId, new Date());
    if (!mockData) {
      return {
        ok: false,
        error: { code: 'NO_MOCK_DATA', message: `No mock data available for fip_id "${consent.fipId}"` },
      };
    }

    const now = new Date();
    const [account] = await db
      .insert(accounts)
      .values({
        userId: consent.userId,
        consentId: consent.id,
        bank: mockData.account.bank,
        type: mockData.account.type,
        maskedNumber: mockData.account.maskedNumber,
        balance: mockData.account.balance,
        currency: mockData.account.currency,
        fetchedAt: now,
      })
      .returning();

    const txnRows = mockData.transactions.map((t) => ({
      accountId: account.id,
      txnDate: t.txnDate,
      amount: t.amount,
      direction: t.direction,
      narration: t.narration,
      merchant: t.merchant,
    }));
    const BATCH = 100;
    for (let i = 0; i < txnRows.length; i += BATCH) {
      await db.insert(transactions).values(txnRows.slice(i, i + BATCH));
    }
  }

  return { ok: true, data: { sessionId: consent.id, status: 'READY' } };
}

export async function getDataStatus(
  sessionId: string
): Promise<ToolResult<{ status: string; fetchedAt: string | null }>> {
  const [consent] = await db.select().from(consents).where(eq(consents.id, sessionId));
  if (!consent) {
    return { ok: false, error: { code: 'SESSION_NOT_FOUND', message: `No session with id "${sessionId}"` } };
  }

  const [account] = await db.select().from(accounts).where(eq(accounts.consentId, sessionId));
  if (!account) {
    return { ok: true, data: { status: 'PENDING', fetchedAt: null } };
  }
  return { ok: true, data: { status: 'READY', fetchedAt: account.fetchedAt.toISOString() } };
}
```

- [ ] **Step 8: Implement the tool wrappers**

`apps/server/src/mcp/tools/dataFetch.ts`:
```ts
import { getDataStatus, requestFinancialData } from '../../adapter/dataFetch.js';
import type { ToolResult } from '../../adapter/types.js';
import { withAudit } from '../audit.js';

export async function requestFinancialDataTool(
  userId: string,
  input: { consentId: string }
): Promise<ToolResult<{ sessionId: string; status: string }>> {
  return withAudit('request_financial_data', userId, input, () => requestFinancialData(input.consentId));
}

export async function getDataStatusTool(
  userId: string,
  input: { sessionId: string }
): Promise<ToolResult<{ status: string; fetchedAt: string | null }>> {
  return withAudit('get_data_status', userId, input, () => getDataStatus(input.sessionId));
}
```

- [ ] **Step 9: Run the test and confirm it passes**

Run: `pnpm --filter @switch/server exec vitest run test/mcp/dataFetch.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 10: Commit**

```bash
git add apps/server/src/db/seed/mockData.ts apps/server/test/db/mockData.test.ts apps/server/src/adapter/dataFetch.ts apps/server/src/mcp/tools/dataFetch.ts apps/server/test/mcp/dataFetch.test.ts
git commit -m "feat(server): add request_financial_data and get_data_status tools"
```

---

### Task 5: Data-serving tools — `fetch_accounts`, `fetch_transactions`

**Files:**
- Create: `apps/server/src/adapter/accounts.ts`
- Create: `apps/server/src/adapter/transactions.ts`
- Create: `apps/server/src/mcp/tools/accounts.ts`
- Create: `apps/server/src/mcp/tools/transactions.ts`
- Test: `apps/server/test/mcp/accounts.test.ts`
- Test: `apps/server/test/mcp/transactions.test.ts`

**Interfaces:**
- Consumes: `withAudit`, `getDemoUserId` (Task 1); `accounts`, `consents`, `transactions` tables (M0 schema); the M0-seeded demo dataset (2 ACTIVE consents, 2 accounts, 400 transactions) directly, via `runSeed`.
- Produces: `AccountSummary`, `TransactionSummary`, `FetchTransactionsInput`, `FetchTransactionsOutput` types; `fetchAccounts`, `fetchTransactions` adapter functions; `fetchAccountsTool`, `fetchTransactionsTool` — consumed by `mcp/server.ts` (Task 6).

- [ ] **Step 1: Write the failing test for fetch_accounts**

`apps/server/test/mcp/accounts.test.ts`:
```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { consents } from '../../src/db/schema.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { getDemoUserId } from '../../src/adapter/demoUser.js';
import { fetchAccountsTool } from '../../src/mcp/tools/accounts.js';

describe('fetchAccountsTool', () => {
  let userId: string;

  beforeAll(async () => {
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    userId = await getDemoUserId();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns the one account tied to a given ACTIVE consent', async () => {
    const [consent] = await db
      .select()
      .from(consents)
      .where(eq(consents.userId, userId))
      .orderBy(consents.fipId)
      .limit(1);

    const result = await fetchAccountsTool(userId, { consentId: consent.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      type: 'SAVINGS',
      currency: 'INR',
    });
  });

  it('blocks fetch_accounts once the consent is REVOKED', async () => {
    const [consent] = await db
      .select()
      .from(consents)
      .where(eq(consents.userId, userId))
      .orderBy(consents.fipId)
      .limit(1);
    await db.update(consents).set({ status: 'REVOKED' }).where(eq(consents.id, consent.id));

    const result = await fetchAccountsTool(userId, { consentId: consent.id });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONSENT_NOT_ACTIVE');
  });

  it('returns CONSENT_NOT_FOUND for an unknown consent id', async () => {
    const result = await fetchAccountsTool(userId, { consentId: '00000000-0000-0000-0000-000000000000' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONSENT_NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @switch/server exec vitest run test/mcp/accounts.test.ts`
Expected: FAIL — cannot find module `../../src/mcp/tools/accounts.js`

- [ ] **Step 3: Implement the accounts adapter + tool wrapper**

`apps/server/src/adapter/accounts.ts`:
```ts
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { accounts, consents } from '../db/schema.js';
import type { ToolResult } from './types.js';

export interface AccountSummary {
  accountId: string;
  type: string;
  maskedNumber: string;
  bank: string;
  balance: string;
  currency: string;
}

export async function fetchAccounts(consentId: string): Promise<ToolResult<AccountSummary[]>> {
  const [consent] = await db.select().from(consents).where(eq(consents.id, consentId));
  if (!consent) {
    return { ok: false, error: { code: 'CONSENT_NOT_FOUND', message: `No consent with id "${consentId}"` } };
  }
  if (consent.status !== 'ACTIVE') {
    return {
      ok: false,
      error: { code: 'CONSENT_NOT_ACTIVE', message: `Consent "${consentId}" is ${consent.status}, expected ACTIVE` },
    };
  }

  const rows = await db.select().from(accounts).where(eq(accounts.consentId, consentId));
  return {
    ok: true,
    data: rows.map((r) => ({
      accountId: r.id,
      type: r.type,
      maskedNumber: r.maskedNumber,
      bank: r.bank,
      balance: r.balance,
      currency: r.currency,
    })),
  };
}
```

`apps/server/src/mcp/tools/accounts.ts`:
```ts
import { fetchAccounts, type AccountSummary } from '../../adapter/accounts.js';
import type { ToolResult } from '../../adapter/types.js';
import { withAudit } from '../audit.js';

export async function fetchAccountsTool(
  userId: string,
  input: { consentId: string }
): Promise<ToolResult<AccountSummary[]>> {
  return withAudit('fetch_accounts', userId, input, () => fetchAccounts(input.consentId));
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @switch/server exec vitest run test/mcp/accounts.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing test for fetch_transactions**

`apps/server/test/mcp/transactions.test.ts`:
```ts
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { accounts, consents } from '../../src/db/schema.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { getDemoUserId } from '../../src/adapter/demoUser.js';
import { fetchTransactionsTool } from '../../src/mcp/tools/transactions.js';

describe('fetchTransactionsTool', () => {
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    userId = await getDemoUserId();
    const [account] = await db.select().from(accounts).orderBy(accounts.bank).limit(1);
    accountId = account.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('paginates with a default limit of 50 and exposes a cursor', async () => {
    const first = await fetchTransactionsTool(userId, { accountId });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.transactions).toHaveLength(50);
    expect(first.data.nextCursor).not.toBeNull();

    const second = await fetchTransactionsTool(userId, { accountId, cursor: first.data.nextCursor! });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const firstIds = new Set(first.data.transactions.map((t) => t.txnId));
    for (const txn of second.data.transactions) {
      expect(firstIds.has(txn.txnId)).toBe(false);
    }
  });

  it('filters by date range', async () => {
    const result = await fetchTransactionsTool(userId, {
      accountId,
      from: '2026-07-01',
      to: '2026-07-31',
      limit: 500,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const txn of result.data.transactions) {
      expect(txn.date >= '2026-07-01' && txn.date <= '2026-07-31').toBe(true);
    }
  });

  it('blocks fetch_transactions once the owning consent is REVOKED', async () => {
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    await db.update(consents).set({ status: 'REVOKED' }).where(eq(consents.id, account.consentId));

    const result = await fetchTransactionsTool(userId, { accountId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONSENT_NOT_ACTIVE');
  });

  it('returns ACCOUNT_NOT_FOUND for an unknown account id', async () => {
    const result = await fetchTransactionsTool(userId, { accountId: '00000000-0000-0000-0000-000000000000' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ACCOUNT_NOT_FOUND');
  });
});
```

- [ ] **Step 6: Run the test and confirm it fails**

Run: `pnpm --filter @switch/server exec vitest run test/mcp/transactions.test.ts`
Expected: FAIL — cannot find module `../../src/mcp/tools/transactions.js`

- [ ] **Step 7: Implement the transactions adapter + tool wrapper**

`apps/server/src/adapter/transactions.ts`:
```ts
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { db } from '../db/client.js';
import { accounts, consents, transactions } from '../db/schema.js';
import type { ToolResult } from './types.js';

export interface TransactionSummary {
  txnId: string;
  date: string;
  amount: string;
  direction: 'credit' | 'debit';
  narration: string;
  merchant: string | null;
  category: string | null;
  confidence: string | null;
}

export interface FetchTransactionsInput {
  accountId: string;
  from?: string;
  to?: string;
  category?: string;
  limit?: number;
  cursor?: string;
}

export interface FetchTransactionsOutput {
  transactions: TransactionSummary[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;

export async function fetchTransactions(input: FetchTransactionsInput): Promise<ToolResult<FetchTransactionsOutput>> {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, input.accountId));
  if (!account) {
    return { ok: false, error: { code: 'ACCOUNT_NOT_FOUND', message: `No account with id "${input.accountId}"` } };
  }

  const [consent] = await db.select().from(consents).where(eq(consents.id, account.consentId));
  if (!consent || consent.status !== 'ACTIVE') {
    return {
      ok: false,
      error: { code: 'CONSENT_NOT_ACTIVE', message: `Consent for account "${input.accountId}" is not ACTIVE` },
    };
  }

  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;

  const conditions = [eq(transactions.accountId, input.accountId)];
  if (input.from) conditions.push(gte(transactions.txnDate, input.from));
  if (input.to) conditions.push(lte(transactions.txnDate, input.to));
  if (input.category) conditions.push(eq(transactions.category, input.category));

  const rows = await db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(asc(transactions.txnDate), asc(transactions.id))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    ok: true,
    data: {
      transactions: page.map((r) => ({
        txnId: r.id,
        date: r.txnDate,
        amount: r.amount,
        direction: r.direction,
        narration: r.narration,
        merchant: r.merchant,
        category: r.category,
        confidence: r.confidence,
      })),
      nextCursor: hasMore ? String(offset + limit) : null,
    },
  };
}
```

`apps/server/src/mcp/tools/transactions.ts`:
```ts
import {
  fetchTransactions,
  type FetchTransactionsInput,
  type FetchTransactionsOutput,
} from '../../adapter/transactions.js';
import type { ToolResult } from '../../adapter/types.js';
import { withAudit } from '../audit.js';

export async function fetchTransactionsTool(
  userId: string,
  input: FetchTransactionsInput
): Promise<ToolResult<FetchTransactionsOutput>> {
  return withAudit('fetch_transactions', userId, input, () => fetchTransactions(input));
}
```

- [ ] **Step 8: Run the test and confirm it passes**

Run: `pnpm --filter @switch/server exec vitest run test/mcp/transactions.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/adapter/accounts.ts apps/server/src/adapter/transactions.ts apps/server/src/mcp/tools/accounts.ts apps/server/src/mcp/tools/transactions.ts apps/server/test/mcp/accounts.test.ts apps/server/test/mcp/transactions.test.ts
git commit -m "feat(server): add fetch_accounts and fetch_transactions tools"
```

---

### Task 6: MCP server — Zod schemas + tool registration (in-memory transport test)

**Files:**
- Modify: `apps/server/package.json` (add `@modelcontextprotocol/sdk`, `zod`)
- Create: `apps/server/src/mcp/schemas.ts`
- Create: `apps/server/src/mcp/server.ts`
- Test: `apps/server/test/mcp/server.test.ts`

**Interfaces:**
- Consumes: all 8 `*Tool` functions from Tasks 2–5; `getDemoUserId` (Task 1).
- Produces: `TOOL_NAMES` (the 8 registered tool names); `createMcpServer(): McpServer` — consumed by `src/index.ts` (Task 7).

- [ ] **Step 1: Add dependencies**

Modify `apps/server/package.json` — add to `"dependencies"`:
```json
    "@modelcontextprotocol/sdk": "^1.0.4",
    "zod": "^3.24.1",
```
(Full `dependencies` block after this edit should read `date-fns`, `dotenv`, `drizzle-orm`, `pg`, `@modelcontextprotocol/sdk`, `zod` — order doesn't matter.)

Run: `pnpm install`
Expected: install completes with no errors.

- [ ] **Step 2: Write the failing test**

`apps/server/test/mcp/server.test.ts`:
```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../src/db/client.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { createMcpServer, TOOL_NAMES } from '../../src/mcp/server.js';

describe('createMcpServer', () => {
  let client: Client;

  beforeAll(async () => {
    await runSeed(new Date('2026-07-20T00:00:00Z'));

    const server = createMcpServer();
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.1' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('registers exactly the 8 M1 tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
  });

  it('calls list_supported_banks end-to-end over the MCP protocol', async () => {
    const result = await client.callTool({ name: 'list_supported_banks', arguments: {} });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const banks = JSON.parse(text);
    expect(banks.map((b: { name: string }) => b.name)).toEqual(['HDFC Bank', 'ICICI Bank']);
  });

  it('surfaces adapter errors as MCP tool errors', async () => {
    const result = await client.callTool({
      name: 'check_consent_status',
      arguments: { consent_id: '00000000-0000-0000-0000-000000000000' },
    });
    expect(result.isError).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `pnpm --filter @switch/server exec vitest run test/mcp/server.test.ts`
Expected: FAIL — cannot find module `../../src/mcp/server.js`

- [ ] **Step 4: Write the Zod schemas**

`apps/server/src/mcp/schemas.ts`:
```ts
import { z } from 'zod';

export const initiateConsentInputSchema = z.object({
  mobile: z.string(),
  fip_id: z.string(),
  purpose: z.string(),
  from_date: z.string(),
  to_date: z.string(),
  expiry_days: z.number().int().positive(),
  fi_types: z.array(z.string()),
});

export const checkConsentStatusInputSchema = z.object({
  consent_id: z.string(),
});

export const getConsentDetailsInputSchema = z.object({
  consent_id: z.string(),
});

export const requestFinancialDataInputSchema = z.object({
  consent_id: z.string(),
});

export const getDataStatusInputSchema = z.object({
  session_id: z.string(),
});

export const fetchAccountsInputSchema = z.object({
  consent_id: z.string(),
});

export const fetchTransactionsInputSchema = z.object({
  account_id: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  category: z.string().optional(),
  limit: z.number().int().positive().optional(),
  cursor: z.string().optional(),
});
```

- [ ] **Step 5: Write the MCP server**

`apps/server/src/mcp/server.ts`:
```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDemoUserId } from '../adapter/demoUser.js';
import { fetchAccountsTool } from './tools/accounts.js';
import { listSupportedBanksTool } from './tools/banks.js';
import { checkConsentStatusTool, getConsentDetailsTool, initiateConsentTool } from './tools/consent.js';
import { getDataStatusTool, requestFinancialDataTool } from './tools/dataFetch.js';
import { fetchTransactionsTool } from './tools/transactions.js';
import {
  checkConsentStatusInputSchema,
  fetchAccountsInputSchema,
  fetchTransactionsInputSchema,
  getConsentDetailsInputSchema,
  getDataStatusInputSchema,
  initiateConsentInputSchema,
  requestFinancialDataInputSchema,
} from './schemas.js';

export const TOOL_NAMES = [
  'list_supported_banks',
  'initiate_consent',
  'check_consent_status',
  'get_consent_details',
  'request_financial_data',
  'get_data_status',
  'fetch_accounts',
  'fetch_transactions',
] as const;

function toContent(result: { ok: boolean; data?: unknown; error?: unknown }) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result.ok ? result.data : result.error) }],
    isError: !result.ok,
  };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'switch-aa-connect', version: '0.1.0' });

  server.tool('list_supported_banks', 'List AA-supported banks in mock mode', {}, async () => {
    const userId = await getDemoUserId();
    return toContent(await listSupportedBanksTool(userId));
  });

  server.tool(
    'initiate_consent',
    'Start an AA consent request for a bank account',
    initiateConsentInputSchema.shape,
    async (args) => {
      const userId = await getDemoUserId();
      return toContent(
        await initiateConsentTool(userId, {
          mobile: args.mobile,
          fipId: args.fip_id,
          purpose: args.purpose,
          fromDate: args.from_date,
          toDate: args.to_date,
          expiryDays: args.expiry_days,
          fiTypes: args.fi_types,
        })
      );
    }
  );

  server.tool(
    'check_consent_status',
    'Check the status of a previously initiated consent',
    checkConsentStatusInputSchema.shape,
    async (args) => {
      const userId = await getDemoUserId();
      return toContent(await checkConsentStatusTool(userId, { consentId: args.consent_id }));
    }
  );

  server.tool(
    'get_consent_details',
    'Get the full details of a consent (purpose, FI types, date range, expiry)',
    getConsentDetailsInputSchema.shape,
    async (args) => {
      const userId = await getDemoUserId();
      return toContent(await getConsentDetailsTool(userId, { consentId: args.consent_id }));
    }
  );

  server.tool(
    'request_financial_data',
    'Kick off a financial institution data fetch for an active consent',
    requestFinancialDataInputSchema.shape,
    async (args) => {
      const userId = await getDemoUserId();
      return toContent(await requestFinancialDataTool(userId, { consentId: args.consent_id }));
    }
  );

  server.tool(
    'get_data_status',
    'Poll the status of a financial data fetch session',
    getDataStatusInputSchema.shape,
    async (args) => {
      const userId = await getDemoUserId();
      return toContent(await getDataStatusTool(userId, { sessionId: args.session_id }));
    }
  );

  server.tool(
    'fetch_accounts',
    'List accounts fetched under an active consent',
    fetchAccountsInputSchema.shape,
    async (args) => {
      const userId = await getDemoUserId();
      return toContent(await fetchAccountsTool(userId, { consentId: args.consent_id }));
    }
  );

  server.tool(
    'fetch_transactions',
    'Fetch paginated transactions for an account',
    fetchTransactionsInputSchema.shape,
    async (args) => {
      const userId = await getDemoUserId();
      return toContent(
        await fetchTransactionsTool(userId, {
          accountId: args.account_id,
          from: args.from,
          to: args.to,
          category: args.category,
          limit: args.limit,
          cursor: args.cursor,
        })
      );
    }
  );

  return server;
}
```

- [ ] **Step 6: Run the test and confirm it passes**

Run: `pnpm --filter @switch/server exec vitest run test/mcp/server.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
git add apps/server/package.json pnpm-lock.yaml apps/server/src/mcp/schemas.ts apps/server/src/mcp/server.ts apps/server/test/mcp/server.test.ts
git commit -m "feat(server): register all 8 M1 MCP tools on an McpServer instance"
```

---

### Task 7: Express Streamable HTTP transport

**Files:**
- Modify: `apps/server/package.json` (add `express`, `@types/express`, `dev`/`start` scripts)
- Create: `apps/server/src/index.ts`

**Interfaces:**
- Consumes: `createMcpServer` (Task 6).
- Produces: a running HTTP server exposing MCP at `POST/GET/DELETE http://localhost:3001/mcp` — the deliverable M1 exists to produce; nothing later in this plan depends on it, but M2+ and the eventual Claude.ai connector (M5) do.

- [ ] **Step 1: Add dependencies and scripts**

Modify `apps/server/package.json`:
- Add to `"scripts"`: `"dev": "tsx watch src/index.ts"`, `"start": "tsx src/index.ts"`
- Add to `"dependencies"`: `"express": "^4.21.2"`
- Add to `"devDependencies"`: `"@types/express": "^4.17.21"`

Run: `pnpm install`
Expected: install completes with no errors.

- [ ] **Step 2: Write the HTTP entry point**

`apps/server/src/index.ts`:
```ts
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './mcp/server.js';

const app = express();
app.use(express.json());

const transports = new Map<string, StreamableHTTPServerTransport>();

app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (!transport) {
    const server = createMcpServer();
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => transports.set(id, transport!),
    });
    res.on('close', () => {
      if (transport!.sessionId) {
        transports.delete(transport!.sessionId);
      }
    });
    await server.connect(transport);
  }

  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send('Unknown session');
    return;
  }
  await transport.handleRequest(req, res);
});

app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  const transport = sessionId ? transports.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).send('Unknown session');
    return;
  }
  await transport.handleRequest(req, res);
});

const PORT = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3001;
app.listen(PORT, () => {
  console.log(`Switch MCP server listening on http://localhost:${PORT}/mcp`);
});
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @switch/server typecheck`
Expected: exits 0, no output.

- [ ] **Step 4: Manual verification with MCP Inspector**

This step is manual — there is no automated test for the HTTP/Express wiring itself (Task 6 already proves the tool logic end-to-end over the MCP protocol via in-memory transport).

In one terminal:
```bash
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm --filter @switch/server dev
```
Expected: `Switch MCP server listening on http://localhost:3001/mcp`

In a second terminal:
```bash
npx @modelcontextprotocol/inspector
```
In the Inspector UI: connect to `http://localhost:3001/mcp` with transport "Streamable HTTP". Confirm:
- "List Tools" shows all 8 tool names.
- Calling `list_supported_banks` with `{}` returns HDFC Bank and ICICI Bank.
- Calling `initiate_consent` with `{"mobile":"9876543210","fip_id":"hdfc-bank","purpose":"Personal finance management","from_date":"2025-01-01","to_date":"2026-07-20","expiry_days":365,"fi_types":["DEPOSIT"]}` returns a `PENDING` consent with a `consent_id`.
- Calling `check_consent_status` with that `consent_id` returns `ACTIVE`.

- [ ] **Step 5: Commit**

```bash
git add apps/server/package.json pnpm-lock.yaml apps/server/src/index.ts
git commit -m "feat(server): expose MCP tools over Streamable HTTP via Express"
```

---

## What M1 does not include (deliberately deferred)

- `categorize_transactions`, `summarize_finances` (tools 9–10) — M2, since they need the rule engine / LLM fallback and SQL aggregation this milestone doesn't build.
- `remember` / `recall` memory tools — M4.
- A `revoke_consent` MCP tool — revocation is a dashboard (web app) action per the spec's demo script, not an MCP tool exposed to LLM clients; that's M3.
- Bearer token auth on the `/mcp` endpoint (spec §11) — deferred to M5's connector deploy, per spec §3 non-goals ("Full OAuth 2.1 flow... bearer token acceptable for demo; note as roadmap").
- The real Finvu adapter — this plan only builds the mock adapter; M5 swaps it in behind the same tool contract.
- `packages/shared` and `apps/web` — still not needed by anything built so far.
- Deployment (Railway) — M5.
