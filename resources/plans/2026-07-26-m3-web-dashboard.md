# M3 — Web Dashboard (Auth, Overview, Spending, Subscriptions, Consent Manager) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stand up `apps/web` (Next.js dashboard) behind real Supabase Auth, and a REST layer on `apps/server` that reuses M1/M2's adapter functions — delivering spec §14 Phase 4 ("Auth, Overview/Spending/Subscriptions pages, consent manager") and FR7's pages minus Chat/Memory (those need M4).

**Architecture:** `packages/shared` holds Zod schemas both sides import. `apps/server` grows a `/api/*` Express router sitting next to the existing `/mcp` route — REST handlers call the *same* `adapter/*.ts` functions M1/M2 already built and tested, adding only a `requireUser` middleware (verifies a Supabase-issued JWT, just-in-time-provisions a row in our own `users` table keyed by email) and ownership checks REST needs that the single-demo-user MCP tools didn't. `apps/web` is Next.js 15 App Router + Tailwind + shadcn/ui + Recharts, using `@supabase/supabase-js` for login (email OTP) and attaching the Supabase access token to every REST call.

**Tech Stack:** `packages/shared` (zod); `apps/server` adds `jsonwebtoken`, `@types/jsonwebtoken`; `apps/web` is a new Next.js 15 + Tailwind + shadcn/ui + Recharts + `@supabase/supabase-js` package.

## Global Constraints

