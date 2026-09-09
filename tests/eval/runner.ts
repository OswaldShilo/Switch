import { sendChatMessage } from '../../backend/core/src/chat/chatService.js';
import { recallMemories, deleteMemory } from '../../backend/core/src/adapter/memory.js';
import type { EvalQuestion } from './types.js';

export interface QuestionRun {
  reply: string;
  toolCalls: string[];
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

  if (question.hygieneVariant === 'delete' && question.deletedFactSubstring) {
    const recalled = await recallMemories({ userId, limit: 20 });
    if (recalled.ok) {
      const match = recalled.data.find((m) =>
        m.content.toLowerCase().includes(question.deletedFactSubstring!.toLowerCase())
      );
      if (match) await deleteMemory(match.memoryId, userId);
    }
  }

  if (question.hygieneVariant === 'stale' && question.staleClaim) {
    const result = await sendChatMessage(userId, question.staleClaim, { memoryEnabled });
    allToolCalls.push(...result.toolCalls);
  }

  const final = await sendChatMessage(userId, question.question, { memoryEnabled });
  allToolCalls.push(...final.toolCalls);

  return { reply: final.reply, toolCalls: allToolCalls };
}
