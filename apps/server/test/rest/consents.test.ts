import { eq } from 'drizzle-orm';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { auditLog, consents, users } from '../../src/db/schema.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { DEMO_USER_EMAIL } from '../../src/adapter/demoUser.js';
import { getOrCreateUserByEmail } from '../../src/adapter/users.js';
import { initiateConsentTool } from '../../src/mcp/tools/consent.js';
import { fetchAccountsTool } from '../../src/mcp/tools/accounts.js';
import { apiRouter } from '../../src/rest/router.js';

const TEST_SECRET = 'test-secret-for-rest-consents-spec';
const OTHER_USER_EMAIL = 'rest-consents-other-user@switch.app';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  return app;
}

function tokenFor(email: string) {
  return jwt.sign({ email }, TEST_SECRET, { algorithm: 'HS256' });
}

describe('consents REST endpoints', () => {
  let demoConsentId: string;

  beforeAll(async () => {
    process.env.SUPABASE_JWT_SECRET = TEST_SECRET;
    await runSeed(new Date('2026-07-20T00:00:00Z'));
  });

  afterAll(async () => {
    const otherUserId = await getOrCreateUserByEmail(OTHER_USER_EMAIL);
    await db.delete(consents).where(eq(consents.userId, otherUserId));
    await db.delete(auditLog).where(eq(auditLog.userId, otherUserId));
    await db.delete(users).where(eq(users.id, otherUserId));
    await pool.end();
  });

  it('GET /api/consents returns both of the demo user\'s consents', async () => {
    const res = await request(buildApp()).get('/api/consents').set('Authorization', `Bearer ${tokenFor(DEMO_USER_EMAIL)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    for (const c of res.body) {
      expect(c).toEqual({
        consentId: expect.any(String),
        fipId: expect.any(String),
        status: expect.any(String),
        purpose: expect.any(String),
        expiryAt: expect.any(String),
      });
    }
    demoConsentId = res.body[0].consentId;
  });

  it('POST /api/consents/:id/revoke flips status to REVOKED and blocks fetch_accounts afterwards', async () => {
    const res = await request(buildApp())
      .post(`/api/consents/${demoConsentId}/revoke`)
      .set('Authorization', `Bearer ${tokenFor(DEMO_USER_EMAIL)}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REVOKED');

    const [row] = await db.select().from(consents).where(eq(consents.id, demoConsentId));
    expect(row.status).toBe('REVOKED');

    const demoUserId = await getOrCreateUserByEmail(DEMO_USER_EMAIL);
    const fetchResult = await fetchAccountsTool(demoUserId, { consentId: demoConsentId });
    expect(fetchResult.ok).toBe(false);
    if (fetchResult.ok) return;
    expect(fetchResult.error.code).toBe('CONSENT_NOT_ACTIVE');
  });

  it("returns 404 when revoking a consent that belongs to a different user", async () => {
    const otherUserId = await getOrCreateUserByEmail(OTHER_USER_EMAIL);
    const initiated = await initiateConsentTool(otherUserId, {
      mobile: '9876500000',
      fipId: 'icici-bank',
      purpose: 'Personal finance management',
      fromDate: '2025-01-01',
      toDate: '2026-07-20',
      expiryDays: 365,
      fiTypes: ['DEPOSIT'],
    });
    if (!initiated.ok) throw new Error('setup failed');

    const res = await request(buildApp())
      .post(`/api/consents/${initiated.data.consentId}/revoke`)
      .set('Authorization', `Bearer ${tokenFor(DEMO_USER_EMAIL)}`);
    expect(res.status).toBe(404);

    const [row] = await db.select().from(consents).where(eq(consents.id, initiated.data.consentId));
    expect(row.status).toBe('PENDING');
  });
});
