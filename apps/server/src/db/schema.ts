import {
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  integer,
  text,
  timestamp,
  date,
  uuid,
} from 'drizzle-orm/pg-core';

export const consentStatusEnum = pgEnum('consent_status', [
  'PENDING',
  'ACTIVE',
  'REJECTED',
  'REVOKED',
  'EXPIRED',
]);

export const directionEnum = pgEnum('txn_direction', ['credit', 'debit']);

export const categorizedByEnum = pgEnum('categorized_by', ['rule', 'llm', 'user']);

export const memoryTypeEnum = pgEnum('memory_type', ['explicit', 'implicit']);

export const auditActorEnum = pgEnum('audit_actor', ['mcp', 'web']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const connectorTokens = pgTable('connector_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const consents = pgTable('consents', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  fipId: text('fip_id').notNull(),
  aaConsentId: text('aa_consent_id'),
  status: consentStatusEnum('status').notNull().default('PENDING'),
  purpose: text('purpose').notNull(),
  fiTypes: text('fi_types').array().notNull(),
  fromDate: date('from_date').notNull(),
  toDate: date('to_date').notNull(),
  expiryAt: timestamp('expiry_at', { withTimezone: true }).notNull(),
  dataLife: text('data_life'),
  rawJson: jsonb('raw_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  consentId: uuid('consent_id').notNull().references(() => consents.id),
  bank: text('bank').notNull(),
  type: text('type').notNull(),
  maskedNumber: text('masked_number').notNull(),
  balance: numeric('balance', { precision: 14, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('INR'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
});

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  txnDate: date('txn_date').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  direction: directionEnum('direction').notNull(),
  narration: text('narration').notNull(),
  merchant: text('merchant'),
  category: text('category'),
  confidence: numeric('confidence', { precision: 3, scale: 2 }),
  categorizedBy: categorizedByEnum('categorized_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const categoryRules = pgTable('category_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  pattern: text('pattern').notNull(),
  category: text('category').notNull(),
  priority: integer('priority').notNull().default(0),
});

export const memories = pgTable('memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  type: memoryTypeEnum('type').notNull(),
  content: text('content').notNull(),
  tags: text('tags').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  role: text('role').notNull(),
  content: text('content').notNull(),
  toolCallsJson: jsonb('tool_calls_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id),
  actor: auditActorEnum('actor').notNull(),
  tool: text('tool').notNull(),
  inputHash: text('input_hash').notNull(),
  status: text('status').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
