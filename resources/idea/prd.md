# PRD — Switch (India AA Connect)

**The money context layer for every AI.** An MCP server + web app that connects a user's real bank data (via India's RBI-regulated Account Aggregator network, Finvu sandbox) to any LLM — with consent, deterministic aggregation, and persistent memory.

| | |
|---|---|
| **Team** | Team Spend FSS |
| **Event** | MLH Hackathon (PecHacks 4.0) |
| **Status** | Draft v1.0 |
| **Owner** | Team Leader |

---

## 1. Background & Problem

Most Indians have abundant financial data (UPI, bank apps) but low applied financial literacy (~27% per NCFE survey). Apps show raw transactions; nobody interprets them. Meanwhile LLMs have zero context on a user's actual income, spending, or goals — so their financial guidance is generic.

India's Account Aggregator (AA) network provides RBI-regulated, consent-based rails to fetch real financial data. Nothing today bridges those rails to LLMs in a reusable, model-agnostic way.

**Insight:** don't build another PFM app. Build the *context layer* — an MCP server any LLM client (Claude, ChatGPT, our own app) can use to reason over a user's real money, safely.

## 2. Goals

**G1.** Working end-to-end demo: consent → fetch → categorize → grounded Q&A, on Finvu sandbox data.
**G2.** The MCP server installs as a remote connector in Claude.ai and answers "Can I afford ₹40K for Goa in December?" with real numbers.
**G3.** Memory demo beat: user states a rule ("never suggest crypto"); a later answer visibly respects it.
**G4.** Dashboard that visualizes spend by category, savings rate, and recurring subscriptions.
**G5.** All financial figures in answers come from deterministic tools — zero free-text arithmetic by the LLM.

### Success metrics (hackathon-scoped)
- Demo completes in < 90 seconds with no manual data seeding on stage.
- ≥ 8 of 10 MCP tools callable and correct from an external MCP client.
- Categorization accuracy ≥ 85% on the mock dataset (spot-checked, 100 txns).
- Fallback mock mode switchable with one env var if the sandbox is down.

## 3. Non-Goals (out of scope for the hackathon)

- Production AA license / real bank data (sandbox only).
- Specific investment recommendations (SEBI/RIA territory — we do insights & education only).
- Multi-user org features, mobile app, notifications.
- Full OAuth 2.1 flow for the MCP connector (bearer token acceptable for demo; note as roadmap).
- Perfect categorization — confidence-scored + user-correctable is the bar.

## 4. Personas

- **Priya, 24, first-job engineer (primary).** Salary ₹70K/mo, spends on delivery apps and subscriptions, doesn't budget. Wants plain-language answers about her own money.
- **Arjun, 30, power user.** Already uses Claude daily; wants his financial context available *inside* the AI he already talks to, not another app.
- **Judge (meta-persona).** Needs to see: real rails, real consent semantics, trustworthy numbers, and the memory differentiator — in 3 minutes.

## 5. User Stories (prioritized)

**P0 — must ship**
1. As a user, I can link my (sandbox) bank account through an AA consent flow and see exactly what I'm sharing, for how long.
2. As a user, I can ask "how much did I spend on food last month?" and get an exact figure computed by a tool, not estimated by the model.
3. As a user, I can ask a planning question ("can I afford X in December?") and get an answer grounded in my income, recurring spend, and savings rate.
4. As a Claude.ai user, I can add the MCP connector and use the same tools inside Claude with no custom app.
5. As a user, I can revoke consent and the system stops serving my data.

**P1 — should ship**
6. As a user, I can tell the assistant a standing rule ("never suggest crypto", "I send ₹10K home monthly") and it persists across sessions.
7. As a user, I can see a dashboard: spend by category, month-over-month trend, recurring subscriptions, savings rate.
8. As a user, I can correct a miscategorized transaction and the correction sticks (and teaches a rule).

**P2 — stretch**
9. Implicit memory: the system notices patterns (ignored suggestions, spending shifts) and adapts tone/advice.
10. Semantic memory retrieval via embeddings (pgvector) instead of recency/keyword.

