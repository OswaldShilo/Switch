import { summarizeFinances } from '../../backend/core/src/adapter/summarize.js';
import { recallMemories } from '../../backend/core/src/adapter/memory.js';
import { replyContainsAmount, replyContainsPercent } from './numericMatch.js';
import { judgePreference } from './judge.js';
import type { EvalQuestion } from './types.js';
import type { QuestionRun } from './runner.js';

export interface QuestionScore {
  id: string;
  category: string;
  pass: boolean;
  detail: string;
}

function readPath(obj: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

async function scoreGrounding(question: EvalQuestion, run: QuestionRun, accountId: string): Promise<QuestionScore> {
  const gt = question.groundTruth!;
  const result = await summarizeFinances({ accountId, period: gt.period, metrics: gt.metrics });
  if (!result.ok) return { id: question.id, category: question.category, pass: false, detail: 'ground truth query failed' };

  if (gt.path[0] === 'spendByCategory') {
    const rows = (result.data.spendByCategory ?? []) as Array<{ category: string | null; total: string }>;
    const row = rows.find((r) => r.category === gt.path[1]);
    const expected = row ? Number(row.total) : 0;
    const pass = replyContainsAmount(run.reply, expected);
    return { id: question.id, category: question.category, pass, detail: `expected ~₹${expected}` };
  }

  const raw = readPath(result.data, gt.path);
  if (gt.path[0] === 'savingsRate') {
    const expected = Number(raw ?? 0);
    const pass = replyContainsPercent(run.reply, expected);
    return { id: question.id, category: question.category, pass, detail: `expected ~${(expected * 100).toFixed(1)}%` };
  }

  const expected = Number(raw ?? 0);
  const pass = replyContainsAmount(run.reply, expected);
  return { id: question.id, category: question.category, pass, detail: `expected ~₹${expected}` };
}

async function scorePreference(question: EvalQuestion, run: QuestionRun): Promise<QuestionScore> {
  const judged = await judgePreference(run.reply, question.rubric!);
  return { id: question.id, category: question.category, pass: judged.pass, detail: judged.reasoning };
}

function scoreRecall(question: EvalQuestion, run: QuestionRun): QuestionScore {
  const pass = run.reply.toLowerCase().includes(question.expectedFact!.toLowerCase());
  return { id: question.id, category: question.category, pass, detail: `expected fact "${question.expectedFact}"` };
}

async function scoreHygiene(question: EvalQuestion, run: QuestionRun, accountId: string, userId: string): Promise<QuestionScore> {
  if (question.hygieneVariant === 'delete') {
    const stillMentions = run.reply.toLowerCase().includes(question.deletedFactSubstring!.toLowerCase());
    const recalled = await recallMemories({ userId, limit: 20 });
    const stillStored =
      recalled.ok && recalled.data.some((m) => m.content.toLowerCase().includes(question.deletedFactSubstring!.toLowerCase()));
    const pass = !stillMentions && !stillStored;
    return { id: question.id, category: question.category, pass, detail: `deleted fact leaked in reply=${stillMentions}, still in DB=${stillStored}` };
  }

  // 'stale' variant: correctness is judged the same way as grounding — the reply must
  // reflect the tool-computed number, not the planted stale claim.
  return scoreGrounding(question, run, accountId);
}

export async function scoreQuestionRun(question: EvalQuestion, run: QuestionRun, accountId: string, userId: string): Promise<QuestionScore> {
  switch (question.category) {
    case 'grounding':
      return scoreGrounding(question, run, accountId);
    case 'preference':
      return scorePreference(question, run);
    case 'recall':
      return scoreRecall(question, run);
    case 'hygiene':
      return scoreHygiene(question, run, accountId, userId);
  }
}
