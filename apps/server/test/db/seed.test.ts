import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { accounts, consents, transactions, users } from '../../src/db/schema.js';
import { runSeed } from '../../src/db/seed/seed.js';

describe('runSeed (integration)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('seeds the demo user with 2 accounts, 2 active consents, and 400 transactions', async () => {
    const result = await runSeed(new Date('2026-07-20T00:00:00Z'));

    expect(result.accountCount).toBe(2);
    expect(result.transactionCount).toBe(400);

    const [user] = await db.select().from(users).where(eq(users.email, 'demo@switch.app'));
    expect(user).toBeDefined();

    const userAccounts = await db.select().from(accounts).where(eq(accounts.userId, user.id));
    expect(userAccounts).toHaveLength(2);

    const userConsents = await db.select().from(consents).where(eq(consents.userId, user.id));
    expect(userConsents).toHaveLength(2);
    expect(userConsents.every((c) => c.status === 'ACTIVE')).toBe(true);

    let totalTxns = 0;
    for (const acc of userAccounts) {
      const rows = await db.select().from(transactions).where(eq(transactions.accountId, acc.id));
      totalTxns += rows.length;
    }
    expect(totalTxns).toBe(400);
  });

  it('is idempotent: re-running the seed does not duplicate rows', async () => {
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    const result = await runSeed(new Date('2026-07-20T00:00:00Z'));

    expect(result.transactionCount).toBe(400);

    const allUsers = await db.select().from(users).where(eq(users.email, 'demo@switch.app'));
    expect(allUsers).toHaveLength(1);

    const userAccounts = await db.select().from(accounts).where(eq(accounts.userId, allUsers[0].id));
    expect(userAccounts).toHaveLength(2);
  });
});
