import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { auditLog } from '../../src/db/schema.js';
import { runSeed } from '../../src/db/seed/seed.js';
import { getDemoUserId } from '../../src/adapter/demoUser.js';
import { createMcpServer, TOOL_NAMES } from '../../src/mcp/server.js';

describe('createMcpServer', () => {
  let client: Client;
  let userId: string;

  beforeAll(async () => {
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    userId = await getDemoUserId();

    const server = createMcpServer(userId);
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '0.0.1' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('registers exactly the 12 M1+M2+M4 tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
  });

  it('calls list_supported_banks end-to-end over the MCP protocol', async () => {
    const result = await client.callTool({ name: 'list_supported_banks', arguments: {} });
    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    const banks = JSON.parse(text);
    expect(banks.map((b: { name: string }) => b.name)).toEqual(['HDFC Bank', 'ICICI Bank']);
  });

  it('surfaces adapter errors as MCP tool errors', async () => {
    const result = await client.callTool({
      name: 'check_consent_status',
      arguments: { consent_id: '00000000-0000-0000-0000-000000000000' },
    });
    expect(result.isError).toBe(true);
  });

  it('scopes tool calls to the userId passed into createMcpServer, not an internally-resolved demo user', async () => {
    await client.callTool({ name: 'list_supported_banks', arguments: {} });
    const [row] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.tool, 'list_supported_banks'))
      .orderBy(desc(auditLog.createdAt))
      .limit(1);
    expect(row.userId).toBe(userId);
  });
});
