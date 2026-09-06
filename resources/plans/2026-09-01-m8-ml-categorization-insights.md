# ML-Backed Categorization, Subscriptions & Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve transaction categorization accuracy against real (messy) bank narration text, add genuine recurring-payment/subscription detection (there is currently none — mock data just hardcodes fixed templates), and add deterministic spending-anomaly insights with an LLM narrative layer on top. Feeds the Overview, Spending, and Subscriptions pages with real signal instead of the current mock-only story.

**Architecture:** `apps/server/src/categorize/rules.ts` does regex/keyword matching against `merchant + narration`; `llmFallback.ts` calls OpenRouter (`anthropic/claude-haiku-4.5` via the `openai` SDK, same client pattern as `chatService.ts`) for anything rules miss; `taxonomy.ts` defines 12 fixed categories; `transactions.category`/`confidence`/`categorizedBy` on the schema already support a `'rule' | 'llm' | 'user'` provenance split. Real bank narration (see `test/adapter/fixtures/finvu-fi-data-sample.xml`) looks like `"DEP TFR   NEFT*UTIB0001506*AXNPN40445376118*PHONEPE PRI"` and `"WDL TFR   UPI/DR/441315150517/Bharti A/YESB/AIRTELPRED/"` — structured-but-noisy strings, nothing like mock data's clean `"SWIGGY ORDER"` templates. Any improvement has to handle that structure explicitly.

**Tech Stack:** No new runtime deps required for the core work — plain TypeScript regex parsing, OpenRouter embeddings endpoint (via the already-installed `openai` SDK) for the similarity-cache stretch goal, existing Drizzle/Postgres for storage.

**Design decision (from research, see conversation record):** Treat categorization as the one place genuine ML (embeddings) is worth the time. Treat subscription detection and spending anomalies as deterministic statistics, not ML — cheaper, more reliable, and far easier to demo correctly at hackathon time; use the LLM only to turn computed stats into prose, never to do the underlying detection.

## Global Constraints

- Keep `pnpm --filter @switch/server test` and `pnpm --filter @switch/server typecheck` green after every task.
- Every new categorization/detection path needs a unit test against real narration strings pulled from `test/adapter/fixtures/finvu-fi-data-sample.xml`, not just clean mock strings — that fixture is the ground truth for "does this actually work on real bank data."
- Don't change the `transactions` table schema without a clear need — `category`/`confidence`/`categorizedBy` already exist; only add columns if a task below explicitly requires one.
- Any LLM call must go through the existing OpenRouter client setup, not a new provider.

---

### Task 1: Narration normalization/extraction preprocessing

**Why:** Real UPI/NEFT/IMPS narration syntax buries the actual counterparty in noise (`UPI/DR/441315150517/Bharti A/YESB/AIRTELPRED/` — the merchant signal is `AIRTELPRED`, surrounded by a transaction reference, a person/entity name field, and a bank code). Extracting this first should raise the rule-engine's match rate significantly before any LLM call is needed, since `rules.ts` currently matches against the raw noisy string.

**Files:**
- Create: `apps/server/src/categorize/narrationNormalizer.ts`
- Create: `apps/server/test/categorize/narrationNormalizer.test.ts`

- [ ] **Step 1: Write failing tests against real fixture narrations**

Pull 10-15 real narration strings directly out of `test/adapter/fixtures/finvu-fi-data-sample.xml` (covering the `NEFT*...*PHONEPE PRI`, `UPI/DR/.../<name>/<bank>/<vpa>/`, `UPI/CR/...`, `DEBIT   ATMCard...`, `INTEREST CREDIT`, and `INB IMPS...` patterns actually present in that file) and write a test per pattern asserting `normalizeNarration(raw)` extracts a clean counterparty/merchant token.

- [ ] **Step 2: Implement the normalizer**

Write `normalizeNarration(narration: string): { counterparty: string | null; rawTokens: string[] }` (or similar) using targeted regexes per pattern family (UPI, NEFT, IMPS, ATM, interest/fee lines). Return `null` counterparty rather than guessing wrong when a pattern doesn't match any known shape — a categorization miss is better than a confidently wrong extraction.

- [ ] **Step 3: Run tests, typecheck, commit**

```bash
pnpm --filter @switch/server test -- narrationNormalizer
pnpm --filter @switch/server typecheck
git add apps/server/src/categorize/narrationNormalizer.ts apps/server/test/categorize/narrationNormalizer.test.ts
git commit -m "feat(categorize): extract counterparty from noisy UPI/NEFT/IMPS narration syntax"
```

