import {
  fetchTransactions,
  type FetchTransactionsInput,
  type FetchTransactionsOutput,
} from '../../adapter/transactions.js';
import type { ToolResult } from '../../adapter/types.js';
import { withAudit } from '../audit.js';

export async function fetchTransactionsTool(
  userId: string,
  input: FetchTransactionsInput
): Promise<ToolResult<FetchTransactionsOutput>> {
  return withAudit('fetch_transactions', userId, input, () => fetchTransactions(input));
}
