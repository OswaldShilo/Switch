import { afterEach, describe, expect, it } from 'vitest';
import { getFinvuConfig } from '../../src/adapter/finvuConfig.js';

const FINVU_ENV_KEYS = [
  'FINVU_BASE_URL',
  'FINVU_CHANNEL_USER_ID',
  'FINVU_CHANNEL_PASSWORD',
  'FINVU_AA_ID',
  'FINVU_TEMPLATE_NAME',
  'FINVU_REDIRECT_URL',
] as const;

describe('getFinvuConfig', () => {
  const originalEnv: Record<string, string | undefined> = {};
  for (const key of FINVU_ENV_KEYS) originalEnv[key] = process.env[key];

  afterEach(() => {
    for (const key of FINVU_ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it('throws when FINVU_CHANNEL_PASSWORD is not set, with no hardcoded fallback', () => {
    delete process.env.FINVU_CHANNEL_PASSWORD;
    expect(() => getFinvuConfig()).toThrow('FINVU_CHANNEL_PASSWORD is not set');
  });

  it('falls back to the known Dhanaprayoga sandbox defaults when only the password is set', () => {
    process.env.FINVU_CHANNEL_PASSWORD = 'test-password';
    delete process.env.FINVU_BASE_URL;
    delete process.env.FINVU_CHANNEL_USER_ID;
    delete process.env.FINVU_AA_ID;
    delete process.env.FINVU_TEMPLATE_NAME;
    delete process.env.FINVU_REDIRECT_URL;

    expect(getFinvuConfig()).toEqual({
      baseUrl: 'https://dhanaprayoga.fiu.finfactor.in/finsense/API/V2',
      channelUserId: 'channel@dhanaprayoga',
      channelPassword: 'test-password',
      aaId: 'cookiejar-aa@finvu.in',
      templateName: 'FINVUDEMO_TESTING',
      redirectUrl: 'https://google.co.in',
    });
  });

  it('prefers explicit env vars over the defaults', () => {
    process.env.FINVU_CHANNEL_PASSWORD = 'test-password';
    process.env.FINVU_BASE_URL = 'https://example.test/API/V2';
    process.env.FINVU_CHANNEL_USER_ID = 'channel@example';

    const config = getFinvuConfig();
    expect(config.baseUrl).toBe('https://example.test/API/V2');
    expect(config.channelUserId).toBe('channel@example');
  });
});
