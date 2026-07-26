import type Anthropic from '@anthropic-ai/sdk';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDemoUserId } from '../../src/adapter/demoUser.js';
import { sendChatMessage, type AskClaudeFn } from '../../src/chat/chatService.js';
import { SYSTEM_PROMPT } from '../../src/chat/systemPrompt.js';
import { db, pool } from '../../src/db/client.js';
import { auditLog, chatMessages } from '../../src/db/schema.js';
import { runSeed } from '../../src/db/seed/seed.js';

function textMessage(text: string): Anthropic.Message {
  return {
    id: 'msg_test_text',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5',
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

function toolUseMessage(name: string, id: string, input: unknown = {}): Anthropic.Message {
  return {
    id: 'msg_test_tool',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5',
    content: [{ type: 'tool_use', id, name, input }],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

describe('sendChatMessage', () => {
  let userId: string;

  beforeAll(async () => {
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    userId = await getDemoUserId();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns a plain text reply and persists both user and assistant chat_messages rows', async () => {
    const askClaude: AskClaudeFn = async () => textMessage('Hello, how can I help?');
    const result = await sendChatMessage(userId, 'Hi there', { askClaude });

    expect(result).toEqual({ reply: 'Hello, how can I help?', toolCalls: [] });

    const rows = await db.select().from(chatMessages).where(eq(chatMessages.userId, userId));
    const userRow = rows.find((r) => r.role === 'user' && r.content === 'Hi there');
    const assistantRow = rows.find((r) => r.role === 'assistant' && r.content === 'Hello, how can I help?');
    expect(userRow).toBeDefined();
    expect(assistantRow).toBeDefined();
  });

  it('runs a requested tool, reports it in toolCalls, and leaves an observable audit_log row', async () => {
    let call = 0;
    const askClaude: AskClaudeFn = async () => {
      call += 1;
      if (call === 1) return toolUseMessage('list_supported_banks', 'toolu_1', {});
      return textMessage('Here are the supported banks.');
    };

    const before = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.userId, userId), eq(auditLog.tool, 'list_supported_banks')));

    const result = await sendChatMessage(userId, 'What banks do you support?', { askClaude });

    expect(result.toolCalls).toEqual(['list_supported_banks']);
    expect(result.reply).toBe('Here are the supported banks.');

    const after = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.userId, userId), eq(auditLog.tool, 'list_supported_banks')));
    expect(after.length).toBeGreaterThan(before.length);
  });

  it('falls back to the tool-call-budget message after MAX_ROUNDS if Claude never stops requesting tools', async () => {
    let call = 0;
    const askClaude: AskClaudeFn = async () => {
      call += 1;
      return toolUseMessage('list_supported_banks', `toolu_${call}`, {});
    };

    const result = await sendChatMessage(userId, 'Keep asking forever', { askClaude });

    expect(result.reply).toBe("I wasn't able to finish that within the allotted tool-call budget — try rephrasing.");
    expect(result.toolCalls.length).toBe(5);
    expect(call).toBe(5);
  });

  it('sends SYSTEM_PROMPT (containing each of FR5\'s four rules) as the literal system param', async () => {
    let capturedSystem = '';
    const askClaude: AskClaudeFn = async (params) => {
      capturedSystem = params.system;
      return textMessage('ok');
    };

    await sendChatMessage(userId, 'test', { askClaude });

    expect(capturedSystem).toBe(SYSTEM_PROMPT);
    // (a) never compute money figures in prose
    expect(capturedSystem).toContain('summarize_finances');
    expect(capturedSystem).toContain('fetch_transactions');
    // (b) always state the data period and freshness
    expect(capturedSystem).toContain('data period');
    expect(capturedSystem).toContain('freshness');
    // (c) never recommend specific securities/investment products
    expect(capturedSystem).toContain('securities');
    // (d) check recall before giving financial advice
    expect(capturedSystem).toContain('recall');
  });
});
