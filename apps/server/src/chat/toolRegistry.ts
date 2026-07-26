import { z } from 'zod';
import type { ToolResult } from '../adapter/types.js';
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
} from '../mcp/schemas.js';
import { fetchAccountsTool } from '../mcp/tools/accounts.js';
import { listSupportedBanksTool } from '../mcp/tools/banks.js';
import { categorizeTransactionsTool } from '../mcp/tools/categorize.js';
import { checkConsentStatusTool, getConsentDetailsTool, initiateConsentTool } from '../mcp/tools/consent.js';
import { getDataStatusTool, requestFinancialDataTool } from '../mcp/tools/dataFetch.js';
import { recallTool, rememberTool } from '../mcp/tools/memory.js';
import { summarizeFinancesTool } from '../mcp/tools/summarize.js';
import { fetchTransactionsTool } from '../mcp/tools/transactions.js';

export interface ChatToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (userId: string, args: unknown) => Promise<ToolResult<unknown>>;
}

// Wraps every MCP tool (10 from M1/M2 + remember/recall from M4) behind one array so the
// Anthropic tool-calling loop (chatService.ts) and the MCP server (mcp/server.ts) draw from
// the same underlying *Tool functions without duplicating adapter logic. Each handler copies
// the exact snake_case-arg -> camelCase-field mapping mcp/server.ts already applies per tool,
// since Anthropic's tool_use input mirrors the same Zod schemas (input_schema is derived from
// them via zod-to-json-schema in chatService.ts).
export const CHAT_TOOLS: ChatToolDef[] = [
  {
    name: 'list_supported_banks',
    description: 'List AA-supported banks in mock mode',
    inputSchema: z.object({}),
    handler: async (userId) => listSupportedBanksTool(userId),
  },
  {
    name: 'initiate_consent',
    description: 'Start an AA consent request for a bank account',
    inputSchema: initiateConsentInputSchema,
    handler: async (userId, rawArgs) => {
      const args = initiateConsentInputSchema.parse(rawArgs);
      return initiateConsentTool(userId, {
        mobile: args.mobile,
        fipId: args.fip_id,
        purpose: args.purpose,
        fromDate: args.from_date,
        toDate: args.to_date,
        expiryDays: args.expiry_days,
        fiTypes: args.fi_types,
      });
    },
  },
  {
    name: 'check_consent_status',
    description: 'Check the status of a previously initiated consent',
    inputSchema: checkConsentStatusInputSchema,
    handler: async (userId, rawArgs) => {
      const args = checkConsentStatusInputSchema.parse(rawArgs);
      return checkConsentStatusTool(userId, { consentId: args.consent_id });
    },
  },
  {
    name: 'get_consent_details',
    description: 'Get the full details of a consent (purpose, FI types, date range, expiry)',
    inputSchema: getConsentDetailsInputSchema,
    handler: async (userId, rawArgs) => {
      const args = getConsentDetailsInputSchema.parse(rawArgs);
      return getConsentDetailsTool(userId, { consentId: args.consent_id });
    },
  },
  {
    name: 'request_financial_data',
    description: 'Kick off a financial institution data fetch for an active consent',
    inputSchema: requestFinancialDataInputSchema,
    handler: async (userId, rawArgs) => {
      const args = requestFinancialDataInputSchema.parse(rawArgs);
      return requestFinancialDataTool(userId, { consentId: args.consent_id });
    },
  },
  {
    name: 'get_data_status',
    description: 'Poll the status of a financial data fetch session',
    inputSchema: getDataStatusInputSchema,
    handler: async (userId, rawArgs) => {
      const args = getDataStatusInputSchema.parse(rawArgs);
      return getDataStatusTool(userId, { sessionId: args.session_id });
    },
  },
  {
    name: 'fetch_accounts',
    description: 'List accounts fetched under an active consent',
    inputSchema: fetchAccountsInputSchema,
    handler: async (userId, rawArgs) => {
      const args = fetchAccountsInputSchema.parse(rawArgs);
      return fetchAccountsTool(userId, { consentId: args.consent_id });
    },
  },
  {
    name: 'fetch_transactions',
    description: 'Fetch paginated transactions for an account',
    inputSchema: fetchTransactionsInputSchema,
    handler: async (userId, rawArgs) => {
      const args = fetchTransactionsInputSchema.parse(rawArgs);
      return fetchTransactionsTool(userId, {
        accountId: args.account_id,
        from: args.from,
        to: args.to,
        category: args.category,
        limit: args.limit,
        cursor: args.cursor,
      });
    },
  },
  {
    name: 'categorize_transactions',
    description: "Categorize an account's transactions using the rule engine first, LLM fallback second",
    inputSchema: categorizeTransactionsInputSchema,
    handler: async (userId, rawArgs) => {
      const args = categorizeTransactionsInputSchema.parse(rawArgs);
      return categorizeTransactionsTool(userId, { accountId: args.account_id, force: args.force });
    },
  },
  {
    name: 'summarize_finances',
    description: 'Compute SQL-aggregated financial metrics for an account over a date range',
    inputSchema: summarizeFinancesInputSchema,
    handler: async (userId, rawArgs) => {
      const args = summarizeFinancesInputSchema.parse(rawArgs);
      return summarizeFinancesTool(userId, {
        accountId: args.account_id,
        period: args.period,
        metrics: args.metrics,
      });
    },
  },
  {
    name: 'remember',
    description: 'Store an explicit fact, preference, or standing rule the user asked to be remembered',
    inputSchema: rememberInputSchema,
    handler: async (userId, rawArgs) => {
      const args = rememberInputSchema.parse(rawArgs);
      return rememberTool(userId, { type: args.type, content: args.content, tags: args.tags });
    },
  },
  {
    name: 'recall',
    description: 'Recall previously remembered facts, preferences, or rules, filtered by tags or a text query',
    inputSchema: recallInputSchema,
    handler: async (userId, rawArgs) => {
      const args = recallInputSchema.parse(rawArgs);
      return recallTool(userId, { query: args.query, tags: args.tags, limit: args.limit });
    },
  },
];
