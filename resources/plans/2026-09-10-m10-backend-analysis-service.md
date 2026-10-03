# Implementation Plan: `backend/analysis` — Python Analysis Service

## Goal

Build a standalone Python service in `backend/analysis/` that reads existing transaction data from the shared Postgres database and writes derived ML/analytics insights back to 4 new output tables. The service runs independently from the Node/TS backend — own virtualenv, own dependencies, own migrations. No changes to `backend/core` or any existing tables.

## Data Context (verified against live DB)

- **772 transactions** across 12 months (Aug 2025 → Jul 2026), 2 accounts
- **12 credit transactions** (salary ₹70K/month) — `merchant=NULL`
- **760 debit transactions** — 20 distinct merchants
- **6 subscription merchants** with exactly 12 occurrences each (netflix, spotify, hotstar, amazonprime, icloud, gym) — fixed amount, same day each month
- **1 spending spike**: May 2026 = ₹96,478 (vs normal ₹61,892) — from extra amazon/myntra purchases
- **All `category` columns are NULL** — categorization has never been run

---

## Proposed Changes

### Scaffold & Infrastructure

#### [NEW] `backend/analysis/pyproject.toml`

Project metadata and dependencies:
- **Core**: `fastapi`, `uvicorn`, `sqlalchemy[asyncio]`, `psycopg2-binary`, `pandas`, `pydantic`, `pydantic-settings`, `alembic`
- **ML/Stats**: `statsforecast`, `scipy`
- **LLM** (Pipeline 2 only): `langchain`, `langgraph`, `langchain-openai`
- **Dev**: `pytest`, `pytest-asyncio`, `httpx`

#### [NEW] `backend/analysis/.env`

```
DATABASE_URL=postgresql://switch:switch_dev_password@localhost:5433/switch_dev
OPENROUTER_API_KEY=  # only needed for Pipeline 2 LLM fallback
```

#### [NEW] `backend/analysis/app/__init__.py`
#### [NEW] `backend/analysis/app/config.py`

Pydantic Settings class reading `DATABASE_URL` and optional `OPENROUTER_API_KEY` from env.

#### [NEW] `backend/analysis/app/database.py`

SQLAlchemy engine + session factory pointing at the shared Postgres. Read-only models for existing `transactions` and `accounts` tables (mapped to the existing schema, not creating them). Read-write models for the 4 new output tables.

#### [NEW] `backend/analysis/app/models/`

SQLAlchemy models split into:
- `source.py` — Read-only mappings for `transactions`, `accounts` (reflect existing tables)
- `outputs.py` — New output table models (see below)

#### [NEW] `backend/analysis/alembic.ini` + `backend/analysis/migrations/`

Alembic config scoped to only the 4 new output tables. Uses the same `DATABASE_URL`.

#### [NEW] `backend/analysis/app/main.py`

FastAPI app with:
- `POST /run/{pipeline}` — Trigger a single pipeline (`subscriptions`, `categorize`, `anomalies`, `forecast`)
- `POST /run/all` — Run all 4 in order
- `GET /health` — Liveness check
- `GET /results/{pipeline}/{account_id}` — Read results (convenience, Node can also read tables directly)

---

### Output Tables (4 new tables)

```sql
-- Pipeline 1
CREATE TABLE subscription_detections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id),
    merchant TEXT NOT NULL,
    typical_amount NUMERIC(14,2) NOT NULL,
    cadence_days INTEGER NOT NULL,        -- e.g. 30 for monthly
    confidence NUMERIC(3,2) NOT NULL,     -- 0.00–1.00
    occurrence_count INTEGER NOT NULL,
    last_seen DATE NOT NULL,
    next_expected DATE,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(account_id, merchant)
);

-- Pipeline 2 (stores LLM-fallback results separately)
CREATE TABLE category_predictions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES transactions(id),
    category TEXT NOT NULL,
    confidence NUMERIC(3,2) NOT NULL,
    predicted_by TEXT NOT NULL,           -- 'rule' or 'llm'
    predicted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(transaction_id)
);

-- Pipeline 3
CREATE TABLE anomaly_flags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id),
    transaction_id UUID REFERENCES transactions(id),  -- NULL for category-level anomalies
    category TEXT,
    month TEXT,                           -- 'YYYY-MM'
    severity TEXT NOT NULL,               -- 'low', 'medium', 'high'
    score NUMERIC(6,2) NOT NULL,          -- z-score or deviation magnitude
    reason TEXT NOT NULL,                 -- human-readable explanation
    detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Pipeline 4
CREATE TABLE forecasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id),
    target_month TEXT NOT NULL,           -- 'YYYY-MM'
    predicted_spend NUMERIC(14,2),
    predicted_income NUMERIC(14,2),
    predicted_savings_rate NUMERIC(5,4),
    model_name TEXT NOT NULL,             -- e.g. 'AutoETS', 'SeasonalNaive'
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(account_id, target_month)
);
```

