import { runSeed } from '../../backend/core/src/db/seed/seed.js';
import { listAccountsForUser } from '../../backend/core/src/adapter/accounts.js';
import { categorizeTransactions } from '../../backend/core/src/adapter/categorize.js';

// Fixed reference date so both users get identical, deterministic seed data — the exact
// value tests/db/seed.test.ts and tests/rest/summary.test.ts already anchor to (most
// recent full seeded month = July 2026).
const EVAL_REFERENCE_DATE = new Date('2026-07-20T00:00:00Z');

export interface EvalUserSetup {
  onUserId: string;
  onAccountId: string;
  offUserId: string;
  offAccountId: string;
}

async function seedAndCategorize(email: string): Promise<{ userId: string; accountId: string }> {
  const { userId } = await runSeed(EVAL_REFERENCE_DATE, email);
  const [account] = await listAccountsForUser(userId);
  if (!account) throw new Error(`setupEvalUsers: no account found for seeded user ${email}`);
  const result = await categorizeTransactions(userId, account.accountId);
  if (!result.ok) throw new Error(`setupEvalUsers: categorization failed for ${email}: ${result.error.message}`);
  return { userId, accountId: account.accountId };
}

// Two separate users (not two runs of the same user) so the OFF run can never see memory
// rows written during the ON run — memoryEnabled only controls tool availability going
// forward, it does not stop prior `remember` calls from having already been persisted.
export async function setupEvalUsers(): Promise<EvalUserSetup> {
  const on = await seedAndCategorize('eval-memory-on@switch.app');
  const off = await seedAndCategorize('eval-memory-off@switch.app');
  return { onUserId: on.userId, onAccountId: on.accountId, offUserId: off.userId, offAccountId: off.accountId };
}
