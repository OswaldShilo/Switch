import cors from 'cors';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { apiRouter } from '../src/rest/router.js';

// Mirrors exactly the middleware apps/server/src/index.ts wires up, built as its
// own tiny app here so this test doesn't depend on every other REST test file's
// buildApp() helper (none of which include CORS middleware).
function buildAppWithCors(origin: string) {
  const app = express();
  app.use(cors({ origin, credentials: true }));
  app.use(express.json());
  app.use('/api', apiRouter);
  return app;
}

describe('CORS', () => {
  it('reflects the configured WEB_ORIGIN on a preflight request to /api/chat', async () => {
    const res = await request(buildAppWithCors('http://localhost:3000'))
      .options('/api/chat')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('does not reflect an origin that is not the configured one', async () => {
    const res = await request(buildAppWithCors('http://localhost:3000'))
      .options('/api/chat')
      .set('Origin', 'http://evil.example.com')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.headers['access-control-allow-origin']).not.toBe('http://evil.example.com');
  });
});
