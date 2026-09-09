import type { Metric } from '../../backend/core/src/adapter/summarize.js';

export type EvalCategory = 'grounding' | 'preference' | 'recall' | 'hygiene';

export interface EvalQuestion {
  id: string;
  category: EvalCategory;
  // Prior user turns to send (via sendChatMessage) before `question`. For 'preference'
  // questions whose id ends in '-cross', these turns are sent in a SEPARATE prior
  // sendChatMessage call sequence (simulating a return session) rather than immediately
  // before the question — see Task 3 for how the runner distinguishes this.
  setup: string[];
  question: string;
  // 'grounding' only: what summarizeFinances call produces the ground-truth number.
  groundTruth?: { metrics: Metric[]; period: { from: string; to: string }; path: string[] };
  // 'recall' only: substring that must appear in a correct answer (case-insensitive).
  expectedFact?: string;
  // 'preference' only: rubric text given to the LLM judge.
  rubric?: string;
  // 'hygiene' only: which sub-case this is.
  hygieneVariant?: 'delete' | 'stale';
  // 'hygiene' + 'stale' only: the false memory to plant before asking the question.
  staleClaim?: string;
  // 'hygiene' + 'delete' only: substring of the setup memory that must NOT reappear
  // in the answer once deleted.
  deletedFactSubstring?: string;
}
