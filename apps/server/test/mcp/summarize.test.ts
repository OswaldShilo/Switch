import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { accounts } from '../../src/db/schema.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { getDemoUserId } from '../../src/adapter/demoUser.js';
import { summarizeFinancesTool } from '../../src/mcp/tools/summarize.js';
import { categorizeTransactionsTool } from '../../src/mcp/tools/categorize.js';
import type { UncategorizedTxn } from '../../src/categorize/llmFallback.js';

describe('summarizeFinancesTool', () => {
  let userId: string;
  let accountId: string;

  beforeAll(async () => {
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    userId = await getDemoUserId();
    const [account] = await db.select().from(accounts).where(eq(accounts.bank, 'HDFC Bank'));
    accountId = account.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('computes income and savings_rate as SQL aggregates over the period', async () => {
    const result = await summarizeFinancesTool(userId, {
      accountId,
      period: { from: '2026-07-01', to: '2026-07-31' },
      metrics: ['income', 'spend_by_category', 'savings_rate'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.income).toBe('70000.00');
    expect(typeof result.data.savingsRate).toBe('number');
    const savingsRate = result.data.savingsRate as number;
    expect(savingsRate).toBeGreaterThanOrEqual(0);
    expect(savingsRate).toBeLessThanOrEqual(1);
    expect(Array.isArray(result.data.spendByCategory)).toBe(true);
  });

  it('returns recurring_subscriptions once transactions are categorized', async () => {
    const classifyBatch = vi.fn(async (txns: UncategorizedTxn[]) =>
      txns.map((t) => ({ txnId: t.txnId, category: 'Other', confidence: 0.5 }))
    );
    const categorizeResult = await categorizeTransactionsTool(userId, { accountId, classifyBatch });
    expect(categorizeResult.ok).toBe(true);

    const result = await summarizeFinancesTool(userId, {
      accountId,
      period: { from: '2020-01-01', to: '2030-01-01' },
      metrics: ['recurring_subscriptions'],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const recurring = result.data.recurringSubscriptions as Array<{ merchant: string; count: number }>;
    expect(Array.isArray(recurring)).toBe(true);
    const merchants = recurring.map((r) => r.merchant);
    expect(merchants).toContain('netflix');
    expect(merchants).toContain('spotify');
    for (const row of recurring) {
      // node-postgres returns bigint aggregates (count(*)) as strings at runtime even
      // though the Drizzle sql<number> template types them as number; coerce for the check.
      expect(Number(row.count)).toBeGreaterThanOrEqual(2);
    }
  });
});
