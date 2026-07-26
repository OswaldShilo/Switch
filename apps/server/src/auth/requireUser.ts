import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getOrCreateUserByEmail } from '../adapter/users.js';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'SUPABASE_JWT_SECRET is not set' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice('Bearer '.length), secret) as { email?: string };
    if (!payload.email) {
      res.status(401).json({ error: 'Token has no email claim' });
      return;
    }
    req.userId = await getOrCreateUserByEmail(payload.email);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
