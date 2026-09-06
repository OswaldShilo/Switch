import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../backend/core/src/db/client.js';
import { accounts, auditLog, consents, users } from '../../backend/core/src/db/schema.js';
import { runSeed } from '../../backend/core/src/db/seed/seed.js';
import { getDemoUserId } from '../../backend/core/src/adapter/demoUser.js';
import { getOrCreateUserByEmail } from '../../backend/core/src/adapter/users.js';
import { fetchTransactionsTool } from '../../backend/core/src/mcp/tools/transactions.js';

const OTHER_USER_EMAIL = 'mcp-transactions-other-user@switch.app';

describe('fetchTransactionsTool', () => {
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    userId = await getDemoUserId();
    const [account] = await db.select().from(accounts).where(eq(accounts.userId, userId)).orderBy(accounts.bank).limit(1);
    accountId = account.id;
  });

  afterAll(async () => {
    const otherUserId = await getOrCreateUserByEmail(OTHER_USER_EMAIL);
    await db.delete(auditLog).where(eq(auditLog.userId, otherUserId));
    await db.delete(users).where(eq(users.id, otherUserId));
    await pool.end();
  });

  it('paginates with a default limit of 50 and exposes a cursor', async () => {
    const first = await fetchTransactionsTool(userId, { accountId });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.transactions).toHaveLength(50);
    expect(first.data.nextCursor).not.toBeNull();

    const second = await fetchTransactionsTool(userId, { accountId, cursor: first.data.nextCursor! });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const firstIds = new Set(first.data.transactions.map((t) => t.txnId));
    for (const txn of second.data.transactions) {
      expect(firstIds.has(txn.txnId)).toBe(false);
    }
  });

  it('filters by date range', async () => {
    const result = await fetchTransactionsTool(userId, {
      accountId,
      from: '2026-07-01',
      to: '2026-07-31',
      limit: 500,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const txn of result.data.transactions) {
      expect(txn.date >= '2026-07-01' && txn.date <= '2026-07-31').toBe(true);
    }
  });

  it('IDOR regression: returns ACCOUNT_NOT_FOUND when a different user supplies the demo user\'s account id', async () => {
    const otherUserId = await getOrCreateUserByEmail(OTHER_USER_EMAIL);
    const result = await fetchTransactionsTool(otherUserId, { accountId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('blocks fetch_transactions once the owning consent is REVOKED', async () => {
    const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
    await db.update(consents).set({ status: 'REVOKED' }).where(eq(consents.id, account.consentId));

    const result = await fetchTransactionsTool(userId, { accountId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONSENT_NOT_ACTIVE');
  });

  it('returns ACCOUNT_NOT_FOUND for an unknown account id', async () => {
    const result = await fetchTransactionsTool(userId, { accountId: '00000000-0000-0000-0000-000000000000' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ACCOUNT_NOT_FOUND');
  });
});
