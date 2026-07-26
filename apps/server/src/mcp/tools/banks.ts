import type { Bank } from '../../adapter/banks.js';
import { getAdapter } from '../../adapter/index.js';
import type { ToolResult } from '../../adapter/types.js';
import { withAudit } from '../audit.js';

export async function listSupportedBanksTool(userId: string | null): Promise<ToolResult<Bank[]>> {
  return withAudit('list_supported_banks', userId, {}, async () => ({
    ok: true as const,
    data: await getAdapter().listSupportedBanks(),
  }));
}
