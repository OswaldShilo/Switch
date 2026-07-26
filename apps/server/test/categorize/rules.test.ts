import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { categoryRules } from '../../src/db/schema.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { getDemoUserId } from '../../src/adapter/demoUser.js';
import { seedDefaultCategoryRules } from '../../src/db/seed/categoryRules.js';
import { matchRule } from '../../src/categorize/rules.js';

describe('matchRule', () => {
  let userId: string;

  beforeAll(async () => {
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    userId = await getDemoUserId();
    await seedDefaultCategoryRules();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('matches a known merchant/narration to its default rule category', async () => {
    const category = await matchRule(userId, { narration: 'SWIGGY ORDER', merchant: 'swiggy' });
    expect(category).toBe('Food Delivery');
  });

  it('matches a salary narration with no merchant to Income', async () => {
    const category = await matchRule(userId, { narration: 'SALARY CREDIT NEXTLEAP', merchant: null });
    expect(category).toBe('Income');
  });

  it('returns null for an unrecognized merchant/narration', async () => {
    const category = await matchRule(userId, {
      narration: 'SOME UNRECOGNIZED NARRATION XYZ',
      merchant: 'totally-unknown-merchant',
    });
    expect(category).toBeNull();
  });

  it('prefers a higher-priority user-specific rule over the matching global rule', async () => {
    await db.insert(categoryRules).values({ userId, pattern: 'swiggy', category: 'Other', priority: 100 });

    const category = await matchRule(userId, { narration: 'SWIGGY ORDER', merchant: 'swiggy' });
    expect(category).toBe('Other');

    // clean up so this user-scoped row doesn't block a later test file's user deletion
    await db.delete(categoryRules).where(eq(categoryRules.userId, userId));
  });
});
