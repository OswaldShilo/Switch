import type Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
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

// No Anthropic API key available for this deployment, so the model is called
// through OpenRouter's OpenAI-compatible chat completions API instead. The
// rest of sendChatMessage's loop still speaks in Anthropic's Message/tool_use
// shapes (that's the AskClaudeFn boundary tests already inject a stub through),
// so this function's only job is translating in and back out.
const askClaudeWithOpenRouter: AskClaudeFn = async ({ system, messages, tools }) => {
  const client = new OpenAI({
    apiKey: process.env.OPEN_ROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
  });

  const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      openAiMessages.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      const text = m.content
        .filter((b): b is Anthropic.TextBlockParam => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const toolUses = m.content.filter((b): b is Anthropic.ToolUseBlockParam => b.type === 'tool_use');
      openAiMessages.push({
        role: 'assistant',
        content: text || null,
        tool_calls: toolUses.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: JSON.stringify(t.input) },
        })),
      });
      continue;
    }
    for (const block of m.content as Anthropic.ToolResultBlockParam[]) {
      openAiMessages.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? ''),
      });
    }
  }

  const openAiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema as Record<string, unknown>,
    },
  }));

  const completion = await client.chat.completions.create({
    model: 'anthropic/claude-haiku-4.5',
    max_tokens: 1024,
    messages: openAiMessages,
    tools: openAiTools,
  });

  const choice = completion.choices[0].message;
  const content: Anthropic.ContentBlock[] = [];
  if (choice.content) {
    content.push({ type: 'text', text: choice.content });
  }
  for (const call of choice.tool_calls ?? []) {
    if (call.type !== 'function') continue;
    content.push({
      type: 'tool_use',
      id: call.id,
      name: call.function.name,
      input: JSON.parse(call.function.arguments || '{}'),
    });
  }

  return {
    id: completion.id,
    type: 'message',
    role: 'assistant',
    model: completion.model,
    content,
    stop_reason: choice.tool_calls?.length ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: completion.usage?.prompt_tokens ?? 0,
      output_tokens: completion.usage?.completion_tokens ?? 0,
    },
  } as Anthropic.Message;
};

const MAX_ROUNDS = 5;

export async function sendChatMessage(
  userId: string,
  message: string,
  opts: { askClaude?: AskClaudeFn } = {}
): Promise<{ reply: string; toolCalls: string[] }> {
  const askClaude = opts.askClaude ?? askClaudeWithOpenRouter;
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
