# M2 — Categorize + Aggregate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the last two MCP tools (`categorize_transactions`, `summarize_finances`, spec §8 tools 9–10) so every rupee figure the system reports is DB-computed, never LLM prose (spec G5).

**Architecture:** A DB-backed rule engine (`category_rules` table, already in the M0 schema) matches merchant/narration first; unmatched transactions go to Claude in batches of 50 via an injectable `classifyBatch` function (real impl uses `@anthropic-ai/sdk`; tests inject a stub — no real API calls in tests). `summarize_finances` is pure SQL aggregation (Drizzle `sql` template) over `transactions`. Same `adapter/*` + `mcp/tools/*` + `withAudit` pattern as M1.

**Tech Stack:** adds `@anthropic-ai/sdk` to `apps/server`. Everything else is M0/M1's stack.

## Global Constraints

- Fixed 12-category taxonomy (spec §17 open question, frozen here): `Food Delivery, Groceries, Transport, Shopping, Subscriptions, Utilities, Rent, Income, Cash Withdrawal, Transfers, Entertainment, Other`.
- `category_rules.userId IS NULL` = global default rule; non-null = a specific user's override/correction. Matching prefers higher `priority`, then falls back through global rules. This is also the seam M3 uses later for "user correction writes a new rule" (FR3) — no new mechanism needed then, just an `insert`.
- `categorizeTransactions` without `force: true` only touches rows where `category IS NULL` (idempotent re-run).
- Confidence `< 0.7` is a UI display concern ("flagged unverified") — this milestone just stores the value; no gating logic needed here.
- `summarize_finances` never lets an LLM compute a number — every metric is a SQL aggregate.
- Tests must never call the real Anthropic API — always inject a stub `classifyBatch`.
- No commit steps are included here — this milestone is committed once, at the end, by the user.

---

### Task 1: Taxonomy + DB-backed rule engine

**Files:** Create `apps/server/src/categorize/taxonomy.ts`, `apps/server/src/categorize/rules.ts`, `apps/server/src/db/seed/categoryRules.ts`, `apps/server/test/categorize/rules.test.ts`.

**Interfaces:** Produces `CATEGORIES`, `matchRule(userId, {narration, merchant}): Promise<string | null>`, `seedDefaultCategoryRules(): Promise<void>` — Task 2 calls both.

- [ ] Write a failing test seeding default rules then asserting: `matchRule` returns `'Food Delivery'` for `{narration: 'SWIGGY ORDER', merchant: 'swiggy'}`; `'Income'` for `{narration: 'SALARY CREDIT NEXTLEAP', merchant: null}`; `null` for an unrecognized merchant/narration; and that a user-specific rule (higher priority) beats a global rule for the same pattern.

- [ ] `apps/server/src/categorize/taxonomy.ts`:
```ts
export const CATEGORIES = [
  'Food Delivery', 'Groceries', 'Transport', 'Shopping', 'Subscriptions',
  'Utilities', 'Rent', 'Income', 'Cash Withdrawal', 'Transfers', 'Entertainment', 'Other',
] as const;
export type Category = (typeof CATEGORIES)[number];
```

- [ ] `apps/server/src/db/seed/categoryRules.ts`:
```ts
import { isNull } from 'drizzle-orm';
import { db } from '../client.js';
import { categoryRules } from '../schema.js';

const DEFAULT_RULES = [
  { pattern: 'swiggy|zomato', category: 'Food Delivery', priority: 10 },
  { pattern: 'bigbasket|dmart', category: 'Groceries', priority: 10 },
  { pattern: 'uber|ola', category: 'Transport', priority: 10 },
  { pattern: 'amazon|myntra', category: 'Shopping', priority: 10 },
  { pattern: 'netflix|spotify|hotstar|amazonprime|icloud|gym', category: 'Subscriptions', priority: 10 },
  { pattern: 'bses|airtel', category: 'Utilities', priority: 10 },
  { pattern: 'atm', category: 'Cash Withdrawal', priority: 10 },
  { pattern: 'upi-transfer', category: 'Transfers', priority: 10 },
  { pattern: 'SALARY CREDIT', category: 'Income', priority: 5 },
  { pattern: 'NEFT RENT PAYMENT', category: 'Rent', priority: 5 },
];

export async function seedDefaultCategoryRules(): Promise<void> {
  const existing = await db.select().from(categoryRules).where(isNull(categoryRules.userId));
  const have = new Set(existing.map((r) => r.pattern));
  const toInsert = DEFAULT_RULES.filter((r) => !have.has(r.pattern));
  if (toInsert.length > 0) {
    await db.insert(categoryRules).values(toInsert.map((r) => ({ ...r, userId: null })));
  }
}
```