## 6. Tech Stack (decided)

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript end-to-end** | One language across MCP server, API, frontend; team velocity |
| MCP server | **@modelcontextprotocol/sdk (TS)** + **Zod** schemas, **Streamable HTTP** transport | Official SDK; HTTP transport = installable as a remote connector in Claude.ai/ChatGPT |
| Backend runtime | **Node 20 + Express** — one service exposing `/mcp` and `/api/*` | Single deployable; REST reuses the exact same tool implementations |
| AA integration | **Finvu AA sandbox** behind an **adapter interface**; `MOCK_MODE=true` swaps in a canned dataset (same schema) | Demo-day insurance; clean seam for a real AA later |
| Database | **Supabase (Postgres)** + **Drizzle ORM**; **pgvector** enabled (P2) | Free tier, instant, auth included, SQL you can debug at 3 a.m. |
| Auth | **Supabase Auth** (web, email OTP/Google) + **per-user bearer token** for the MCP connector | OAuth for MCP is roadmap, not hackathon |
| LLM | **Claude Sonnet 4.6 via Anthropic API** (in-app chat + categorization fallback) | Strong tool calling; the MCP server itself stays model-agnostic |
| Frontend | **Next.js 15 (App Router) + Tailwind + shadcn/ui + Recharts**, deployed on **Vercel** | Fast to build, looks polished, Recharts covers every chart we need |
| Hosting (backend) | **Railway** (persistent HTTP for MCP) | Vercel serverless is awkward for long-lived MCP sessions |
| Repo | **pnpm workspaces** monorepo: `apps/web`, `apps/server`, `packages/shared` | Shared types between tools and UI |
| Dev/test | tsx, vitest (tool functions only), ngrok (local connector testing) | Minimum viable rigor |

*Alternative:* if the team is Python-heavy, the MCP server can be Python **FastMCP** with the same tool contract — but do not split languages across server and categorization logic.

## 7. System Architecture

```
                 ┌───────────────────────────────┐
  Claude.ai /    │        MCP CLIENTS            │     Next.js Web App (Vercel)
  ChatGPT  ──────►  Streamable HTTP  /mcp        │     Dashboard + in-app chat
                 └──────────────┬────────────────┘             │  /api/*
                                ▼                              ▼
                 ┌─────────────────────────────────────────────────────┐
                 │        Node/Express service (Railway)               │
                 │  ┌───────────────┐  ┌──────────────────────────┐    │
                 │  │ MCP Tool Layer │  │ REST layer (same funcs) │    │
                 │  └──────┬────────┘  └──────────┬──────────────┘    │
                 │         ▼                      ▼                   │
                 │  Core services: ConsentSvc · DataSvc ·             │
                 │  CategorizeSvc · AggregateSvc · MemorySvc          │
                 │         │                  │                       │
                 │   AA Adapter          Anthropic API                │
                 │   (Finvu | Mock)      (chat, fallback categorize)  │
                 └─────────┬──────────────────────┬──────────────────┘
                           ▼                      ▼
                    Finvu AA Sandbox       Supabase Postgres
                    (consent + FI data)    (accounts, txns, memory,
                                            consents, audit log)
```

**Key principle:** every rupee figure shown to a user is computed in `AggregateSvc` (SQL), never by the LLM. The LLM narrates; the database calculates.

### AA data flow (Finvu)
1. `initiate_consent` → create consent artifact (purpose, FI types, date range, expiry) → user approves in Finvu handle.
2. `check_consent_status` polls until `ACTIVE`.
3. `request_financial_data` → FI request against the consent.
4. `get_data_status` polls until `READY`; data fetched, decrypted, normalized, stored.
5. `fetch_accounts` / `fetch_transactions` serve from our DB thereafter (with freshness timestamp).
6. Revocation → consent marked `REVOKED`; all serving tools return a consent error.

## 8. MCP Tool Specifications (10 tools)

All inputs validated with Zod. All tools return `{ ok, data | error }`; errors carry a machine code + human message. Every call is written to `audit_log`.

| # | Tool | Input | Output | Notes |
|---|---|---|---|---|
| 1 | `list_supported_banks` | — | `[{fip_id, name, logo}]` | Static from adapter |
| 2 | `initiate_consent` | `{mobile, fip_id, purpose, from_date, to_date, expiry_days, fi_types[]}` | `{consent_id, approval_url, status}` | Purpose codes mirror AA spec |
| 3 | `check_consent_status` | `{consent_id}` | `{status: PENDING\|ACTIVE\|REJECTED\|REVOKED\|EXPIRED}` | |
| 4 | `get_consent_details` | `{consent_id}` | `{purpose, fi_types, date_range, expiry, data_life}` | Transparency tool — show the user what they granted |
| 5 | `request_financial_data` | `{consent_id}` | `{session_id, status}` | Kicks off FI request |
| 6 | `get_data_status` | `{session_id}` | `{status: PENDING\|READY\|FAILED, fetched_at?}` | |
| 7 | `fetch_accounts` | `{consent_id}` | `[{account_id, type, masked_number, bank, balance, currency}]` | Masked numbers only |
| 8 | `fetch_transactions` | `{account_id, from?, to?, category?, limit?, cursor?}` | `[{txn_id, date, amount, direction, narration, merchant?, category, confidence}]` | Paginated; default limit 50 |
| 9 | `categorize_transactions` | `{account_id, force?: bool}` | `{categorized, uncategorized, accuracy_note}` | Rules first, LLM fallback, results cached |
| 10 | `summarize_finances` | `{account_id, period, metrics[]}` where metrics ⊆ `{spend_by_category, income, savings_rate, recurring_subscriptions, top_merchants, mom_trend}` | Structured summary object | **The grounding workhorse** — deterministic SQL only |

