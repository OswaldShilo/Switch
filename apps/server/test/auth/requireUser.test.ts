import { eq } from 'drizzle-orm';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { users } from '../../src/db/schema.js';
import { requireUser } from '../../src/auth/requireUser.js';

const TEST_SECRET = 'test-secret-for-requireUser-spec';
const TEST_EMAIL = 'requireuser-spec@switch.app';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function buildApp() {
  const app = express();
  app.get('/protected', requireUser, (req, res) => {
    res.json({ userId: req.userId });
  });
  return app;
}

describe('requireUser middleware', () => {
  beforeAll(() => {
    process.env.SUPABASE_JWT_SECRET = TEST_SECRET;
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.email, TEST_EMAIL));
    await pool.end();
  });

  it('sets req.userId to a real user row for a valid token, provisioning the user on first sight', async () => {
    const token = jwt.sign({ email: TEST_EMAIL }, TEST_SECRET, { algorithm: 'HS256' });
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.userId).toEqual(expect.stringMatching(UUID_RE));

    const [row] = await db.select().from(users).where(eq(users.email, TEST_EMAIL));
    expect(row).toBeDefined();
    expect(row.id).toBe(res.body.userId);
  });

  it('reuses the existing user row on a second valid token for the same email', async () => {
    const token = jwt.sign({ email: TEST_EMAIL }, TEST_SECRET, { algorithm: 'HS256' });
    const first = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    const second = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);

    expect(first.body.userId).toBe(second.body.userId);
  });

  it('returns 401 when the Authorization header is missing', async () => {
    const res = await request(buildApp()).get('/protected');
    expect(res.status).toBe(401);
  });

  it('returns 401 for a garbage token', async () => {
    const res = await request(buildApp()).get('/protected').set('Authorization', 'Bearer not-a-real-jwt');
    expect(res.status).toBe(401);
  });

  it('returns 401 for a token signed with the wrong secret', async () => {
    const token = jwt.sign({ email: TEST_EMAIL }, 'a-different-secret', { algorithm: 'HS256' });
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});
