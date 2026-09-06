import { isNull } from 'drizzle-orm';
import { db } from '../client.js';
import { categoryRules } from '../schema.js';

const DEFAULT_RULES = [
  { pattern: 'swiggy|zomato', category: 'Food Delivery', priority: 10 },
  { pattern: 'bigbasket|dmart', category: 'Groceries', priority: 10 },
  { pattern: 'uber|ola', category: 'Transport', priority: 10 },
  { pattern: 'amazon|myntra', category: 'Shopping', priority: 10 },
  { pattern: 'netflix|spotify|hotstar|amazonprime|icloud|gym', category: 'Subscriptions', priority: 10 },
  { pattern: 'bses|airtel', category: 'Utilities', priority: 10 },
  { pattern: 'atm', category: 'Cash Withdrawal', priority: 10 },
  { pattern: 'upi-transfer', category: 'Transfers', priority: 10 },
  { pattern: 'SALARY CREDIT', category: 'Income', priority: 5 },
  { pattern: 'NEFT RENT PAYMENT', category: 'Rent', priority: 5 },
];

export async function seedDefaultCategoryRules(): Promise<void> {
  const existing = await db.select().from(categoryRules).where(isNull(categoryRules.userId));
  const have = new Set(existing.map((r) => r.pattern));
  const toInsert = DEFAULT_RULES.filter((r) => !have.has(r.pattern));
  if (toInsert.length > 0) {
    await db.insert(categoryRules).values(toInsert.map((r) => ({ ...r, userId: null })));
  }
}
