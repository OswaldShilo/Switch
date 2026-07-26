import { afterAll, describe, expect, it } from 'vitest';
import { pool } from '../../src/db/client.js';
import type { AaAdapter } from '../../src/adapter/AaAdapter.js';
import { mockAdapter } from '../../src/adapter/mockAdapter.js';
import { getAdapter } from '../../src/adapter/index.js';

describe('mockAdapter', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('satisfies the AaAdapter interface (type-level; also asserts the six methods exist)', () => {
    const adapter: AaAdapter = mockAdapter;
    expect(typeof adapter.listSupportedBanks).toBe('function');
    expect(typeof adapter.initiateConsent).toBe('function');
    expect(typeof adapter.checkConsentStatus).toBe('function');
    expect(typeof adapter.getConsentDetails).toBe('function');
    expect(typeof adapter.requestFinancialData).toBe('function');
    expect(typeof adapter.getDataStatus).toBe('function');
  });

  it('getAdapter() returns mockAdapter when MOCK_MODE is unset', () => {
    const original = process.env.MOCK_MODE;
    delete process.env.MOCK_MODE;
    try {
      expect(getAdapter()).toBe(mockAdapter);
    } finally {
      if (original === undefined) delete process.env.MOCK_MODE;
      else process.env.MOCK_MODE = original;
    }
  });

  it('getAdapter() returns mockAdapter when MOCK_MODE is "true"', () => {
    const original = process.env.MOCK_MODE;
    process.env.MOCK_MODE = 'true';
    try {
      expect(getAdapter()).toBe(mockAdapter);
    } finally {
      if (original === undefined) delete process.env.MOCK_MODE;
      else process.env.MOCK_MODE = original;
    }
  });

  it('getAdapter() returns a different adapter when MOCK_MODE is "false"', () => {
    const original = process.env.MOCK_MODE;
    process.env.MOCK_MODE = 'false';
    try {
      expect(getAdapter()).not.toBe(mockAdapter);
    } finally {
      if (original === undefined) delete process.env.MOCK_MODE;
      else process.env.MOCK_MODE = original;
    }
  });
});
