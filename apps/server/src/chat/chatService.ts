import Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
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
    // zod-to-json-schema's output is a plain JSON Schema object; Anthropic's Tool.InputSchema
    // is a structurally compatible (looser) shape, so this cast is safe.
    input_schema: zodToJsonSchema(t.inputSchema) as unknown as Anthropic.Tool.InputSchema,
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
      const result = tool
        ? await tool.handler(userId, use.input)
        : { ok: false as const, error: { code: 'UNKNOWN_TOOL', message: use.name } };
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
