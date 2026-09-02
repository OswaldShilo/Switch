# Chat SSE Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the chat endpoint from a synchronous request/response into a streamed SSE response, so the assistant's reply appears incrementally and tool-call progress ("looking up your transactions…") is visible, instead of the browser sitting on a blank state until the entire multi-round tool-calling loop finishes.

**Architecture:** `apps/server/src/chat/chatService.ts`'s `sendChatMessage` runs an agentic tool-calling loop capped at `MAX_ROUNDS = 5`: each round calls the OpenRouter-backed `askClaude`, and if the model returns `tool_use` blocks, `toolRegistry.ts`'s handlers run sequentially before the loop continues. Only the final round (no more tool calls) produces the reply that's persisted and returned. This is not a single streamable completion — it's a sequence of LLM calls interleaved with tool execution. The `openai` SDK's `stream: true` only cleanly streams the terminal, non-tool-calling round; tool-call argument deltas arrive fragmented and must be buffered-then-parsed before a tool can run, so earlier rounds are buffer-then-emit, not token-by-token. `ChatPanel.tsx` currently does a plain `fetch` + `await res.json()` with a Bearer auth header — `EventSource` can't carry that header (GET-only, no custom headers), so the client side uses `fetch()` + `ReadableStream`, not `EventSource`.

**Tech Stack:** Express (SSE via raw `res.write`, no new streaming library needed), the `openai` SDK's existing `stream: true` support, native `fetch()` + `ReadableStream` on the client (no new client dependency).

## Global Constraints

