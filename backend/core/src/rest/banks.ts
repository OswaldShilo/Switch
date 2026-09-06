import { Router } from 'express';
import { getAdapter } from '../adapter/index.js';
import { requireUser } from '../auth/requireUser.js';

export const banksRouter = Router();

banksRouter.get('/banks', requireUser, async (_req, res) => {
  const banks = await getAdapter().listSupportedBanks();
  res.json(banks);
});
