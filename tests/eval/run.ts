import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { pool } from '../../backend/core/src/db/client.js';
import { EVAL_QUESTIONS } from './questions.js';
import { setupEvalUsers } from './setupEvalUsers.js';
import { runQuestion } from './runner.js';
import { scoreQuestionRun, type QuestionScore } from './score.js';

interface ModeResult {
  mode: 'on' | 'off';
  scores: QuestionScore[];
}

async function main() {
  console.log('Seeding two isolated eval users...');
  const { onUserId, onAccountId, offUserId, offAccountId } = await setupEvalUsers();

  const results: ModeResult[] = [];

  for (const [mode, userId, accountId] of [
    ['on', onUserId, onAccountId],
    ['off', offUserId, offAccountId],
  ] as const) {
    console.log(`\nRunning ${EVAL_QUESTIONS.length} questions with memory ${mode.toUpperCase()}...`);
    const scores: QuestionScore[] = [];
    for (const question of EVAL_QUESTIONS) {
      try {
        const run = await runQuestion(question, userId, mode === 'on');
        const score = await scoreQuestionRun(question, run, accountId, userId);
        scores.push(score);
        console.log(`  [${mode}] ${question.id}: ${score.pass ? 'PASS' : 'FAIL'} — ${score.detail}`);
      } catch (err) {
        // One question's transient failure (e.g. a flaky API call) should not lose
        // the rest of a 68-call live run — record it as a failure and keep going.
        const message = err instanceof Error ? err.message : String(err);
        scores.push({ id: question.id, category: question.category, pass: false, detail: `ERROR: ${message}` });
        console.log(`  [${mode}] ${question.id}: ERROR — ${message}`);
      }
    }
    results.push({ mode, scores });
  }

  const summary = summarize(results);
  console.log('\n=== Summary (pass rate by category) ===');
  console.table(summary);

  mkdirSync('eval/results', { recursive: true });
  const outPath = `eval/results/${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(outPath, JSON.stringify({ results, summary }, null, 2));
  console.log(`\nFull results written to tests/${outPath}`);

  await pool.end();
}

function summarize(results: ModeResult[]): Record<string, { on: string; off: string }> {
  const categories = ['grounding', 'preference', 'recall', 'hygiene'];
  const table: Record<string, { on: string; off: string }> = {};
  for (const category of categories) {
    const on = results.find((r) => r.mode === 'on')!.scores.filter((s) => s.category === category);
    const off = results.find((r) => r.mode === 'off')!.scores.filter((s) => s.category === category);
    table[category] = {
      on: `${on.filter((s) => s.pass).length}/${on.length}`,
      off: `${off.filter((s) => s.pass).length}/${off.length}`,
    };
  }
  return table;
}

main().catch(async (err) => {
  // Plain console.error(err) can itself throw here for certain SDK error shapes
  // (observed: a TypeError inside Node's util.inspect while formatting an OpenAI
  // SDK error object) — print message/stack directly instead of inspecting err.
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  await pool.end();
  process.exit(1);
});
