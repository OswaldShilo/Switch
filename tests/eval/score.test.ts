import { describe, expect, it } from 'vitest';
import type { EvalQuestion } from './types.js';
import type { QuestionRun } from './runner.js';

// Import scoreRecall's behavior indirectly through scoreQuestionRun's recall branch,
// since scoreRecall itself isn't exported (kept internal to score.ts) — this exercises
// the same code path score.ts's public API uses.
import { scoreQuestionRun } from './score.js';

describe('scoreQuestionRun — recall category (no DB/LLM involved)', () => {
  const question: EvalQuestion = {
    id: 'recall-test',
    category: 'recall',
    setup: [],
    question: 'What did I mention earlier?',
    expectedFact: 'bruno',
  };

  it('passes when the reply contains the expected fact', async () => {
    const run: QuestionRun = { reply: 'You mentioned your dog Bruno earlier.', toolCalls: [] };
    const score = await scoreQuestionRun(question, run, 'unused-account-id', 'unused-user-id');
    expect(score.pass).toBe(true);
  });

  it('fails when the reply omits the expected fact', async () => {
    const run: QuestionRun = { reply: "I don't see anything about that in our conversation.", toolCalls: [] };
    const score = await scoreQuestionRun(question, run, 'unused-account-id', 'unused-user-id');
    expect(score.pass).toBe(false);
  });
});
