// Fixed categorical order (never cycled/generated) per the dataviz skill's
// color-formula guidance — a category always maps to the same color, and
// low-frequency categories fold into "Other" rather than spilling past the
// validated 8-slot palette. Values are the skill's validated reference
// palette (references/palette.md), light-mode column.
export const CATEGORY_COLOR_ORDER = [
  'Food Delivery',
  'Groceries',
  'Transport',
  'Shopping',
  'Subscriptions',
  'Utilities',
  'Rent',
  'Cash Withdrawal',
] as const;

const PALETTE = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];
const OTHER_COLOR = '#898781'; // muted gray, reserved for the folded "Other" bucket

export function colorForCategory(category: string): string {
  const idx = CATEGORY_COLOR_ORDER.indexOf(category as (typeof CATEGORY_COLOR_ORDER)[number]);
  return idx === -1 ? OTHER_COLOR : PALETTE[idx];
}

export const OTHER_BUCKET_COLOR = OTHER_COLOR;
