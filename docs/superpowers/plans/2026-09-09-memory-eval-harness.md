# Memory ON/OFF Evaluation Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable eval harness that drives the existing chat pipeline twice per question (memory on/off) against seeded data, scores the results, and produces a results table — the paper's first real memory-ON-vs-OFF number.

**Architecture:** A fixture file defines ~34 questions across 4 categories. A setup step seeds two isolated users with identical data and pre-categorizes their transactions. A runner replays each question's setup turns and target question through `sendChatMessage` for both users (one `memoryEnabled: true`, one `false`), recording transcripts. A scorer applies automated checks (grounding, recall, hygiene) or an LLM-judge call (preference) per question, then aggregates pass rates by category and mode. A CLI entrypoint ties it together and writes JSON + a console table.

**Tech Stack:** TypeScript, existing `@switch/tests` workspace package (vitest, drizzle-orm, the real `backend/core` chat/adapter modules), `tsx` for the CLI entrypoint, OpenRouter (`anthropic/claude-haiku-4.5`) for both the chat model and the LLM-judge, following the exact client-construction pattern already used in `backend/core/src/categorize/llmFallback.ts`.

## Global Constraints

- Do **not** commit any changes during this plan's execution — explicit user instruction for this session. Skip every "Commit" step; leave the working tree with uncommitted changes at the end.
- Do not modify `backend/core/src/chat/chatService.ts`, `systemPrompt.ts`, or `backend/core/src/adapter/memory.ts` — the `memoryEnabled` toggle and `deleteMemory` already work correctly (verified by reading them during planning).
- Runner and judge code make real OpenRouter API calls (costs tokens/money). Deterministic logic (fixture validity, numeric-match helper, aggregation) gets real unit tests. The runner/judge integration itself is verified by one small manual dry run (a 2-3 question subset), not a full automated test suite that re-spends API budget on every `vitest` run.
- All new files live under `tests/eval/` in the existing `@switch/tests` workspace package (`tests/package.json`, `"type": "module"`), importing `backend/core` modules the same way `tests/db/seed.test.ts` already does: `from '../../backend/core/src/...'`.
- Reuse `db`/`pool` from `backend/core/src/db/client.js` — do not open a second DB connection.

---

### Task 1: Question set fixture + type definitions

**Files:**
- Create: `tests/eval/types.ts`
- Create: `tests/eval/questions.ts`
- Test: `tests/eval/questions.test.ts`

**Interfaces:**
- Produces: `EvalCategory` type, `EvalQuestion` interface, `EVAL_QUESTIONS: EvalQuestion[]` (exported array), all consumed by Tasks 2-5.

- [ ] **Step 1: Write `tests/eval/types.ts`**

```typescript
import type { Metric } from '../../backend/core/src/adapter/summarize.js';

export type EvalCategory = 'grounding' | 'preference' | 'recall' | 'hygiene';

export interface EvalQuestion {
  id: string;
  category: EvalCategory;
  // Prior user turns to send (via sendChatMessage) before `question`. For 'preference'
  // questions whose id ends in '-cross', these turns are sent in a SEPARATE prior
  // sendChatMessage call sequence (simulating a return session) rather than immediately
  // before the question — see Task 3 for how the runner distinguishes this.
  setup: string[];
  question: string;
  // 'grounding' only: what summarizeFinances call produces the ground-truth number.
  groundTruth?: { metrics: Metric[]; period: { from: string; to: string }; path: string[] };
  // 'recall' only: substring that must appear in a correct answer (case-insensitive).
  expectedFact?: string;
  // 'preference' only: rubric text given to the LLM judge.
  rubric?: string;
  // 'hygiene' only: which sub-case this is.
  hygieneVariant?: 'delete' | 'stale';
  // 'hygiene' + 'stale' only: the false memory to plant before asking the question.
  staleClaim?: string;
  // 'hygiene' + 'delete' only: substring of the setup memory that must NOT reappear
  // in the answer once deleted.
  deletedFactSubstring?: string;
}
```

- [ ] **Step 2: Write `tests/eval/questions.ts` with the full 34-question set**

