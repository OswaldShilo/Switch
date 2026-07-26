import { Router } from 'express';
import { deleteMemory } from '../adapter/memory.js';
import { requireUser } from '../auth/requireUser.js';
import { recallTool } from '../mcp/tools/memory.js';

export const memoriesRouter = Router();

memoriesRouter.get('/memories', requireUser, async (req, res) => {
  const result = await recallTool(req.userId!, { limit: 100 });
  res.json(result.ok ? result.data : result.error);
});

// Deletion is a dashboard-only action (mirrors M3's revoke_consent precedent) — not part of
// the MCP tool surface, so it goes straight through adapter/memory.ts's deleteMemory rather
// than a *Tool wrapper.
memoriesRouter.delete('/memories/:id', requireUser, async (req, res) => {
  const result = await deleteMemory(req.params.id, req.userId!);
  if (!result.ok) {
    res.status(404).json(result.error);
    return;
  }
  res.json(result.data);
});
