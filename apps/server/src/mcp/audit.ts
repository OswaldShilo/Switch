import { createHash } from 'node:crypto';
import { db } from '../db/client.js';
import { auditLog } from '../db/schema.js';

async function recordAudit(params: {
  userId: string | null;
  tool: string;
  input: unknown;
  status: 'ok' | 'error';
  latencyMs: number;
}) {
  const inputHash = createHash('sha256').update(JSON.stringify(params.input)).digest('hex');
  await db.insert(auditLog).values({
    userId: params.userId,
    actor: 'mcp',
    tool: params.tool,
    inputHash,
    status: params.status,
    latencyMs: params.latencyMs,
  });
}

export async function withAudit<T>(
  tool: string,
  userId: string | null,
  input: unknown,
  fn: () => Promise<T>
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    await recordAudit({ userId, tool, input, status: 'ok', latencyMs: Date.now() - start });
    return result;
  } catch (err) {
    await recordAudit({ userId, tool, input, status: 'error', latencyMs: Date.now() - start });
    throw err;
  }
}
