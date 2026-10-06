# `backend/analysis` — Python Financial Analysis Service

Standalone Python ML and analytics service for Switch. Reads transaction history from PostgreSQL and computes financial insights stored in 4 dedicated insight tables.

---

## 1. Architecture

This service runs independently from `backend/core` (Node/TypeScript).
- **Postgres Database**: Shared database (`switch_dev`), reads existing `accounts`, `transactions`, `category_rules`.
- **Insight Output Tables**: Managed via Alembic migrations:
  1. `subscription_detections` — Recurring charges (Netflix, Spotify, gym, etc.)
  2. `category_predictions` — Transaction categorization (regex rules + LLM fallback)
  3. `anomaly_flags` — Monthly spending spikes and unusual transaction amounts
  4. `forecasts` — 3-month forecast of spend, income, and savings rate

---

## 2. Quickstart

### Setup Virtual Environment
```bash
cd backend/analysis
python -m venv .venv
.venv\Scripts\activate       # Windows
# source .venv/bin/activate  # Linux/macOS

pip install -e ".[dev,ml]"
```

### Apply Migrations
Create the 4 output insight tables in the database:
```bash
alembic upgrade head
```

### Run All Pipeline Tests
```bash
pytest -v
```

---

## 3. Running Pipelines

### Via CLI
Run all pipelines:
```bash
python -m app.cli all
```

Or run individual pipelines:
```bash
python -m app.cli subscriptions
python -m app.cli categorize
python -m app.cli anomalies
python -m app.cli forecast
```

Filter by specific account:
```bash
python -m app.cli all --account-id <ACCOUNT_UUID>
```

### Via REST API (FastAPI)
Start the FastAPI server:
```bash
uvicorn app.main:app --port 8000 --reload
```

Endpoints:
- `GET /health` — Service health check
- `POST /run/all` — Run all 4 pipelines sequentially
- `POST /run/{pipeline}` — Run a specific pipeline (`subscriptions`, `categorize`, `anomalies`, `forecast`)
- `GET /results/subscriptions/{account_id}` — Fetch detected subscriptions
- `GET /results/categorize/{account_id}` — Fetch categorized transactions
- `GET /results/anomalies/{account_id}` — Fetch detected anomalies
- `GET /results/forecast/{account_id}` — Fetch monthly forecasts
