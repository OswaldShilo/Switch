# M0 — Monorepo Scaffold + Mock Dataset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the pnpm monorepo skeleton, migrate the full Postgres schema via Drizzle against a local Dockerized Postgres, and seed a deterministic 6-month mock financial dataset (2 accounts, 400 transactions) — so every later milestone (M1 MCP core, M2 categorize/aggregate, M3 dashboard, M4 chat/memory, M5 Finvu adapter) has real data to build against without depending on any external account or the Finvu sandbox.

**Architecture:** `apps/server` is a Node/TypeScript package holding the Drizzle schema, migration runner, and a two-stage seed system: a pure, deterministic `generateMockDataset()` function (no I/O, unit-tested) feeding an idempotent `runSeed()` database writer (integration-tested against a real Postgres instance running in Docker). `packages/shared` and `apps/web` are declared in the workspace but intentionally not created yet — they get scaffolded by the milestones that first need them (M1 and M3 respectively), per YAGNI.

**Tech Stack:** TypeScript (NodeNext), pnpm workspaces, Drizzle ORM + drizzle-kit, `pg` (node-postgres) driver, `date-fns`, Vitest, `tsx`, Docker Compose (Postgres 16).

## Global Constraints

- Language: TypeScript end-to-end (per project spec `ideas/prd.md` §6).
- Package manager: pnpm workspaces, root packages at `apps/*` and `packages/*` (per spec §6). Confirmed locally: pnpm 10.32.1, Node v24.13.0, Docker 29.4.1, Docker Compose v5.1.3.
- Database: Postgres via Drizzle ORM. For this milestone, target a **local Postgres 16 container via Docker Compose** — not a hosted Supabase project. Supabase (hosted Postgres + Auth) gets wired in by whichever later milestone first needs Auth or deployment; the schema is unchanged either way since Supabase is Postgres.
- Schema scope: create the full data model from spec §10 (9 tables) now, since it is already fully specified — except the `memories.embedding` vector column, which requires the `pgvector` Postgres extension and is explicitly P2/stretch (semantic recall) in the spec. Add that column in the milestone that implements semantic recall.
- All IDs are `uuid` primary keys generated via `gen_random_uuid()` (requires the `pgcrypto` extension, enabled by the migration runner).
- Seed data must be **deterministic** (same output every run for a given reference date) and **idempotent** (re-running the seed script never duplicates rows).
- Test runner: Vitest. Unit tests (pure functions) run with no external dependencies. Integration tests in this plan require the Docker Postgres container running and migrated first — this is stated explicitly in each task that needs it.
- Do not commit anything outside the files each task lists.

---

### Task 1: Workspace root + Docker Postgres

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `docker-compose.yml`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a running Postgres 16 container reachable at `postgresql://switch:switch_dev_password@localhost:5433/switch_dev`, and root pnpm workspace scripts (`db:up`, `db:down`) that later tasks/milestones extend.

- [ ] **Step 1: Create the pnpm workspace manifest**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 2: Create the root package.json**

`package.json`:
```json
{
  "name": "switch-monorepo",
  "private": true,
  "packageManager": "pnpm@10.32.1",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "db:up": "docker compose up -d postgres",
    "db:down": "docker compose down"
  }
}
```

- [ ] **Step 3: Create .gitignore**

`.gitignore`:
```
node_modules/
dist/
.env
*.log
drizzle/
```

- [ ] **Step 4: Create .env.example**

`.env.example`:
```
DATABASE_URL=postgresql://switch:switch_dev_password@localhost:5433/switch_dev
```

- [ ] **Step 5: Create docker-compose.yml**

`docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: switch-postgres
    environment:
      POSTGRES_USER: switch
      POSTGRES_PASSWORD: switch_dev_password
      POSTGRES_DB: switch_dev
    ports:
      - "5433:5432"
    volumes:
      - switch_pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U switch -d switch_dev"]
      interval: 2s
      timeout: 3s
      retries: 20

volumes:
  switch_pg_data:
```

- [ ] **Step 6: Start the container and verify it's healthy**

