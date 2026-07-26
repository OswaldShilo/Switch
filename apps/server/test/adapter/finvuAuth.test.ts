import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getFinvuToken, resetFinvuTokenCache } from '../../src/adapter/finvuAuth.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe('getFinvuToken', () => {
  beforeAll(() => {
    process.env.FINVU_CHANNEL_PASSWORD = 'test-password';
  });

  afterEach(() => {
    resetFinvuTokenCache();
    vi.restoreAllMocks();
  });

  it('logs in via POST /User/Login and returns the token, never touching the real network', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ body: { token: 'stub-token-123' } }));

    const token = await getFinvuToken(fetchImpl);
    expect(token).toBe('stub-token-123');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/User/Login');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.body.userId).toBe('channel@dhanaprayoga');
    expect(body.body.password).toBe('test-password');
  });

  it('caches the token across calls, only hitting the stub fetch once', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ body: { token: 'cached-token' } }));

    const first = await getFinvuToken(fetchImpl);
    const second = await getFinvuToken(fetchImpl);
    expect(first).toBe('cached-token');
    expect(second).toBe('cached-token');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('re-fetches after resetFinvuTokenCache()', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ body: { token: 'token-a' } }))
      .mockResolvedValueOnce(jsonResponse({ body: { token: 'token-b' } }));

    expect(await getFinvuToken(fetchImpl)).toBe('token-a');
    resetFinvuTokenCache();
    expect(await getFinvuToken(fetchImpl)).toBe('token-b');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('throws when the login call fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, false, 401));
    await expect(getFinvuToken(fetchImpl)).rejects.toThrow('Finvu login failed: 401');
  });
});
