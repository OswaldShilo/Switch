export const CATEGORIES = [
  'Food Delivery',
  'Groceries',
  'Transport',
  'Shopping',
  'Subscriptions',
  'Utilities',
  'Rent',
  'Income',
  'Cash Withdrawal',
  'Transfers',
  'Entertainment',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];
