import type Anthropic from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// askClaudeWithOpenRouter is the only piece of chatService.ts that talks to a real
// network client (OpenRouter's OpenAI-compatible chat completions API). Every other
// chat test injects a stub AskClaudeFn and never exercises this translation function,
// so it's mocked here at the `openai` package boundary instead — the same style
// test/setup.ts already uses to globally mock `@supabase/supabase-js`, just scoped to
// this file since nothing else needs an OpenAI double.
const createMock = vi.fn();

vi.mock('openai', () => {
  class MockOpenAI {
    chat = { completions: { create: createMock } };
  }
  return { default: MockOpenAI };
});

const { askClaudeWithOpenRouter } = await import('../../src/chat/chatService.js');

function baseCompletion(overrides: Partial<{ content: string | null; tool_calls: unknown[] }>) {
  return {
    id: 'gen-123',
    model: 'anthropic/claude-haiku-4.5',
    usage: { prompt_tokens: 10, completion_tokens: 5 },
    choices: [
      {
        message: {
          content: overrides.content ?? null,
          tool_calls: overrides.tool_calls,
        },
      },
    ],
  };
}

describe('askClaudeWithOpenRouter', () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it('translates a multi tool_use/tool_result turn into OpenAI tool_calls and tool-role messages', async () => {
    createMock.mockResolvedValue(baseCompletion({ content: 'All set.' }));

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'Show me my banks and my recent memory.' },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'list_supported_banks', input: {} },
          { type: 'tool_use', id: 'toolu_2', name: 'recall', input: { query: 'budget' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: '["HDFC","ICICI"]' },
          { type: 'tool_result', tool_use_id: 'toolu_2', content: '["remembered: pays rent on the 1st"]' },
        ],
      },
    ];

    await askClaudeWithOpenRouter({ system: 'sys prompt', messages, tools: [] });

    expect(createMock).toHaveBeenCalledTimes(1);
    const request = createMock.mock.calls[0][0];
    const openAiMessages = request.messages;

    expect(openAiMessages[0]).toEqual({ role: 'system', content: 'sys prompt' });
    expect(openAiMessages[1]).toEqual({ role: 'user', content: 'Show me my banks and my recent memory.' });

    const assistantMsg = openAiMessages[2];
    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.tool_calls).toEqual([
      { id: 'toolu_1', type: 'function', function: { name: 'list_supported_banks', arguments: '{}' } },
      { id: 'toolu_2', type: 'function', function: { name: 'recall', arguments: JSON.stringify({ query: 'budget' }) } },
    ]);

    expect(openAiMessages[3]).toEqual({
      role: 'tool',
      tool_call_id: 'toolu_1',
      content: '["HDFC","ICICI"]',
    });
    expect(openAiMessages[4]).toEqual({
      role: 'tool',
      tool_call_id: 'toolu_2',
      content: '["remembered: pays rent on the 1st"]',
    });
  });

  it('translates an OpenAI response with multiple tool_calls back into Anthropic tool_use content blocks', async () => {
    createMock.mockResolvedValue(
      baseCompletion({
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'list_supported_banks', arguments: '{}' } },
          {
            id: 'call_2',
            type: 'function',
            function: { name: 'fetch_transactions', arguments: JSON.stringify({ accountId: 'acc_1' }) },
          },
        ],
      })
    );

    const result = await askClaudeWithOpenRouter({
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
    });

    expect(result.stop_reason).toBe('tool_use');
    expect(result.content).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'list_supported_banks', input: {} },
      { type: 'tool_use', id: 'call_2', name: 'fetch_transactions', input: { accountId: 'acc_1' } },
    ]);
  });

  it('translates a text-only OpenAI response into a single Anthropic text content block', async () => {
    createMock.mockResolvedValue(baseCompletion({ content: 'Here is your summary.' }));

    const result = await askClaudeWithOpenRouter({
      system: 'sys',
      messages: [{ role: 'user', content: 'summarize' }],
      tools: [],
    });

    expect(result.stop_reason).toBe('end_turn');
    expect(result.content).toEqual([{ type: 'text', text: 'Here is your summary.' }]);
  });

  it('does not send an empty tool_calls array for a text-only assistant history entry (OpenRouter rejects tool_calls: [])', async () => {
    createMock.mockResolvedValue(baseCompletion({ content: 'ok' }));

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'Hello! How can I help?' }] },
      { role: 'user', content: 'follow up' },
    ];

    await askClaudeWithOpenRouter({ system: 'sys', messages, tools: [] });

    const request = createMock.mock.calls[0][0];
    const assistantMsg = request.messages[2];
    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.content).toBe('Hello! How can I help?');
    expect(assistantMsg.tool_calls).toBeUndefined();
    expect('tool_calls' in assistantMsg).toBe(false);
  });
});