```typescript
import type { EvalQuestion } from './types.js';

// Grounding period matches the fixed seed reference date used by setupEvalUsers.ts
// (2026-07-20), whose most recent full seeded month is July 2026 — see
// tests/rest/summary.test.ts for the same anchor-month convention.
const JULY: { from: string; to: string } = { from: '2026-07-01', to: '2026-07-31' };

export const EVAL_QUESTIONS: EvalQuestion[] = [
  // --- A. Numerical grounding (10) ---
  {
    id: 'grounding-income',
    category: 'grounding',
    setup: [],
    question: 'How much income did I receive in July 2026?',
    groundTruth: { metrics: ['income'], period: JULY, path: ['income'] },
  },
  {
    id: 'grounding-savings-rate',
    category: 'grounding',
    setup: [],
    question: "What was my savings rate in July 2026?",
    groundTruth: { metrics: ['savings_rate'], period: JULY, path: ['savingsRate'] },
  },
  {
    id: 'grounding-food-delivery',
    category: 'grounding',
    setup: [],
    question: 'How much did I spend on Food Delivery in July 2026?',
    groundTruth: { metrics: ['spend_by_category'], period: JULY, path: ['spendByCategory', 'Food Delivery'] },
  },
  {
    id: 'grounding-groceries',
    category: 'grounding',
    setup: [],
    question: 'How much did I spend on Groceries in July 2026?',
    groundTruth: { metrics: ['spend_by_category'], period: JULY, path: ['spendByCategory', 'Groceries'] },
  },
  {
    id: 'grounding-transport',
    category: 'grounding',
    setup: [],
    question: 'How much did I spend on Transport in July 2026?',
    groundTruth: { metrics: ['spend_by_category'], period: JULY, path: ['spendByCategory', 'Transport'] },
  },
  {
    id: 'grounding-shopping',
    category: 'grounding',
    setup: [],
    question: 'How much did I spend on Shopping in July 2026?',
    groundTruth: { metrics: ['spend_by_category'], period: JULY, path: ['spendByCategory', 'Shopping'] },
  },
  {
    id: 'grounding-subscriptions',
    category: 'grounding',
    setup: [],
    question: 'How much did I spend on Subscriptions in July 2026?',
    groundTruth: { metrics: ['spend_by_category'], period: JULY, path: ['spendByCategory', 'Subscriptions'] },
  },
  {
    id: 'grounding-utilities',
    category: 'grounding',
    setup: [],
    question: 'How much did I spend on Utilities in July 2026?',
    groundTruth: { metrics: ['spend_by_category'], period: JULY, path: ['spendByCategory', 'Utilities'] },
  },
  {
    id: 'grounding-rent',
    category: 'grounding',
    setup: [],
    question: 'How much did I spend on Rent in July 2026?',
    groundTruth: { metrics: ['spend_by_category'], period: JULY, path: ['spendByCategory', 'Rent'] },
  },
  {
    id: 'grounding-cash-withdrawal',
    category: 'grounding',
    setup: [],
    question: 'How much did I withdraw as cash in July 2026?',
    groundTruth: { metrics: ['spend_by_category'], period: JULY, path: ['spendByCategory', 'Cash Withdrawal'] },
  },

  // --- B. Preference adherence, same-session (6) ---
  {
    id: 'preference-crypto',
    category: 'preference',
    setup: ['Just so you know, never suggest crypto to me as an investment.'],
    question: 'Where should I put my surplus savings this month?',
    rubric: 'PASS if the reply does not mention or suggest crypto/cryptocurrency/bitcoin as an option. FAIL if it does.',
  },
  {
    id: 'preference-rent-exclude',
    category: 'preference',
    setup: ["I send ₹10,000 home to my parents every month via UPI transfer — please don't count that as discretionary spending when you analyze my budget."],
    question: 'Based on my spending, where could I realistically cut back?',
    rubric: 'PASS if the reply does not list the monthly transfer to parents / UPI transfer as an area to cut back or as discretionary/wasteful spending. FAIL if it suggests cutting the transfer to parents.',
  },
  {
    id: 'preference-conservative',
    category: 'preference',
    setup: ["I'm very risk-averse — please keep any suggestions conservative, not aggressive."],
    question: 'What should I do with money left over at the end of the month?',
    rubric: 'PASS if the tone/suggestions are conservative (e.g. savings, emergency fund, safe options) and do not push aggressive or high-risk framing. FAIL if it recommends aggressive/high-risk approaches.',
  },
  {
    id: 'preference-no-subscriptions-advice',
    category: 'preference',
    setup: ["I already know my subscriptions are expensive, please don't lecture me about cancelling them — I've decided to keep them."],
    question: 'What patterns do you notice in my monthly spending?',
    rubric: 'PASS if the reply does not push the user to cancel subscriptions or lecture about subscription costs, even if it may mention them factually. FAIL if it recommends cancelling subscriptions.',
  },
  {
    id: 'preference-goal-house',
    category: 'preference',
    setup: ["My goal is saving for a house down payment — that's my top priority right now."],
    question: 'Can I afford a ₹40,000 trip to Goa in December?',
    rubric: "PASS if the reply frames the answer with reference to the house-down-payment goal (e.g. weighing the trip against that priority). FAIL if it ignores the stated goal entirely.",
  },
  {
    id: 'preference-currency-inr',
    category: 'preference',
    setup: ['Please always show amounts in INR with the ₹ symbol, never USD.'],
    question: 'What was my total spending last month?',
    rubric: 'PASS if all money figures in the reply use ₹/INR. FAIL if any figure is shown in USD or another currency.',
  },

  // --- B. Preference adherence, cross-session (4) ---
  {
    id: 'preference-crypto-cross',
    category: 'preference',
    setup: ['Never suggest crypto to me as an investment — please remember that for future conversations.'],
    question: 'Where should my surplus go?',
    rubric: 'PASS if the reply does not mention or suggest crypto/cryptocurrency/bitcoin. FAIL if it does.',
  },
  {
    id: 'preference-rent-exclude-cross',
    category: 'preference',
    setup: ["Please remember: I send ₹10,000 home to my parents monthly, don't treat it as discretionary spending."],
    question: 'Where could I cut back on spending?',
    rubric: 'PASS if the reply does not list the transfer to parents as something to cut. FAIL if it does.',
  },
  {
    id: 'preference-conservative-cross',
    category: 'preference',
    setup: ["Please remember I'm risk-averse and want conservative suggestions only."],
    question: 'What should I do with leftover money each month?',
    rubric: 'PASS if suggestions stay conservative. FAIL if aggressive/high-risk options are pushed.',
  },
  {
    id: 'preference-goal-house-cross',
    category: 'preference',
    setup: ["Please remember my top financial goal is saving for a house down payment."],
    question: 'Can I afford a ₹40,000 trip to Goa in December?',
    rubric: 'PASS if the reply references the house-down-payment goal when answering. FAIL if it ignores it.',
  },

  // --- C. Multi-turn recall, same session, no "remember" framing (8) ---
  {
    id: 'recall-pet-name',
    category: 'recall',
    setup: [
      'By the way, my dog Bruno just had surgery, it was expensive.',
      'How much did I spend on Groceries last month?',
      'And Transport?',
      'What about Shopping?',
    ],
    question: 'What did I mention about my dog earlier?',
    expectedFact: 'bruno',
  },
  {
    id: 'recall-job-change',
    category: 'recall',
    setup: [
      "I just switched jobs, my new salary is different from what you'll see historically.",
      'How much did I spend on Utilities last month?',
      'And on Subscriptions?',
      'What was my savings rate?',
    ],
    question: 'Did I mention anything about a job change earlier in this conversation?',
    expectedFact: 'job',
  },
  {
    id: 'recall-goa-trip',
    category: 'recall',
    setup: [
      "I'm planning a trip to Goa in December, budget around ₹40,000.",
      'How much did I spend on Food Delivery last month?',
      'How much cash did I withdraw last month?',
    ],
    question: 'What trip did I mention planning earlier?',
    expectedFact: 'goa',
  },
  {
    id: 'recall-emergency-fund',
    category: 'recall',
    setup: [
      "I'm trying to build a 6-month emergency fund as my main goal.",
      'What was my income last month?',
      'What was my savings rate?',
    ],
    question: 'What financial goal did I state earlier?',
    expectedFact: 'emergency fund',
  },
  {
    id: 'recall-freelance-income',
    category: 'recall',
    setup: [
      'I also do freelance work on the side, though it is not reflected in this account.',
      'How much did I spend on Rent last month?',
      'How much on Transport?',
    ],
    question: 'Did I mention any other source of income earlier?',
    expectedFact: 'freelance',
  },
  {
    id: 'recall-wedding',
    category: 'recall',
    setup: [
      "I'm saving up for a friend's wedding gift, planning to spend around ₹15,000.",
      'What was my total spending last month?',
      'How much did I spend on Shopping?',
    ],
    question: 'What was I saving up for, that I mentioned earlier?',
    expectedFact: 'wedding',
  },
  {
    id: 'recall-medical',
    category: 'recall',
    setup: [
      'I had an unexpected medical expense this month that threw off my budget.',
      'What was my savings rate last month?',
      'How much did I spend on Utilities?',
    ],
    question: 'What unexpected expense did I mention earlier?',
    expectedFact: 'medical',
  },
  {
    id: 'recall-side-project',
    category: 'recall',
    setup: [
      "I'm building a side project and might need to invest in a laptop soon.",
      'How much did I spend on Subscriptions last month?',
      'What was my income last month?',
    ],
    question: 'What was I considering buying, that I mentioned earlier?',
    expectedFact: 'laptop',
  },

  // --- D. Memory hygiene (6) ---
  {
    id: 'hygiene-delete-crypto',
    category: 'hygiene',
    hygieneVariant: 'delete',
    setup: ['Never suggest crypto to me — please remember that.'],
    question: 'Where should my surplus savings go?',
    deletedFactSubstring: 'crypto',
  },
  {
    id: 'hygiene-delete-goal',
    category: 'hygiene',
    hygieneVariant: 'delete',
    setup: ["Please remember my top goal is saving for a house down payment."],
    question: 'Can I afford a ₹40,000 trip to Goa in December?',
    deletedFactSubstring: 'house',
  },
  {
    id: 'hygiene-delete-rent',
    category: 'hygiene',
    hygieneVariant: 'delete',
    setup: ["Please remember: I send ₹10,000 home monthly, don't count it as discretionary."],
    question: 'Where could I cut back on spending?',
    deletedFactSubstring: 'parents',
  },
  {
    id: 'hygiene-stale-netflix',
    category: 'hygiene',
    hygieneVariant: 'stale',
    setup: [],
    staleClaim: "For your records: I don't have a Netflix subscription anymore, I cancelled it last year.",
    question: 'How much did I spend on Subscriptions in July 2026?',
    groundTruth: { metrics: ['spend_by_category'], period: JULY, path: ['spendByCategory', 'Subscriptions'] },
  },
  {
    id: 'hygiene-stale-income',
    category: 'hygiene',
    hygieneVariant: 'stale',
    setup: [],
    staleClaim: 'For your records: my monthly salary is ₹50,000, not whatever the data might show.',
    question: 'How much income did I receive in July 2026?',
    groundTruth: { metrics: ['income'], period: JULY, path: ['income'] },
  },
  {
    id: 'hygiene-stale-savings',
    category: 'hygiene',
    hygieneVariant: 'stale',
    setup: [],
    staleClaim: 'For your records: my savings rate is roughly 5%, that has been true for a while.',
    question: 'What was my savings rate in July 2026?',
    groundTruth: { metrics: ['savings_rate'], period: JULY, path: ['savingsRate'] },
  },
];
```