Run: `docker compose up -d postgres`
Then: `docker compose exec postgres pg_isready -U switch -d switch_dev`
Expected: `/var/run/postgresql:5432 - accepting connections`

- [ ] **Step 7: Commit**

```bash
git add pnpm-workspace.yaml package.json .gitignore .env.example docker-compose.yml
git commit -m "chore: scaffold pnpm workspace and local Postgres via Docker Compose"
```

---

### Task 2: apps/server package + Drizzle schema

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/vitest.config.ts`
- Create: `apps/server/.env` (local only, gitignored, copy of `.env.example`)
- Create: `apps/server/src/db/schema.ts`
- Create: `apps/server/src/db/client.ts`

**Interfaces:**
- Consumes: `DATABASE_URL` env var (from Task 1's `.env.example`, copied to a real `.env`).
- Produces: Drizzle table objects `users`, `connectorTokens`, `consents`, `accounts`, `transactions`, `categoryRules`, `memories`, `chatMessages`, `auditLog` and enums `consentStatusEnum`, `directionEnum`, `categorizedByEnum`, `memoryTypeEnum`, `auditActorEnum` from `schema.ts`; `db` (Drizzle instance) and `pool` (pg Pool) from `client.ts`. Later tasks in this plan, and all of M1+, import from these two files.

- [ ] **Step 1: Create apps/server/package.json**

`apps/server/package.json`:
```json
{
  "name": "@switch/server",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts",
    "db:seed": "tsx src/db/seed/run.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "date-fns": "^4.1.0",
    "dotenv": "^16.4.7",
    "drizzle-orm": "^0.36.4",
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "@types/pg": "^8.11.10",
    "drizzle-kit": "^0.28.1",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create apps/server/tsconfig.json**

`apps/server/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create apps/server/vitest.config.ts**

`apps/server/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 15000,
  },
});
```

- [ ] **Step 4: Create local env file**

Run:
```bash
cp .env.example apps/server/.env
```
(Windows PowerShell alternative: `Copy-Item .env.example apps/server/.env`)

- [ ] **Step 5: Write the Drizzle schema**

`apps/server/src/db/schema.ts`:
```ts
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
```

- [ ] **Step 6: Write the DB client**

`apps/server/src/db/client.ts`:
```ts
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
```

- [ ] **Step 7: Install dependencies**

Run: `pnpm install`
Expected: install completes with no errors; `apps/server/node_modules` (hoisted to root) present.

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @switch/server typecheck`
Expected: exits 0, no output (no type errors).

- [ ] **Step 9: Commit**

```bash
git add apps/server/package.json apps/server/tsconfig.json apps/server/vitest.config.ts apps/server/src/db/schema.ts apps/server/src/db/client.ts pnpm-lock.yaml
git commit -m "feat(server): scaffold apps/server package and full Drizzle schema"
```

---

### Task 3: Migration runner + schema verification test

**Files:**
- Create: `apps/server/drizzle.config.ts`
- Create: `apps/server/src/db/migrate.ts`
- Create: `apps/server/test/db/schema.test.ts`
- Modify: `apps/server/package.json` (already has `db:generate`/`db:migrate` scripts from Task 2 — no change needed, this task just implements what they call)

**Interfaces:**
- Consumes: `db`, `pool` from `client.ts` (Task 2).
- Produces: a migrated Postgres database (all 9 tables exist) that Tasks 4–6 and all of M1+ can query.

- [ ] **Step 1: Write the failing schema test**

