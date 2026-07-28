import type { NextFunction, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { getOrCreateUserByEmail } from '../adapter/users.js';

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

// Verified via Supabase's Auth API (auth.getUser) rather than local JWT
// verification: this project signs tokens with an asymmetric key (ES256),
// not the legacy shared SUPABASE_JWT_SECRET, so a local jwt.verify() call
// can't check the signature. Asking Supabase directly also catches revoked
// sessions, which a pure signature check wouldn't.
let supabase: ReturnType<typeof createClient> | undefined;
function getSupabase() {
  // createClient itself throws a clear error if SUPABASE_URL/SUPABASE_ANON_KEY
  // are missing, so no separate guard is needed here.
  if (!supabase) {
    supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  }
  return supabase;
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }
  try {
    const { data, error } = await getSupabase().auth.getUser(header.slice('Bearer '.length));
    if (error || !data.user?.email) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    req.userId = await getOrCreateUserByEmail(data.user.email);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
