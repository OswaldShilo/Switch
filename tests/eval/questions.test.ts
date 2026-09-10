import { describe, expect, it } from 'vitest';
import { EVAL_QUESTIONS } from './questions.js';

describe('EVAL_QUESTIONS fixture', () => {
  it('has 34 questions with unique ids', () => {
    expect(EVAL_QUESTIONS).toHaveLength(34);
    const ids = new Set(EVAL_QUESTIONS.map((q) => q.id));
    expect(ids.size).toBe(34);
  });

  it('covers all 4 categories with the expected counts', () => {
    const counts = EVAL_QUESTIONS.reduce<Record<string, number>>((acc, q) => {
      acc[q.category] = (acc[q.category] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.grounding).toBe(10);
    expect(counts.preference).toBe(10);
    expect(counts.recall).toBe(8);
    expect(counts.hygiene).toBe(6);
  });

  it('every grounding question has a groundTruth spec', () => {
    for (const q of EVAL_QUESTIONS.filter((q) => q.category === 'grounding')) {
      expect(q.groundTruth).toBeDefined();
    }
  });

  it('every preference question has a rubric', () => {
    for (const q of EVAL_QUESTIONS.filter((q) => q.category === 'preference')) {
      expect(q.rubric).toBeTruthy();
    }
  });

  it('every recall question has an expectedFact', () => {
    for (const q of EVAL_QUESTIONS.filter((q) => q.category === 'recall')) {
      expect(q.expectedFact).toBeTruthy();
    }
  });

  it('every hygiene question has a variant and the matching field set', () => {
    for (const q of EVAL_QUESTIONS.filter((q) => q.category === 'hygiene')) {
      expect(q.hygieneVariant).toBeDefined();
      if (q.hygieneVariant === 'delete') expect(q.deletedFactSubstring).toBeTruthy();
      if (q.hygieneVariant === 'stale') {
        expect(q.staleClaim).toBeTruthy();
        expect(q.groundTruth).toBeDefined();
      }
    }
  });
});