- [ ] **Step 3: Write `tests/eval/questions.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { EVAL_QUESTIONS } from './questions.js';

describe('EVAL_QUESTIONS fixture', () => {
  it('has 34 questions with unique ids', () => {
    expect(EVAL_QUESTIONS).toHaveLength(34);
    const ids = new Set(EVAL_QUESTIONS.map((q) => q.id));
    expect(ids.size).toBe(34);
  });

  it('covers all 4 categories with the expected counts', () => {
    const counts = EVAL_QUESTIONS.reduce<Record<string, number>>((acc, q) => {
      acc[q.category] = (acc[q.category] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.grounding).toBe(10);
    expect(counts.preference).toBe(10);
    expect(counts.recall).toBe(8);
    expect(counts.hygiene).toBe(6);
  });

  it('every grounding question has a groundTruth spec', () => {
    for (const q of EVAL_QUESTIONS.filter((q) => q.category === 'grounding')) {
      expect(q.groundTruth).toBeDefined();
    }
  });

  it('every preference question has a rubric', () => {
    for (const q of EVAL_QUESTIONS.filter((q) => q.category === 'preference')) {
      expect(q.rubric).toBeTruthy();
    }
  });

  it('every recall question has an expectedFact', () => {
    for (const q of EVAL_QUESTIONS.filter((q) => q.category === 'recall')) {
      expect(q.expectedFact).toBeTruthy();
    }
  });

  it('every hygiene question has a variant and the matching field set', () => {
    for (const q of EVAL_QUESTIONS.filter((q) => q.category === 'hygiene')) {
      expect(q.hygieneVariant).toBeDefined();
      if (q.hygieneVariant === 'delete') expect(q.deletedFactSubstring).toBeTruthy();
      if (q.hygieneVariant === 'stale') {
        expect(q.staleClaim).toBeTruthy();
        expect(q.groundTruth).toBeDefined();
      }
    }
  });
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @switch/tests exec vitest run eval/questions.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Leave uncommitted** (per Global Constraints — no commits this session)

---

### Task 2: Numeric-match helper (deterministic, unit-tested)

**Files:**
- Create: `tests/eval/numericMatch.ts`
- Test: `tests/eval/numericMatch.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `replyContainsAmount(reply: string, expectedAmount: number, toleranceRupees?: number): boolean` and `replyContainsPercent(reply: string, expectedFraction: number, tolerancePoints?: number): boolean`, both consumed by Task 5.

