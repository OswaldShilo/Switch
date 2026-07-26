import { eq } from 'drizzle-orm';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { accounts } from '../../src/db/schema.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { DEMO_USER_EMAIL } from '../../src/adapter/demoUser.js';
import { apiRouter } from '../../src/rest/router.js';

const TEST_SECRET = 'test-secret-for-rest-transactions-spec';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  return app;
}

function tokenFor(email: string) {
  return jwt.sign({ email }, TEST_SECRET, { algorithm: 'HS256' });
}

describe('GET /api/accounts/:id/transactions', () => {
  let accountId: string;

  beforeAll(async () => {
    process.env.SUPABASE_JWT_SECRET = TEST_SECRET;
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    const [account] = await db.select().from(accounts).orderBy(accounts.bank).limit(1);
    accountId = account.id;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('paginates with a default limit of 50 and exposes a cursor, matching fetchTransactions', async () => {
    const res = await request(buildApp())
      .get(`/api/accounts/${accountId}/transactions`)
      .set('Authorization', `Bearer ${tokenFor(DEMO_USER_EMAIL)}`);
    expect(res.status).toBe(200);
    expect(res.body.transactions).toHaveLength(50);
    expect(res.body.nextCursor).not.toBeNull();
  });

  it('returns 404 for an unknown account id', async () => {
    const res = await request(buildApp())
      .get('/api/accounts/00000000-0000-0000-0000-000000000000/transactions')
      .set('Authorization', `Bearer ${tokenFor(DEMO_USER_EMAIL)}`);
    expect(res.status).toBe(404);
  });
});
