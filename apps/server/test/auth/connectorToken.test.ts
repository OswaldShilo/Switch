import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { connectorTokens, users } from '../../src/db/schema.js';
import { getOrCreateUserByEmail } from '../../src/adapter/users.js';
import {
  createConnectorToken,
  revokeConnectorToken,
  verifyConnectorToken,
} from '../../src/auth/connectorToken.js';

const TEST_EMAIL = 'connector-token-spec@switch.app';
const OTHER_EMAIL = 'connector-token-spec-other@switch.app';

describe('connectorToken', () => {
  afterAll(async () => {
    const userId = await getOrCreateUserByEmail(TEST_EMAIL);
    const otherUserId = await getOrCreateUserByEmail(OTHER_EMAIL);
    await db.delete(connectorTokens).where(eq(connectorTokens.userId, userId));
    await db.delete(connectorTokens).where(eq(connectorTokens.userId, otherUserId));
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(users).where(eq(users.id, otherUserId));
    await pool.end();
  });

  it('creates a token and verifies it resolves the right userId', async () => {
    const userId = await getOrCreateUserByEmail(TEST_EMAIL);
    const { token, tokenId } = await createConnectorToken(userId);

    expect(token).toMatch(/^switch_[0-9a-f]{64}$/);
    expect(tokenId).toEqual(expect.any(String));

    const resolved = await verifyConnectorToken(token);
    expect(resolved).toBe(userId);
  });

  it('never stores the raw token, only its hash', async () => {
    const userId = await getOrCreateUserByEmail(TEST_EMAIL);
    const { token, tokenId } = await createConnectorToken(userId);

    const [row] = await db.select().from(connectorTokens).where(eq(connectorTokens.id, tokenId));
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns null for an unknown token', async () => {
    const resolved = await verifyConnectorToken('switch_not-a-real-token');
    expect(resolved).toBeNull();
  });

  it('fails verification for a revoked token', async () => {
    const userId = await getOrCreateUserByEmail(TEST_EMAIL);
    const { token, tokenId } = await createConnectorToken(userId);

    expect(await verifyConnectorToken(token)).toBe(userId);

    const revoked = await revokeConnectorToken(tokenId, userId);
    expect(revoked).toBe(true);

    expect(await verifyConnectorToken(token)).toBeNull();
  });

  it('revokeConnectorToken returns false for a token owned by a different user', async () => {
    const userId = await getOrCreateUserByEmail(TEST_EMAIL);
    const otherUserId = await getOrCreateUserByEmail(OTHER_EMAIL);
    const { tokenId } = await createConnectorToken(userId);

    const revoked = await revokeConnectorToken(tokenId, otherUserId);
    expect(revoked).toBe(false);

    // still valid afterwards
    const [row] = await db.select().from(connectorTokens).where(eq(connectorTokens.id, tokenId));
    expect(row.revokedAt).toBeNull();
  });
});
