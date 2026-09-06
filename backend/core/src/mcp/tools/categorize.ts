import { categorizeTransactions, type CategorizeSummary } from '../../adapter/categorize.js';
import type { ToolResult } from '../../adapter/types.js';
import type { ClassifyBatchFn } from '../../categorize/llmFallback.js';
import { withAudit } from '../audit.js';

export async function categorizeTransactionsTool(
  userId: string,
  input: { accountId: string; force?: boolean; classifyBatch?: ClassifyBatchFn }
): Promise<ToolResult<CategorizeSummary>> {
  return withAudit('categorize_transactions', userId, { accountId: input.accountId, force: input.force }, () =>
    categorizeTransactions(userId, input.accountId, { force: input.force, classifyBatch: input.classifyBatch })
  );
}
