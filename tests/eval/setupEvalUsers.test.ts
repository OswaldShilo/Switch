import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../backend/core/src/db/client.js';
import { transactions } from '../../backend/core/src/db/schema.js';
import { setupEvalUsers } from './setupEvalUsers.js';

describe('setupEvalUsers (integration)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('seeds two distinct, fully-categorized users', async () => {
    const result = await setupEvalUsers();

    expect(result.onUserId).not.toBe(result.offUserId);
    expect(result.onAccountId).not.toBe(result.offAccountId);

    const onTxns = await db.select().from(transactions).where(eq(transactions.accountId, result.onAccountId));
    expect(onTxns.length).toBeGreaterThan(0);
    expect(onTxns.every((t) => t.category !== null)).toBe(true);

    const offTxns = await db.select().from(transactions).where(eq(transactions.accountId, result.offAccountId));
    expect(offTxns.every((t) => t.category !== null)).toBe(true);
  });
});