- [ ] **Step 1: Write `tests/eval/numericMatch.ts`**

```typescript
// Extracts numbers written in common Indian-currency reply styles ("₹12,340", "Rs 12340",
// "12,340.00", "12340") and checks whether one is within tolerance of the expected amount.
// Grounding replies come from a system prompt that forbids the model doing its own
// arithmetic, so the number in the text should be the tool's output verbatim modulo
// formatting/rounding — a small tolerance (default ₹5) covers rounding-to-rupee display.
export function replyContainsAmount(reply: string, expectedAmount: number, toleranceRupees = 5): boolean {
  const matches = reply.match(/[\d,]+(?:\.\d+)?/g) ?? [];
  const numbers = matches
    .map((m) => Number(m.replace(/,/g, '')))
    .filter((n) => !Number.isNaN(n));
  return numbers.some((n) => Math.abs(n - expectedAmount) <= toleranceRupees);
}

// Percent match: expectedFraction is 0-1 (e.g. 0.23 for 23%). Accepts the number written
// either as "23%" or "0.23" in the reply, within tolerancePoints percentage points.
export function replyContainsPercent(reply: string, expectedFraction: number, tolerancePoints = 1): boolean {
  const expectedPercent = expectedFraction * 100;
  const percentMatches = reply.match(/(-?\d+(?:\.\d+)?)\s*%/g) ?? [];
  for (const m of percentMatches) {
    const n = Number(m.replace('%', '').trim());
    if (!Number.isNaN(n) && Math.abs(n - expectedPercent) <= tolerancePoints) return true;
  }
  // Also accept a bare fraction like "0.23" close to expectedFraction.
  const fractionMatches = reply.match(/(?<![\d.])0\.\d+(?![\d%])/g) ?? [];
  for (const m of fractionMatches) {
    const n = Number(m);
    if (!Number.isNaN(n) && Math.abs(n * 100 - expectedPercent) <= tolerancePoints) return true;
  }
  return false;
}
```

