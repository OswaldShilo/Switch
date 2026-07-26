import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../src/db/client.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { DEMO_USER_EMAIL } from '../../src/adapter/demoUser.js';
import { apiRouter } from '../../src/rest/router.js';

const TEST_SECRET = 'test-secret-for-rest-accounts-spec';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  return app;
}

function tokenFor(email: string) {
  return jwt.sign({ email }, TEST_SECRET, { algorithm: 'HS256' });
}

describe('GET /api/accounts', () => {
  beforeAll(async () => {
    process.env.SUPABASE_JWT_SECRET = TEST_SECRET;
    await runSeed(new Date('2026-07-20T00:00:00Z'));
  });

  afterAll(async () => {
    await pool.end();
  });

  it("returns the demo user's active accounts", async () => {
    const res = await request(buildApp()).get('/api/accounts').set('Authorization', `Bearer ${tokenFor(DEMO_USER_EMAIL)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    const banks = res.body.map((a: { bank: string }) => a.bank).sort();
    expect(banks).toEqual(['HDFC Bank', 'ICICI Bank']);
  });

  it('returns 401 without a bearer token', async () => {
    const res = await request(buildApp()).get('/api/accounts');
    expect(res.status).toBe(401);
  });
});
