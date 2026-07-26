import { and, arrayOverlaps, desc, eq, ilike, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { memories } from '../db/schema.js';
import type { ToolResult } from './types.js';

const DEFAULT_RECALL_LIMIT = 10;

export interface RememberInput {
  userId: string;
  type?: 'explicit' | 'implicit';
  content: string;
  tags: string[];
}

export interface RecallInput {
  userId: string;
  query?: string;
  tags?: string[];
  limit?: number;
}

export interface MemorySummary {
  memoryId: string;
  type: 'explicit' | 'implicit';
  content: string;
  tags: string[];
  createdAt: string;
}

export async function rememberMemory(input: RememberInput): Promise<ToolResult<{ memoryId: string }>> {
  const [memory] = await db
    .insert(memories)
    .values({
      userId: input.userId,
      type: input.type ?? 'explicit',
      content: input.content,
      tags: input.tags,
    })
    .returning();

  return { ok: true, data: { memoryId: memory.id } };
}

export async function recallMemories(input: RecallInput): Promise<ToolResult<MemorySummary[]>> {
  const conditions = [eq(memories.userId, input.userId), isNull(memories.deletedAt)];
  if (input.tags && input.tags.length > 0) {
    conditions.push(arrayOverlaps(memories.tags, input.tags));
  }
  if (input.query) {
    conditions.push(ilike(memories.content, `%${input.query}%`));
  }

  const rows = await db
    .select()
    .from(memories)
    .where(and(...conditions))
    .orderBy(desc(memories.createdAt))
    .limit(input.limit ?? DEFAULT_RECALL_LIMIT);

  return {
    ok: true,
    data: rows.map((r) => ({
      memoryId: r.id,
      type: r.type,
      content: r.content,
      tags: r.tags,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function deleteMemory(memoryId: string, userId: string): Promise<ToolResult<{ deleted: true }>> {
  const [memory] = await db.select().from(memories).where(eq(memories.id, memoryId));
  if (!memory || memory.userId !== userId) {
    return { ok: false, error: { code: 'MEMORY_NOT_FOUND', message: `No memory with id "${memoryId}"` } };
  }
  await db.update(memories).set({ deletedAt: new Date() }).where(eq(memories.id, memoryId));
  return { ok: true, data: { deleted: true } };
}
