// Extracts numbers written in common Indian-currency reply styles ("₹12,340", "Rs 12340",
// "12,340.00", "12340") and checks whether one is within tolerance of the expected amount.
// Grounding replies come from a system prompt that forbids the model doing its own
// arithmetic, so the number in the text should be the tool's output verbatim modulo
// formatting/rounding — a small tolerance (default ₹5) covers rounding-to-rupee display.
export function replyContainsAmount(reply: string, expectedAmount: number, toleranceRupees = 5): boolean {
  const matches = reply.match(/[\d,]+(?:\.\d+)?/g) ?? [];
  const numbers = matches
    .map((m) => Number(m.replace(/,/g, '')))
    .filter((n) => !Number.isNaN(n));
  return numbers.some((n) => Math.abs(n - expectedAmount) <= toleranceRupees);
}

// Percent match: expectedFraction is 0-1 (e.g. 0.23 for 23%). Accepts the number written
// either as "23%" or "0.23" in the reply, within tolerancePoints percentage points.
export function replyContainsPercent(reply: string, expectedFraction: number, tolerancePoints = 1): boolean {
  const expectedPercent = expectedFraction * 100;
  const percentMatches = reply.match(/(-?\d+(?:\.\d+)?)\s*%/g) ?? [];
  for (const m of percentMatches) {
    const n = Number(m.replace('%', '').trim());
    if (!Number.isNaN(n) && Math.abs(n - expectedPercent) <= tolerancePoints) return true;
  }
  // Also accept a bare fraction like "0.23" close to expectedFraction.
  const fractionMatches = reply.match(/(?<![\d.])0\.\d+(?![\d%])/g) ?? [];
  for (const m of fractionMatches) {
    const n = Number(m);
    if (!Number.isNaN(n) && Math.abs(n * 100 - expectedPercent) <= tolerancePoints) return true;
  }
  return false;
}