**Memory (exposed to LLM clients via two additional lightweight tools if time permits, else internal to in-app chat):**
- `remember` `{type: explicit|implicit, content, tags[]}` → stores a memory row.
- `recall` `{query?, tags?, limit}` → returns relevant memories (recency+tags P0; pgvector P2).

## 9. Functional Requirements

**FR1 — Consent lifecycle.** Full initiate/verify/details/revoke cycle mirroring AA semantics (purpose, FI types, date range, expiry, data life). Revoked/expired consents hard-block all data tools. UI shows a human-readable consent card before approval.

**FR2 — Data pipeline.** Fetched FI data is normalized into `accounts` + `transactions`, idempotently (re-fetch never duplicates). Every dataset carries `fetched_at`; answers older than 24h display a freshness note.

**FR3 — Categorization.** Deterministic rule engine first: UPI VPA / narration regex → category (e.g., `swiggy|zomato → Food Delivery`; `netflix|spotify|hotstar → Subscriptions`; NEFT + recurring same-amount → Rent/EMI heuristic). Unknowns go to Claude in batches of 50 with a fixed category taxonomy (12 categories), returning JSON `{txn_id, category, confidence}`. `confidence < 0.7` → flagged "unverified" in UI. User corrections write a new rule (merchant → category) so the fix generalizes.

**FR4 — Aggregation & insights.** SQL-computed: spend by category (period), income detection (recurring credits), savings rate = (income − spend)/income, recurring subscriptions (same merchant, similar amount, ~monthly cadence), top merchants, month-over-month deltas. Affordability check = projected free cash flow over target period vs. requested amount, with assumptions listed.

**FR5 — Grounded Q&A.** In-app chat (Anthropic API, tool calling against the same service functions). System prompt rules: (a) never compute money figures in prose — always call `summarize_finances`/`fetch_transactions`; (b) always state the data period and freshness; (c) never recommend specific securities/products; (d) check `recall` before advising.

**FR6 — Memory.** Explicit memories from user statements (detected via tool call `remember`). Implicit (P2): declined suggestions, repeated queries, spending shifts. Memory is per-user, viewable and deletable in the UI ("What Switch knows about me" page) — this page is itself a demo moment.

**FR7 — Dashboard.** Pages: Overview (balance, savings rate, MoM trend), Spending (category donut + monthly bars), Subscriptions (recurring list + annual cost), Chat, Memory, Consent manager (status + revoke button).

**FR8 — Mock mode.** `MOCK_MODE=true` serves a hand-crafted 6-month dataset (2 accounts, ~400 txns, salary credits, 6 subscriptions, 1 rent pattern, seasonal spikes) through the same adapter interface. Demo runs identically.

## 10. Data Model (Postgres)

```
users(id, email, created_at)
connector_tokens(id, user_id, token_hash, created_at, revoked_at)
consents(id, user_id, fip_id, aa_consent_id, status, purpose,
         fi_types[], from_date, to_date, expiry_at, data_life, raw_json)
accounts(id, user_id, consent_id, bank, type, masked_number,
         balance, currency, fetched_at)
transactions(id, account_id, txn_date, amount, direction,
             narration, merchant, category, confidence,
             categorized_by ENUM(rule|llm|user), created_at)
category_rules(id, user_id NULLABLE, pattern, category, priority)
memories(id, user_id, type ENUM(explicit|implicit), content,
         tags[], embedding VECTOR NULL, created_at, deleted_at)
chat_messages(id, user_id, role, content, tool_calls_json, created_at)
audit_log(id, user_id, actor ENUM(mcp|web), tool, input_hash,
          status, latency_ms, created_at)
```

## 11. Security & Privacy Requirements