---

### Task 2: Feed normalized narration into rules.ts and tighten the LLM fallback's structured output

**Files:**
- Modify: `apps/server/src/categorize/rules.ts`
- Modify: `apps/server/src/categorize/llmFallback.ts`
- Modify: `apps/server/test/categorize/rules.test.ts`

- [ ] **Step 1: Read both files in full to confirm the current match/prompt shape**

- [ ] **Step 2: Wire the normalizer into rules.ts's matching input**

Have `rules.ts` match against the normalized counterparty token (falling back to the raw narration if normalization returned `null`) rather than the raw string alone.

- [ ] **Step 3: Tighten llmFallback.ts's prompt and parsing**

Pass the normalized fields (not just raw narration) into the LLM prompt. Switch to structured JSON output (`response_format: { type: 'json_object' }`, supported by the OpenRouter/OpenAI SDK already in use) instead of a bare `JSON.parse` on freeform text — the current bare-parse approach is fragile against any stray prose the model adds.

- [ ] **Step 4: Add regression tests against real fixture narrations**

Extend `rules.test.ts` with cases using the same real narration strings from Task 1, asserting correct category (or correct "no match, falls through to LLM" behavior) now that normalization feeds the matcher.

- [ ] **Step 5: Run tests, typecheck, commit**

```bash
pnpm --filter @switch/server test
pnpm --filter @switch/server typecheck
git add apps/server/src/categorize/rules.ts apps/server/src/categorize/llmFallback.ts apps/server/test/categorize/rules.test.ts
git commit -m "feat(categorize): match against normalized narration, structured LLM fallback output"
```

---

### Task 3: Embedding-based merchant similarity cache (the "ML" showcase feature)

**Why:** Once a transaction is categorized (by rule, LLM, or user correction), future transactions from the same/similar counterparty shouldn't need a fresh LLM call. An embeddings-based cache turns every user correction into a permanent, self-improving shortcut — this is the one place genuine ML earns its complexity budget in this plan.

**Files:**
- Create: `apps/server/src/categorize/embeddingCache.ts`
- Create: `apps/server/test/categorize/embeddingCache.test.ts`
- Modify: wherever categorization is orchestrated (find the call site chaining rules → llmFallback, likely a `categorize.ts` or the `categorize_transactions` MCP tool)

- [ ] **Step 1: Design the cache shape**

In-memory (process-lifetime) map/array of `{ counterparty: string; embedding: number[]; category: string }`, populated from every transaction that has a non-null `category` (regardless of `categorizedBy`). No vector DB needed at this data volume — cosine similarity over a plain-TS array is fast enough for a few thousand entries. Document in a comment that this cache is not persisted across restarts (acceptable — it rebuilds from already-categorized DB rows on next use, or starts empty and falls through to rules/LLM until repopulated).

- [ ] **Step 2: Write failing tests**

Test cosine-similarity matching returns the right cached category for a near-duplicate counterparty string, and correctly falls through (returns no match) when nothing in the cache is similar enough (pick and document a similarity threshold, e.g. 0.85, with a comment on why).

- [ ] **Step 3: Implement using OpenRouter's embeddings endpoint**

