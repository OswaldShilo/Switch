import { describe, expect, it } from 'vitest';
import {
  accountDtoSchema,
  consentDtoSchema,
  transactionDtoSchema,
  summaryResponseSchema,
} from '../src/dashboard.js';

describe('accountDtoSchema', () => {
  it('accepts a valid account', () => {
    const valid = {
      accountId: 'acc_1',
      consentId: 'con_1',
      bank: 'HDFC Bank',
      type: 'SAVINGS',
      maskedNumber: 'XXXX1234',
      balance: '1000.00',
      currency: 'INR',
    };
    expect(accountDtoSchema.parse(valid)).toEqual(valid);
  });

  it('rejects a malformed account missing a required field', () => {
    const invalid = { accountId: 'acc_1', bank: 'HDFC Bank' };
    expect(accountDtoSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('consentDtoSchema', () => {
  it('accepts a valid consent', () => {
    const valid = {
      consentId: 'con_1',
      fipId: 'hdfc-bank',
      status: 'ACTIVE',
      purpose: 'Personal finance management',
      expiryAt: '2027-01-01T00:00:00.000Z',
    };
    expect(consentDtoSchema.parse(valid)).toEqual(valid);
  });

  it('rejects a malformed consent missing a required field', () => {
    const invalid = { consentId: 'con_1', status: 'ACTIVE' };
    expect(consentDtoSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('transactionDtoSchema', () => {
  it('accepts a valid transaction', () => {
    const valid = {
      txnId: 'txn_1',
      date: '2026-07-01',
      amount: '499.00',
      direction: 'debit' as const,
      narration: 'NETFLIX SUBSCRIPTION',
      merchant: 'netflix',
      category: 'Subscriptions',
    };
    expect(transactionDtoSchema.parse(valid)).toEqual(valid);
  });

  it('rejects a malformed transaction missing a required field', () => {
    const invalid = { txnId: 'txn_1', date: '2026-07-01' };
    expect(transactionDtoSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('summaryResponseSchema', () => {
  it('accepts a valid summary record', () => {
    const valid = { income: '70000.00', savingsRate: 0.5 };
    expect(summaryResponseSchema.parse(valid)).toEqual(valid);
  });

  it('rejects a non-object value', () => {
    expect(summaryResponseSchema.safeParse('not-an-object').success).toBe(false);
  });
});