- [ ] `apps/server/src/categorize/rules.ts`:
```ts
import { eq, isNull, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { categoryRules } from '../db/schema.js';

export async function matchRule(
  userId: string,
  input: { narration: string; merchant: string | null }
): Promise<string | null> {
  const rules = await db
    .select()
    .from(categoryRules)
    .where(or(isNull(categoryRules.userId), eq(categoryRules.userId, userId)));

  const ordered = rules.sort((a, b) => b.priority - a.priority);
  const haystack = `${input.merchant ?? ''} ${input.narration}`;
  for (const rule of ordered) {
    if (new RegExp(rule.pattern, 'i').test(haystack)) return rule.category;
  }
  return null;
}
```

- [ ] Run `pnpm --filter @switch/server exec vitest run test/categorize/rules.test.ts` — should go RED before the implementation exists, GREEN after.

---

### Task 2: `categorize_transactions` tool

**Files:** Create `apps/server/src/categorize/llmFallback.ts`, `apps/server/src/adapter/categorize.ts`, `apps/server/src/mcp/tools/categorize.ts`, `apps/server/test/mcp/categorize.test.ts`. Modify `apps/server/package.json` (add `@anthropic-ai/sdk`).

**Interfaces:** Consumes `matchRule`, `seedDefaultCategoryRules` (Task 1), `withAudit`/`getDemoUserId` (M1 Task 1). Produces `categorizeTransactionsTool(userId, {accountId, force?, classifyBatch?})` — registered in Task 4.

- [ ] Add `"@anthropic-ai/sdk": "^0.32.1"` to `apps/server/package.json` dependencies, `pnpm install`.

- [ ] `apps/server/src/categorize/llmFallback.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk';
import { CATEGORIES } from './taxonomy.js';

export interface UncategorizedTxn {
  txnId: string;
  narration: string;
  merchant: string | null;
}
export interface LlmCategorization {
  txnId: string;
  category: string;
  confidence: number;
}
export type ClassifyBatchFn = (txns: UncategorizedTxn[]) => Promise<LlmCategorization[]>;

export const classifyBatchWithClaude: ClassifyBatchFn = async (txns) => {
  const client = new Anthropic();
  const message = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content:
          `Categorize each transaction into exactly one of: ${CATEGORIES.join(', ')}. ` +
          `Return only a JSON array of {"txn_id","category","confidence"} (confidence 0-1), one per input.\n` +
          `Transactions: ${JSON.stringify(txns)}`,
      },
    ],
  });
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const parsed = JSON.parse(text) as Array<{ txn_id: string; category: string; confidence: number }>;
  return parsed.map((p) => ({ txnId: p.txn_id, category: p.category, confidence: p.confidence }));
};
```

- [ ] `apps/server/src/adapter/categorize.ts`:
```ts
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { transactions } from '../db/schema.js';
import { matchRule } from '../categorize/rules.js';
import { seedDefaultCategoryRules } from '../db/seed/categoryRules.js';
import { classifyBatchWithClaude, type ClassifyBatchFn } from '../categorize/llmFallback.js';
import type { ToolResult } from './types.js';

const BATCH_SIZE = 50;

export interface CategorizeSummary {
  categorized: number;
  uncategorized: number;
  accuracyNote: string;
}

export async function categorizeTransactions(
  userId: string,
  accountId: string,
  opts: { force?: boolean; classifyBatch?: ClassifyBatchFn } = {}
): Promise<ToolResult<CategorizeSummary>> {
  await seedDefaultCategoryRules();
  const classifyBatch = opts.classifyBatch ?? classifyBatchWithClaude;

  const conditions = [eq(transactions.accountId, accountId)];
  if (!opts.force) conditions.push(isNull(transactions.category));
  const rows = await db.select().from(transactions).where(and(...conditions));

  let categorized = 0;
  const remaining: typeof rows = [];

  for (const txn of rows) {
    const category = await matchRule(userId, { narration: txn.narration, merchant: txn.merchant });
    if (category) {
      await db
        .update(transactions)
        .set({ category, confidence: '1.00', categorizedBy: 'rule' })
        .where(eq(transactions.id, txn.id));
      categorized++;
    } else {
      remaining.push(txn);
    }
  }

  for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
    const batch = remaining.slice(i, i + BATCH_SIZE);
    const results = await classifyBatch(
      batch.map((t) => ({ txnId: t.id, narration: t.narration, merchant: t.merchant }))
    );
    for (const r of results) {
      await db
        .update(transactions)
        .set({ category: r.category, confidence: r.confidence.toFixed(2), categorizedBy: 'llm' })
        .where(eq(transactions.id, r.txnId));
      categorized++;
    }
  }

  return {
    ok: true,
    data: {
      categorized,
      uncategorized: rows.length - categorized,
      accuracyNote: `${categorized}/${rows.length} categorized (rule engine first, LLM fallback in batches of ${BATCH_SIZE}).`,
    },
  };
}
```

