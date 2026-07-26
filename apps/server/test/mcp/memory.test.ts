import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool } from '../../src/db/client.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { getDemoUserId } from '../../src/adapter/demoUser.js';
import { recallTool, rememberTool } from '../../src/mcp/tools/memory.js';

describe('memory tools', () => {
  let userId: string;

  beforeAll(async () => {
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    userId = await getDemoUserId();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('remembers a fact and recalls it with no filter', async () => {
    const remembered = await rememberTool(userId, {
      content: 'I prefer aggressive savings goals',
      tags: ['preference', 'savings'],
    });
    expect(remembered.ok).toBe(true);
    if (!remembered.ok) return;
    expect(remembered.data.memoryId).toEqual(expect.any(String));

    const recalled = await recallTool(userId, {});
    expect(recalled.ok).toBe(true);
    if (!recalled.ok) return;
    expect(recalled.data.some((m) => m.memoryId === remembered.data.memoryId)).toBe(true);
    const match = recalled.data.find((m) => m.memoryId === remembered.data.memoryId);
    expect(match).toEqual({
      memoryId: remembered.data.memoryId,
      type: 'explicit',
      content: 'I prefer aggressive savings goals',
      tags: ['preference', 'savings'],
      createdAt: expect.any(String),
    });
  });

  it('recall with a non-matching tag returns empty', async () => {
    await rememberTool(userId, { content: 'Never recommend crypto', tags: ['rule'] });
    const recalled = await recallTool(userId, { tags: ['no-such-tag'] });
    expect(recalled).toEqual({ ok: true, data: [] });
  });

  it('surfaces both facts after a second, unrelated remember call, most recent first', async () => {
    const first = await rememberTool(userId, { content: 'First distinct fact', tags: ['fact-a'] });
    const second = await rememberTool(userId, { content: 'Second distinct fact', tags: ['fact-b'] });
    if (!first.ok || !second.ok) throw new Error('setup failed');

    const recalled = await recallTool(userId, {});
    if (!recalled.ok) throw new Error('recall failed');
    const ids = recalled.data.map((m) => m.memoryId);
    expect(ids).toContain(first.data.memoryId);
    expect(ids).toContain(second.data.memoryId);
    expect(ids.indexOf(second.data.memoryId)).toBeLessThan(ids.indexOf(first.data.memoryId));
  });
});
