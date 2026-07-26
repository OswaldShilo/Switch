import { eq } from 'drizzle-orm';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { connectorTokens, users } from '../../src/db/schema.js';
import { getOrCreateUserByEmail } from '../../src/adapter/users.js';
import { requireConnectorToken } from '../../src/auth/requireConnectorToken.js';
import { apiRouter } from '../../src/rest/router.js';

const TEST_SECRET = 'test-secret-for-connector-tokens-spec';
const TEST_EMAIL = 'connector-tokens-rest-spec@switch.app';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  // A stand-in for the real /mcp route, gated the same way, to prove revocation
  // takes effect immediately against the connector-token middleware.
  app.get('/mcp', requireConnectorToken, (req, res) => {
    res.json({ userId: req.userId });
  });
  return app;
}

function tokenFor(email: string) {
  return jwt.sign({ email }, TEST_SECRET, { algorithm: 'HS256' });
}

describe('connector-tokens REST endpoints', () => {
  beforeAll(() => {
    process.env.SUPABASE_JWT_SECRET = TEST_SECRET;
  });

  afterAll(async () => {
    const userId = await getOrCreateUserByEmail(TEST_EMAIL);
    await db.delete(connectorTokens).where(eq(connectorTokens.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  });

  it('POST /api/connector-tokens creates a token, returning the raw token exactly once', async () => {
    const res = await request(buildApp())
      .post('/api/connector-tokens')
      .set('Authorization', `Bearer ${tokenFor(TEST_EMAIL)}`);

    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^switch_[0-9a-f]{64}$/);
    expect(res.body.tokenId).toEqual(expect.any(String));
  });

  it('GET /api/connector-tokens lists tokens without ever returning the hash', async () => {
    const app = buildApp();
    await request(app).post('/api/connector-tokens').set('Authorization', `Bearer ${tokenFor(TEST_EMAIL)}`);

    const res = await request(app).get('/api/connector-tokens').set('Authorization', `Bearer ${tokenFor(TEST_EMAIL)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    for (const row of res.body) {
      expect(row).toEqual({
        tokenId: expect.any(String),
        createdAt: expect.any(String),
        revokedAt: null,
      });
      expect(row.tokenHash).toBeUndefined();
      expect(row.token).toBeUndefined();
    }
  });

  it('a newly created token authenticates /mcp, and revoking it immediately fails a subsequent call', async () => {
    const app = buildApp();
    const created = await request(app)
      .post('/api/connector-tokens')
      .set('Authorization', `Bearer ${tokenFor(TEST_EMAIL)}`);
    const { token, tokenId } = created.body;

    const beforeRevoke = await request(app).get('/mcp').set('Authorization', `Bearer ${token}`);
    expect(beforeRevoke.status).toBe(200);

    const revoke = await request(app)
      .post(`/api/connector-tokens/${tokenId}/revoke`)
      .set('Authorization', `Bearer ${tokenFor(TEST_EMAIL)}`);
    expect(revoke.status).toBe(200);

    const afterRevoke = await request(app).get('/mcp').set('Authorization', `Bearer ${token}`);
    expect(afterRevoke.status).toBe(401);
  });

  it('POST /api/connector-tokens/:id/revoke returns 404 for an unknown token id', async () => {
    const res = await request(buildApp())
      .post('/api/connector-tokens/00000000-0000-0000-0000-000000000000/revoke')
      .set('Authorization', `Bearer ${tokenFor(TEST_EMAIL)}`);
    expect(res.status).toBe(404);
  });
});
