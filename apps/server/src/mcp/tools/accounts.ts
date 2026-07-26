import { fetchAccounts, type AccountSummary } from '../../adapter/accounts.js';
import type { ToolResult } from '../../adapter/types.js';
import { withAudit } from '../audit.js';

export async function fetchAccountsTool(
  userId: string,
  input: { consentId: string }
): Promise<ToolResult<AccountSummary[]>> {
  return withAudit('fetch_accounts', userId, input, () => fetchAccounts(input.consentId));
}
