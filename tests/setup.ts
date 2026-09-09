import fs from 'fs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import { vi } from 'vitest';

// Load .env files for tests
function loadEnvFile(envPath: string) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf-8');
  content.split('\n').forEach((line) => {
    const [key, ...valueParts] = line.split('=');
    if (key && !key.startsWith('#')) {
      const value = valueParts.join('=').trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.join(__dirname, '.env'));
loadEnvFile(path.join(__dirname, '..', 'backend', 'core', '.env'));

// requireUser.ts verifies bearer tokens via Supabase's real Auth API
// (auth.getUser), since this project signs tokens with an asymmetric key that
// a local jwt.verify() can't check. Tests still mint tokens locally with
// jsonwebtoken and set SUPABASE_JWT_SECRET per-file, so this mock replicates
// that same HS256 shared-secret verification in place of a real network call
// to Supabase — every existing test file's tokenFor()/SUPABASE_JWT_SECRET
// setup keeps working unchanged.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      async getUser(token: string) {
        try {
          const secret = process.env.SUPABASE_JWT_SECRET;
          if (!secret) throw new Error('SUPABASE_JWT_SECRET is not set');
          const payload = jwt.verify(token, secret) as { email?: string };
          if (!payload.email) throw new Error('Token has no email claim');
          return { data: { user: { email: payload.email } }, error: null };
        } catch (err) {
          return { data: { user: null }, error: err as Error };
        }
      },
    },
  }),
}));
