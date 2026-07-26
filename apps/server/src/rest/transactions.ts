import { Router } from 'express';
import { assertAccountOwnership } from '../adapter/accounts.js';
import { fetchTransactions } from '../adapter/transactions.js';
import { requireUser } from '../auth/requireUser.js';

export const transactionsRouter = Router();

transactionsRouter.get('/accounts/:id/transactions', requireUser, async (req, res) => {
  const owns = await assertAccountOwnership(req.params.id, req.userId!);
  if (!owns) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  const from = req.query.from as string | undefined;
  const to = req.query.to as string | undefined;
  const category = req.query.category as string | undefined;
  const limit = req.query.limit ? Number.parseInt(req.query.limit as string, 10) : undefined;
  const cursor = req.query.cursor as string | undefined;

  const result = await fetchTransactions({
    accountId: req.params.id,
    from,
    to,
    category,
    limit,
    cursor,
  });
  res.json(result.ok ? result.data : result.error);
});
