import { Router } from 'express';
import { accountsRouter } from './accounts.js';
import { consentsRouter } from './consents.js';
import { summaryRouter } from './summary.js';
import { transactionsRouter } from './transactions.js';

export const apiRouter = Router();
apiRouter.use(accountsRouter);
apiRouter.use(consentsRouter);
apiRouter.use(summaryRouter);
apiRouter.use(transactionsRouter);
