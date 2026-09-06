# M4 — In-App Chat + Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The last two MCP tools (`remember`, `recall`, spec §8) plus a grounded, tool-calling in-app chat (FR5) that proves the demo script's memory beat: state a rule, later answer visibly respects it.

**Architecture:** `remember`/`recall` follow the exact adapter/tool-wrapper pattern every other tool in this project uses (`withAudit`, `adapter/*.ts` + `mcp/tools/*.ts`). The chat loop is new: `chat/toolRegistry.ts` wraps all 12 tools (10 from M1/M2 + this milestone's 2) behind one array of `{name, description, zodSchema, handler}` so the Anthropic tool-calling loop and the MCP server draw from the same source without duplicating logic. `chat/chatService.ts` runs a bounded Anthropic tool-use loop, persists to `chat_messages`, and enforces FR5's system-prompt rules (never compute money in prose, always cite data freshness, never recommend securities, check `recall` before advising). REST exposes `/api/chat` and `/api/memories`; the web app gets Chat and Memory ("what Switch knows about me") pages, reusing M3's `apiClient`/page patterns.

**Tech Stack:** adds `zod-to-json-schema` to `apps/server` (Anthropic tool `input_schema` from the same Zod schemas M1-M3 already use). `@anthropic-ai/sdk` is already a dependency (M2).

## Global Constraints

- Implicit memory (spec P2 stretch, spec §5 story 9) is out of scope — only explicit memory (`remember` called directly, or by the LLM when a user states a standing rule).
- `memories.embedding` (pgvector) stays deferred — `recall` ranks by recency + tag overlap, per spec §8 ("recency+tags P0; pgvector P2").
- System prompt rules (FR5) are non-negotiable and must be literal, testable strings in `chat/systemPrompt.ts` — the chat test asserts the rules are present in what's sent to Anthropic, not just "vibes."
- `ANTHROPIC_API_KEY` must be set in `apps/server/.env` for real chat calls to work; like M2's `classifyBatchWithClaude`, the chat loop takes an injectable "ask Claude" function so tests never hit the real API.
- The tool-use loop is bounded (max 5 rounds) to avoid runaway cost/loops if Claude keeps requesting tools.
- No commit steps included — one commit for the whole milestone, done by the user at the end.

---

### Task 1: `remember` / `recall` tools

**Files:** Create `apps/server/src/adapter/memory.ts`, `apps/server/src/mcp/tools/memory.ts`, `apps/server/test/mcp/memory.test.ts`. Modify `apps/server/src/mcp/schemas.ts`, `apps/server/src/mcp/server.ts` (register, `TOOL_NAMES` → 12 entries).

**Interfaces:** Produces `rememberMemory(userId, {type, content, tags}): Promise<ToolResult<{memoryId: string}>>`, `recallMemories(userId, {query?, tags?, limit?}): Promise<ToolResult<MemorySummary[]>>` — consumed by Task 3's chat tool registry and Task 4's REST `/api/memories`.

- [ ] `apps/server/src/adapter/memory.ts` — `rememberMemory` inserts into `memories` (type defaults `'explicit'` for this milestone — nothing calls it with `'implicit'` yet). `recallMemories` selects non-deleted (`deletedAt IS NULL`) rows for the user, filters by `tags` overlap (`tags && input.tags` via `sql` if given) and a naive `ILIKE` on `content` if `query` given, orders by `createdAt DESC`, limits (`input.limit ?? 10`).
- [ ] `apps/server/src/mcp/tools/memory.ts` — `rememberTool`/`recallTool`, same `withAudit(...)` wrapper pattern as every other tool.
- [ ] Add `rememberInputSchema` (`{ type: z.enum(['explicit','implicit']).optional(), content: z.string(), tags: z.array(z.string()) }`) and `recallInputSchema` (`{ query: z.string().optional(), tags: z.array(z.string()).optional(), limit: z.number().int().positive().optional() }`) to `schemas.ts`; register both tools in `server.ts` the same way as the other 10.
- [ ] `apps/server/test/mcp/memory.test.ts` — `remember` a fact, `recall` with no filter returns it; `recall` with a non-matching tag returns empty; recalling after a second, unrelated `remember` call still surfaces both, most recent first.
- [ ] Run, confirm RED then GREEN. Confirm `test/mcp/server.test.ts`'s tool-count assertion now expects 12 (self-updating via `TOOL_NAMES`).

---

### Task 2: Shared tool registry for chat

**Files:** Create `apps/server/src/chat/toolRegistry.ts`.

**Interfaces:** Produces `CHAT_TOOLS: ChatToolDef[]` where `ChatToolDef = { name: string; description: string; inputSchema: z.ZodTypeAny; handler: (userId: string, args: unknown) => Promise<ToolResult<unknown>> }` — consumed by `chatService.ts` (Task 3).

- [ ] Import every `*Tool` function from `mcp/tools/*.ts` (all 12) and their Zod schemas from `mcp/schemas.ts` + Task 1's additions. Build one array mapping each tool name to `{ description, inputSchema, handler }`, where `handler` adapts each tool's specific input shape (camelCase fields like `consentId`) from the snake_case args Anthropic will send (matching the same `args.consent_id → consentId` mapping `mcp/server.ts` already does per tool — copy that mapping here rather than inventing a generic converter, since a couple of tools have nested params like `summarize_finances`'s `period`).
- [ ] No dedicated test file — this is a data/wiring module; Task 3's chat service test exercises it indirectly by calling tools through the loop.

---

### Task 3: Chat service (Anthropic tool-calling loop)

**Files:** Create `apps/server/src/chat/systemPrompt.ts`, `apps/server/src/chat/chatService.ts`, `apps/server/test/chat/chatService.test.ts`. Modify `apps/server/package.json` (add `zod-to-json-schema`).

**Interfaces:** Consumes `CHAT_TOOLS` (Task 2). Produces `sendChatMessage(userId, message, opts?: {askClaude?: AskClaudeFn}): Promise<{reply: string; toolCalls: string[]}>` — consumed by Task 4's REST `/api/chat`.

- [ ] `apps/server/src/chat/systemPrompt.ts` — export `SYSTEM_PROMPT` as a template string encoding FR5 verbatim: (a) never compute money figures in prose — always call `summarize_finances`/`fetch_transactions`; (b) always state the data period and freshness; (c) never recommend specific securities/investment products; (d) check `recall` before giving financial advice.
- [ ] `apps/server/src/chat/chatService.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { chatMessages } from '../db/schema.js';
import { CHAT_TOOLS } from './toolRegistry.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';

export type AskClaudeFn = (params: {
  system: string;
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
}) => Promise<Anthropic.Message>;

const askClaudeWithApi: AskClaudeFn = async (params) => {
  const client = new Anthropic();
  return client.messages.create({ model: 'claude-sonnet-4-5', max_tokens: 1024, ...params });
};

const MAX_ROUNDS = 5;

export async function sendChatMessage(
  userId: string,
  message: string,
  opts: { askClaude?: AskClaudeFn } = {}
): Promise<{ reply: string; toolCalls: string[] }> {
  const askClaude = opts.askClaude ?? askClaudeWithApi;
  const tools: Anthropic.Tool[] = CHAT_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: zodToJsonSchema(t.inputSchema) as Anthropic.Tool.InputSchema,
  }));

  await db.insert(chatMessages).values({ userId, role: 'user', content: message });

  const history: Anthropic.MessageParam[] = [{ role: 'user', content: message }];
  const toolCalls: string[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await askClaude({ system: SYSTEM_PROMPT, messages: history, tools });
    const textParts = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text');
    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

    if (toolUses.length === 0) {
      const reply = textParts.map((b) => b.text).join('');
      await db.insert(chatMessages).values({
        userId,
        role: 'assistant',
        content: reply,
        toolCallsJson: toolCalls,
      });
      return { reply, toolCalls };
    }

    history.push({ role: 'assistant', content: response.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const tool = CHAT_TOOLS.find((t) => t.name === use.name);
      const result = tool ? await tool.handler(userId, use.input) : { ok: false, error: { code: 'UNKNOWN_TOOL', message: use.name } };
      toolCalls.push(use.name);
      toolResults.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify(result.ok ? result.data : result.error),
        is_error: !result.ok,
      });
    }
    history.push({ role: 'user', content: toolResults });
  }

  const reply = "I wasn't able to finish that within the allotted tool-call budget — try rephrasing.";
  await db.insert(chatMessages).values({ userId, role: 'assistant', content: reply, toolCallsJson: toolCalls });
  return { reply, toolCalls };
}
```
- [ ] `apps/server/test/chat/chatService.test.ts` — inject a stub `askClaude` (never calls the real API):
  1. Stub returns a single text block, no tool use → `sendChatMessage` returns that text, `chat_messages` has both a `user` and `assistant` row.
  2. Stub's first call returns a `tool_use` block for `fetch_accounts` (or a cheaper tool like `list_supported_banks`), second call returns text → assert the tool actually ran (its side effect is observable, e.g. an `audit_log` row for that tool) and `toolCalls` includes its name.
  3. Stub always returns `tool_use` (never a final text answer) → after `MAX_ROUNDS` iterations, assert the "tool-call budget" fallback reply is returned rather than looping forever.
  4. Assert `SYSTEM_PROMPT` (the literal string passed to `askClaude`) contains each of FR5's four rules in recognizable form (e.g. `.toContain('summarize_finances')`, `.toContain('recall')`).
- [ ] Run, confirm RED then GREEN.

---

### Task 4: REST `/api/chat`, `/api/memories`

**Files:** Create `apps/server/src/rest/chat.ts`, `apps/server/src/rest/memories.ts`, `apps/server/test/rest/chat.test.ts`, `apps/server/test/rest/memories.test.ts`. Modify `apps/server/src/rest/router.ts`.

**Interfaces:** Consumes `sendChatMessage` (Task 3), `rememberTool`/`recallTool` (Task 1), `requireUser` (M3).

- [ ] `POST /api/chat` — body `{ message: string }`, calls `sendChatMessage(req.userId, message)`, returns `{ reply, toolCalls }`. Test injects `askClaude` — since the REST layer calls `sendChatMessage` with no override, either export a way to inject it for tests (e.g. a query param `?_test_stub=1` is NOT acceptable — instead, test this route by calling the Express handler directly with a mocked module import, or restructure `chat.ts` to accept an optional injected service for tests via dependency injection at the router-construction level: `export function createChatRouter(sendMessage = sendChatMessage) { ... }`). Use the DI-via-factory-function approach — cleaner than mocking modules.
- [ ] `GET /api/memories` — lists via `recallTool(req.userId, { limit: 100 })`. `DELETE /api/memories/:id` — soft-delete (`deletedAt`) after confirming the memory belongs to `req.userId`; add a small adapter helper `deleteMemory(memoryId, userId)` in `adapter/memory.ts` for this (not part of the MCP tool surface — deletion is a dashboard-only action, mirroring M3's `revoke_consent` precedent).
- [ ] Tests: sign a test JWT (same pattern as M3), `POST /api/chat` with an injected stub service and assert the JSON shape; `GET /api/memories` after seeding a memory via `rememberTool` directly; `DELETE /api/memories/:id` then confirm a follow-up `GET` no longer includes it, and that deleting another user's memory 404s.
- [ ] Wire both routers into `apps/server/src/rest/router.ts`.
- [ ] Run, confirm RED then GREEN.

---

### Task 5: Chat + Memory pages

**Files:** Create `apps/web/src/app/dashboard/chat/page.tsx`, `apps/web/src/app/dashboard/chat/ChatPanel.tsx` (client component), `apps/web/src/app/dashboard/memory/page.tsx`, `apps/web/src/app/dashboard/memory/DeleteMemoryButton.tsx` (client component). Modify `apps/web/src/app/dashboard/layout.tsx` (add nav links for Chat, Memory).

- [ ] `ChatPanel.tsx` — client component: local message list state, a text input + send button, `POST`s to `/api/chat` via `apiClient`-style fetch with the Supabase access token, appends the reply. Nothing fancy — no streaming this milestone (YAGNI; add if the demo needs the polish later).
- [ ] `memory/page.tsx` — server component listing memories (content, tags, created date) via `GET /api/memories`, each row has a `DeleteMemoryButton` (same `fetch` + `router.refresh()` pattern as M3's `RevokeButton`).
- [ ] Manual check (same constraints as M3 — no real browser session available to the implementer): confirm `pnpm --filter @switch/web build` succeeds and both routes respond without 500s given a valid session. Full click-through (type a message, see a grounded reply, state a rule, confirm memory persists page-to-page) is the user's manual verification step, and doubles as a rehearsal of the demo script's memory beat (spec §13 step 4).

---

## What M4 does not include (deliberately deferred)

- Implicit memory (behavioral pattern detection) — spec P2, no milestone currently scopes it.
- Streaming chat responses — not required by any spec success metric.
- pgvector semantic `recall` — spec P2; current `recall` is recency+tag, matching spec §8's explicit P0 note.
- Deployment / the Claude.ai remote connector — that's M5, which also finally adds the bearer-token auth spec §11 asks for on `/mcp` (this milestone's chat lives behind Supabase-authenticated REST, not the MCP transport).
