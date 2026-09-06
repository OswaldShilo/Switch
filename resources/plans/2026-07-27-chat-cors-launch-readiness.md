# Chat CORS Fix & Launch Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the in-app chat actually reachable from the real browser, prove the chat+memory demo loop works end-to-end, then take the deployment through Railway and register it as a Claude.ai connector so the pitch can be rehearsed against a live instance instead of localhost.

**Architecture:** The web dashboard (`apps/web`, Next.js) and the MCP/API server (`apps/server`, Express) run on different origins in dev (`localhost:3000` vs `localhost:3001`) and will run on different origins in production too (the web host vs. Railway). Server-rendered dashboard pages already fetch `apps/server` from Node-to-Node (no browser involved, so no CORS applies), which is why Overview/Spending already work. The Chat panel is a client component that calls `fetch()` directly from the user's browser — that cross-origin request has never had a CORS-compliant response, so it has been failing silently in the browser this entire time regardless of which LLM backend was configured. Fix that first (Task 1), since every later verification step in this plan depends on chat actually reaching the server from a real browser tab.

**Tech Stack:** Express, the `cors` npm package, Vitest + Supertest for the new test, Railway (Nixpacks) for deployment, the existing Claude.ai custom-connector flow for the last mile.

## Global Constraints

- Never commit secrets. `apps/server/.env` and `apps/web/.env.local` are gitignored; any new env var goes in as a *name* in this plan, never a real value.
- Only commit when a task's tests pass — don't batch unrelated changes into one commit.
- Keep `pnpm --filter @switch/server test` and `pnpm --filter @switch/server typecheck` green after every task.
- Don't touch the existing 10 MCP tools' behavior or the Claude.ai connector's `/mcp` auth path (`requireConnectorToken`) — this plan only touches the web dashboard's own `/api/*` surface and deployment config.

---

### Task 1: Add CORS support so the browser-based Chat panel can actually reach the server

**Files:**
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/package.json` (new dependency)
- Create: `apps/server/test/cors.test.ts`

**Interfaces:**
- Consumes: `apiRouter` from `apps/server/src/rest/router.js` (already exported, unchanged).
- Produces: nothing new is exported — this task only adds response headers to existing routes. Later tasks rely on the env var name `WEB_ORIGIN` being read by `index.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/cors.test.ts`:

```ts
import cors from 'cors';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { apiRouter } from '../src/rest/router.js';

// Mirrors exactly the middleware apps/server/src/index.ts wires up, built as its
// own tiny app here so this test doesn't depend on every other REST test file's
// buildApp() helper (none of which include CORS middleware).
function buildAppWithCors(origin: string) {
  const app = express();
  app.use(cors({ origin, credentials: true }));
  app.use(express.json());
  app.use('/api', apiRouter);
  return app;
}

