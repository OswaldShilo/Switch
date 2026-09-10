import { sendChatMessage } from '../../backend/core/src/chat/chatService.js';
import { recallMemories, deleteMemory } from '../../backend/core/src/adapter/memory.js';
import type { EvalQuestion } from './types.js';

export interface QuestionRun {
  reply: string;
  toolCalls: string[];
  // hygiene 'delete' only: true if a fresh recallMemories check, taken immediately after
  // deleteMemory and BEFORE the final question turn, confirms the fact is actually gone.
  // Checked here (not after the final turn) because the final turn itself runs with
  // memoryEnabled and can call `remember` again on unrelated content — checking DB state
  // after that turn would conflate "did deletion fail" with "did the model re-store it".
  hygieneDeleteVerified?: boolean;
}

// Replays a question's setup turns, applies hygiene mutations (delete/stale) in between,
// then sends the target question — all through the real sendChatMessage loop so memory
// is written/read via actual tool calls, never injected directly into the DB.
export async function runQuestion(
  question: EvalQuestion,
  userId: string,
  memoryEnabled: boolean
): Promise<QuestionRun> {
  const allToolCalls: string[] = [];

  for (const turn of question.setup) {
    const result = await sendChatMessage(userId, turn, { memoryEnabled });
    allToolCalls.push(...result.toolCalls);
  }

  let hygieneDeleteVerified: boolean | undefined;
  if (question.hygieneVariant === 'delete' && question.deletedFactSubstring) {
    const substring = question.deletedFactSubstring.toLowerCase();
    const recalled = await recallMemories({ userId, limit: 20 });
    if (recalled.ok) {
      // Delete every matching memory, not just the first — the model can call `remember`
      // more than once during a setup turn (e.g. restating a preference while explaining
      // it), leaving a second matching row that would otherwise survive deletion.
      const matches = recalled.data.filter((m) => m.content.toLowerCase().includes(substring));
      await Promise.all(matches.map((m) => deleteMemory(m.memoryId, userId)));
    }
    // Verify immediately, before the final (memory-enabled) question turn runs — that turn
    // can itself call `remember` on unrelated content, which would otherwise be mistaken
    // for a failed deletion.
    const reChecked = await recallMemories({ userId, limit: 20 });
    hygieneDeleteVerified =
      reChecked.ok && !reChecked.data.some((m) => m.content.toLowerCase().includes(substring));
  }

  if (question.hygieneVariant === 'stale' && question.staleClaim) {
    const result = await sendChatMessage(userId, question.staleClaim, { memoryEnabled });
    allToolCalls.push(...result.toolCalls);
  }

  const final = await sendChatMessage(userId, question.question, { memoryEnabled });
  allToolCalls.push(...final.toolCalls);

  return { reply: final.reply, toolCalls: allToolCalls, hygieneDeleteVerified };
}
