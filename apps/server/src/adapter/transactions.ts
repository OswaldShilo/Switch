import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { db } from '../db/client.js';
import { accounts, consents, transactions } from '../db/schema.js';
import type { ToolResult } from './types.js';

export interface TransactionSummary {
  txnId: string;
  date: string;
  amount: string;
  direction: 'credit' | 'debit';
  narration: string;
  merchant: string | null;
  category: string | null;
  confidence: string | null;
}

export interface FetchTransactionsInput {
  accountId: string;
  from?: string;
  to?: string;
  category?: string;
  limit?: number;
  cursor?: string;
}

export interface FetchTransactionsOutput {
  transactions: TransactionSummary[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;

export async function fetchTransactions(input: FetchTransactionsInput): Promise<ToolResult<FetchTransactionsOutput>> {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, input.accountId));
  if (!account) {
    return { ok: false, error: { code: 'ACCOUNT_NOT_FOUND', message: `No account with id "${input.accountId}"` } };
  }

  const [consent] = await db.select().from(consents).where(eq(consents.id, account.consentId));
  if (!consent || consent.status !== 'ACTIVE') {
    return {
      ok: false,
      error: { code: 'CONSENT_NOT_ACTIVE', message: `Consent for account "${input.accountId}" is not ACTIVE` },
    };
  }

  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;

  const conditions = [eq(transactions.accountId, input.accountId)];
  if (input.from) conditions.push(gte(transactions.txnDate, input.from));
  if (input.to) conditions.push(lte(transactions.txnDate, input.to));
  if (input.category) conditions.push(eq(transactions.category, input.category));

  const rows = await db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(asc(transactions.txnDate), asc(transactions.id))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    ok: true,
    data: {
      transactions: page.map((r) => ({
        txnId: r.id,
        date: r.txnDate,
        amount: r.amount,
        direction: r.direction,
        narration: r.narration,
        merchant: r.merchant,
        category: r.category,
        confidence: r.confidence,
      })),
      nextCursor: hasMore ? String(offset + limit) : null,
    },
  };
}
