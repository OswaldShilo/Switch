import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { accounts, consents, transactions } from '../db/schema.js';
import { generateMockAccountData } from '../db/seed/mockData.js';
import type { ToolResult } from './types.js';

export async function requestFinancialData(
  consentId: string
): Promise<ToolResult<{ sessionId: string; status: string }>> {
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

  const existing = await db.select().from(accounts).where(eq(accounts.consentId, consentId));
  if (existing.length === 0) {
    const mockData = generateMockAccountData(consent.fipId, new Date());
    if (!mockData) {
      return {
        ok: false,
        error: { code: 'NO_MOCK_DATA', message: `No mock data available for fip_id "${consent.fipId}"` },
      };
    }

    const now = new Date();
    const [account] = await db
      .insert(accounts)
      .values({
        userId: consent.userId,
        consentId: consent.id,
        bank: mockData.account.bank,
        type: mockData.account.type,
        maskedNumber: mockData.account.maskedNumber,
        balance: mockData.account.balance,
        currency: mockData.account.currency,
        fetchedAt: now,
      })
      .returning();

    const txnRows = mockData.transactions.map((t) => ({
      accountId: account.id,
      txnDate: t.txnDate,
      amount: t.amount,
      direction: t.direction,
      narration: t.narration,
      merchant: t.merchant,
    }));
    const BATCH = 100;
    for (let i = 0; i < txnRows.length; i += BATCH) {
      await db.insert(transactions).values(txnRows.slice(i, i + BATCH));
    }
  }

  return { ok: true, data: { sessionId: consent.id, status: 'READY' } };
}

export async function getDataStatus(
  sessionId: string
): Promise<ToolResult<{ status: string; fetchedAt: string | null }>> {
  const [consent] = await db.select().from(consents).where(eq(consents.id, sessionId));
  if (!consent) {
    return { ok: false, error: { code: 'SESSION_NOT_FOUND', message: `No session with id "${sessionId}"` } };
  }

  const [account] = await db.select().from(accounts).where(eq(accounts.consentId, sessionId));
  if (!account) {
    return { ok: true, data: { status: 'PENDING', fetchedAt: null } };
  }
  return { ok: true, data: { status: 'READY', fetchedAt: account.fetchedAt.toISOString() } };
}
