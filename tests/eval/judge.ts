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

  let text = completion.choices[0].message.content ?? '{}';

  // Handle markdown code blocks (some models wrap JSON in ```json...```)
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    text = jsonMatch[1].trim();
  }

  const parsed = JSON.parse(text) as { pass: boolean; reasoning: string };
  return { pass: Boolean(parsed.pass), reasoning: parsed.reasoning ?? '' };
}