- **You need a real Supabase project before Tasks 5+ can run against real auth** (Tasks 1–4 are backend-only and testable without one — Task 2's JWT tests sign their own tokens with a test secret, no live Supabase required). Before Task 5:
  1. Create a project at supabase.com.
  2. Settings → API → copy the **Project URL** and **anon public key** into `apps/web/.env.local` as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
  3. Settings → API → JWT Settings → copy the **JWT Secret** into `apps/server/.env` as `SUPABASE_JWT_SECRET`. Never paste this value into chat/logs — it's a server secret, not the anon key.
  4. Auth → Providers → confirm Email is enabled with OTP (magic link) sign-in, no password.
- Our own `users` table (from M0) stays the source of truth for app data ownership; Supabase only issues identity (JWT with `sub`, `email`). `requireUser` middleware maps `email` → our `users.id`, creating the row on first sight. This avoids migrating the working local dev Postgres to Supabase-hosted Postgres — Supabase here is Auth-only.
- MCP tools (M1/M2) are unchanged — they still resolve `getDemoUserId()`. REST is a separate, additive surface; nothing in `/mcp` requires Supabase.
- REST handlers must verify the requesting user owns the `account_id`/`consent_id` they're asking about (via `consents.userId`) — the M1 adapter functions don't do this themselves (they were built for a single implicit demo user), so REST adds an ownership check before calling them.
- Frontend pages are manually verified against a running dev server (`pnpm --filter @switch/web dev` + `pnpm --filter @switch/server dev`), not unit-tested — consistent with the project's existing test scope (spec §6: "vitest (tool functions only)"). Backend tasks (1–4) keep full TDD.
- Category donut / bars / subscriptions read `category = 'Subscriptions'` etc. set by M2's `categorize_transactions` — call that tool (or run `pnpm --filter @switch/server exec tsx` a one-off script) against the demo account before manually verifying Spending/Subscriptions pages, or they'll show empty state (a correct empty state, not a bug).
- No commit steps included — one commit for the whole milestone, done by the user at the end.

---

### Task 1: `packages/shared`

**Files:** Create `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/dashboard.ts`, `packages/shared/src/index.ts`, `packages/shared/test/dashboard.test.ts`.

**Interfaces:** Produces Zod schemas + inferred types (`AccountDto`, `ConsentDto`, `TransactionDto`, `SummaryResponse`) that Tasks 3–4's REST responses and Task 6–9's frontend both import as `@switch/shared`.

- [ ] `packages/shared/package.json`: name `@switch/shared`, `"type": "module"`, `"main": "./src/index.ts"`, deps `{ "zod": "^3.24.1" }`, devDeps `{ "typescript": "^5.7.2", "vitest": "^2.1.8" }`, scripts `{ "test": "vitest run" }`.
- [ ] `packages/shared/tsconfig.json`: same shape as `apps/server/tsconfig.json` (NodeNext, strict, `rootDir` omitted per the M1 fix).
- [ ] `packages/shared/src/dashboard.ts`:
```ts
import { z } from 'zod';

export const accountDtoSchema = z.object({
  accountId: z.string(),
  consentId: z.string(),
  bank: z.string(),
  type: z.string(),
  maskedNumber: z.string(),
  balance: z.string(),
  currency: z.string(),
});
export type AccountDto = z.infer<typeof accountDtoSchema>;

export const consentDtoSchema = z.object({
  consentId: z.string(),
  fipId: z.string(),
  status: z.string(),
  purpose: z.string(),
  expiryAt: z.string(),
});
export type ConsentDto = z.infer<typeof consentDtoSchema>;

export const transactionDtoSchema = z.object({
  txnId: z.string(),
  date: z.string(),
  amount: z.string(),
  direction: z.enum(['credit', 'debit']),
  narration: z.string(),
  merchant: z.string().nullable(),
  category: z.string().nullable(),
});
export type TransactionDto = z.infer<typeof transactionDtoSchema>;

export const summaryResponseSchema = z.record(z.string(), z.unknown());
export type SummaryResponse = z.infer<typeof summaryResponseSchema>;
```
- [ ] `packages/shared/src/index.ts`: `export * from './dashboard.js';`
- [ ] `packages/shared/test/dashboard.test.ts`: one test per schema asserting `.parse()` accepts a valid sample object and `.safeParse()` rejects a malformed one (missing required field). Keep it short — this is a contract sanity check, not exhaustive validation testing.
- [ ] `pnpm install`, run `pnpm --filter @switch/shared test`, confirm pass.

---

### Task 2: Supabase JWT verification + user provisioning

**Files:** Modify `apps/server/package.json` (add `jsonwebtoken`, `@types/jsonwebtoken`). Create `apps/server/src/adapter/users.ts`, `apps/server/src/auth/requireUser.ts`, `apps/server/test/auth/requireUser.test.ts`.

**Interfaces:** Produces `getOrCreateUserByEmail(email): Promise<string>` (userId) and an Express middleware `requireUser(req, res, next)` that sets `req.userId`. Task 3/4's REST routes mount this middleware.

- [ ] `apps/server/src/adapter/users.ts`:
```ts
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';

export async function getOrCreateUserByEmail(email: string): Promise<string> {
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) return existing.id;
  const [created] = await db.insert(users).values({ email }).returning();
  return created.id;
}
```
- [ ] `apps/server/src/auth/requireUser.ts` — verifies `Authorization: Bearer <jwt>` with `SUPABASE_JWT_SECRET` (HS256), 401 on missing/invalid/expired token, otherwise resolves the user and attaches `req.userId`:
```ts
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getOrCreateUserByEmail } from '../adapter/users.js';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'SUPABASE_JWT_SECRET is not set' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice('Bearer '.length), secret) as { email?: string };
    if (!payload.email) {
      res.status(401).json({ error: 'Token has no email claim' });
      return;
    }
    req.userId = await getOrCreateUserByEmail(payload.email);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
```
- [ ] `apps/server/test/auth/requireUser.test.ts` — no live Supabase needed: sign test tokens with `jsonwebtoken.sign({ email }, testSecret)`, set `process.env.SUPABASE_JWT_SECRET = testSecret` in `beforeAll`. Use a minimal fake Express `req`/`res` (or spin up a throwaway `express()` app with one route behind the middleware and hit it with `supertest` — add `supertest`/`@types/supertest` as devDeps if you go that route). Cover: valid token → `req.userId` set to a real UUID and a `users` row exists with that email; missing header → 401; garbage token → 401; token signed with the wrong secret → 401.
- [ ] Run the test, confirm pass.

---

### Task 3: REST — accounts & consents (list, revoke)

**Files:** Create `apps/server/src/rest/router.ts`, `apps/server/src/rest/accounts.ts`, `apps/server/src/rest/consents.ts`, `apps/server/test/rest/accounts.test.ts`, `apps/server/test/rest/consents.test.ts`. Modify `apps/server/src/adapter/accounts.ts` (add `listAccountsForUser`), `apps/server/src/adapter/consent.ts` (add `listConsentsForUser`, `revokeConsent`). Modify `apps/server/src/index.ts` to mount the router.

**Interfaces:** Consumes `requireUser` (Task 2). Produces `GET /api/accounts`, `GET /api/consents`, `POST /api/consents/:id/revoke`; the `router` this task creates is extended by Task 4 and mounted at `/api` in `index.ts`.

- [ ] Add to `apps/server/src/adapter/accounts.ts`:
```ts
export async function listAccountsForUser(userId: string): Promise<AccountSummary[]> {
  const rows = await db
    .select({ account: accounts })
    .from(accounts)
    .innerJoin(consents, eq(accounts.consentId, consents.id))
    .where(and(eq(consents.userId, userId), eq(consents.status, 'ACTIVE')));
  return rows.map((r) => ({
    accountId: r.account.id,
    type: r.account.type,
    maskedNumber: r.account.maskedNumber,
    bank: r.account.bank,
    balance: r.account.balance,
    currency: r.account.currency,
  }));
}

export async function assertAccountOwnership(accountId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: consents.userId })
    .from(accounts)
    .innerJoin(consents, eq(accounts.consentId, consents.id))
    .where(eq(accounts.id, accountId));
  return row?.userId === userId;
}
```
(add `consents` and `and` to that file's imports)
- [ ] Add to `apps/server/src/adapter/consent.ts`:
```ts
export async function listConsentsForUser(userId: string) {
  return db.select().from(consents).where(eq(consents.userId, userId));
}

export async function revokeConsent(consentId: string, userId: string): Promise<ToolResult<{ status: string }>> {
  const [consent] = await db.select().from(consents).where(eq(consents.id, consentId));
  if (!consent || consent.userId !== userId) {
    return { ok: false, error: { code: 'CONSENT_NOT_FOUND', message: `No consent with id "${consentId}"` } };
  }
  const [updated] = await db
    .update(consents)
    .set({ status: 'REVOKED' })
    .where(eq(consents.id, consentId))
    .returning();
  return { ok: true, data: { status: updated.status } };
}
```
- [ ] `apps/server/src/rest/accounts.ts`:
```ts
import { Router } from 'express';
import { listAccountsForUser } from '../adapter/accounts.js';
import { requireUser } from '../auth/requireUser.js';

export const accountsRouter = Router();

accountsRouter.get('/accounts', requireUser, async (req, res) => {
  const accounts = await listAccountsForUser(req.userId!);
  res.json(accounts);
});
```
- [ ] `apps/server/src/rest/consents.ts`:
```ts
import { Router } from 'express';
import { listConsentsForUser, revokeConsent } from '../adapter/consent.js';
import { requireUser } from '../auth/requireUser.js';

export const consentsRouter = Router();

consentsRouter.get('/consents', requireUser, async (req, res) => {
  const consents = await listConsentsForUser(req.userId!);
  res.json(consents);
});

consentsRouter.post('/consents/:id/revoke', requireUser, async (req, res) => {
  const result = await revokeConsent(req.params.id, req.userId!);
  if (!result.ok) {
    res.status(404).json(result.error);
    return;
  }
  res.json(result.data);
});
```
- [ ] `apps/server/src/rest/router.ts`: `export const apiRouter = Router(); apiRouter.use(accountsRouter); apiRouter.use(consentsRouter);` (Task 4 adds two more `.use()` calls here).
- [ ] Mount in `apps/server/src/index.ts`: `import { apiRouter } from './rest/router.js';` then `app.use('/api', apiRouter);` (add above the `/mcp` routes).
- [ ] Tests: sign a test JWT (same pattern as Task 2), seed via `runSeed`, call the routes with `supertest` against an `express()` app that mounts `apiRouter`. Cover: `GET /accounts` returns the demo user's accounts once their email matches a seeded/created user; `GET /consents` returns both consents; `POST /consents/:id/revoke` flips status to `REVOKED` and a follow-up `fetch_accounts`-equivalent call would now be blocked (reuse `fetchAccountsTool` from M1 to assert `CONSENT_NOT_ACTIVE` after revoke, proving REST and MCP share enforcement); revoking someone else's consent id (create a second user + consent) returns 404, not another user's data.
- [ ] Run the tests, confirm pass.

---

### Task 4: REST — summary & transactions

**Files:** Create `apps/server/src/rest/summary.ts`, `apps/server/src/rest/transactions.ts`, `apps/server/test/rest/summary.test.ts`, `apps/server/test/rest/transactions.test.ts`. Modify `apps/server/src/rest/router.ts`.

**Interfaces:** Consumes `summarizeFinances` (M2), `fetchTransactions` (M1), `assertAccountOwnership` (Task 3). Produces `GET /api/accounts/:id/summary`, `GET /api/accounts/:id/transactions`.

- [ ] `apps/server/src/rest/summary.ts`:
```ts
import { Router } from 'express';
import { assertAccountOwnership } from '../adapter/accounts.js';
import { summarizeFinances, type Metric } from '../adapter/summarize.js';
import { requireUser } from '../auth/requireUser.js';

export const summaryRouter = Router();

summaryRouter.get('/accounts/:id/summary', requireUser, async (req, res) => {
  const owns = await assertAccountOwnership(req.params.id, req.userId!);
  if (!owns) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  const metrics = (req.query.metrics as string | undefined)?.split(',') as Metric[] | undefined;
  const from = (req.query.from as string) ?? '1970-01-01';
  const to = (req.query.to as string) ?? '2999-12-31';
  const result = await summarizeFinances({
    accountId: req.params.id,
    period: { from, to },
    metrics: metrics ?? ['spend_by_category', 'income', 'savings_rate', 'recurring_subscriptions', 'top_merchants', 'mom_trend'],
  });
  res.json(result.ok ? result.data : result.error);
});
```
- [ ] `apps/server/src/rest/transactions.ts` — same shape, calls `fetchTransactions({ accountId: req.params.id, from, to, category, limit, cursor })` from query params after the same `assertAccountOwnership` check, `res.json(result.ok ? result.data : result.error)`.
- [ ] Add both routers to `apps/server/src/rest/router.ts`'s `.use()` chain.
- [ ] Tests: seed + activate a consent + `requestFinancialDataTool` to populate an account with real mock transactions (reuse the M1 test helper pattern from `test/mcp/dataFetch.test.ts`), then hit `GET /accounts/:id/summary?metrics=income&from=2026-07-01&to=2026-07-31` and assert the known `70000.00` salary figure; hit `GET /accounts/:id/transactions` and assert pagination shape matches `fetchTransactions`'s own test expectations. Assert a foreign account id (belonging to a different user) 404s.
- [ ] Run the tests, confirm pass.

---

### Task 5: `apps/web` scaffold + Supabase Auth

**Files:** Create `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/tailwind.config.ts`, `apps/web/tsconfig.json`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/lib/supabaseClient.ts`, `apps/web/src/lib/supabaseServer.ts`, `apps/web/src/app/login/page.tsx`, `apps/web/middleware.ts`, `apps/web/.env.local.example`.

**Interfaces:** Produces `getSupabaseBrowserClient()`, `getSupabaseServerClient()`, and route-level auth gating that Tasks 6–9's pages sit behind.

- [ ] Scaffold with the official generator (answer: TypeScript yes, Tailwind yes, App Router yes, `src/` dir yes, import alias `@/*`):
```bash
pnpm dlx create-next-app@15 apps/web --typescript --tailwind --app --src-dir --import-alias "@/*" --use-pnpm --no-eslint
```
Then `cd apps/web && pnpm dlx shadcn@latest init` (defaults), `pnpm dlx shadcn@latest add button card badge table` — these give Tasks 6–9 ready-made primitives instead of hand-rolling them.
- [ ] `pnpm add @supabase/supabase-js recharts` in `apps/web`.
- [ ] `apps/web/.env.local.example`:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```
Copy to `.env.local` and fill in from the Supabase dashboard (see Global Constraints) — `.env.local` is gitignored by `create-next-app` by default; confirm.
- [ ] `apps/web/src/lib/supabaseClient.ts`:
```ts
import { createBrowserClient } from '@supabase/ssr';

export function getSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```
(`pnpm add @supabase/ssr` alongside `@supabase/supabase-js` — needed for cookie-based session handling in App Router.)
- [ ] `apps/web/src/app/login/page.tsx` — a client component with an email input, "Send magic link" button calling `supabase.auth.signInWithOtp({ email })`, and a confirmation message. Keep it minimal — this is the one page in the app with no design requirements beyond "works."
- [ ] `apps/web/middleware.ts` — uses `createServerClient` from `@supabase/ssr` to read the session from cookies; if absent and the path isn't `/login`, redirect to `/login`.
- [ ] Manual check: `pnpm --filter @switch/web dev`, visit `http://localhost:3000`, confirm redirect to `/login`, enter your email, confirm the magic-link email arrives (Supabase's default email provider works out of the box for dev) and clicking it lands you back in the app authenticated.

---

### Task 6: API client + Overview page

**Files:** Create `apps/web/src/lib/apiClient.ts`, `apps/web/src/app/dashboard/page.tsx`, `apps/web/src/app/dashboard/layout.tsx`.

**Interfaces:** Consumes `@switch/shared` DTOs (Task 1), REST endpoints (Tasks 3–4). Produces `apiGet<T>(path: string, accessToken: string): Promise<T>` used by every later dashboard page.

- [ ] `apps/web/src/lib/apiClient.ts`:
```ts
export async function apiGet<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}
```
- [ ] `apps/web/src/app/dashboard/layout.tsx` — server component: reads the Supabase session via `supabaseServer.ts`, fetches `/api/accounts` (an `AccountDto[]`), renders a simple nav (`Overview / Spending / Subscriptions / Consents`) plus `{children}`. Pass the first account's id down via a React context or just re-fetch `/api/accounts` per page (simplicity over cleverness at this scale — one account is used for all demo purposes).
- [ ] `apps/web/src/app/dashboard/page.tsx` — server component: `apiGet<SummaryResponse>('/api/accounts/{id}/summary?metrics=income,savings_rate,mom_trend&from=...&to=...')`, render: a balance/savings-rate stat row (shadcn `Card`s) and a `mom_trend` line chart via Recharts' `<ResponsiveContainer><LineChart>...`.
- [ ] Manual check: log in, land on `/dashboard`, confirm real numbers from the seeded mock dataset appear (not zeros/placeholders) — cross-check one figure (e.g. income for the current month) against what `pnpm --filter @switch/server exec tsx -e "..."` or the M2 test's known `70000.00` salary figure says it should be.

---

### Task 7: Spending page

**Files:** Create `apps/web/src/app/dashboard/spending/page.tsx`.

- [ ] Server component fetching `metrics=spend_by_category,mom_trend`. Render a Recharts `<PieChart>` donut for `spend_by_category` (one slice per category, use the `dataviz` skill's palette guidance if you want a second opinion on category colors) and a `<BarChart>` for monthly totals from `mom_trend`.
- [ ] Manual check: categories and totals match what `summarize_finances`'s own M2 test asserted for the seeded dataset (run `categorize_transactions` first per the Global Constraints note, or the donut will correctly show "no categorized spend yet").

---

### Task 8: Subscriptions page

**Files:** Create `apps/web/src/app/dashboard/subscriptions/page.tsx`.

- [ ] Server component fetching `metrics=recurring_subscriptions`. Render a `Table` (merchant, monthly amount, occurrences) with an "Annual cost" column computed client-side as `amount * 12` — no new backend metric needed, this is presentation-layer arithmetic on an already-DB-computed figure, not the LLM inventing a number (spec G5 concerns the LLM's chat answers, not static page math).
- [ ] Manual check: after running `categorize_transactions`, the 6 seeded subscription merchants (netflix, spotify, hotstar, amazonprime, icloud, gym) all appear with the exact `amount` values M0's mock data seeded them at.

---

### Task 9: Consent manager page

**Files:** Create `apps/web/src/app/dashboard/consents/page.tsx`, `apps/web/src/app/dashboard/consents/RevokeButton.tsx` (client component).

- [ ] Server component: `apiGet<ConsentDto[]>('/api/consents')`, render a table (bank/fip_id, status as a shadcn `Badge`, purpose, expiry) with a `RevokeButton` per row.
- [ ] `RevokeButton.tsx` — client component: `onClick` does `fetch(`${apiBase}/api/consents/${id}/revoke`, { method: 'POST', headers: { Authorization: ... } })`, then `router.refresh()`.
- [ ] Manual check: click revoke on a consent, confirm its badge flips to `REVOKED`, then reload `/dashboard` and confirm that account's data-dependent cards now show an error/empty state instead of stale numbers (proving the REST layer's ownership + status checks from Task 3/4 actually block post-revoke reads, not just the UI hiding a button).

---

## What M3 does not include (deliberately deferred)

- Chat and Memory pages (FR7 lists them, but they need M4's `remember`/`recall` tools and the Anthropic tool-calling chat loop, which don't exist yet).
- Deployment (Vercel for `apps/web`, Railway for `apps/server`) — no milestone has needed real hosting yet; still deferred to whichever of M5's tasks first requires it.
- Any change to the MCP tools or their single-demo-user resolution — REST and MCP are additive, parallel surfaces on the same adapter functions.
- Google OAuth as a second Supabase Auth provider (spec mentions "email OTP/Google") — email OTP alone is enough to prove the auth flow for the demo; add Google later if the judges' flow specifically wants it.
