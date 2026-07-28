import { eq } from 'drizzle-orm';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { users } from '../../src/db/schema.js';

const TEST_SECRET = 'test-secret-for-requireUser-spec';
const TEST_EMAIL = 'requireuser-spec@switch.app';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The global test/setup.ts mock of @supabase/supabase-js stands in for Supabase's
// Auth API by re-verifying the locally-forged JWT — that's a convenience so every
// other REST test file can keep minting tokens with jsonwebtoken. But requireUser.ts's
// own job is handling whatever shape getUser() returns, not re-deriving the JWT check,
// so this file re-mocks the module with a controllable getUser: it defaults to the same
// JWT-forging behavior (so the pre-existing tests below keep working unchanged), but
// exposes the underlying vi.fn so individual tests can override it to assert
// requireUser's handling of Supabase-shaped responses directly (an API error, or a
// user object with no email) without needing a real network call or a crafted token.
type MockGetUserResult = { data: { user: { email?: string } | null }; error: Error | null };

const getUserMock = vi.fn(async (token: string): Promise<MockGetUserResult> => {
  try {
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!secret) throw new Error('SUPABASE_JWT_SECRET is not set');
    const payload = jwt.verify(token, secret) as { email?: string };
    if (!payload.email) throw new Error('Token has no email claim');
    return { data: { user: { email: payload.email } }, error: null };
  } catch (err) {
    return { data: { user: null }, error: err as Error };
  }
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: getUserMock } }),
}));

const { requireUser } = await import('../../src/auth/requireUser.js');

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

  it('returns 401 when Supabase getUser() resolves with an error', async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: new Error('invalid token') });
    const res = await request(buildApp()).get('/protected').set('Authorization', 'Bearer whatever');
    expect(res.status).toBe(401);
  });

  it('returns 401 when Supabase getUser() resolves with a user that has no email', async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: {} }, error: null });
    const res = await request(buildApp()).get('/protected').set('Authorization', 'Bearer whatever');
    expect(res.status).toBe(401);
  });

  it('calls next() and sets req.userId when Supabase getUser() resolves with a valid user', async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: { email: TEST_EMAIL } }, error: null });
    const res = await request(buildApp()).get('/protected').set('Authorization', 'Bearer whatever');
    expect(res.status).toBe(200);
    expect(res.body.userId).toEqual(expect.stringMatching(UUID_RE));
  });
});