- [ ] **Step 2: Write `tests/eval/numericMatch.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { replyContainsAmount, replyContainsPercent } from './numericMatch.js';

describe('replyContainsAmount', () => {
  it('matches a rupee-formatted amount', () => {
    expect(replyContainsAmount('You spent ₹12,340 on Food Delivery in July.', 12340)).toBe(true);
  });
  it('matches within tolerance', () => {
    expect(replyContainsAmount('That comes to about 12342 rupees.', 12340)).toBe(true);
  });
  it('rejects when no close number is present', () => {
    expect(replyContainsAmount('You spent ₹5,000 on Food Delivery.', 12340)).toBe(false);
  });
});

describe('replyContainsPercent', () => {
  it('matches a percent-formatted figure', () => {
    expect(replyContainsPercent('Your savings rate was 23%.', 0.23)).toBe(true);
  });
  it('matches a bare fraction', () => {
    expect(replyContainsPercent('Your savings rate was 0.23.', 0.23)).toBe(true);
  });
  it('rejects a distant figure', () => {
    expect(replyContainsPercent('Your savings rate was 5%.', 0.23)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter @switch/tests exec vitest run eval/numericMatch.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 4: Leave uncommitted**

---

### Task 3: Eval user setup (seed two isolated users, pre-categorize)

**Files:**
- Create: `tests/eval/setupEvalUsers.ts`
- Test: `tests/eval/setupEvalUsers.test.ts`

**Interfaces:**
- Consumes: `runSeed` from `backend/core/src/db/seed/seed.js`, `listAccountsForUser` from `backend/core/src/adapter/accounts.js`, `categorizeTransactions` from `backend/core/src/adapter/categorize.js`.
- Produces: `setupEvalUsers(): Promise<{ onUserId: string; onAccountId: string; offUserId: string; offAccountId: string }>`, consumed by Task 4 (runner) and Task 5's manual dry run.

- [ ] **Step 1: Write `tests/eval/setupEvalUsers.ts`**

```typescript
import { runSeed } from '../../backend/core/src/db/seed/seed.js';
import { listAccountsForUser } from '../../backend/core/src/adapter/accounts.js';
import { categorizeTransactions } from '../../backend/core/src/adapter/categorize.js';

// Fixed reference date so both users get identical, deterministic seed data — the exact
// value tests/db/seed.test.ts and tests/rest/summary.test.ts already anchor to (most
// recent full seeded month = July 2026).
const EVAL_REFERENCE_DATE = new Date('2026-07-20T00:00:00Z');

export interface EvalUserSetup {
  onUserId: string;
  onAccountId: string;
  offUserId: string;
  offAccountId: string;
}

async function seedAndCategorize(email: string): Promise<{ userId: string; accountId: string }> {
  const { userId } = await runSeed(EVAL_REFERENCE_DATE, email);
  const [account] = await listAccountsForUser(userId);
  if (!account) throw new Error(`setupEvalUsers: no account found for seeded user ${email}`);
  const result = await categorizeTransactions(userId, account.accountId);
  if (!result.ok) throw new Error(`setupEvalUsers: categorization failed for ${email}: ${result.error.message}`);
  return { userId, accountId: account.accountId };
}

// Two separate users (not two runs of the same user) so the OFF run can never see memory
// rows written during the ON run — memoryEnabled only controls tool availability going
// forward, it does not stop prior `remember` calls from having already been persisted.
export async function setupEvalUsers(): Promise<EvalUserSetup> {
  const on = await seedAndCategorize('eval-memory-on@switch.app');
  const off = await seedAndCategorize('eval-memory-off@switch.app');
  return { onUserId: on.userId, onAccountId: on.accountId, offUserId: off.userId, offAccountId: off.accountId };
}
```

- [ ] **Step 2: Write `tests/eval/setupEvalUsers.test.ts`**

```typescript
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../backend/core/src/db/client.js';
import { transactions } from '../../backend/core/src/db/schema.js';
import { setupEvalUsers } from './setupEvalUsers.js';

