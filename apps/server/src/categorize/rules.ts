import { eq, isNull, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { categoryRules } from '../db/schema.js';

export async function matchRule(
  userId: string,
  input: { narration: string; merchant: string | null }
): Promise<string | null> {
  const rules = await db
    .select()
    .from(categoryRules)
    .where(or(isNull(categoryRules.userId), eq(categoryRules.userId, userId)));

  const ordered = rules.sort((a, b) => b.priority - a.priority);
  const haystack = `${input.merchant ?? ''} ${input.narration}`;
  for (const rule of ordered) {
    if (new RegExp(rule.pattern, 'i').test(haystack)) return rule.category;
  }
  return null;
}
