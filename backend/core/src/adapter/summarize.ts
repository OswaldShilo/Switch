import { and, between, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { transactions } from '../db/schema.js';
import type { ToolResult } from './types.js';

export type Metric =
  | 'spend_by_category'
  | 'income'
  | 'savings_rate'
  | 'recurring_subscriptions'
  | 'top_merchants'
  | 'mom_trend';

export interface SummarizeInput {
  accountId: string;
  period: { from: string; to: string };
  metrics: Metric[];
}

export async function summarizeFinances(input: SummarizeInput): Promise<ToolResult<Record<string, unknown>>> {
  const { accountId, period } = input;
  const inPeriod = and(eq(transactions.accountId, accountId), between(transactions.txnDate, period.from, period.to));
  const result: Record<string, unknown> = {};

  if (input.metrics.includes('spend_by_category')) {
    result.spendByCategory = await db
      .select({ category: transactions.category, total: sql<string>`sum(${transactions.amount})` })
      .from(transactions)
      .where(and(inPeriod, eq(transactions.direction, 'debit')))
      .groupBy(transactions.category);
  }

  if (input.metrics.includes('income') || input.metrics.includes('savings_rate')) {
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
      .from(transactions)
      .where(and(inPeriod, eq(transactions.direction, 'credit')));
    result.income = row.total;
  }

  if (input.metrics.includes('savings_rate')) {
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
      .from(transactions)
      .where(and(inPeriod, eq(transactions.direction, 'debit')));
    const income = Number(result.income ?? 0);
    result.savingsRate = income > 0 ? (income - Number(row.total)) / income : 0;
  }

  if (input.metrics.includes('top_merchants')) {
    result.topMerchants = await db
      .select({
        merchant: transactions.merchant,
        total: sql<string>`sum(${transactions.amount})`,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(and(inPeriod, eq(transactions.direction, 'debit')))
      .groupBy(transactions.merchant)
      .orderBy(sql`sum(${transactions.amount}) desc`)
      .limit(10);
  }

  if (input.metrics.includes('recurring_subscriptions')) {
    result.recurringSubscriptions = await db
      .select({ merchant: transactions.merchant, amount: transactions.amount, count: sql<number>`count(*)` })
      .from(transactions)
      .where(and(eq(transactions.accountId, accountId), eq(transactions.category, 'Subscriptions')))
      .groupBy(transactions.merchant, transactions.amount)
      .having(sql`count(*) >= 2`);
  }

  if (input.metrics.includes('mom_trend')) {
    result.momTrend = await db
      .select({
        month: sql<string>`to_char(${transactions.txnDate}::date, 'YYYY-MM')`,
        total: sql<string>`sum(${transactions.amount})`,
      })
      .from(transactions)
      .where(and(eq(transactions.accountId, accountId), eq(transactions.direction, 'debit')))
      .groupBy(sql`to_char(${transactions.txnDate}::date, 'YYYY-MM')`)
      .orderBy(sql`to_char(${transactions.txnDate}::date, 'YYYY-MM')`);
  }

  return { ok: true, data: result };
}
