import Anthropic from '@anthropic-ai/sdk';
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

export const classifyBatchWithClaude: ClassifyBatchFn = async (txns) => {
  const client = new Anthropic();
  const message = await client.messages.create({
    model: 'claude-sonnet-4-5',
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
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  const parsed = JSON.parse(text) as Array<{ txn_id: string; category: string; confidence: number }>;
  return parsed.map((p) => ({ txnId: p.txn_id, category: p.category, confidence: p.confidence }));
};