- Keep `pnpm --filter @switch/server test` and `pnpm --filter @switch/server typecheck` green after every task.
- The existing `POST /api/chat` JSON contract (`{ reply, toolCalls }`) is relied on by `test/rest/chat.test.ts` — do not break it. Add streaming as a new, separate concern (see Task 1's approach decision) rather than mutating the existing contract in place.
- Memory-write side effects (`db.insert(chatMessages)`) must still happen exactly once per request, after the loop concludes — not per-event — so a mid-stream disconnect can't leave partial/duplicate rows.
- Auth failures (401 from `requireUser`) must still be plain 4xx JSON responses, sent *before* any SSE headers are flushed — once `Content-Type: text/event-stream` and a 200 status are sent, the HTTP status can no longer change, so errors after that point must be an `error` SSE event, not a status code change.

---

### Task 0: Decide and confirm the endpoint versioning approach

**Why first:** Every later task depends on this. `test/rest/chat.test.ts` asserts a plain JSON body via supertest — that's fundamentally incompatible with an SSE response on the same route.

- [ ] **Step 1: Confirm with whoever owns this plan whether to add a new route (`POST /api/chat/stream`) alongside the existing `POST /api/chat`, or negotiate via an `Accept: text/event-stream` header on the same route**

Recommendation: a new route. Simpler to implement, simpler to test (existing `chat.test.ts` stays untouched and green, a new `chat.stream.test.ts` covers the new route), and `ChatPanel.tsx` can be pointed at the new route directly without content-negotiation logic on either side. Record the decision in this section before starting Task 1.

**Decision:** _(fill in once confirmed — default to the new-route approach if no objection)_

---

### Task 1: Refactor `chatService.ts`'s loop to emit events instead of only returning a final object

**Files:**
- Modify: `apps/server/src/chat/chatService.ts`
- Modify: `apps/server/test/chat/chatService.test.ts`

**Interfaces:**
- `sendChatMessage` gains an optional `onEvent?: (event: ChatStreamEvent) => void` parameter. When omitted, behavior is unchanged (existing callers/tests keep working). When provided, the function calls it at each of the points listed below, in addition to still returning the same final `{ reply, toolCalls }` shape it always has.
- New exported type `ChatStreamEvent` — a discriminated union: `{ type: 'round_start'; round: number } | { type: 'tool_call'; name: string; input: unknown } | { type: 'tool_result'; name: string; ok: boolean; data?: unknown; error?: unknown } | { type: 'token'; text: string } | { type: 'done'; reply: string; toolCalls: ... } | { type: 'error'; message: string }`.

- [ ] **Step 1: Read `chatService.ts` and `toolRegistry.ts` in full to confirm exact current loop structure**

Confirm exactly where each round starts, where tool calls are detected/executed, and where the final non-tool-calling round's reply is produced — the event emission points in Step 3 below must line up exactly with this existing control flow, not an assumed one.

- [ ] **Step 2: Write failing tests for event emission**

Using a mocked OpenRouter client (follow `test/chat/chatService.openrouter.test.ts`'s existing mocking pattern), assert that a multi-round conversation (one tool call, then a final answer) emits events in the correct order: `round_start` → `tool_call` → `tool_result` → `round_start` → `token`(s) → `done`. Assert the final return value is unchanged from today's shape regardless of whether `onEvent` was passed.

- [ ] **Step 3: Implement the event emission points**

Add `onEvent?.({ type: 'round_start', round })` at the top of each loop iteration; `onEvent?.({ type: 'tool_call', ... })` immediately before each tool handler runs; `onEvent?.({ type: 'tool_result', ... })` immediately after; on the final round, if using `stream: true` against OpenRouter, forward each text delta as `onEvent?.({ type: 'token', text })` — if not streaming that round (simpler first pass), emit the whole final text as one `token` event, and revisit true token-by-token in a follow-up if time allows. Emit `done` once, after the persist-to-`chatMessages` step, not before.

- [ ] **Step 4: Run tests, typecheck, commit**

```bash
pnpm --filter @switch/server test
pnpm --filter @switch/server typecheck
git add apps/server/src/chat/chatService.ts apps/server/test/chat/chatService.test.ts apps/server/test/chat/chatService.openrouter.test.ts
git commit -m "feat(chat): emit stream events from the tool-calling loop, no behavior change to existing callers"
```

---

### Task 2: Add the SSE route

**Files:**
- Modify: `apps/server/src/rest/chat.ts` (add the new route per Task 0's decision)
- Create: `apps/server/test/rest/chat.stream.test.ts`

- [ ] **Step 1: Write a failing test using supertest against a raw SSE body**

Supertest can capture the raw response body/text of an SSE response — write a test that posts a message, reads the raw `res.text`, and asserts it contains the expected `event: ...\ndata: ...\n\n` frames in order (round_start, tool_call/tool_result if applicable, token, done), mocking the OpenRouter client the same way `chatService.test.ts` does.

- [ ] **Step 2: Implement the route**

On the new route: `requireUser` still runs first (auth stays a normal pre-stream check — 401 is plain JSON if it fails). On success, set `res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })`, then call `sendChatMessage(..., { onEvent: (e) => res.write(\`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n\`) })`, and `res.end()` once the call resolves. Wrap the whole body in try/catch — a caught error after headers are sent must be written as an `error` SSE event (not a thrown/unhandled response), then `res.end()`.

- [ ] **Step 3: Run tests, typecheck, commit**

```bash
pnpm --filter @switch/server test
pnpm --filter @switch/server typecheck
git add apps/server/src/rest/chat.ts apps/server/test/rest/chat.stream.test.ts
git commit -m "feat(chat): add SSE streaming endpoint"
```

---

### Task 3: Update `ChatPanel.tsx` to consume the SSE stream

**Files:**
- Modify: `apps/web/src/app/dashboard/chat/ChatPanel.tsx`

- [ ] **Step 1: Read the current implementation in full**

Confirm the exact current `fetch` + `await res.json()` shape and the Bearer-auth header pattern used, so the replacement keeps the same auth call signature.

- [ ] **Step 2: Implement the fetch + ReadableStream reader loop**

`fetch(streamUrl, { method: 'POST', headers: { Authorization: ..., 'Content-Type': 'application/json' }, body })`, then read `res.body!.getReader()`, decode chunks with `TextDecoder`, split on the SSE frame boundary (`\n\n`), parse each frame's `event:`/`data:` lines, and dispatch on `event` type: append text on `token`, show a "calling <tool name>…" indicator on `tool_call`/clear it on `tool_result`, finalize the message on `done`, and show the existing inline-error pattern (see the UX-polish plan's `InlineError` component, if that plan has landed — otherwise match whatever this file's current error display already does) on `error`.

- [ ] **Step 3: Handle the pre-stream auth-failure case**

If `res.ok` is false before any stream reading starts (e.g. a 401), handle it exactly as today — don't attempt to read a stream body that was never sent as SSE.

- [ ] **Step 4: Verify in browser**

Send a message that requires a tool call (e.g. "what's my balance?") and confirm: a tool-call indicator appears before the answer, the final answer text appears (streamed or as one chunk depending on how much of Task 1 Step 3's true-streaming stretch goal landed), and the Memory tab/toggle behavior is unaffected.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/dashboard/chat/ChatPanel.tsx
git commit -m "feat(chat): consume SSE stream in ChatPanel, show tool-call progress"
```

---

### Task 4: Decide the fate of the old non-streaming route

- [ ] **Step 1: Decide whether `POST /api/chat` (non-streaming) stays as a fallback/API-compat route or gets removed**

Recommendation: keep it — it's a smaller, simpler contract that's useful for any non-browser client (e.g. a script, or Claude.ai's MCP path if that ever calls chat directly rather than tools individually) and costs nothing to maintain alongside the streaming route. Record the decision; if "remove," add a follow-up task to delete `test/rest/chat.test.ts`'s now-dead assertions and update any other caller.

---

## Explicitly Out of Scope

- True token-by-token streaming on every round (only the final round streams under this plan; earlier tool-calling rounds are buffer-then-emit, which is the OpenAI SDK's own limitation for tool-call argument deltas, not a shortcut this plan is taking).
- A shared client-side SSE-parsing utility extracted for reuse elsewhere — revisit only if a second SSE consumer appears in this codebase.
