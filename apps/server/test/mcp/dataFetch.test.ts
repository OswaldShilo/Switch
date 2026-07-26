import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { accounts } from '../../src/db/schema.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { getDemoUserId } from '../../src/adapter/demoUser.js';
import { checkConsentStatusTool, initiateConsentTool } from '../../src/mcp/tools/consent.js';
import { getDataStatusTool, requestFinancialDataTool } from '../../src/mcp/tools/dataFetch.js';

describe('data fetch tools', () => {
  let userId: string;

  beforeAll(async () => {
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    userId = await getDemoUserId();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function activeConsentId(): Promise<string> {
    const initiated = await initiateConsentTool(userId, {
      mobile: '9876543210',
      fipId: 'icici-bank',
      purpose: 'Personal finance management',
      fromDate: '2025-01-01',
      toDate: '2026-07-20',
      expiryDays: 365,
      fiTypes: ['DEPOSIT'],
    });
    if (!initiated.ok) throw new Error('setup failed');
    await checkConsentStatusTool(userId, { consentId: initiated.data.consentId });
    return initiated.data.consentId;
  }

  it('fetches data synchronously, is idempotent, and reports READY via get_data_status', async () => {
    const consentId = await activeConsentId();

    const first = await requestFinancialDataTool(userId, { consentId });
    expect(first).toEqual({ ok: true, data: { sessionId: consentId, status: 'READY' } });

    const second = await requestFinancialDataTool(userId, { consentId });
    expect(second).toEqual({ ok: true, data: { sessionId: consentId, status: 'READY' } });

    const rows = await db.select().from(accounts).where(eq(accounts.consentId, consentId));
    expect(rows).toHaveLength(1);

    const status = await getDataStatusTool(userId, { sessionId: consentId });
    expect(status.ok).toBe(true);
    if (!status.ok) return;
    expect(status.data.status).toBe('READY');
    expect(status.data.fetchedAt).toEqual(expect.any(String));
  });

  it('rejects request_financial_data on a PENDING (not yet ACTIVE) consent', async () => {
    const initiated = await initiateConsentTool(userId, {
      mobile: '9876543210',
      fipId: 'hdfc-bank',
      purpose: 'Personal finance management',
      fromDate: '2025-01-01',
      toDate: '2026-07-20',
      expiryDays: 365,
      fiTypes: ['DEPOSIT'],
    });
    if (!initiated.ok) throw new Error('setup failed');

    const result = await requestFinancialDataTool(userId, { consentId: initiated.data.consentId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONSENT_NOT_ACTIVE');
  });

  it('reports PENDING from get_data_status before request_financial_data has run', async () => {
    const consentId = await activeConsentId();
    const status = await getDataStatusTool(userId, { sessionId: consentId });
    expect(status).toEqual({ ok: true, data: { status: 'PENDING', fetchedAt: null } });
  });

  it('returns SESSION_NOT_FOUND for an unknown session id', async () => {
    const result = await getDataStatusTool(userId, { sessionId: '00000000-0000-0000-0000-000000000000' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SESSION_NOT_FOUND');
  });
});