- [ ] `apps/server/src/mcp/tools/categorize.ts` — mirrors M1's tool-wrapper pattern:
```ts
import { categorizeTransactions, type CategorizeSummary } from '../../adapter/categorize.js';
import type { ToolResult } from '../../adapter/types.js';
import type { ClassifyBatchFn } from '../../categorize/llmFallback.js';
import { withAudit } from '../audit.js';

export async function categorizeTransactionsTool(
  userId: string,
  input: { accountId: string; force?: boolean; classifyBatch?: ClassifyBatchFn }
): Promise<ToolResult<CategorizeSummary>> {
  return withAudit('categorize_transactions', userId, { accountId: input.accountId, force: input.force }, () =>
    categorizeTransactions(userId, input.accountId, { force: input.force, classifyBatch: input.classifyBatch })
  );
}
```

- [ ] `apps/server/test/mcp/categorize.test.ts` — seed demo data (`runSeed`), call `categorizeTransactionsTool` with a stub `classifyBatch` that returns `[{ txnId, category: 'Other', confidence: 0.5 }]` for whatever it's given (never call the real API). Assert: known salary transactions end up `category: 'Income', categorizedBy: 'rule'`; known subscription transactions end up `'Subscriptions'`; re-running without `force` doesn't re-touch already-categorized rows (stub call count stays the same on the second run — assert via a mock/spy).

- [ ] Run the test file, confirm RED then GREEN.

---

### Task 3: `summarize_finances` tool

**Files:** Create `apps/server/src/adapter/summarize.ts`, `apps/server/src/mcp/tools/summarize.ts`, `apps/server/test/mcp/summarize.test.ts`.

**Interfaces:** Consumes `transactions` table, `withAudit`. Produces `summarizeFinancesTool(userId, {accountId, period, metrics})` — registered in Task 4. `recurring_subscriptions` and `mom_trend` depend on `categorize_transactions` (Task 2) having already labeled `category = 'Subscriptions'`; note this in the tool's output if `recurring_subscriptions` is requested but no rows have that category yet (empty array is a valid, correct answer, not an error).

- [ ] `apps/server/src/adapter/summarize.ts`:
```ts
import { and, between, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { transactions } from '../db/schema.js';
import type { ToolResult } from './types.js';

export type Metric =
  | 'spend_by_category' | 'income' | 'savings_rate'
  | 'recurring_subscriptions' | 'top_merchants' | 'mom_trend';

export interface SummarizeInput {
  accountId: string;
  period: { from: string; to: string };
  metrics: Metric[];
}

export async function summarizeFinances(input: SummarizeInput): Promise<ToolResult<Record<string, unknown>>> {
  const { accountId, period } = input;
  const inPeriod = and(eq(transactions.accountId, accountId), between(transactions.txnDate, period.from, period.to));
  const result: Record<string, unknown> = {};

  if (input.metrics.includes('spend_by_category')) {
    result.spendByCategory = await db
      .select({ category: transactions.category, total: sql<string>`sum(${transactions.amount})` })
      .from(transactions)
      .where(and(inPeriod, eq(transactions.direction, 'debit')))
      .groupBy(transactions.category);
  }

  if (input.metrics.includes('income') || input.metrics.includes('savings_rate')) {
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
      .from(transactions)
      .where(and(inPeriod, eq(transactions.direction, 'credit')));
    result.income = row.total;
  }

  if (input.metrics.includes('savings_rate')) {
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
      .from(transactions)
      .where(and(inPeriod, eq(transactions.direction, 'debit')));
    const income = Number(result.income ?? 0);
    result.savingsRate = income > 0 ? (income - Number(row.total)) / income : 0;
  }

  if (input.metrics.includes('top_merchants')) {
    result.topMerchants = await db
      .select({ merchant: transactions.merchant, total: sql<string>`sum(${transactions.amount})`, count: sql<number>`count(*)` })
      .from(transactions)
      .where(and(inPeriod, eq(transactions.direction, 'debit')))
      .groupBy(transactions.merchant)
      .orderBy(sql`sum(${transactions.amount}) desc`)
      .limit(10);
  }

  if (input.metrics.includes('recurring_subscriptions')) {
    result.recurringSubscriptions = await db
      .select({ merchant: transactions.merchant, amount: transactions.amount, count: sql<number>`count(*)` })
      .from(transactions)
      .where(and(eq(transactions.accountId, accountId), eq(transactions.category, 'Subscriptions')))
      .groupBy(transactions.merchant, transactions.amount)
      .having(sql`count(*) >= 2`);
  }

  if (input.metrics.includes('mom_trend')) {
    result.momTrend = await db
      .select({ month: sql<string>`to_char(${transactions.txnDate}::date, 'YYYY-MM')`, total: sql<string>`sum(${transactions.amount})` })
      .from(transactions)
      .where(and(eq(transactions.accountId, accountId), eq(transactions.direction, 'debit')))
      .groupBy(sql`to_char(${transactions.txnDate}::date, 'YYYY-MM')`)
      .orderBy(sql`to_char(${transactions.txnDate}::date, 'YYYY-MM')`);
  }

  return { ok: true, data: result };
}
```

