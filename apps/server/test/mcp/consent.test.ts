import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../src/db/client.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { getDemoUserId } from '../../src/adapter/demoUser.js';
import {
  checkConsentStatusTool,
  getConsentDetailsTool,
  initiateConsentTool,
} from '../../src/mcp/tools/consent.js';

describe('consent tools', () => {
  let userId: string;

  beforeAll(async () => {
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    userId = await getDemoUserId();
  });

  afterAll(async () => {
    await pool.end();
  });

  const baseInput = {
    mobile: '9876543210',
    fipId: 'icici-bank',
    purpose: 'Personal finance management',
    fromDate: '2025-01-01',
    toDate: '2026-07-20',
    expiryDays: 365,
    fiTypes: ['DEPOSIT'],
  };

  it('initiates a PENDING consent, flips ACTIVE on first status check, stays ACTIVE after', async () => {
    const initiated = await initiateConsentTool(userId, baseInput);
    expect(initiated.ok).toBe(true);
    if (!initiated.ok) return;
    expect(initiated.data.status).toBe('PENDING');
    expect(initiated.data.approvalUrl).toContain(initiated.data.consentId);

    const firstCheck = await checkConsentStatusTool(userId, { consentId: initiated.data.consentId });
    expect(firstCheck).toEqual({ ok: true, data: { status: 'ACTIVE' } });

    const secondCheck = await checkConsentStatusTool(userId, { consentId: initiated.data.consentId });
    expect(secondCheck).toEqual({ ok: true, data: { status: 'ACTIVE' } });
  });

  it('returns full consent details', async () => {
    const initiated = await initiateConsentTool(userId, baseInput);
    if (!initiated.ok) throw new Error('setup failed');

    const details = await getConsentDetailsTool(userId, { consentId: initiated.data.consentId });
    expect(details).toEqual({
      ok: true,
      data: {
        purpose: baseInput.purpose,
        fiTypes: baseInput.fiTypes,
        dateRange: { from: baseInput.fromDate, to: baseInput.toDate },
        expiry: expect.any(String),
        dataLife: expect.any(String),
      },
    });
  });

  it('rejects an unsupported fip_id', async () => {
    const result = await initiateConsentTool(userId, { ...baseInput, fipId: 'unknown-bank' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNSUPPORTED_BANK');
  });

  it('returns CONSENT_NOT_FOUND for an unknown consent id', async () => {
    const result = await checkConsentStatusTool(userId, { consentId: '00000000-0000-0000-0000-000000000000' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONSENT_NOT_FOUND');
  });
});
