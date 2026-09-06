import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { transactions } from '../db/schema.js';
import { matchRule } from '../categorize/rules.js';
import { seedDefaultCategoryRules } from '../db/seed/categoryRules.js';
import { classifyBatchWithClaude, type ClassifyBatchFn } from '../categorize/llmFallback.js';
import type { ToolResult } from './types.js';

const BATCH_SIZE = 50;

export interface CategorizeSummary {
  categorized: number;
  uncategorized: number;
  accuracyNote: string;
}

export async function categorizeTransactions(
  userId: string,
  accountId: string,
  opts: { force?: boolean; classifyBatch?: ClassifyBatchFn } = {}
): Promise<ToolResult<CategorizeSummary>> {
  await seedDefaultCategoryRules();
  const classifyBatch = opts.classifyBatch ?? classifyBatchWithClaude;

  const conditions = [eq(transactions.accountId, accountId)];
  if (!opts.force) conditions.push(isNull(transactions.category));
  const rows = await db.select().from(transactions).where(and(...conditions));

  let categorized = 0;
  const remaining: typeof rows = [];

  for (const txn of rows) {
    const category = await matchRule(userId, { narration: txn.narration, merchant: txn.merchant });
    if (category) {
      await db
        .update(transactions)
        .set({ category, confidence: '1.00', categorizedBy: 'rule' })
        .where(eq(transactions.id, txn.id));
      categorized++;
    } else {
      remaining.push(txn);
    }
  }

  for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
    const batch = remaining.slice(i, i + BATCH_SIZE);
    const results = await classifyBatch(
      batch.map((t) => ({ txnId: t.id, narration: t.narration, merchant: t.merchant }))
    );
    for (const r of results) {
      await db
        .update(transactions)
        .set({ category: r.category, confidence: r.confidence.toFixed(2), categorizedBy: 'llm' })
        .where(eq(transactions.id, r.txnId));
      categorized++;
    }
  }

  return {
    ok: true,
    data: {
      categorized,
      uncategorized: rows.length - categorized,
      accuracyNote: `${categorized}/${rows.length} categorized (rule engine first, LLM fallback in batches of ${BATCH_SIZE}).`,
    },
  };
}