---

### Pipeline 1: Subscription Detection

#### [NEW] `backend/analysis/app/pipelines/subscriptions.py`

**Algorithm (pandas, no ML):**

1. Query all debit transactions for a given `account_id`, load into DataFrame
2. Group by `merchant` (skip `NULL` merchants)
3. For each merchant group with **≥ 3 occurrences**:
   - Sort by `txn_date`
   - Compute inter-transaction intervals (days between consecutive charges)
   - Compute amount stats: median, coefficient of variation (std/mean)
   - **Subscription criteria:**
     - Amount CV < 0.15 (amounts are very similar)
     - Median interval between 25–35 days (monthly) OR 6–8 days (weekly) OR 350–380 days (annual)
     - Interval standard deviation < 5 days (regular cadence)
   - Confidence = weighted score of amount consistency (40%), interval regularity (40%), occurrence count (20%)
4. Upsert results into `subscription_detections` (ON CONFLICT update)

**Expected results on seeded data:** 6 subscriptions detected (netflix, spotify, hotstar, amazonprime, icloud, gym) — all with confidence ~1.0 (perfect monthly cadence, exact same amount each time). `bses` and `airtel` might also trigger (48 occurrences, fixed amounts, but irregular intervals from the everyday template's day-cycling).

#### [NEW] `backend/analysis/tests/test_subscriptions.py`

- ✅ Netflix (12 charges, ₹649, day 5 each month) → detected, confidence ≥ 0.9
- ✅ Spotify (12 charges, ₹119, day 7 each month) → detected
- ❌ Amazon (62 charges, varying amounts ₹799–₹1199, irregular days) → NOT a subscription
- ❌ Salary credit (12 charges, ₹70K, but `direction='credit'`) → excluded (debits only)

---

### Pipeline 2: Categorization (Regex + LangGraph LLM Fallback)

#### [NEW] `backend/analysis/app/pipelines/categorize.py`

**Two-stage pipeline, mirroring the Node/TS architecture:**

**Stage 1 — Regex rule engine (port from Node):**
1. Read `category_rules` table (same rules the TS backend uses — 10 default patterns)
2. For each uncategorized transaction: concatenate `merchant + narration`, test against rules ordered by priority
3. On match → write to `category_predictions` with `predicted_by='rule'`, `confidence=1.0`

**Stage 2 — LangGraph LLM fallback (only for unmatched transactions):**
1. Batch remaining transactions (batch size 50)
2. LangGraph graph with 2 nodes:
   - `regex_node`: attempt rule match (already done, but this models the graph structure cleanly)
   - `llm_node`: call OpenRouter (Claude Haiku) with the fixed 12-category taxonomy, request structured JSON response
3. Conditional edge: `regex_node` → if matched, END; else → `llm_node`
4. Parse response, write to `category_predictions` with `predicted_by='llm'`

**Taxonomy (exact copy from Node):**
```
Food Delivery, Groceries, Transport, Shopping, Subscriptions,
Utilities, Rent, Income, Cash Withdrawal, Transfers, Entertainment, Other
```

#### [NEW] `backend/analysis/tests/test_categorize.py`

- ✅ `merchant='swiggy'` → 'Food Delivery' (rule match)
- ✅ `merchant='netflix'` → 'Subscriptions' (rule match)
- ✅ Salary (`narration='SALARY CREDIT...'`) → 'Income' (rule match)
- ✅ Unknown merchant → falls through to LLM (mock the LLM call in tests)
- Edge: rule priority ordering is respected (higher priority wins)

---

### Pipeline 3: Anomaly Detection

#### [NEW] `backend/analysis/app/pipelines/anomalies.py`

**Algorithm (z-score/IQR, no ML libraries):**

1. Requires categorized data — depends on Pipeline 2 having run (read from `category_predictions` or `transactions.category`)
2. **Category-month anomalies:**
   - For each `(account_id, category)`: compute monthly spend totals
   - Calculate z-score for each month relative to that category's mean/std
   - Flag months where |z-score| > 2.0
   - Severity: `|z| > 3.0` → high, `|z| > 2.5` → medium, `|z| > 2.0` → low
3. **Individual transaction anomalies:**
   - For each `(account_id, merchant)`: compute amount mean/std across all transactions
   - Flag individual transactions where |z-score| > 2.5 (unusually large single purchase)
4. Write results to `anomaly_flags` with human-readable `reason` (e.g., "Shopping spend in May 2026 was 56% above your 12-month average")

**Expected results on seeded data:** May 2026 Shopping category should flag as anomalous (₹96,478 total month vs ₹61,892 normal — the spike comes from extra amazon/myntra charges that month).

#### [NEW] `backend/analysis/tests/test_anomalies.py`

- ✅ May 2026 Shopping spike → flagged, severity medium or high
- ❌ Normal month (e.g., Jan 2026 at ₹61,892) → NOT flagged
- Edge: category with only 1 month of data → skipped (insufficient history for z-score)

---

### Pipeline 4: Forecasting

#### [NEW] `backend/analysis/app/pipelines/forecast.py`

**Algorithm (statsforecast):**

1. For each `account_id`:
   - Build monthly time series of total spend (debit) and total income (credit)
   - Requires ≥ 6 months of history (we have 12)
2. Use `statsforecast.StatsForecast` with `AutoETS` model (handles trend + seasonality automatically)
3. Forecast next 3 months
4. Compute predicted savings rate = `(predicted_income - predicted_spend) / predicted_income`
5. Upsert into `forecasts` table

**Expected results on seeded data:**
- Income: should predict ~₹70,000/month (constant salary)
- Spend: should predict ~₹62,000/month (normal baseline), possibly with slight upward adjustment if the model picks up the May spike as a seasonal signal

#### [NEW] `backend/analysis/tests/test_forecast.py`

- ✅ Predicted income for next month is within 10% of ₹70,000
- ✅ Predicted spend for next month is within 20% of ₹62,000
- ✅ `forecasts` table has rows for the next 3 months
- Edge: account with < 6 months of data → skipped with a log warning

---

## File Structure Summary

```
backend/analysis/
├── pyproject.toml
├── .env
├── alembic.ini
├── migrations/
│   ├── env.py
│   └── versions/
│       └── 001_create_output_tables.py
├── app/
│   ├── __init__.py
│   ├── config.py
│   ├── database.py
│   ├── main.py                    # FastAPI app
│   ├── models/
│   │   ├── __init__.py
│   │   ├── source.py              # Read-only: transactions, accounts
│   │   └── outputs.py             # Read-write: 4 output tables
│   └── pipelines/
│       ├── __init__.py
│       ├── subscriptions.py       # Pipeline 1
│       ├── categorize.py          # Pipeline 2
│       ├── anomalies.py           # Pipeline 3
│       └── forecast.py            # Pipeline 4
├── tests/
│   ├── conftest.py                # Shared fixtures (DB session, etc.)
│   ├── test_subscriptions.py
│   ├── test_categorize.py
│   ├── test_anomalies.py
│   └── test_forecast.py
└── README.md                      # Updated from placeholder
```

---

## Verification Plan

### Automated Tests
```bash
cd backend/analysis
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -e ".[dev]"
alembic upgrade head           # Create the 4 output tables
pytest -v                      # Run all pipeline tests
```

### Manual Verification
After running all pipelines against the seeded DB:
```sql
-- Pipeline 1: Should see 6 subscriptions
SELECT merchant, typical_amount, cadence_days, confidence
FROM subscription_detections ORDER BY confidence DESC;

-- Pipeline 2: Should see 772 categorized transactions
SELECT predicted_by, count(*), avg(confidence)
FROM category_predictions GROUP BY predicted_by;

-- Pipeline 3: Should see May 2026 anomaly
SELECT category, month, severity, reason
FROM anomaly_flags ORDER BY score DESC;

-- Pipeline 4: Should see 3 future months
SELECT target_month, predicted_spend, predicted_income, predicted_savings_rate
FROM forecasts ORDER BY target_month;
```

## Open Questions

> [!IMPORTANT]
> **LLM fallback in Pipeline 2:** Do you have an OpenRouter API key available, or should I make the LLM fallback a no-op / mock for now and only activate it when a key is provided?

> [!IMPORTANT]
> **Pipeline execution model:** The plan uses a FastAPI endpoint (`POST /run/{pipeline}`) for on-demand triggering. Should we also add a CLI mode (`python -m app.pipelines.subscriptions`) for easy manual runs / debugging?
