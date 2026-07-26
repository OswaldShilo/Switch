import { getAdapter } from '../../adapter/index.js';
import type { ToolResult } from '../../adapter/types.js';
import { withAudit } from '../audit.js';

export async function requestFinancialDataTool(
  userId: string,
  input: { consentId: string }
): Promise<ToolResult<{ sessionId: string; status: string }>> {
  return withAudit('request_financial_data', userId, input, () =>
    getAdapter().requestFinancialData(input.consentId)
  );
}

export async function getDataStatusTool(
  userId: string,
  input: { sessionId: string }
): Promise<ToolResult<{ status: string; fetchedAt: string | null }>> {
  return withAudit('get_data_status', userId, input, () => getAdapter().getDataStatus(input.sessionId));
}
