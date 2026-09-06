import { Router } from 'express';
import {
  createConnectorToken,
  listConnectorTokensForUser,
  revokeConnectorToken,
} from '../auth/connectorToken.js';
import { requireUser } from '../auth/requireUser.js';

export const connectorTokensRouter = Router();

// Token management stays behind the existing Supabase-authenticated requireUser —
// only /mcp itself uses the bearer connector tokens minted here.
connectorTokensRouter.post('/connector-tokens', requireUser, async (req, res) => {
  const result = await createConnectorToken(req.userId!);
  res.status(201).json(result);
});

connectorTokensRouter.get('/connector-tokens', requireUser, async (req, res) => {
  const rows = await listConnectorTokensForUser(req.userId!);
  res.json(rows);
});

connectorTokensRouter.post('/connector-tokens/:id/revoke', requireUser, async (req, res) => {
  const ok = await revokeConnectorToken(req.params.id, req.userId!);
  if (!ok) {
    res.status(404).json({ error: 'Token not found' });
    return;
  }
  res.json({ ok: true });
});
