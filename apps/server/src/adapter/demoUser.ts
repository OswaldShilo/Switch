import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';

export const DEMO_USER_EMAIL = 'demo@switch.app';

export async function getDemoUserId(): Promise<string> {
  const [user] = await db.select().from(users).where(eq(users.email, DEMO_USER_EMAIL));
  if (!user) {
    throw new Error(`Demo user not found. Run "pnpm db:seed" first.`);
  }
  return user.id;
}