describe('CORS', () => {
  it('reflects the configured WEB_ORIGIN on a preflight request to /api/chat', async () => {
    const res = await request(buildAppWithCors('http://localhost:3000'))
      .options('/api/chat')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('does not reflect an origin that is not the configured one', async () => {
    const res = await request(buildAppWithCors('http://localhost:3000'))
      .options('/api/chat')
      .set('Origin', 'http://evil.example.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.headers['access-control-allow-origin']).not.toBe('http://evil.example.com');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switch/server test -- cors.test.ts`
Expected: FAIL — `Cannot find package 'cors'` (or equivalent module-not-found error), since the dependency isn't installed yet.

- [ ] **Step 3: Install the dependency**

Run: `pnpm --filter @switch/server add cors` and `pnpm --filter @switch/server add -D @types/cors`

- [ ] **Step 4: Run test again to confirm it now fails on the assertion, not the import**

Run: `pnpm --filter @switch/server test -- cors.test.ts`
Expected: FAIL — `expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000')` fails because the header is `undefined` (the test's own `buildAppWithCors` already wires up `cors()` correctly, so if this still fails, the `cors` package call itself is fine — this confirms the test harness works before you rely on it to validate `index.ts`).

Note: if Step 4 actually passes already, that just confirms the `cors` package works as expected in isolation — the real target of this task is wiring it into `apps/server/src/index.ts`, which Step 5 does. This automated test cannot by itself prove `index.ts` is fixed (it builds its own small app, not the real one, since `index.ts` calls `app.listen()` directly rather than exporting a testable app factory — a bigger refactor than this fix warrants). Step 7's manual browser check is what actually proves the real server is fixed; treat it as required, not optional.

- [ ] **Step 5: Wire CORS into the real server entrypoint**

Read `apps/server/src/index.ts` first, then apply this change — add the import and the middleware line right after `const app = express();` and before `app.use(express.json());`:

```ts
import cors from 'cors';
```

```ts
app.use(cors({ origin: process.env.WEB_ORIGIN, credentials: true }));
```

- [ ] **Step 6: Add the new env var locally**

Add this line to `apps/server/.env` (not committed — gitignored):

```
WEB_ORIGIN=http://localhost:3000
```

- [ ] **Step 7: Restart the dev server and confirm the real chat request now succeeds in a browser**

Restart `pnpm --filter @switch/server dev` (env vars are only read at process start). Then, in the actual web dashboard (`http://localhost:3000/dashboard/chat`), send any message and confirm you get a real reply instead of "Couldn't reach Switch — please try again." Check DevTools → Network → the `OPTIONS` request to `/api/chat` and confirm it now carries `Access-Control-Allow-Origin: http://localhost:3000`.

- [ ] **Step 8: Run the full test suite and typecheck**

Run: `pnpm --filter @switch/server test`
Expected: PASS — all files including the two new `cors.test.ts` cases.

Run: `pnpm --filter @switch/server typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/index.ts apps/server/test/cors.test.ts apps/server/package.json pnpm-lock.yaml
git commit -m "fix(server): add CORS so the browser-based chat panel can reach the API"
```

---

### Task 2: Verify the chat + memory demo loop end-to-end (manual verification, no new code expected)

This task has no code changes unless verification turns up a real bug — if it does, stop and write a fresh task to fix it before continuing (don't improvise a fix mid-checklist).

**Prerequisite:** Task 1 committed, dev server restarted with `WEB_ORIGIN` set.

- [ ] **Step 1: Confirm a grounded, data-backed answer**

In `http://localhost:3000/dashboard/chat`, send: `Can I afford ₹40,000 for a trip in December?`
Expected: the reply cites real figures (balance/income/spending) sourced from a tool call, not a generic guess. Check the response for a mention of the data period/freshness (per `SYSTEM_PROMPT` rule 2 in `apps/server/src/chat/systemPrompt.ts`).

- [ ] **Step 2: Teach a standing rule**

Send: `Never suggest crypto to me.`
Expected: a reply confirming the rule was saved (this should trigger the `remember` tool per `SYSTEM_PROMPT` rule 4).

- [ ] **Step 3: Confirm the rule persisted to the Memory page**

Navigate to `http://localhost:3000/dashboard/memory`.
Expected: the "Remembered facts" list now shows the crypto rule (no longer "Nothing remembered yet").

- [ ] **Step 4: Confirm chat respects the rule on a later, unrelated turn**

Back in Chat, send a message that would naturally invite an investment suggestion, e.g.: `What should I do with my savings?`
Expected: the reply does not name or suggest crypto (or any specific security/product — per `SYSTEM_PROMPT` rule 3), and ideally references the standing preference from Step 2.

- [ ] **Step 5: Record the outcome**

If all four steps pass, this task is done — no commit needed (no code changed). If any step fails, write down exactly what happened (the message sent, the reply received, any console/network errors) before starting a fix — don't guess at a fix without that evidence in hand, per this project's own debugging pattern earlier in this plan's history.

---

### Task 3: Verify Subscriptions and Spending pages reflect categorized data

**Prerequisite:** Task 2's Step 1 (or any categorize_transactions call) has run at least once for the signed-in user, OR run it directly via chat: send `Please categorize my transactions.` and wait for a reply confirming a category count.

- [ ] **Step 1: Check the Subscriptions page**

Navigate to `http://localhost:3000/dashboard/subscriptions`.
Expected: "Recurring merchants" now lists actual merchants (no longer "No recurring subscriptions detected yet — run categorize_transactions first").

- [ ] **Step 2: Check the Spending page**

Navigate to `http://localhost:3000/dashboard/spending`.
Expected: "Spend by category" donut chart shows multiple real categories (no longer a single grey "Other" slice).

- [ ] **Step 3: Record the outcome**

No code change expected here either — this is confirming Task 2's tool call actually persisted category data the dashboard's existing queries already know how to render. If either page still shows the empty/uncategorized state, check `apps/server/src/adapter/categorize.ts` and the `category` column on `transactions` directly (`docker exec switch-postgres psql -U switch -d switch_dev -c "select category, count(*) from transactions group by category;"`) before assuming the UI is broken.

---

### Task 4: Deploy `apps/server` to Railway

This task is mostly manual account/dashboard actions on Railway's side — I can't create a Railway account or project on your behalf (that's outside what I can do for you), so each dashboard step below is yours to click through. Commands you run yourself are marked `(you run this)`.

**Files:**
- Reference only, no changes: `railway.json` (already committed at repo root from M5 Task 4 prep).

- [ ] **Step 1: Create the Railway project (you do this)**

In the Railway dashboard: New Project → Deploy from GitHub repo → select this repo. Railway will detect `railway.json` at the repo root and use Nixpacks with `pnpm --filter @switch/server start` as the start command.

- [ ] **Step 2: Add a Postgres plugin (you do this)**

In the same Railway project: New → Database → PostgreSQL. Railway will provision it and expose a `DATABASE_URL`-shaped connection string as a Railway-managed env var reference.

- [ ] **Step 3: Set environment variables on the Railway service (you do this)**

In the service's Variables tab, set:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Reference Railway's Postgres plugin variable (do not hardcode) |
| `SUPABASE_URL` | Same value as your local `apps/server/.env` |
| `SUPABASE_ANON_KEY` | Same value as your local `apps/server/.env` |
| `OPEN_ROUTER_API_KEY` | Same value as your local `apps/server/.env` |
| `WEB_ORIGIN` | The deployed web app's real origin (see Task 5 note below — if the web app isn't deployed yet, use `http://localhost:3000` for now and update this later) |

Do **not** set `SUPABASE_JWT_SECRET` — `requireUser.ts` no longer reads it (verified: only a comment references it now, since auth was switched to `supabase.auth.getUser()`).

Leave `MOCK_MODE` unset (defaults to the mock adapter) unless you specifically want to demo the real Finvu sandbox path — the mock adapter is the safer choice for a live judged demo since it has no external network dependency.

- [ ] **Step 4: Run migrations against the Railway Postgres instance (you run this)**

With the Railway CLI installed and linked to the project (`railway login`, `railway link`):

```bash
railway run pnpm --filter @switch/server db:migrate
```

Expected: migration output with no errors.

- [ ] **Step 5: Seed demo data against the Railway database (you run this)**

```bash
railway run env SEED_USER_EMAIL=<your real email> pnpm --filter @switch/server db:seed
```

Expected: `Seeded 2 accounts, 400 transactions for user <uuid>`.

- [ ] **Step 6: Confirm the deployed server responds**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://<your-railway-domain>/api/accounts
```

Expected: `401` (same as local — means the server is up and `requireUser` is correctly rejecting an unauthenticated request, not that something is broken).

---

### Task 5: Register the deployed server as a custom connector in Claude.ai

**Prerequisite:** Task 4 complete, you have the Railway service's public URL.

- [ ] **Step 1: Mint a connector token against the deployed server**

This uses the same `/api/connector-tokens` endpoint you already used against localhost — just point it at the Railway URL instead, authenticated with your real Supabase session token (same pattern as `get-login-link.mjs`/the browser session already gives you).

```bash
curl -s -X POST "https://<your-railway-domain>/api/connector-tokens" \
  -H "Authorization: Bearer <your Supabase access_token>" \
  -H "Content-Type: application/json"
```

Expected: a JSON body containing a connector token.

- [ ] **Step 2: Add the custom connector in Claude.ai (you do this)**

In Claude.ai: Settings → Connectors → Add custom connector. URL: `https://<your-railway-domain>/mcp`. When prompted for auth, supply the token from Step 1.

- [ ] **Step 3: Confirm the connector shows as connected**

Expected: Claude.ai's connector list shows it as active/connected, with the tool list (the same 10 MCP tools) visible.

---

### Task 6: Run one real test from inside Claude.ai itself

**Prerequisite:** Task 5 complete.

- [ ] **Step 1: Ask Claude a financial question that requires a live tool call**

In a Claude.ai conversation with the connector enabled, ask something like: `Using my Switch connector, what's my current account balance?`

- [ ] **Step 2: Confirm it actually calls the tool**

Expected: Claude's response shows it invoked a tool (visible in Claude.ai's tool-use UI) and returned a real, specific figure — not a refusal or a generic answer.

- [ ] **Step 3: Record the outcome**

This is your most judge-visible proof point per the original plan — if it works, you're done with the functional build. If it doesn't, capture the exact error Claude.ai shows before touching any code.

---

### Task 7: Rehearse the timed pitch against the deployed instance

- [ ] **Step 1: Re-run the Task 2 demo script, but from the deployed web dashboard URL, not localhost**

If the web app itself is also deployed (e.g. Vercel), do the walkthrough there. If only the server is deployed and you're still running the web app locally pointed at the Railway server (`NEXT_PUBLIC_API_BASE_URL` set to the Railway URL), that's fine too — the point is not to rehearse against a version of the stack that won't exist at demo time.

- [ ] **Step 2: Time it**

Run through the full 3-minute pitch arc once, start to finish, with a clock running. Note any step that stalls or needs a fallback (e.g. a recorded backup video) if the live network call is slow.

---

## Notes for later, not part of this plan's scope

- The Supabase `service_role` JWT that was pasted into `apps/web/get-login-link.mjs` earlier in this project's history should be rotated as routine hygiene once things are stable — it's gitignored so it was never committed, but it did pass through a chat transcript.
- `apps/server/.env` and `apps/web/.env.local` have no `.env.example` counterpart listing the newer vars (`SUPABASE_ANON_KEY`, `OPEN_ROUTER_API_KEY`, `WEB_ORIGIN`) — worth adding if anyone else needs to set this project up from scratch.
