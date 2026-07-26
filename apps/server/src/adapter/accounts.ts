import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { accounts, consents } from '../db/schema.js';
import type { ToolResult } from './types.js';

export interface AccountSummary {
  accountId: string;
  type: string;
  maskedNumber: string;
  bank: string;
  balance: string;
  currency: string;
}

export interface AccountForUser extends AccountSummary {
  consentId: string;
}

export async function fetchAccounts(consentId: string): Promise<ToolResult<AccountSummary[]>> {
  const [consent] = await db.select().from(consents).where(eq(consents.id, consentId));
  if (!consent) {
    return { ok: false, error: { code: 'CONSENT_NOT_FOUND', message: `No consent with id "${consentId}"` } };
  }
  if (consent.status !== 'ACTIVE') {
    return {
      ok: false,
      error: { code: 'CONSENT_NOT_ACTIVE', message: `Consent "${consentId}" is ${consent.status}, expected ACTIVE` },
    };
  }

  const rows = await db.select().from(accounts).where(eq(accounts.consentId, consentId));
  return {
    ok: true,
    data: rows.map((r) => ({
      accountId: r.id,
      type: r.type,
      maskedNumber: r.maskedNumber,
      bank: r.bank,
      balance: r.balance,
      currency: r.currency,
    })),
  };
}

// Task 3 (M3): list a REST caller's own accounts (ACTIVE consents only) — separate from
// fetchAccounts above, which resolves accounts for a single known consent id and is what
// the MCP fetch_accounts tool uses. REST has no consent id up front; it starts from userId.
export async function listAccountsForUser(userId: string): Promise<AccountForUser[]> {
  const rows = await db
    .select({ account: accounts })
    .from(accounts)
    .innerJoin(consents, eq(accounts.consentId, consents.id))
    .where(and(eq(consents.userId, userId), eq(consents.status, 'ACTIVE')));
  return rows.map((r) => ({
    accountId: r.account.id,
    consentId: r.account.consentId,
    type: r.account.type,
    maskedNumber: r.account.maskedNumber,
    bank: r.account.bank,
    balance: r.account.balance,
    currency: r.account.currency,
  }));
}

export async function assertAccountOwnership(accountId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: consents.userId })
    .from(accounts)
    .innerJoin(consents, eq(accounts.consentId, consents.id))
    .where(eq(accounts.id, accountId));
  return row?.userId === userId;
}
