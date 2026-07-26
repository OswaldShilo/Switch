import { Router } from 'express';
import { accountsRouter } from './accounts.js';
import { chatRouter } from './chat.js';
import { consentsRouter } from './consents.js';
import { memoriesRouter } from './memories.js';
import { summaryRouter } from './summary.js';
import { transactionsRouter } from './transactions.js';

export const apiRouter = Router();
apiRouter.use(accountsRouter);
apiRouter.use(chatRouter);
apiRouter.use(consentsRouter);
apiRouter.use(memoriesRouter);
apiRouter.use(summaryRouter);
apiRouter.use(transactionsRouter);
