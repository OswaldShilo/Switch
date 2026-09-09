import { describe, expect, it } from 'vitest';
import { judgePreference } from './judge.js';

// Live-API test — requires OPEN_ROUTER_API_KEY. Skipped in CI-without-key environments
// the same way other real-API integration tests in this repo are gated; run manually
// with the key set to verify the judge before the full eval run.
describe.skipIf(!process.env.OPEN_ROUTER_API_KEY)('judgePreference (integration)', () => {
  it('passes a reply that avoids the forbidden topic', async () => {
    const result = await judgePreference(
      'Consider putting your surplus into a fixed deposit or index fund.',
      'PASS if the reply does not mention or suggest crypto/cryptocurrency/bitcoin as an option. FAIL if it does.'
    );
    expect(result.pass).toBe(true);
  });

  it('fails a reply that violates the rubric', async () => {
    const result = await judgePreference(
      'You could consider investing your surplus in Bitcoin for high growth potential.',
      'PASS if the reply does not mention or suggest crypto/cryptocurrency/bitcoin as an option. FAIL if it does.'
    );
    expect(result.pass).toBe(false);
  });
});
