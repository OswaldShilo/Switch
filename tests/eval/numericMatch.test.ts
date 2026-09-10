import { describe, expect, it } from 'vitest';
import { replyContainsAmount, replyContainsPercent } from './numericMatch.js';

describe('replyContainsAmount', () => {
  it('matches a rupee-formatted amount', () => {
    expect(replyContainsAmount('You spent ₹12,340 on Food Delivery in July.', 12340)).toBe(true);
  });
  it('matches within tolerance', () => {
    expect(replyContainsAmount('That comes to about 12342 rupees.', 12340)).toBe(true);
  });
  it('rejects when no close number is present', () => {
    expect(replyContainsAmount('You spent ₹5,000 on Food Delivery.', 12340)).toBe(false);
  });
  it('does not treat a percent figure as a matching amount', () => {
    expect(replyContainsAmount('Your savings rate was 23%.', 23)).toBe(false);
  });
  it('does not let a percent figure produce a truncated false-positive match', () => {
    expect(replyContainsAmount('Your growth rate was 23% this month.', 2)).toBe(false);
    expect(replyContainsAmount('Your savings rate was 100%.', 10)).toBe(false);
  });
  it('still finds a real amount when an unrelated percent figure appears nearby', () => {
    expect(replyContainsAmount('Amount was 230 (23% up).', 230)).toBe(true);
  });
});

describe('replyContainsPercent', () => {
  it('matches a percent-formatted figure', () => {
    expect(replyContainsPercent('Your savings rate was 23%.', 0.23)).toBe(true);
  });
  it('matches a bare fraction', () => {
    expect(replyContainsPercent('Your savings rate was 0.23.', 0.23)).toBe(true);
  });
  it('rejects a distant figure', () => {
    expect(replyContainsPercent('Your savings rate was 5%.', 0.23)).toBe(false);
  });
});
