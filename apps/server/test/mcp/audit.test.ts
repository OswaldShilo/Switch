import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { auditLog } from '../../src/db/schema.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { getDemoUserId } from '../../src/adapter/demoUser.js';
import { withAudit } from '../../src/mcp/audit.js';

describe('withAudit', () => {
  let userId: string;

  beforeAll(async () => {
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    userId = await getDemoUserId();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('records a successful call and returns the wrapped result', async () => {
    const result = await withAudit('test_tool_ok', userId, { a: 1 }, async () => 42);
    expect(result).toBe(42);

    const rows = await db.select().from(auditLog).where(eq(auditLog.tool, 'test_tool_ok'));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('ok');
    expect(rows[0].actor).toBe('mcp');
    expect(rows[0].userId).toBe(userId);
    expect(rows[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('records a failed call and rethrows', async () => {
    await expect(
      withAudit('test_tool_fail', userId, { a: 1 }, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    const rows = await db.select().from(auditLog).where(eq(auditLog.tool, 'test_tool_fail'));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('error');
  });
});
