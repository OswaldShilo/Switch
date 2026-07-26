import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { consents } from '../../src/db/schema.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { getDemoUserId } from '../../src/adapter/demoUser.js';
import { fetchAccountsTool } from '../../src/mcp/tools/accounts.js';

describe('fetchAccountsTool', () => {
  let userId: string;

  beforeAll(async () => {
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    userId = await getDemoUserId();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns the one account tied to a given ACTIVE consent', async () => {
    const [consent] = await db
      .select()
      .from(consents)
      .where(eq(consents.userId, userId))
      .orderBy(consents.fipId)
      .limit(1);

    const result = await fetchAccountsTool(userId, { consentId: consent.id });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      type: 'SAVINGS',
      currency: 'INR',
    });
  });

  it('blocks fetch_accounts once the consent is REVOKED', async () => {
    const [consent] = await db
      .select()
      .from(consents)
      .where(eq(consents.userId, userId))
      .orderBy(consents.fipId)
      .limit(1);
    await db.update(consents).set({ status: 'REVOKED' }).where(eq(consents.id, consent.id));

    const result = await fetchAccountsTool(userId, { consentId: consent.id });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONSENT_NOT_ACTIVE');
  });

  it('returns CONSENT_NOT_FOUND for an unknown consent id', async () => {
    const result = await fetchAccountsTool(userId, { consentId: '00000000-0000-0000-0000-000000000000' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CONSENT_NOT_FOUND');
  });
});
