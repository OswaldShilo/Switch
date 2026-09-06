import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { connectorTokens } from '../db/schema.js';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface ConnectorTokenSummary {
  tokenId: string;
  createdAt: string;
  revokedAt: string | null;
}

export async function createConnectorToken(userId: string): Promise<{ token: string; tokenId: string }> {
  const token = `switch_${randomBytes(32).toString('hex')}`;
  const [row] = await db.insert(connectorTokens).values({ userId, tokenHash: hashToken(token) }).returning();
  return { token, tokenId: row.id };
}

export async function verifyConnectorToken(token: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(connectorTokens)
    .where(and(eq(connectorTokens.tokenHash, hashToken(token)), isNull(connectorTokens.revokedAt)));
  return row?.userId ?? null;
}

export async function revokeConnectorToken(tokenId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(connectorTokens)
    .where(and(eq(connectorTokens.id, tokenId), eq(connectorTokens.userId, userId)));
  if (!row) return false;
  await db.update(connectorTokens).set({ revokedAt: new Date() }).where(eq(connectorTokens.id, tokenId));
  return true;
}

export async function listConnectorTokensForUser(userId: string): Promise<ConnectorTokenSummary[]> {
  const rows = await db.select().from(connectorTokens).where(eq(connectorTokens.userId, userId));
  return rows.map((r) => ({
    tokenId: r.id,
    createdAt: r.createdAt.toISOString(),
    revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
  }));
}
