import { eq } from 'drizzle-orm';
import { db } from '../client.js';
import { accounts, auditLog, consents, transactions, users } from '../schema.js';
import { generateMockDataset } from './mockData.js';

export async function runSeed(referenceDate: Date = new Date()) {
  const dataset = generateMockDataset(referenceDate);

  const existing = await db.select().from(users).where(eq(users.email, dataset.userEmail));
  if (existing.length > 0) {
    const userId = existing[0].id;
    const existingAccounts = await db.select().from(accounts).where(eq(accounts.userId, userId));
    for (const acc of existingAccounts) {
      await db.delete(transactions).where(eq(transactions.accountId, acc.id));
    }
    // audit_log rows reference users.id with no cascade; a demo user accrues audit_log
    // rows the moment any MCP tool runs against it (via withAudit), so they must be
    // cleared before the user can be deleted and re-seeded.
    await db.delete(auditLog).where(eq(auditLog.userId, userId));
    await db.delete(accounts).where(eq(accounts.userId, userId));
    await db.delete(consents).where(eq(consents.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  }

  const [user] = await db.insert(users).values({ email: dataset.userEmail }).returning();

  const now = new Date();
  const consentIdByAccountKey = new Map<string, string>();
  for (const acc of dataset.accounts) {
    const [consent] = await db
      .insert(consents)
      .values({
        userId: user.id,
        fipId: acc.bank.toLowerCase().replace(/\s+/g, '-'),
        aaConsentId: `mock-consent-${acc.key}`,
        status: 'ACTIVE',
        purpose: 'Personal finance management',
        fiTypes: ['DEPOSIT'],
        fromDate: '2020-01-01',
        toDate: now.toISOString().slice(0, 10),
        expiryAt: new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()),
        dataLife: '1 year',
      })
      .returning();
    consentIdByAccountKey.set(acc.key, consent.id);
  }

  const accountIdByKey = new Map<string, string>();
  for (const acc of dataset.accounts) {
    const [row] = await db
      .insert(accounts)
      .values({
        userId: user.id,
        consentId: consentIdByAccountKey.get(acc.key)!,
        bank: acc.bank,
        type: acc.type,
        maskedNumber: acc.maskedNumber,
        balance: acc.balance,
        currency: acc.currency,
        fetchedAt: now,
      })
      .returning();
    accountIdByKey.set(acc.key, row.id);
  }

  const txnRows = dataset.transactions.map((t) => ({
    accountId: accountIdByKey.get(t.accountKey)!,
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

  return {
    userId: user.id,
    accountCount: dataset.accounts.length,
    transactionCount: txnRows.length,
  };
}
