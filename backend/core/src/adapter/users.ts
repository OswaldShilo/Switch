import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';

export async function getOrCreateUserByEmail(email: string): Promise<string> {
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) return existing.id;
  const [created] = await db.insert(users).values({ email }).returning();
  return created.id;
}
