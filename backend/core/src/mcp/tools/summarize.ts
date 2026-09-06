import { summarizeFinances, type SummarizeInput } from '../../adapter/summarize.js';
import type { ToolResult } from '../../adapter/types.js';
import { withAudit } from '../audit.js';

export async function summarizeFinancesTool(
  userId: string,
  input: SummarizeInput
): Promise<ToolResult<Record<string, unknown>>> {
  return withAudit('summarize_finances', userId, input, () => summarizeFinances(input));
}
