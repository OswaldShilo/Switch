import { eq } from 'drizzle-orm';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { accounts, auditLog, consents, transactions, users } from '../../src/db/schema.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { DEMO_USER_EMAIL } from '../../src/adapter/demoUser.js';
import { getOrCreateUserByEmail } from '../../src/adapter/users.js';
import { initiateConsentTool, checkConsentStatusTool } from '../../src/mcp/tools/consent.js';
import { requestFinancialDataTool } from '../../src/mcp/tools/dataFetch.js';
import { apiRouter } from '../../src/rest/router.js';

const TEST_SECRET = 'test-secret-for-rest-summary-spec';
const OTHER_USER_EMAIL = 'rest-summary-other-user@switch.app';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  return app;
}

function tokenFor(email: string) {
  return jwt.sign({ email }, TEST_SECRET, { algorithm: 'HS256' });
}

describe('GET /api/accounts/:id/summary', () => {
  let hdfcAccountId: string;
  let foreignAccountId: string;

  beforeAll(async () => {
    process.env.SUPABASE_JWT_SECRET = TEST_SECRET;
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    const [account] = await db.select().from(accounts).where(eq(accounts.bank, 'HDFC Bank'));
    hdfcAccountId = account.id;

    const otherUserId = await getOrCreateUserByEmail(OTHER_USER_EMAIL);
    const initiated = await initiateConsentTool(otherUserId, {
      mobile: '9876500001',
      fipId: 'icici-bank',
      purpose: 'Personal finance management',
      fromDate: '2025-01-01',
      toDate: '2026-07-20',
      expiryDays: 365,
      fiTypes: ['DEPOSIT'],
    });
    if (!initiated.ok) throw new Error('setup failed');
    await checkConsentStatusTool(otherUserId, { consentId: initiated.data.consentId });
    const fetched = await requestFinancialDataTool(otherUserId, { consentId: initiated.data.consentId });
    if (!fetched.ok) throw new Error('setup failed');
    const [foreignAccount] = await db.select().from(accounts).where(eq(accounts.consentId, initiated.data.consentId));
    foreignAccountId = foreignAccount.id;
  });

  afterAll(async () => {
    const otherUserId = await getOrCreateUserByEmail(OTHER_USER_EMAIL);
    const otherAccounts = await db.select().from(accounts).where(eq(accounts.userId, otherUserId));
    for (const acc of otherAccounts) {
      await db.delete(transactions).where(eq(transactions.accountId, acc.id));
      await db.delete(accounts).where(eq(accounts.id, acc.id));
    }
    await db.delete(consents).where(eq(consents.userId, otherUserId));
    await db.delete(auditLog).where(eq(auditLog.userId, otherUserId));
    await db.delete(users).where(eq(users.id, otherUserId));
    await pool.end();
  });

  it('returns the known 70000.00 salary income figure for the seeded July period', async () => {
    const res = await request(buildApp())
      .get(`/api/accounts/${hdfcAccountId}/summary`)
      .query({ metrics: 'income', from: '2026-07-01', to: '2026-07-31' })
      .set('Authorization', `Bearer ${tokenFor(DEMO_USER_EMAIL)}`);
    expect(res.status).toBe(200);
    expect(res.body.income).toBe('70000.00');
  });

  it('404s on an account belonging to a different user', async () => {
    const res = await request(buildApp())
      .get(`/api/accounts/${foreignAccountId}/summary`)
      .query({ metrics: 'income' })
      .set('Authorization', `Bearer ${tokenFor(DEMO_USER_EMAIL)}`);
    expect(res.status).toBe(404);
  });

  it('401s without a bearer token', async () => {
    const res = await request(buildApp()).get(`/api/accounts/${hdfcAccountId}/summary`);
    expect(res.status).toBe(401);
  });
});