Use `text-embedding-3-small` (or whatever the cheapest embeddings model available through the existing OpenRouter client is — verify against OpenRouter's current model list rather than assuming) via the `openai` SDK's embeddings API. Batch embedding calls where possible rather than one call per transaction.

- [ ] **Step 4: Wire the cache into the categorization pipeline**

Insert the embedding-cache check between "normalized rules match" and "LLM fallback" in the orchestration path found in Step 0 above — cache hit skips the LLM call entirely.

- [ ] **Step 5: Run tests, typecheck, commit**

```bash
pnpm --filter @switch/server test
pnpm --filter @switch/server typecheck
git add apps/server/src/categorize/embeddingCache.ts apps/server/test/categorize/embeddingCache.test.ts
git commit -m "feat(categorize): embedding-based similarity cache to avoid repeat LLM calls"
```

---

### Task 4: Deterministic recurring-payment/subscription detection

**Why:** There is currently no real subscription detection anywhere — mock data just hardcodes `SUBSCRIPTION_TEMPLATES` on fixed days. This is a statistics problem, not an ML problem: group by normalized merchant, check occurrence count + amount variance + interval regularity.

**Files:**
- Create: `apps/server/src/insights/subscriptionDetection.ts`
- Create: `apps/server/test/insights/subscriptionDetection.test.ts`
- Modify: whatever currently powers the Subscriptions page's data (find the REST/summary endpoint feeding `apps/web/src/app/dashboard/subscriptions/page.tsx`)

- [ ] **Step 1: Write failing tests with synthetic + real-shaped data**

Construct a small transaction set with an obvious monthly subscription pattern (same merchant, near-identical amount, ~30-day intervals) and confirm detection; also construct near-misses (irregular amounts, irregular intervals, too few occurrences) and confirm they're correctly *not* flagged.

- [ ] **Step 2: Implement the detection algorithm**

Group debit transactions by normalized counterparty (reuse Task 1's normalizer). Within each group with ≥3 occurrences: check amount variance is small (e.g. within 10-15%, or exact), check interval-between-charges clusters tightly around a fixed period (weekly ~7d / monthly ~28-31d / annual ~365d) with low standard deviation. Output a detected subscription with `merchant`, `amount`, `intervalDays`, `projectedNextChargeDate` (last date + median interval).

- [ ] **Step 3: Wire into the endpoint feeding the Subscriptions page**

Replace whatever currently populates that page (likely reading raw `merchant` groupings with no real recurrence logic — verify by reading the actual current implementation first) with this detector's output.

- [ ] **Step 4: Run tests, typecheck, verify in browser, commit**

```bash
pnpm --filter @switch/server test
pnpm --filter @switch/server typecheck
```

Manually check `/dashboard/subscriptions` renders the newly detected subscriptions correctly against seeded data.

```bash
git add apps/server/src/insights/subscriptionDetection.ts apps/server/test/insights/subscriptionDetection.test.ts
git commit -m "feat(insights): deterministic recurring-payment/subscription detection"
```

---

### Task 5: Spending anomaly detection + LLM narrative layer

**Why:** Turn raw category/amount data on the Overview/Spending pages into actual insight ("you spent 40% more on Food Delivery this month"), using deterministic stats for detection (cheap, reliable, testable) and the LLM only for prose generation (reuses the existing OpenRouter client, low incremental cost).

**Files:**
- Create: `apps/server/src/insights/spendingAnomalies.ts`
- Create: `apps/server/test/insights/spendingAnomalies.test.ts`
- Modify: whichever REST endpoint powers the Overview page's summary data

- [ ] **Step 1: Write failing tests for the two stat computations**

Month-over-month category delta (sum spend per category per month, % change vs. prior month or trailing 3-month average, threshold e.g. >25% to surface). Per-merchant/category z-score anomaly (flag a transaction >2 standard deviations from that merchant/category's historical mean).

- [ ] **Step 2: Implement both as pure functions over already-categorized transaction rows**

No LLM involved in this step — purely deterministic aggregation/statistics.

- [ ] **Step 3: Add an optional LLM narrative pass**

Given the structured deltas/anomalies from Step 2, one OpenRouter call (same client as `chatService.ts`) to generate 1-3 sentences of natural-language summary. Keep this a thin, isolated function so it can be unit-tested by mocking the LLM call and asserting the prompt shape, without needing a live API call in the test suite (follow whatever mocking pattern `test/chat/chatService.test.ts` already uses for the OpenRouter client).

- [ ] **Step 4: Wire into the Overview page's data**

Add the narrative + any surfaced anomalies to whatever summary payload the Overview page consumes.

- [ ] **Step 5: Run tests, typecheck, verify in browser, commit**

```bash
pnpm --filter @switch/server test
pnpm --filter @switch/server typecheck
```

```bash
git add apps/server/src/insights/spendingAnomalies.ts apps/server/test/insights/spendingAnomalies.test.ts
git commit -m "feat(insights): month-over-month deltas, anomaly detection, LLM narrative summary"
```

---

## Explicitly Out of Scope

- A locally-trained classifier (Naive Bayes/TF-IDF, e.g. via `natural` or `ml-classify-text`) — considered and rejected for this plan; the embedding cache (Task 3) gives most of the benefit with far less pipeline/training-data overhead for a hackathon timeline. Revisit only if Task 3's cache hit rate turns out too low in practice.
- ML-based clustering (DBSCAN/k-means) for subscription detection — the heuristic in Task 4 is standard industry practice (Mint/YNAB-style) and cheaper to build and debug; no accuracy benefit expected at this data volume.
