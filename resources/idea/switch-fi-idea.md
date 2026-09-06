# Switch FI — Idea

**One-liner:** An app that connects your real bank data (via India's Account Aggregator network) to a deep analysis layer you own, and exposes that same understanding — safely — to any LLM through MCP.

---

## The Flow (what a user actually walks through)

```
1. Landing page
   → what Switch does, why it's safe

2. Consent + Sign Up (one combined step)
   → this IS the onboarding: user signs up AND connects their bank
   → consent is captured here, not buried in chat later
   → data pull happens right after consent is granted

3. Dashboard — "the Analysation"
   → this is where all the analysis layer's output surfaces
   → spend trends, categorization, subscriptions, forecasts, anomalies
   → the user sees insight, not raw transactions

4. Chat — grounded, memory-aware
   → answers questions using the same analysis layer, not free-text guessing
   → remembers stated preferences across sessions
   → (TTL cache + SSE streaming: ON HOLD — not needed yet, revisit after the
     core loop and evaluation are done)
```

---

## Two ways the same data gets used — and they follow different rules

This is the part that has to stay clear as the system grows.

### A. Inside the app — the real analysis engine (Python)

This is where the depth lives. Built in Python, using **LangGraph/LangChain** to
orchestrate multi-step analysis, plus whatever ML models genuinely help
(classification, time-series forecasting, anomaly detection — not everything
needs an LLM in the loop).

Examples of what this layer does:
- Deep transaction categorization (beyond simple regex rules)
- Subscription/recurring-payment detection
- Spend forecasting, savings-rate trends
- Anomaly / unusual-spending detection
- Feeds the Dashboard directly

**This layer can be as agentic and multi-step as it needs to be** — it's
internal, it's not answering a live user question that gets graded for
hallucination, and its output gets reviewed (by the dashboard UI, by tests)
before it reaches anyone.

### B. Outside the app — MCP for Claude / ChatGPT (the enclosed loop)

This is the safety-critical surface. Any external LLM only ever sees a small,
fixed set of **deterministic tools** — never raw account access, never an
open-ended agent loop.

**"Enclosed loop" means, concretely:**
- Fixed, scoped tool list (fetch summary, fetch category spend, remember,
  recall — not "run arbitrary analysis")
- Every tool call is deterministic and auditable — the LLM never computes a
  number itself, it only asks for one
- No raw PII ever crosses this boundary (already true today — see the
  Holders/PII exclusion decision)
- Every call logged to `audit_log`, consent-scoped, rate-limited
- **No agent framework on this side.** This loop stays plain tool-calling,
  on purpose — it's what the research evaluation measures, and it needs to
  stay simple enough to reason about exactly what happened on every call.

**Why the split matters:** the Python analysis layer is allowed to be
powerful and experimental. The MCP loop is not — it has to stay boring,
predictable, and provable. Don't let LangGraph creep into the MCP-facing
tool-calling path.

---

## Architecture, in one picture

```
┌─────────────────────────────────────────────────────────┐
│  Node/TS (existing)                                      │
│  - Web app (Next.js): landing, consent+signup, dashboard,│
│    chat                                                   │
│  - MCP server: the enclosed loop for Claude/ChatGPT       │
│  - Auth (Supabase)                                        │
└───────────────────────┬───────────────────────────────────┘
                         │ shared source of truth
                         ▼
                  ┌─────────────┐
                  │  Postgres   │
                  └─────────────┘
                         ▲
                         │ writes derived insights
┌────────────────────────┴──────────────────────────────────┐
│  Python (new)                                              │
│  - Analysis service: LangGraph/LangChain + ML models        │
│  - Runs categorization, forecasting, anomaly detection      │
│  - Never talks to external LLMs directly                    │
└───────────────────────────────────────────────────────────┘
```

---

## On hold, deliberately (not forgotten, just not now)

- SSE token-streaming for chat UI
- TTL cache for in-session state
- Full Railway deployment (ngrok is enough for a real Claude.ai connector test)

---

## Immediate next step

1. **Repo cleanup** — remove/gitignore leaked-secret scripts, separate
   Python analysis service into its own folder, confirm no dead deploy
   config is misleading anyone.
2. Then: scaffold the Python analysis service (LangGraph skeleton, one real
   pipeline — e.g. categorization or subscription detection — end to end).
