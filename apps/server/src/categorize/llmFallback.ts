import OpenAI from 'openai';
import { CATEGORIES } from './taxonomy.js';

export interface UncategorizedTxn {
  txnId: string;
  narration: string;
  merchant: string | null;
}
export interface LlmCategorization {
  txnId: string;
  category: string;
  confidence: number;
}
export type ClassifyBatchFn = (txns: UncategorizedTxn[]) => Promise<LlmCategorization[]>;

// No Anthropic API key available for this deployment, so this fallback (only
// reached for transactions the rule engine can't categorize) goes through
// OpenRouter's OpenAI-compatible API instead.
export const classifyBatchWithClaude: ClassifyBatchFn = async (txns) => {
  const client = new OpenAI({
    apiKey: process.env.OPEN_ROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1',
  });
  const completion = await client.chat.completions.create({
    model: 'anthropic/claude-haiku-4.5',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content:
          `Categorize each transaction into exactly one of: ${CATEGORIES.join(', ')}. ` +
          `Return only a JSON array of {"txn_id","category","confidence"} (confidence 0-1), one per input.\n` +
          `Transactions: ${JSON.stringify(txns)}`,
      },
    ],
  });
  const text = completion.choices[0].message.content ?? '';
  const parsed = JSON.parse(text) as Array<{ txn_id: string; category: string; confidence: number }>;
  return parsed.map((p) => ({ txnId: p.txn_id, category: p.category, confidence: p.confidence }));
};
