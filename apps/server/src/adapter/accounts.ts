import { eq } from 'drizzle-orm';
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
