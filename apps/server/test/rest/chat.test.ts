import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_USER_EMAIL } from '../../src/adapter/demoUser.js';
import { pool } from '../../src/db/client.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { createChatRouter } from '../../src/rest/chat.js';

const TEST_SECRET = 'test-secret-for-rest-chat-spec';

function buildApp(sendMessage: Parameters<typeof createChatRouter>[0]) {
  const app = express();
  app.use(express.json());
  app.use('/api', createChatRouter(sendMessage));
  return app;
}

function tokenFor(email: string) {
  return jwt.sign({ email }, TEST_SECRET, { algorithm: 'HS256' });
}

describe('POST /api/chat', () => {
  beforeAll(async () => {
    process.env.SUPABASE_JWT_SECRET = TEST_SECRET;
    await runSeed(new Date('2026-07-20T00:00:00Z'));
  });

  afterAll(async () => {
    await pool.end();
  });

  it('calls the injected sendMessage with the authenticated user and message, returns its JSON shape', async () => {
    let receivedUserId = '';
    let receivedMessage = '';
    const stub = async (userId: string, message: string) => {
      receivedUserId = userId;
      receivedMessage = message;
      return { reply: 'Hi! How can I help?', toolCalls: ['list_supported_banks'] };
    };

    const res = await request(buildApp(stub))
      .post('/api/chat')
      .set('Authorization', `Bearer ${tokenFor(DEMO_USER_EMAIL)}`)
      .send({ message: 'Hello Switch' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reply: 'Hi! How can I help?', toolCalls: ['list_supported_banks'] });
    expect(receivedMessage).toBe('Hello Switch');
    expect(receivedUserId).toEqual(expect.any(String));
  });

  it('401s without a bearer token', async () => {
    const stub = async () => ({ reply: 'unreachable', toolCalls: [] });
    const res = await request(buildApp(stub)).post('/api/chat').send({ message: 'hi' });
    expect(res.status).toBe(401);
  });

  it('400s when message is missing', async () => {
    const stub = async () => ({ reply: 'unreachable', toolCalls: [] });
    const res = await request(buildApp(stub))
      .post('/api/chat')
      .set('Authorization', `Bearer ${tokenFor(DEMO_USER_EMAIL)}`)
      .send({});
    expect(res.status).toBe(400);
  });
});
