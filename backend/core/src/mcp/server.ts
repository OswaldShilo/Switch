import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { fetchAccountsTool } from './tools/accounts.js';
import { listSupportedBanksTool } from './tools/banks.js';
import { categorizeTransactionsTool } from './tools/categorize.js';
import { checkConsentStatusTool, getConsentDetailsTool, initiateConsentTool } from './tools/consent.js';
import { getDataStatusTool, requestFinancialDataTool } from './tools/dataFetch.js';
import { recallTool, rememberTool } from './tools/memory.js';
import { summarizeFinancesTool } from './tools/summarize.js';
import { fetchTransactionsTool } from './tools/transactions.js';
import {
  categorizeTransactionsInputSchema,
  checkConsentStatusInputSchema,
  fetchAccountsInputSchema,
  fetchTransactionsInputSchema,
  getConsentDetailsInputSchema,
  getDataStatusInputSchema,
  initiateConsentInputSchema,
  recallInputSchema,
  rememberInputSchema,
  requestFinancialDataInputSchema,
  summarizeFinancesInputSchema,
} from './schemas.js';

export const TOOL_NAMES = [
  'list_supported_banks',
  'initiate_consent',
  'check_consent_status',
  'get_consent_details',
  'request_financial_data',
  'get_data_status',
  'fetch_accounts',
  'fetch_transactions',
  'categorize_transactions',
  'summarize_finances',
  'remember',
  'recall',
] as const;

function toContent(result: { ok: boolean; data?: unknown; error?: unknown }) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result.ok ? result.data : result.error) }],
    isError: !result.ok,
  };
}

export function createMcpServer(userId: string): McpServer {
  const server = new McpServer({ name: 'switch-aa-connect', version: '0.1.0' });

  server.tool('list_supported_banks', 'List AA-supported banks in mock mode', {}, async () => {
    return toContent(await listSupportedBanksTool(userId));
  });

  server.tool(
    'initiate_consent',
    'Start an AA consent request for a bank account',
    initiateConsentInputSchema.shape,
    async (args) => {
      return toContent(
        await initiateConsentTool(userId, {
          mobile: args.mobile,
          fipId: args.fip_id,
          purpose: args.purpose,
          fromDate: args.from_date,
          toDate: args.to_date,
          expiryDays: args.expiry_days,
          fiTypes: args.fi_types,
        })
      );
    }
  );

  server.tool(
    'check_consent_status',
    'Check the status of a previously initiated consent',
    checkConsentStatusInputSchema.shape,
    async (args) => {
      return toContent(await checkConsentStatusTool(userId, { consentId: args.consent_id }));
    }
  );

  server.tool(
    'get_consent_details',
    'Get the full details of a consent (purpose, FI types, date range, expiry)',
    getConsentDetailsInputSchema.shape,
    async (args) => {
      return toContent(await getConsentDetailsTool(userId, { consentId: args.consent_id }));
    }
  );

  server.tool(
    'request_financial_data',
    'Kick off a financial institution data fetch for an active consent',
    requestFinancialDataInputSchema.shape,
    async (args) => {
      return toContent(await requestFinancialDataTool(userId, { consentId: args.consent_id }));
    }
  );

  server.tool(
    'get_data_status',
    'Poll the status of a financial data fetch session',
    getDataStatusInputSchema.shape,
    async (args) => {
      return toContent(await getDataStatusTool(userId, { sessionId: args.session_id }));
    }
  );

  server.tool(
    'fetch_accounts',
    'List accounts fetched under an active consent',
    fetchAccountsInputSchema.shape,
    async (args) => {
      return toContent(await fetchAccountsTool(userId, { consentId: args.consent_id }));
    }
  );

  server.tool(
    'fetch_transactions',
    'Fetch paginated transactions for an account',
    fetchTransactionsInputSchema.shape,
    async (args) => {
      return toContent(
        await fetchTransactionsTool(userId, {
          accountId: args.account_id,
          from: args.from,
          to: args.to,
          category: args.category,
          limit: args.limit,
          cursor: args.cursor,
        })
      );
    }
  );

  server.tool(
    'categorize_transactions',
    'Categorize an account\'s transactions using the rule engine first, LLM fallback second',
    categorizeTransactionsInputSchema.shape,
    async (args) => {
      return toContent(
        await categorizeTransactionsTool(userId, { accountId: args.account_id, force: args.force })
      );
    }
  );

  server.tool(
    'summarize_finances',
    'Compute SQL-aggregated financial metrics for an account over a date range',
    summarizeFinancesInputSchema.shape,
    async (args) => {
      return toContent(
        await summarizeFinancesTool(userId, {
          accountId: args.account_id,
          period: args.period,
          metrics: args.metrics,
        })
      );
    }
  );

  server.tool(
    'remember',
    'Store an explicit fact, preference, or standing rule the user asked to be remembered',
    rememberInputSchema.shape,
    async (args) => {
      return toContent(await rememberTool(userId, { type: args.type, content: args.content, tags: args.tags }));
    }
  );

  server.tool(
    'recall',
    'Recall previously remembered facts, preferences, or rules, filtered by tags or a text query',
    recallInputSchema.shape,
    async (args) => {
      return toContent(await recallTool(userId, { query: args.query, tags: args.tags, limit: args.limit }));
    }
  );

  return server;
}
