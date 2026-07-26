import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { connectorTokens, users } from '../../src/db/schema.js';
import { createConnectorToken, revokeConnectorToken } from '../../src/auth/connectorToken.js';
import { requireConnectorToken } from '../../src/auth/requireConnectorToken.js';
import { getOrCreateUserByEmail } from '../../src/adapter/users.js';

const TEST_EMAIL = 'require-connector-token-spec@switch.app';

function buildApp() {
  const app = express();
  app.get('/protected', requireConnectorToken, (req, res) => {
    res.json({ userId: req.userId });
  });
  return app;
}

describe('requireConnectorToken middleware', () => {
  afterAll(async () => {
    const userId = await getOrCreateUserByEmail(TEST_EMAIL);
    await db.delete(connectorTokens).where(eq(connectorTokens.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
    await pool.end();
  });

  it('sets req.userId for a valid token', async () => {
    const userId = await getOrCreateUserByEmail(TEST_EMAIL);
    const { token } = await createConnectorToken(userId);

    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(userId);
  });

  it('returns 401 when the Authorization header is missing', async () => {
    const res = await request(buildApp()).get('/protected');
    expect(res.status).toBe(401);
  });

  it('returns 401 for a garbage token', async () => {
    const res = await request(buildApp()).get('/protected').set('Authorization', 'Bearer switch_garbage-not-real');
    expect(res.status).toBe(401);
  });

  it('returns 401 for a revoked token', async () => {
    const userId = await getOrCreateUserByEmail(TEST_EMAIL);
    const { token, tokenId } = await createConnectorToken(userId);
    await revokeConnectorToken(tokenId, userId);

    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});