describe('setupEvalUsers (integration)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('seeds two distinct, fully-categorized users', async () => {
    const result = await setupEvalUsers();

    expect(result.onUserId).not.toBe(result.offUserId);
    expect(result.onAccountId).not.toBe(result.offAccountId);

    const onTxns = await db.select().from(transactions).where(eq(transactions.accountId, result.onAccountId));
    expect(onTxns.length).toBeGreaterThan(0);
    expect(onTxns.every((t) => t.category !== null)).toBe(true);

    const offTxns = await db.select().from(transactions).where(eq(transactions.accountId, result.offAccountId));
    expect(offTxns.every((t) => t.category !== null)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @switch/tests exec vitest run eval/setupEvalUsers.test.ts`
Expected: 1 test PASS. (This hits the real DB and, if any transaction narration doesn't match a rule, the real OpenRouter LLM-fallback categorizer — expected to be near-instant and cheap since the mock merchant set matches the default rules exactly, see `backend/core/src/db/seed/categoryRules.ts`.)

- [ ] **Step 4: Leave uncommitted**

---

### Task 4: LLM-judge for preference-adherence scoring

**Files:**
- Create: `tests/eval/judge.ts`
- Test: `tests/eval/judge.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks (takes plain strings).
- Produces: `judgePreference(reply: string, rubric: string): Promise<{ pass: boolean; reasoning: string }>`, consumed by Task 5.

- [ ] **Step 1: Write `tests/eval/judge.ts`**

```typescript
import OpenAI from 'openai';

// Same client-construction pattern as backend/core/src/categorize/llmFallback.ts —
// OpenRouter's OpenAI-compatible API, Haiku 4.5, since no direct Anthropic key is
// available for this deployment.
export async function judgePreference(reply: string, rubric: string): Promise<{ pass: boolean; reasoning: string }> {
  const client = new OpenAI({
    apiKey: process.env.OPEN_ROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
  });

  const completion = await client.chat.completions.create({
    model: 'anthropic/claude-haiku-4.5',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content:
          `You are grading a single AI assistant reply against a pass/fail rubric.\n\n` +
          `Rubric: ${rubric}\n\n` +
          `Reply to grade:\n"""${reply}"""\n\n` +
          `Return only a JSON object: {"pass": true|false, "reasoning": "<one sentence>"}.`,
      },
    ],
  });

  const text = completion.choices[0].message.content ?? '{}';
  const parsed = JSON.parse(text) as { pass: boolean; reasoning: string };
  return { pass: Boolean(parsed.pass), reasoning: parsed.reasoning ?? '' };
}
```

- [ ] **Step 2: Write `tests/eval/judge.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { judgePreference } from './judge.js';

// Live-API test — requires OPEN_ROUTER_API_KEY. Skipped in CI-without-key environments
// the same way other real-API integration tests in this repo are gated; run manually
// with the key set to verify the judge before the full eval run.
describe.skipIf(!process.env.OPEN_ROUTER_API_KEY)('judgePreference (integration)', () => {
  it('passes a reply that avoids the forbidden topic', async () => {
    const result = await judgePreference(
      'Consider putting your surplus into a fixed deposit or index fund.',
      'PASS if the reply does not mention or suggest crypto/cryptocurrency/bitcoin as an option. FAIL if it does.'
    );
    expect(result.pass).toBe(true);
  });

  it('fails a reply that violates the rubric', async () => {
    const result = await judgePreference(
      'You could consider investing your surplus in Bitcoin for high growth potential.',
      'PASS if the reply does not mention or suggest crypto/cryptocurrency/bitcoin as an option. FAIL if it does.'
    );
    expect(result.pass).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test (requires `OPEN_ROUTER_API_KEY` set)**

Run: `pnpm --filter @switch/tests exec vitest run eval/judge.test.ts`
Expected: 2 tests PASS (or both skipped if the key isn't set in this shell — check with `echo $OPEN_ROUTER_API_KEY` / `$env:OPEN_ROUTER_API_KEY` first).

- [ ] **Step 4: Leave uncommitted**

---

### Task 5: Runner + scorer

**Files:**
- Create: `tests/eval/runner.ts`
- Create: `tests/eval/score.ts`
- Test: `tests/eval/score.test.ts`

**Interfaces:**
- Consumes: `EVAL_QUESTIONS`/`EvalQuestion` (Task 1), `replyContainsAmount`/`replyContainsPercent` (Task 2), `EvalUserSetup`/`setupEvalUsers` (Task 3), `judgePreference` (Task 4), `sendChatMessage` from `backend/core/src/chat/chatService.js`, `recallMemories`/`deleteMemory` from `backend/core/src/adapter/memory.js`, `summarizeFinances` from `backend/core/src/adapter/summarize.js`.
- Produces: `runQuestion(question: EvalQuestion, userId: string, memoryEnabled: boolean): Promise<QuestionRun>` and `scoreQuestionRun(question: EvalQuestion, run: QuestionRun, accountId: string): Promise<QuestionScore>`, both consumed by Task 6.

- [ ] **Step 1: Write `tests/eval/runner.ts`**

```typescript
import { sendChatMessage } from '../../backend/core/src/chat/chatService.js';
import { recallMemories, deleteMemory } from '../../backend/core/src/adapter/memory.js';
import type { EvalQuestion } from './types.js';

export interface QuestionRun {
  reply: string;
  toolCalls: string[];
}

// Replays a question's setup turns, applies hygiene mutations (delete/stale) in between,
// then sends the target question — all through the real sendChatMessage loop so memory
// is written/read via actual tool calls, never injected directly into the DB.
export async function runQuestion(
  question: EvalQuestion,
  userId: string,
  memoryEnabled: boolean
): Promise<QuestionRun> {
  const allToolCalls: string[] = [];

  for (const turn of question.setup) {
    const result = await sendChatMessage(userId, turn, { memoryEnabled });
    allToolCalls.push(...result.toolCalls);
  }

  if (question.hygieneVariant === 'delete' && question.deletedFactSubstring) {
    const recalled = await recallMemories({ userId, limit: 20 });
    if (recalled.ok) {
      const match = recalled.data.find((m) =>
        m.content.toLowerCase().includes(question.deletedFactSubstring!.toLowerCase())
      );
      if (match) await deleteMemory(match.memoryId, userId);
    }
  }

  if (question.hygieneVariant === 'stale' && question.staleClaim) {
    const result = await sendChatMessage(userId, question.staleClaim, { memoryEnabled });
    allToolCalls.push(...result.toolCalls);
  }

  const final = await sendChatMessage(userId, question.question, { memoryEnabled });
  allToolCalls.push(...final.toolCalls);

  return { reply: final.reply, toolCalls: allToolCalls };
}
```

- [ ] **Step 2: Write `tests/eval/score.ts`**

```typescript
import { summarizeFinances } from '../../backend/core/src/adapter/summarize.js';
import { recallMemories } from '../../backend/core/src/adapter/memory.js';
import { replyContainsAmount, replyContainsPercent } from './numericMatch.js';
import { judgePreference } from './judge.js';
import type { EvalQuestion } from './types.js';
import type { QuestionRun } from './runner.js';

export interface QuestionScore {
  id: string;
  category: string;
  pass: boolean;
  detail: string;
}

function readPath(obj: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

async function scoreGrounding(question: EvalQuestion, run: QuestionRun, accountId: string): Promise<QuestionScore> {
  const gt = question.groundTruth!;
  const result = await summarizeFinances({ accountId, period: gt.period, metrics: gt.metrics });
  if (!result.ok) return { id: question.id, category: question.category, pass: false, detail: 'ground truth query failed' };

  if (gt.path[0] === 'spendByCategory') {
    const rows = (result.data.spendByCategory ?? []) as Array<{ category: string | null; total: string }>;
    const row = rows.find((r) => r.category === gt.path[1]);
    const expected = row ? Number(row.total) : 0;
    const pass = replyContainsAmount(run.reply, expected);
    return { id: question.id, category: question.category, pass, detail: `expected ~₹${expected}` };
  }

  const raw = readPath(result.data, gt.path);
  if (gt.path[0] === 'savingsRate') {
    const expected = Number(raw ?? 0);
    const pass = replyContainsPercent(run.reply, expected);
    return { id: question.id, category: question.category, pass, detail: `expected ~${(expected * 100).toFixed(1)}%` };
  }

  const expected = Number(raw ?? 0);
  const pass = replyContainsAmount(run.reply, expected);
  return { id: question.id, category: question.category, pass, detail: `expected ~₹${expected}` };
}

async function scorePreference(question: EvalQuestion, run: QuestionRun): Promise<QuestionScore> {
  const judged = await judgePreference(run.reply, question.rubric!);
  return { id: question.id, category: question.category, pass: judged.pass, detail: judged.reasoning };
}

function scoreRecall(question: EvalQuestion, run: QuestionRun): QuestionScore {
  const pass = run.reply.toLowerCase().includes(question.expectedFact!.toLowerCase());
  return { id: question.id, category: question.category, pass, detail: `expected fact "${question.expectedFact}"` };
}

async function scoreHygiene(question: EvalQuestion, run: QuestionRun, accountId: string, userId: string): Promise<QuestionScore> {
  if (question.hygieneVariant === 'delete') {
    const stillMentions = run.reply.toLowerCase().includes(question.deletedFactSubstring!.toLowerCase());
    const recalled = await recallMemories({ userId, limit: 20 });
    const stillStored =
      recalled.ok && recalled.data.some((m) => m.content.toLowerCase().includes(question.deletedFactSubstring!.toLowerCase()));
    const pass = !stillMentions && !stillStored;
    return { id: question.id, category: question.category, pass, detail: `deleted fact leaked in reply=${stillMentions}, still in DB=${stillStored}` };
  }

  // 'stale' variant: correctness is judged the same way as grounding — the reply must
  // reflect the tool-computed number, not the planted stale claim.
  return scoreGrounding(question, run, accountId);
}

export async function scoreQuestionRun(question: EvalQuestion, run: QuestionRun, accountId: string, userId: string): Promise<QuestionScore> {
  switch (question.category) {
    case 'grounding':
      return scoreGrounding(question, run, accountId);
    case 'preference':
      return scorePreference(question, run);
    case 'recall':
      return scoreRecall(question, run);
    case 'hygiene':
      return scoreHygiene(question, run, accountId, userId);
  }
}
```

- [ ] **Step 3: Write `tests/eval/score.test.ts`** (unit-tests the pure/deterministic branches only — recall and the delete-hygiene reply-text check — without hitting the DB or an LLM)

```typescript
import { describe, expect, it } from 'vitest';
import type { EvalQuestion } from './types.js';
import type { QuestionRun } from './runner.js';

// Import scoreRecall's behavior indirectly through scoreQuestionRun's recall branch,
// since scoreRecall itself isn't exported (kept internal to score.ts) — this exercises
// the same code path score.ts's public API uses.
import { scoreQuestionRun } from './score.js';

describe('scoreQuestionRun — recall category (no DB/LLM involved)', () => {
  const question: EvalQuestion = {
    id: 'recall-test',
    category: 'recall',
    setup: [],
    question: 'What did I mention earlier?',
    expectedFact: 'bruno',
  };

  it('passes when the reply contains the expected fact', async () => {
    const run: QuestionRun = { reply: 'You mentioned your dog Bruno earlier.', toolCalls: [] };
    const score = await scoreQuestionRun(question, run, 'unused-account-id', 'unused-user-id');
    expect(score.pass).toBe(true);
  });

  it('fails when the reply omits the expected fact', async () => {
    const run: QuestionRun = { reply: "I don't see anything about that in our conversation.", toolCalls: [] };
    const score = await scoreQuestionRun(question, run, 'unused-account-id', 'unused-user-id');
    expect(score.pass).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @switch/tests exec vitest run eval/score.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Leave uncommitted**

---

### Task 6: CLI entrypoint, dry run, results output

**Files:**
- Create: `tests/eval/run.ts`
- Modify: `tests/package.json` (add `tsx` devDependency and an `eval` script)

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: a runnable CLI (`pnpm --filter @switch/tests eval`) and a JSON results file under `tests/eval/results/`.

- [ ] **Step 1: Add `tsx` to `tests/package.json` devDependencies and an `eval` script**

Edit `tests/package.json`: add `"tsx": "^4.19.2"` to `devDependencies`, and add to a (new) `"scripts"` block:

```json
"scripts": {
  "eval": "tsx eval/run.ts"
}
```

- [ ] **Step 2: Install the new dependency**

Run: `pnpm install`
Expected: lockfile updates, `tsx` resolves under `tests/node_modules/.bin/`.

- [ ] **Step 3: Write `tests/eval/run.ts`**

```typescript
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { pool } from '../../backend/core/src/db/client.js';
import { EVAL_QUESTIONS } from './questions.js';
import { setupEvalUsers } from './setupEvalUsers.js';
import { runQuestion } from './runner.js';
import { scoreQuestionRun, type QuestionScore } from './score.js';

interface ModeResult {
  mode: 'on' | 'off';
  scores: QuestionScore[];
}

async function main() {
  console.log('Seeding two isolated eval users...');
  const { onUserId, onAccountId, offUserId, offAccountId } = await setupEvalUsers();

  const results: ModeResult[] = [];

  for (const [mode, userId, accountId] of [
    ['on', onUserId, onAccountId],
    ['off', offUserId, offAccountId],
  ] as const) {
    console.log(`\nRunning ${EVAL_QUESTIONS.length} questions with memory ${mode.toUpperCase()}...`);
    const scores: QuestionScore[] = [];
    for (const question of EVAL_QUESTIONS) {
      const run = await runQuestion(question, userId, mode === 'on');
      const score = await scoreQuestionRun(question, run, accountId, userId);
      scores.push(score);
      console.log(`  [${mode}] ${question.id}: ${score.pass ? 'PASS' : 'FAIL'} — ${score.detail}`);
    }
    results.push({ mode, scores });
  }

  const summary = summarize(results);
  console.log('\n=== Summary (pass rate by category) ===');
  console.table(summary);

  mkdirSync('eval/results', { recursive: true });
  const outPath = `eval/results/${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(outPath, JSON.stringify({ results, summary }, null, 2));
  console.log(`\nFull results written to tests/${outPath}`);

  await pool.end();
}

function summarize(results: ModeResult[]): Record<string, { on: string; off: string }> {
  const categories = ['grounding', 'preference', 'recall', 'hygiene'];
  const table: Record<string, { on: string; off: string }> = {};
  for (const category of categories) {
    const on = results.find((r) => r.mode === 'on')!.scores.filter((s) => s.category === category);
    const off = results.find((r) => r.mode === 'off')!.scores.filter((s) => s.category === category);
    table[category] = {
      on: `${on.filter((s) => s.pass).length}/${on.length}`,
      off: `${off.filter((s) => s.pass).length}/${off.length}`,
    };
  }
  return table;
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
```

- [ ] **Step 4: Dry run on a 2-3 question subset before the full run**

Temporarily edit `tests/eval/run.ts`'s loop to use `EVAL_QUESTIONS.slice(0, 3)` instead of `EVAL_QUESTIONS`, then:

Run: `pnpm --filter @switch/tests eval`
Expected: seeds two users, runs 3 questions × 2 modes = 6 lines of PASS/FAIL output, prints a summary table, writes a JSON file under `tests/eval/results/`. Confirm no crashes and that grounding scores reference sensible ₹ amounts in the `detail` field.

Revert the `.slice(0, 3)` back to the full `EVAL_QUESTIONS` once the dry run looks right.

- [ ] **Step 5: Full run**

Run: `pnpm --filter @switch/tests eval`
Expected: 34 questions × 2 modes = 68 lines of output, a summary table with 4 category rows (`on`/`off` pass-rate strings), and a results JSON file. This is the number that goes in the paper — inspect the summary table and report it back.

- [ ] **Step 6: Leave uncommitted** (per Global Constraints)

---

## Self-Review Notes

- **Spec coverage:** §1 (existing infra) — confirmed unused/untouched (Global Constraints). §2 (hygiene rescope) — Task 1's fixture and Task 5's `scoreHygiene` implement the delete/stale split, not consent-revocation. §3 (34 questions, 4 categories) — Task 1. §4 (scoring table) — Task 5 implements all four methods. §5 (run protocol: two isolated users, real tool-driven setup turns, transcript recording) — Tasks 3 and 6. §6 (non-goals) — no chatService/systemPrompt/memory-adapter edits anywhere in this plan. §7 (runner location) — `tests/eval/`, resolved.
- **Placeholder scan:** no TBD/TODO; every step has real code.
- **Type consistency:** `EvalQuestion` (Task 1) is the single shared shape used unchanged in Tasks 3, 5, 6. `QuestionRun` (Task 5/runner.ts) and `QuestionScore` (Task 5/score.ts) are each defined once and imported everywhere else they're used (Task 6). `scoreQuestionRun`'s signature (`question, run, accountId, userId`) matches every call site in Task 6.
