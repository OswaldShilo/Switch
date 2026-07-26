import { describe, expect, it } from 'vitest';
import { generateMockAccountData, generateMockDataset } from '../../src/db/seed/mockData.js';

describe('generateMockDataset', () => {
  const dataset = generateMockDataset(new Date('2026-07-20T00:00:00Z'));

  it('creates exactly 2 accounts', () => {
    expect(dataset.accounts).toHaveLength(2);
    expect(dataset.accounts.map((a) => a.key)).toEqual(['acc1', 'acc2']);
  });

  it('creates exactly 400 transactions', () => {
    expect(dataset.transactions).toHaveLength(400);
  });

  it('creates exactly 6 monthly salary credits of ₹70,000', () => {
    const salaryTxns = dataset.transactions.filter((t) => t.narration.startsWith('SALARY CREDIT'));
    expect(salaryTxns).toHaveLength(6);
    for (const txn of salaryTxns) {
      expect(txn.direction).toBe('credit');
      expect(txn.amount).toBe('70000.00');
    }
  });

  it('creates exactly 6 monthly rent payments', () => {
    const rentTxns = dataset.transactions.filter((t) => t.narration.startsWith('NEFT RENT PAYMENT'));
    expect(rentTxns).toHaveLength(6);
    for (const txn of rentTxns) {
      expect(txn.direction).toBe('debit');
      expect(txn.amount).toBe('15000.00');
    }
  });

  it('creates exactly 36 subscription transactions across 6 distinct merchants', () => {
    const subMerchants = ['netflix', 'spotify', 'hotstar', 'amazonprime', 'icloud', 'gym'];
    const subTxns = dataset.transactions.filter((t) => t.merchant && subMerchants.includes(t.merchant));
    expect(subTxns).toHaveLength(36);
    for (const merchant of subMerchants) {
      expect(subTxns.filter((t) => t.merchant === merchant)).toHaveLength(6);
    }
  });

  it('produces a seasonal spike in shopping transactions in one month', () => {
    const shoppingTxns = dataset.transactions.filter(
      (t) => t.merchant === 'amazon' || t.merchant === 'myntra'
    );
    const byMonth = new Map<string, number>();
    for (const txn of shoppingTxns) {
      const ym = txn.txnDate.slice(0, 7);
      byMonth.set(ym, (byMonth.get(ym) ?? 0) + 1);
    }
    const counts = [...byMonth.values()].sort((a, b) => a - b);
    expect(counts[counts.length - 1]).toBeGreaterThan(counts[0] * 2);
  });

  it('spans exactly 6 distinct calendar months', () => {
    const months = new Set(dataset.transactions.map((t) => t.txnDate.slice(0, 7)));
    expect(months.size).toBe(6);
  });

  it('is deterministic for a fixed reference date', () => {
    const second = generateMockDataset(new Date('2026-07-20T00:00:00Z'));
    expect(second).toEqual(dataset);
  });
});

describe('generateMockAccountData', () => {
  const now = new Date('2026-07-20T00:00:00Z');

  it('returns the HDFC account and its transactions for fip_id "hdfc-bank"', () => {
    const result = generateMockAccountData('hdfc-bank', now);
    expect(result).not.toBeNull();
    expect(result?.account.bank).toBe('HDFC Bank');
    expect(result?.transactions.every((t) => t.accountKey === result.account.key)).toBe(true);
  });

  it('returns null for an unknown fip_id', () => {
    expect(generateMockAccountData('unknown-bank', now)).toBeNull();
  });

  it('matches the transactions for that account in the full dataset', () => {
    const full = generateMockDataset(now);
    const result = generateMockAccountData('icici-bank', now);
    const expected = full.transactions.filter((t) => t.accountKey === 'acc2');
    expect(result?.transactions).toEqual(expected);
  });
});