- [ ] `apps/server/src/mcp/tools/summarize.ts` — same `withAudit('summarize_finances', userId, input, () => summarizeFinances(input))` pattern as every other M1/M2 tool wrapper.

- [ ] `apps/server/test/mcp/summarize.test.ts` — seed demo data with `runSeed(new Date('2026-07-20T00:00:00Z'))`, request `metrics: ['income', 'spend_by_category', 'savings_rate']` for the HDFC account over `period: {from: '2026-07-01', to: '2026-07-31'}`. Assert `income === '70000.00'` (one salary credit that month) and `savingsRate` is a number between 0 and 1. Separately, run `categorizeTransactionsTool` with a stub classifier first, then assert `recurring_subscriptions` returns entries for at least `netflix`/`spotify` with `count >= 2` across the full 6-month seed.

- [ ] Run the test file, confirm RED then GREEN.

---

### Task 4: Register tools 9–10 on the MCP server

**Files:** Modify `apps/server/src/mcp/schemas.ts`, `apps/server/src/mcp/server.ts`, `apps/server/test/mcp/server.test.ts`.

**Interfaces:** Consumes `categorizeTransactionsTool` (Task 2), `summarizeFinancesTool` (Task 3). Extends `TOOL_NAMES` to 10 entries.

- [ ] Add to `schemas.ts`:
```ts
export const categorizeTransactionsInputSchema = z.object({
  account_id: z.string(),
  force: z.boolean().optional(),
});

export const summarizeFinancesInputSchema = z.object({
  account_id: z.string(),
  period: z.object({ from: z.string(), to: z.string() }),
  metrics: z.array(
    z.enum(['spend_by_category', 'income', 'savings_rate', 'recurring_subscriptions', 'top_merchants', 'mom_trend'])
  ),
});
```

- [ ] In `server.ts`: add `'categorize_transactions'` and `'summarize_finances'` to `TOOL_NAMES`, and register both with `server.tool(...)` following the exact same pattern as the other 8 (resolve `getDemoUserId()`, call the `*Tool` function, wrap with `toContent`). `categorize_transactions` passes `{ accountId: args.account_id, force: args.force }` (no `classifyBatch` override — production always uses the real `classifyBatchWithClaude` default). `summarize_finances` passes `{ accountId: args.account_id, period: args.period, metrics: args.metrics }`.

- [ ] Update `test/mcp/server.test.ts`'s tool-count assertion to expect 10 names instead of 8 (`TOOL_NAMES` import already makes this self-updating — just confirm the test still passes).

- [ ] Run `pnpm --filter @switch/server exec vitest run test/mcp/server.test.ts`, confirm PASS with all 10 tools listed.

---

## What M2 does not include

- `remember`/`recall` memory tools — M4.
- User-correction UI that writes to `category_rules` with `userId` set — M3 (the DB seam is ready; no UI to trigger it yet).
- Any change to `request_financial_data`/`fetch_transactions` — those stay exactly as M1 left them.
