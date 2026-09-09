# Memory ON/OFF Evaluation Harness — Design

**Status:** Approved (brainstormed 2026-09-09), not yet committed
**Purpose:** Produce the paper's core empirical result — does persistent memory measurably improve grounded, personalized financial reasoning — by running a fixed question set through the chat pipeline twice (memory on, memory off) and scoring the difference.

## 1. What already exists (do not rebuild)

- `sendChatMessage(userId, message, { memoryEnabled })` in `backend/core/src/chat/chatService.ts` already toggles: system prompt (`SYSTEM_PROMPT` vs `SYSTEM_PROMPT_NO_MEMORY`), and whether `remember`/`recall` are in the tool list at all (not just disabled — physically absent from `CHAT_TOOLS` when off).
- REST surface: `POST /api/chat` already accepts `memory_enabled: boolean` in the body and passes it straight through.
- Memory deletion (`deleteMemory` in `backend/core/src/adapter/memory.ts`, exposed via `DELETE /api/memories/:id`) already soft-deletes (`deletedAt`) and `recallMemories` already filters out deleted rows (`isNull(memories.deletedAt)`).
- Audit logging (`withAudit` in `backend/core/src/mcp/audit.ts`) already records every `remember`/`recall` call to `audit_log` with status/latency — usable as hygiene-test ground truth.

None of the above needs new code. The harness is new: a question set, a runner that drives `sendChatMessage` twice per question, and a scorer.

## 2. Scope correction from brainstorming

The original design proposed a "revoke consent → recall must fail closed" hygiene test. That doesn't map onto the actual schema: `memories` rows are keyed by `userId`, not by `consentId` or `accountId` — a user's stated preferences ("never suggest crypto") are independent of which bank accounts are currently connected, and that's correct behavior, not a gap. Revoking one bank's consent shouldn't erase what the user told the assistant about themselves.

The hygiene test is rescoped to what the architecture actually enforces: **memory deletion**. A user states a preference, it's later deleted (simulating the "what Switch knows about me" UI action), and a subsequent question must not leak the deleted content — verified both in the chat reply and against `recallMemories`' own filtered output.

## 3. Question set — ~34 questions, 4 categories

Stored as a fixture file (`tests/eval/memoryQuestions.ts` or `.json` — implementation plan decides), each entry: `{ id, category, setup: string[] (prior turns, memory-relevant), question: string, groundTruth?: {...}, rubric?: string }`.

**A. Numerical grounding (10)** — answer must match `summarize_finances`/`fetch_transactions` output computed against the seeded data. No memory dependency; this is the control category proving memory ON/OFF doesn't change grounding accuracy (it shouldn't — grounding rules are identical in both system prompts).
Example: "How much did I spend on Food Delivery last month?" → ground truth computed from seed data at eval time (seed is deterministic per `now`).

**B. Preference adherence (10)** — a rule is stated in an earlier turn ("never suggest crypto", "I send ₹10K home monthly, don't count it as discretionary spend"), then a later, unrelated-looking question should visibly respect it. Scored by LLM-judge against a written rubric (did the reply violate, ignore, or honor the stated rule).

**B variant — cross-session (4 of the 10)** — preference stated in a *separate* prior chat session (separate `sendChatMessage` call sequence, simulating a return visit), tests recall across sessions, not just within one multi-turn conversation. Memory OFF has no mechanism for this at all — expected to fail 100% off, non-trivial on.

**C. Multi-turn recall (8)** — a fact stated early (turn 1-2) needed later (turn 5+) in the *same* session, no explicit "remember this" framing — tests whether the model spontaneously calls `remember`/`recall` per system-prompt rule 4, not just when told to. Automated match against the stated fact.

**D. Memory hygiene (6)** — 
  - 3x: state a preference, delete it (call `DELETE /api/memories/:id` directly, bypassing the LLM — simulates the UI action), then ask a question that would have used it. Pass = reply does not reference the deleted preference AND `recallMemories` for that user/tag no longer returns it.
  - 3x: state a preference that's *outdated* by seeded data (e.g., "I don't have a Netflix subscription" stated as memory, but seed data shows one) — tests whether the model trusts the live tool-computed answer over the stale remembered claim when asked a grounding question. Pass = reply uses the tool result, not the stale memory, for the factual claim (memory may still be acknowledged, but must not override `summarize_finances`/`fetch_transactions` output).

## 4. Scoring

| Category | Method | Ground truth source |
|---|---|---|
| A. Numerical grounding | Automated exact/tolerance match | `summarize_finances` computed live at eval time against seeded DB |
| B. Preference adherence | LLM-judge + written rubric (pass/partial/fail) | Rubric text per question |
| C. Multi-turn recall | Automated substring/fact match | The fact as stated in setup turns |
| D. Memory hygiene | Automated: reply text check + direct `recallMemories` query | Deletion state / seeded DB (for the stale-memory variant) |

Aggregate: per-category pass rate, ON vs OFF, side by side. This is the number that goes in the paper.

## 5. Run protocol

1. Ensure DB is freshly seeded (`pnpm db:seed`) so grounding ground truth is known.
2. Runner script iterates the question set. For each question: replay `setup` turns (as real `sendChatMessage` calls, so memory actually gets written via real tool calls, not injected directly into the DB) then send `question`, once with `memoryEnabled: true`, once with `memoryEnabled: false`, against **two separate seeded users** (or the same user with memories wiped between runs) so the OFF run has no memory residue from the ON run.
3. Record full transcript + `toolCalls` array per run (already returned by `sendChatMessage`).
4. Score per §4, output a results table (JSON + human-readable summary).

## 6. Non-goals

- No changes to `chatService.ts`, `systemPrompt.ts`, or the memory adapter — the toggle and deletion already work.
- No new consent-scoping of memories (see §2 correction).
- No UI work — this is a backend eval script, run manually/via CI, not a dashboard feature.
- No LLM-judge infra beyond a single OpenRouter call per judged question (reuse the existing `OPEN_ROUTER_API_KEY` pattern from `llmFallback.ts`).

## 7. Open question carried into planning

Where does the runner live — `tests/eval/` (alongside the existing `tests/` workspace package, reuses its DB/test-client setup) or a new top-level `eval/` package? Recommendation: `tests/eval/` — it needs the same DB connection and `sendChatMessage` import path the existing `tests/` package already has configured correctly (this took real effort to get right per the monorepo restructure — don't re-solve module resolution for a new package).
