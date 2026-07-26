import {
  recallMemories,
  rememberMemory,
  type MemorySummary,
  type RecallInput,
  type RememberInput,
} from '../../adapter/memory.js';
import type { ToolResult } from '../../adapter/types.js';
import { withAudit } from '../audit.js';

export async function rememberTool(
  userId: string,
  input: Omit<RememberInput, 'userId'>
): Promise<ToolResult<{ memoryId: string }>> {
  return withAudit('remember', userId, input, () => rememberMemory({ ...input, userId }));
}

export async function recallTool(
  userId: string,
  input: Omit<RecallInput, 'userId'>
): Promise<ToolResult<MemorySummary[]>> {
  return withAudit('recall', userId, input, () => recallMemories({ ...input, userId }));
}
