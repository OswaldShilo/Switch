import type { NextFunction, Request, Response } from 'express';
import { verifyConnectorToken } from './connectorToken.js';

export async function requireConnectorToken(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }
  const token = header.slice('Bearer '.length);
  const userId = await verifyConnectorToken(token);
  if (!userId) {
    res.status(401).json({ error: 'Invalid or revoked token' });
    return;
  }
  req.userId = userId;
  next();
}
