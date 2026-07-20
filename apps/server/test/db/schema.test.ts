import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../src/db/client.js';

const EXPECTED_TABLES = [
  'users',
  'connector_tokens',
  'consents',
  'accounts',
  'transactions',
  'category_rules',
  'memories',
  'chat_messages',
  'audit_log',
];

describe('database schema', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('creates all expected tables', async () => {
    const result = await db.execute(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const tableNames = (result.rows as Array<{ table_name: string }>).map((r) => r.table_name);
    for (const table of EXPECTED_TABLES) {
      expect(tableNames).toContain(table);
    }
  });
});
