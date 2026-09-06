import { Router } from 'express';
import { listAccountsForUser } from '../adapter/accounts.js';
import { requireUser } from '../auth/requireUser.js';

export const accountsRouter = Router();

accountsRouter.get('/accounts', requireUser, async (req, res) => {
  const accounts = await listAccountsForUser(req.userId!);
  res.json(accounts);
});
