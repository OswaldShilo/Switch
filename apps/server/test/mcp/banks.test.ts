import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../src/db/client.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { getDemoUserId } from '../../src/adapter/demoUser.js';
import { listSupportedBanksTool } from '../../src/mcp/tools/banks.js';

describe('listSupportedBanksTool', () => {
  let userId: string;

  beforeAll(async () => {
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    userId = await getDemoUserId();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns the HDFC and ICICI mock banks with matching fip_ids', async () => {
    const result = await listSupportedBanksTool(userId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([
      { fipId: 'hdfc-bank', name: 'HDFC Bank', logo: expect.any(String) },
      { fipId: 'icici-bank', name: 'ICICI Bank', logo: expect.any(String) },
    ]);
  });
});