- **Data minimization at the LLM boundary.** Default path: LLM receives aggregates/summaries from `summarize_finances`. Raw `fetch_transactions` output is capped, masked (no account numbers), and only returned when the query genuinely needs line items.
- Consent tokens and AA payloads encrypted at rest (Supabase column encryption / app-level AES-GCM); TLS everywhere.
- MCP connector auth: per-user bearer token, revocable from the UI; tokens stored hashed.
- Consent revocation is enforced server-side in every data tool, not just hidden in UI.
- Full audit log of every tool call (who, what, when) — also a nice judge slide.
- PII never in logs; mock data contains no real persons.
- Positioning guardrail: insights & education only; the system prompt explicitly forbids specific investment product recommendations.

## 12. Non-Functional Requirements

- Tool p95 latency < 800ms (DB-served tools); consent/FI polling excepted.
- Cold demo start (fresh browser) to first grounded answer < 90s.
- Idempotent data ingestion; safe re-runs.
- Graceful degradation: sandbox failure → visible banner + automatic mock mode suggestion.

## 13. Demo Script (3 minutes)

1. **Hook (20s):** ask vanilla Claude "Can I afford a ₹40K Goa trip in December?" → generic non-answer.
2. **Connect (30s):** add the Switch connector in Claude.ai → `initiate_consent` → approve in Finvu sandbox → consent card shows exactly what's shared.
3. **Grounded answer (45s):** repeat the Goa question → Claude calls `summarize_finances` → answer with real savings rate, recurring commitments, and a verdict + assumptions.
4. **Memory beat (30s):** "By the way, never suggest crypto." → later: "Where should my surplus go?" → answer visibly excludes crypto and cites the remembered rule.
5. **Dashboard (30s):** flip to the web app — spend donut, subscriptions costing ₹X/year, savings trend.
6. **Trust close (25s):** audit log + consent revoke live on stage → tools now refuse. "Deterministic numbers, consented data, any LLM."

## 14. Build Plan (36–48h)

| Phase | Hours | Deliverable | Owner |
|---|---|---|---|
| 0. Scaffold | 0–3 | Monorepo, Supabase, schema migrated, mock dataset seeded | Leader |
| 1. MCP core | 3–10 | Tools 1–8 on mock adapter; testable via MCP inspector | Leader + M2 |
| 2. Finvu adapter | 6–14 | Real sandbox consent + FI flow behind adapter (parallel track) | M2 |
| 3. Categorize + aggregate | 8–18 | Rule engine, LLM fallback, `summarize_finances` metrics | M3 |
| 4. Web dashboard | 10–24 | Auth, Overview/Spending/Subscriptions pages, consent manager | M4 |
| 5. In-app chat + memory | 18–30 | Anthropic tool-calling chat, `remember`/`recall`, memory page | M5 |
| 6. Connector deploy | 24–32 | Railway deploy, bearer auth, installed in Claude.ai | Leader |
| 7. Polish + QA | 32–42 | Demo script dry-runs ×3, freshness notes, error states | All |
| Buffer | 42–48 | Sleep is a feature | All |

## 15. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Finvu sandbox down/flaky during judging | Medium | `MOCK_MODE` adapter, identical schema, one env var |
| Consent flow complexity eats the schedule | High | Build mock-first; Finvu adapter is a parallel track that can slip to "shown in video" |
| LLM invents numbers | Medium | Hard rule: no arithmetic in prose; evals on 10 canned questions before demo |
| Miscategorization misleads | Medium | Confidence flags + user correction + rules; demo uses curated dataset |
| Judges' privacy pushback | High | Slide + live audit log + revoke-on-stage moment |
| Remote connector auth friction in Claude.ai | Medium | Pre-install on the demo account; bearer token fallback documented |

## 16. Future Roadmap (post-hackathon)

- OAuth 2.1 for the MCP connector; production AA partnership (licensed FIU).
- Multi-FI types: mutual funds, EPF, insurance via AA — true net-worth view.
- Implicit memory v2 (behavioral patterns), pgvector semantic recall.
- Goal tracking (save ₹X by Y) with proactive nudges.
- Regional languages for the chat layer.

## 17. Open Questions

- Do we expose `remember`/`recall` as public MCP tools (any client benefits) or keep memory in-app only for the demo? (Lean: expose — it strengthens the "context layer" story.)
- One consent per bank vs. multi-FIP consent bundling in the sandbox — verify Finvu sandbox support early (hour 6 checkpoint).
- Category taxonomy: freeze the 12 categories by hour 8; changing later invalidates cached categorizations.