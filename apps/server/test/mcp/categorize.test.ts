import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { accounts, transactions } from '../../src/db/schema.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { getDemoUserId } from '../../src/adapter/demoUser.js';
import { categorizeTransactionsTool } from '../../src/mcp/tools/categorize.js';
import type { UncategorizedTxn } from '../../src/categorize/llmFallback.js';

describe('categorizeTransactionsTool', () => {
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    userId = await getDemoUserId();
    const [account] = await db.select().from(accounts).where(and(eq(accounts.userId, userId), eq(accounts.bank, 'HDFC Bank')));
    accountId = account.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  function stubClassifyBatch() {
    return vi.fn(async (txns: UncategorizedTxn[]) =>
      txns.map((t) => ({ txnId: t.txnId, category: 'Other', confidence: 0.5 }))
    );
  }

  it('categorizes known salary and subscription transactions via the rule engine', async () => {
    const classifyBatch = stubClassifyBatch();
    const result = await categorizeTransactionsTool(userId, { accountId, classifyBatch });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.categorized).toBeGreaterThan(0);

    const salaryRows = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.accountId, accountId), eq(transactions.narration, 'SALARY CREDIT NEXTLEAP TECHNOLOGIES')));
    expect(salaryRows.length).toBeGreaterThan(0);
    for (const row of salaryRows) {
      expect(row.category).toBe('Income');
      expect(row.categorizedBy).toBe('rule');
    }

    const netflixRows = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.accountId, accountId), eq(transactions.merchant, 'netflix')));
    expect(netflixRows.length).toBeGreaterThan(0);
    for (const row of netflixRows) {
      expect(row.category).toBe('Subscriptions');
      expect(row.categorizedBy).toBe('rule');
    }
  });

  it('never re-touches already-categorized rows on a re-run without force', async () => {
    const firstClassify = stubClassifyBatch();
    await categorizeTransactionsTool(userId, { accountId, classifyBatch: firstClassify });
    const callsAfterFirstRun = firstClassify.mock.calls.length;

    const secondClassify = stubClassifyBatch();
    const secondResult = await categorizeTransactionsTool(userId, { accountId, classifyBatch: secondClassify });
    expect(secondResult.ok).toBe(true);
    if (!secondResult.ok) return;
    expect(secondResult.data.categorized).toBe(0);
    expect(secondClassify.mock.calls.length).toBe(0);
    expect(callsAfterFirstRun).toBeGreaterThanOrEqual(0);
  });
});