`apps/server/test/db/schema.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Ensure the container from Task 1 is running (`docker compose up -d postgres`), then run:
`pnpm --filter @switch/server exec vitest run test/db/schema.test.ts`
Expected: FAIL — table names missing (no migration has run yet), or a connection/relation error.

- [ ] **Step 3: Write drizzle.config.ts**

`apps/server/drizzle.config.ts`:
```ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
```

- [ ] **Step 4: Write the migration runner**

`apps/server/src/db/migrate.ts`:
```ts
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: './drizzle' });
  await pool.end();
  console.log('Migrations complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 5: Generate the migration SQL from the schema**

Run: `pnpm --filter @switch/server db:generate`
Expected: creates `apps/server/drizzle/0000_<name>.sql` (and a `meta/` folder) containing `CREATE TYPE` statements for the 5 enums and `CREATE TABLE` statements for the 9 tables.

- [ ] **Step 6: Run the migration**

Run: `pnpm --filter @switch/server db:migrate`
Expected output: `Migrations complete`

- [ ] **Step 7: Run the test again and confirm it passes**

Run: `pnpm --filter @switch/server exec vitest run test/db/schema.test.ts`
Expected: PASS (1 test)

- [ ] **Step 8: Commit**

```bash
git add apps/server/drizzle.config.ts apps/server/src/db/migrate.ts apps/server/test/db/schema.test.ts apps/server/drizzle
git commit -m "feat(server): add Drizzle migration runner and generated migration"
```

---

### Task 4: Deterministic mock dataset generator (unit tested)

**Files:**
- Create: `apps/server/src/db/seed/mockData.ts`
- Test: `apps/server/test/db/mockData.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, no DB, no I/O).
- Produces: `generateMockDataset(now: Date): MockDataset` and types `MockDataset`, `MockAccount`, `MockTransaction`, consumed by Task 5's `runSeed()`.

- [ ] **Step 1: Write the failing unit test**

`apps/server/test/db/mockData.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { generateMockDataset } from '../../src/db/seed/mockData.js';

describe('generateMockDataset', () => {
  const dataset = generateMockDataset(new Date('2026-07-20T00:00:00Z'));

  it('creates exactly 2 accounts', () => {
    expect(dataset.accounts).toHaveLength(2);
    expect(dataset.accounts.map((a) => a.key)).toEqual(['acc1', 'acc2']);
  });

  it('creates exactly 400 transactions', () => {
    expect(dataset.transactions).toHaveLength(400);
  });

  it('creates exactly 6 monthly salary credits of ₹70,000', () => {
    const salaryTxns = dataset.transactions.filter((t) => t.narration.startsWith('SALARY CREDIT'));
    expect(salaryTxns).toHaveLength(6);
    for (const txn of salaryTxns) {
      expect(txn.direction).toBe('credit');
      expect(txn.amount).toBe('70000.00');
    }
  });

  it('creates exactly 6 monthly rent payments', () => {
    const rentTxns = dataset.transactions.filter((t) => t.narration.startsWith('NEFT RENT PAYMENT'));
    expect(rentTxns).toHaveLength(6);
    for (const txn of rentTxns) {
      expect(txn.direction).toBe('debit');
      expect(txn.amount).toBe('15000.00');
    }
  });

  it('creates exactly 36 subscription transactions across 6 distinct merchants', () => {
    const subMerchants = ['netflix', 'spotify', 'hotstar', 'amazonprime', 'icloud', 'gym'];
    const subTxns = dataset.transactions.filter((t) => t.merchant && subMerchants.includes(t.merchant));
    expect(subTxns).toHaveLength(36);
    for (const merchant of subMerchants) {
      expect(subTxns.filter((t) => t.merchant === merchant)).toHaveLength(6);
    }
  });

  it('produces a seasonal spike in shopping transactions in one month', () => {
    const shoppingTxns = dataset.transactions.filter(
      (t) => t.merchant === 'amazon' || t.merchant === 'myntra'
    );
    const byMonth = new Map<string, number>();
    for (const txn of shoppingTxns) {
      const ym = txn.txnDate.slice(0, 7);
      byMonth.set(ym, (byMonth.get(ym) ?? 0) + 1);
    }
    const counts = [...byMonth.values()].sort((a, b) => a - b);
    expect(counts[counts.length - 1]).toBeGreaterThan(counts[0] * 2);
  });

  it('spans exactly 6 distinct calendar months', () => {
    const months = new Set(dataset.transactions.map((t) => t.txnDate.slice(0, 7)));
    expect(months.size).toBe(6);
  });

  it('is deterministic for a fixed reference date', () => {
    const second = generateMockDataset(new Date('2026-07-20T00:00:00Z'));
    expect(second).toEqual(dataset);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @switch/server exec vitest run test/db/mockData.test.ts`
Expected: FAIL — cannot find module `../../src/db/seed/mockData.js`

- [ ] **Step 3: Implement the generator**

`apps/server/src/db/seed/mockData.ts`:
```ts
import { addMonths, getDaysInMonth, startOfMonth } from 'date-fns';

export interface MockAccount {
  key: 'acc1' | 'acc2';
  bank: string;
  type: string;
  maskedNumber: string;
  balance: string;
  currency: string;
}

export interface MockTransaction {
  accountKey: 'acc1' | 'acc2';
  txnDate: string;
  amount: string;
  direction: 'credit' | 'debit';
  narration: string;
  merchant: string | null;
}

export interface MockDataset {
  userEmail: string;
  accounts: MockAccount[];
  transactions: MockTransaction[];
}

const MONTHS = 6;
const SPIKE_MONTH_INDEX = 3;
const SPIKE_EXTRA_COUNT = 28;
const REGULAR_EVERYDAY_COUNT = 54;

interface EverydayTemplate {
  merchant: string;
  narration: string;
  baseAmount: number;
  step: number;
  accountKey: 'acc1' | 'acc2';
}

const EVERYDAY_TEMPLATES: EverydayTemplate[] = [
  { merchant: 'swiggy', narration: 'SWIGGY ORDER', baseAmount: 320, step: 15, accountKey: 'acc1' },
  { merchant: 'zomato', narration: 'ZOMATO ORDER', baseAmount: 280, step: 12, accountKey: 'acc1' },
  { merchant: 'uber', narration: 'UBER TRIP', baseAmount: 180, step: 20, accountKey: 'acc1' },
  { merchant: 'ola', narration: 'OLA CAB', baseAmount: 150, step: 18, accountKey: 'acc2' },
  { merchant: 'bigbasket', narration: 'BIGBASKET GROCERIES', baseAmount: 900, step: 40, accountKey: 'acc1' },
  { merchant: 'dmart', narration: 'DMART RETAIL', baseAmount: 650, step: 30, accountKey: 'acc2' },
  { merchant: 'bses', narration: 'BSES ELECTRICITY BILL', baseAmount: 1400, step: 60, accountKey: 'acc1' },
  { merchant: 'airtel', narration: 'AIRTEL MOBILE RECHARGE', baseAmount: 399, step: 0, accountKey: 'acc2' },
  { merchant: 'amazon', narration: 'AMAZON.IN PURCHASE', baseAmount: 799, step: 100, accountKey: 'acc1' },
  { merchant: 'myntra', narration: 'MYNTRA PURCHASE', baseAmount: 1200, step: 150, accountKey: 'acc2' },
  { merchant: 'atm', narration: 'ATM CASH WITHDRAWAL', baseAmount: 2000, step: 500, accountKey: 'acc1' },
  { merchant: 'upi-transfer', narration: 'UPI/P2P TRANSFER', baseAmount: 500, step: 50, accountKey: 'acc2' },
];

interface SubscriptionTemplate {
  merchant: string;
  narration: string;
  amount: number;
  day: number;
  accountKey: 'acc1' | 'acc2';
}

const SUBSCRIPTION_TEMPLATES: SubscriptionTemplate[] = [
  { merchant: 'netflix', narration: 'NETFLIX.COM SUBSCRIPTION', amount: 649, day: 5, accountKey: 'acc1' },
  { merchant: 'spotify', narration: 'SPOTIFY INDIA', amount: 119, day: 7, accountKey: 'acc1' },
  { merchant: 'hotstar', narration: 'DISNEY HOTSTAR SUBSCRIPTION', amount: 299, day: 9, accountKey: 'acc2' },
  { merchant: 'amazonprime', narration: 'AMAZON PRIME MEMBERSHIP', amount: 299, day: 11, accountKey: 'acc1' },
  { merchant: 'icloud', narration: 'APPLE ICLOUD STORAGE', amount: 75, day: 13, accountKey: 'acc2' },
  { merchant: 'gym', narration: 'CULTFIT MEMBERSHIP', amount: 1499, day: 15, accountKey: 'acc1' },
];

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function dateStr(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

function clampDay(day: number, daysInMonth: number): number {
  return Math.min(day, daysInMonth);
}

export function generateMockDataset(now: Date): MockDataset {
  const accounts: MockAccount[] = [
    { key: 'acc1', bank: 'HDFC Bank', type: 'SAVINGS', maskedNumber: 'XXXX1234', balance: '84250.00', currency: 'INR' },
    { key: 'acc2', bank: 'ICICI Bank', type: 'SAVINGS', maskedNumber: 'XXXX5678', balance: '21430.00', currency: 'INR' },
  ];

  const transactions: MockTransaction[] = [];
  const anchor = startOfMonth(now);

  for (let m = 0; m < MONTHS; m++) {
    const monthDate = addMonths(anchor, -(MONTHS - 1 - m));
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const daysInMonth = getDaysInMonth(monthDate);

    transactions.push({
      accountKey: 'acc1',
      txnDate: dateStr(year, month, clampDay(1, daysInMonth)),
      amount: '70000.00',
      direction: 'credit',
      narration: 'SALARY CREDIT NEXTLEAP TECHNOLOGIES',
      merchant: null,
    });

    transactions.push({
      accountKey: 'acc1',
      txnDate: dateStr(year, month, clampDay(3, daysInMonth)),
      amount: '15000.00',
      direction: 'debit',
      narration: 'NEFT RENT PAYMENT MAYUR CO-OP HSG SOCIETY',
      merchant: null,
    });

    for (const sub of SUBSCRIPTION_TEMPLATES) {
      transactions.push({
        accountKey: sub.accountKey,
        txnDate: dateStr(year, month, clampDay(sub.day, daysInMonth)),
        amount: sub.amount.toFixed(2),
        direction: 'debit',
        narration: sub.narration,
        merchant: sub.merchant,
      });
    }

    for (let i = 0; i < REGULAR_EVERYDAY_COUNT; i++) {
      const template = EVERYDAY_TEMPLATES[i % EVERYDAY_TEMPLATES.length];
      const amount = template.baseAmount + (i % 4) * template.step;
      const day = clampDay(1 + ((i * 2 + 3) % daysInMonth), daysInMonth);
      transactions.push({
        accountKey: template.accountKey,
        txnDate: dateStr(year, month, day),
        amount: amount.toFixed(2),
        direction: 'debit',
        narration: template.narration,
        merchant: template.merchant,
      });
    }

    if (m === SPIKE_MONTH_INDEX) {
      const spikeTemplates = EVERYDAY_TEMPLATES.filter(
        (t) => t.merchant === 'amazon' || t.merchant === 'myntra'
      );
      for (let i = 0; i < SPIKE_EXTRA_COUNT; i++) {
        const template = spikeTemplates[i % spikeTemplates.length];
        const amount = template.baseAmount + (i % 5) * template.step;
        const day = clampDay(1 + ((i * 3 + 7) % daysInMonth), daysInMonth);
        transactions.push({
          accountKey: template.accountKey,
          txnDate: dateStr(year, month, day),
          amount: amount.toFixed(2),
          direction: 'debit',
          narration: template.narration,
          merchant: template.merchant,
        });
      }
    }
  }

  return {
    userEmail: 'demo@switch.app',
    accounts,
    transactions,
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @switch/server exec vitest run test/db/mockData.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/db/seed/mockData.ts apps/server/test/db/mockData.test.ts
git commit -m "feat(server): add deterministic mock financial dataset generator"
```

---

### Task 5: Idempotent seed writer (integration tested)

**Files:**
- Create: `apps/server/src/db/seed/seed.ts`
- Create: `apps/server/src/db/seed/run.ts`
- Test: `apps/server/test/db/seed.test.ts`

**Interfaces:**
- Consumes: `generateMockDataset` from Task 4; `db` from `client.ts` (Task 2); `users`, `consents`, `accounts`, `transactions` tables from `schema.ts` (Task 2).
- Produces: `runSeed(referenceDate?: Date): Promise<{ userId: string; accountCount: number; transactionCount: number }>`, used by `run.ts` (CLI, invoked via `pnpm db:seed`) and by M1+ as the standard way to reset demo data before a demo run.

- [ ] **Step 1: Write the failing integration test**

`apps/server/test/db/seed.test.ts`:
```ts
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../src/db/client.js';
import { accounts, consents, transactions, users } from '../../src/db/schema.js';
import { runSeed } from '../../src/db/seed/seed.js';

describe('runSeed (integration)', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('seeds the demo user with 2 accounts, 2 active consents, and 400 transactions', async () => {
    const result = await runSeed(new Date('2026-07-20T00:00:00Z'));

    expect(result.accountCount).toBe(2);
    expect(result.transactionCount).toBe(400);

    const [user] = await db.select().from(users).where(eq(users.email, 'demo@switch.app'));
    expect(user).toBeDefined();

    const userAccounts = await db.select().from(accounts).where(eq(accounts.userId, user.id));
    expect(userAccounts).toHaveLength(2);

    const userConsents = await db.select().from(consents).where(eq(consents.userId, user.id));
    expect(userConsents).toHaveLength(2);
    expect(userConsents.every((c) => c.status === 'ACTIVE')).toBe(true);

    let totalTxns = 0;
    for (const acc of userAccounts) {
      const rows = await db.select().from(transactions).where(eq(transactions.accountId, acc.id));
      totalTxns += rows.length;
    }
    expect(totalTxns).toBe(400);
  });

  it('is idempotent: re-running the seed does not duplicate rows', async () => {
    await runSeed(new Date('2026-07-20T00:00:00Z'));
    const result = await runSeed(new Date('2026-07-20T00:00:00Z'));

    expect(result.transactionCount).toBe(400);

    const allUsers = await db.select().from(users).where(eq(users.email, 'demo@switch.app'));
    expect(allUsers).toHaveLength(1);

    const userAccounts = await db.select().from(accounts).where(eq(accounts.userId, allUsers[0].id));
    expect(userAccounts).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @switch/server exec vitest run test/db/seed.test.ts`
Expected: FAIL — cannot find module `../../src/db/seed/seed.js`

- [ ] **Step 3: Implement the seed writer**

`apps/server/src/db/seed/seed.ts`:
```ts
import { eq } from 'drizzle-orm';
import { db } from '../client.js';
import { accounts, consents, transactions, users } from '../schema.js';
import { generateMockDataset } from './mockData.js';

export async function runSeed(referenceDate: Date = new Date()) {
  const dataset = generateMockDataset(referenceDate);

  const existing = await db.select().from(users).where(eq(users.email, dataset.userEmail));
  if (existing.length > 0) {
    const userId = existing[0].id;
    const existingAccounts = await db.select().from(accounts).where(eq(accounts.userId, userId));
    for (const acc of existingAccounts) {
      await db.delete(transactions).where(eq(transactions.accountId, acc.id));
    }
    await db.delete(accounts).where(eq(accounts.userId, userId));
    await db.delete(consents).where(eq(consents.userId, userId));
    await db.delete(users).where(eq(users.id, userId));
  }

  const [user] = await db.insert(users).values({ email: dataset.userEmail }).returning();

  const now = new Date();
  const consentIdByAccountKey = new Map<string, string>();
  for (const acc of dataset.accounts) {
    const [consent] = await db
      .insert(consents)
      .values({
        userId: user.id,
        fipId: acc.bank.toLowerCase().replace(/\s+/g, '-'),
        aaConsentId: `mock-consent-${acc.key}`,
        status: 'ACTIVE',
        purpose: 'Personal finance management',
        fiTypes: ['DEPOSIT'],
        fromDate: '2020-01-01',
        toDate: now.toISOString().slice(0, 10),
        expiryAt: new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()),
        dataLife: '1 year',
      })
      .returning();
    consentIdByAccountKey.set(acc.key, consent.id);
  }

  const accountIdByKey = new Map<string, string>();
  for (const acc of dataset.accounts) {
    const [row] = await db
      .insert(accounts)
      .values({
        userId: user.id,
        consentId: consentIdByAccountKey.get(acc.key)!,
        bank: acc.bank,
        type: acc.type,
        maskedNumber: acc.maskedNumber,
        balance: acc.balance,
        currency: acc.currency,
        fetchedAt: now,
      })
      .returning();
    accountIdByKey.set(acc.key, row.id);
  }

  const txnRows = dataset.transactions.map((t) => ({
    accountId: accountIdByKey.get(t.accountKey)!,
    txnDate: t.txnDate,
    amount: t.amount,
    direction: t.direction,
    narration: t.narration,
    merchant: t.merchant,
  }));

  const BATCH = 100;
  for (let i = 0; i < txnRows.length; i += BATCH) {
    await db.insert(transactions).values(txnRows.slice(i, i + BATCH));
  }

  return {
    userId: user.id,
    accountCount: dataset.accounts.length,
    transactionCount: txnRows.length,
  };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `pnpm --filter @switch/server exec vitest run test/db/seed.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the CLI entry point**

`apps/server/src/db/seed/run.ts`:
```ts
import 'dotenv/config';
import { pool } from '../client.js';
import { runSeed } from './seed.js';

runSeed()
  .then(async (result) => {
    console.log(`Seeded ${result.accountCount} accounts, ${result.transactionCount} transactions for user ${result.userId}`);
    await pool.end();
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
```

- [ ] **Step 6: Run the CLI seed script directly as a smoke check**

Run: `pnpm --filter @switch/server db:seed`
Expected output: `Seeded 2 accounts, 400 transactions for user <uuid>`

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/db/seed/seed.ts apps/server/src/db/seed/run.ts apps/server/test/db/seed.test.ts
git commit -m "feat(server): add idempotent seed writer and CLI entry point"
```

---

### Task 6: Root workspace scripts + clean-environment verification

**Files:**
- Modify: `package.json` (root)

**Interfaces:**
- Consumes: everything from Tasks 1–5.
- Produces: root-level `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm test` scripts that M1+ and CI (later) invoke without needing to know `apps/server` is where the implementation lives.

- [ ] **Step 1: Add proxy scripts to the root package.json**

Modify `package.json` (root) — replace the `"scripts"` block from Task 1 with:
```json
{
  "name": "switch-monorepo",
  "private": true,
  "packageManager": "pnpm@10.32.1",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "db:up": "docker compose up -d postgres",
    "db:down": "docker compose down",
    "db:generate": "pnpm --filter @switch/server db:generate",
    "db:migrate": "pnpm --filter @switch/server db:migrate",
    "db:seed": "pnpm --filter @switch/server db:seed",
    "test": "pnpm --filter @switch/server test"
  }
}
```

- [ ] **Step 2: Verify the full pipeline from a clean database**

Run, in order:
```bash
docker compose down -v
pnpm db:up
```
Wait for healthy (poll `docker compose exec postgres pg_isready -U switch -d switch_dev` until it prints `accepting connections`), then:
```bash
pnpm db:migrate
pnpm db:seed
pnpm test
```
Expected: `db:migrate` prints `Migrations complete`; `db:seed` prints `Seeded 2 accounts, 400 transactions for user <uuid>`; `pnpm test` reports all test files passing (`mockData.test.ts`, `schema.test.ts`, `seed.test.ts`) with 0 failures.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add root-level db and test proxy scripts"
```

---

## What M0 does not include (deliberately deferred)

- `packages/shared` — created when M1 needs to share Zod tool-input/output types between the MCP layer and REST layer.
- `apps/web` — created at the start of M3 (dashboard).
- The AA adapter interface (Finvu | Mock) and the 10 MCP tools — that's M1, built directly against the schema and seeded data this plan produces.
- `memories.embedding` (pgvector) — added when semantic recall (spec §5, P2) is implemented.
- Any Supabase account, Auth wiring, or Railway/Vercel deployment — deferred to whichever milestone first needs hosting or Auth (M3 for Auth, M5 for the MCP connector deploy).
