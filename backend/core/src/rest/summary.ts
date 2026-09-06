import { Router } from 'express';
import { assertAccountOwnership } from '../adapter/accounts.js';
import { summarizeFinances, type Metric } from '../adapter/summarize.js';
import { requireUser } from '../auth/requireUser.js';

export const summaryRouter = Router();

summaryRouter.get('/accounts/:id/summary', requireUser, async (req, res) => {
  const owns = await assertAccountOwnership(req.params.id, req.userId!);
  if (!owns) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  const metrics = (req.query.metrics as string | undefined)?.split(',') as Metric[] | undefined;
  const from = (req.query.from as string) ?? '1970-01-01';
  const to = (req.query.to as string) ?? '2999-12-31';
  const result = await summarizeFinances({
    accountId: req.params.id,
    period: { from, to },
    metrics: metrics ?? ['spend_by_category', 'income', 'savings_rate', 'recurring_subscriptions', 'top_merchants', 'mom_trend'],
  });
  res.json(result.ok ? result.data : result.error);
});
