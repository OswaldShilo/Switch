import { eq } from 'drizzle-orm';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_USER_EMAIL, getDemoUserId } from '../../src/adapter/demoUser.js';
import { getOrCreateUserByEmail } from '../../src/adapter/users.js';
import { db, pool } from '../../src/db/client.js';
import { auditLog, memories, users } from '../../src/db/schema.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { rememberTool } from '../../src/mcp/tools/memory.js';
import { apiRouter } from '../../src/rest/router.js';

const TEST_SECRET = 'test-secret-for-rest-memories-spec';
const OTHER_USER_EMAIL = 'rest-memories-other-user@switch.app';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  return app;
}

function tokenFor(email: string) {
  return jwt.sign({ email }, TEST_SECRET, { algorithm: 'HS256' });
}

describe('memories REST endpoints', () => {
  let userId: string;
  let memoryId: string;

  beforeAll(async () => {
    process.env.SUPABASE_JWT_SECRET = TEST_SECRET;
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    userId = await getDemoUserId();
    const remembered = await rememberTool(userId, {
      content: 'Always keep 6 months of expenses as an emergency fund',
      tags: ['rule'],
    });
    if (!remembered.ok) throw new Error('setup failed');
    memoryId = remembered.data.memoryId;
  });

  afterAll(async () => {
    const otherUserId = await getOrCreateUserByEmail(OTHER_USER_EMAIL);
    await db.delete(memories).where(eq(memories.userId, otherUserId));
    await db.delete(auditLog).where(eq(auditLog.userId, otherUserId));
    await db.delete(users).where(eq(users.id, otherUserId));
    await pool.end();
  });

  it('GET /api/memories lists the seeded memory', async () => {
    const res = await request(buildApp())
      .get('/api/memories')
      .set('Authorization', `Bearer ${tokenFor(DEMO_USER_EMAIL)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.some((m: { memoryId: string }) => m.memoryId === memoryId)).toBe(true);
  });

  it('DELETE /api/memories/:id soft-deletes it; a follow-up GET no longer includes it', async () => {
    const del = await request(buildApp())
      .delete(`/api/memories/${memoryId}`)
      .set('Authorization', `Bearer ${tokenFor(DEMO_USER_EMAIL)}`);
    expect(del.status).toBe(200);

    const res = await request(buildApp())
      .get('/api/memories')
      .set('Authorization', `Bearer ${tokenFor(DEMO_USER_EMAIL)}`);
    expect(res.body.some((m: { memoryId: string }) => m.memoryId === memoryId)).toBe(false);
  });

  it("404s deleting another user's memory", async () => {
    const otherUserId = await getOrCreateUserByEmail(OTHER_USER_EMAIL);
    const otherRemembered = await rememberTool(otherUserId, { content: "other user's secret", tags: ['x'] });
    if (!otherRemembered.ok) throw new Error('setup failed');

    const res = await request(buildApp())
      .delete(`/api/memories/${otherRemembered.data.memoryId}`)
      .set('Authorization', `Bearer ${tokenFor(DEMO_USER_EMAIL)}`);
    expect(res.status).toBe(404);
  });

  it('401s without a bearer token', async () => {
    const res = await request(buildApp()).get('/api/memories');
    expect(res.status).toBe(401);
  });
});
