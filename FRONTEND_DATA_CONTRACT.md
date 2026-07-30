# Frontend Data Contract

This repository is the source for `https://j2itamah.github.io/`.

## Authoritative backend

```text
https://live-agent-dashboard-web-production.up.railway.app
```

The frontend is a read-only viewer. It must never place, modify, cancel, simulate, ingest, reconcile, archive, backfill, or otherwise mutate trades or backend state.

## Complete dashboard snapshot

```text
GET /api/live-agent/dashboard
```

This is the canonical joined snapshot for the public REAL, SHADOW, Catalyst, Sources, Execution, Journal, and launcher pages. It currently contains these top-level objects:

- `generated_at`
- `schema_version` (`live_agent_dashboard_v1`)
- `security`
- `real`
- `shadow`
- `source_observability`
- `execution_quality`
- `account_capital`

The payload is large. Fetch it once per refresh cycle, cache it in memory for the current page session, and share the parsed result between components. Use `{ cache: "no-store" }`; do not make one request per card.

### REAL (`data.real`)

Broker-derived PAPER evidence only:

- population, venue, local date, data-quality status and reconciliation status
- sample counts, open/closed counts, wins/losses and win rate
- gross P/L, commissions and net P/L
- breakdowns by rule, catalyst and direction
- equity curve and daily journal
- decision feed
- recent closed trades and open positions
- uncosted/stale/anomalous/excluded population counters
- reconciliation and capture evidence
- detailed catalyst rows

### SHADOW (`data.shadow`)

Non-executable research evidence only:

- priced, pending/unpriced and diagnostic counts
- modeled-P/L and slot-book diagnostics
- horizon ladder
- breakdowns by rule, catalyst and direction
- recent priced observations, all observations and pending observations
- capture and multi-day status
- detailed catalyst rows

Never label SHADOW returns as broker P/L, cash, fills, orders, or executable performance.

### Sources (`data.source_observability`)

Source coverage, per-source status, warnings, freshness and capture evidence.

### Execution (`data.execution_quality`)

Broker execution/cost evidence such as commissions, spread, latency, reference-price comparison and slippage when available.

### Capital (`data.account_capital`)

IBKR PAPER account snapshot and position-sizing evidence:

- connection/mode/base currency
- cash, equity, available funds and buying power
- snapshot timestamps and freshness
- open notional, average notional and percentage-of-equity evidence
- warnings, caveats and next action

If `snapshot_status !== "LIVE"`, render account values as unavailable. Never invent or reuse old cash/equity values.

## Additional display-safe GET endpoints

Use these only when a page needs detail not already present in the complete snapshot:

### Trading and portfolio

- `GET /api/portfolio`
- `GET /api/positions`
- `GET /api/trades`
- `GET /api/open-positions`
- `GET /api/direction-stats`
- `GET /api/mfe-mae/stats`
- `GET /api/mfe-mae/open`

### System, risk and configuration evidence

- `GET /api/live-agent/security`
- `GET /api/health`
- `GET /api/health-card`
- `GET /api/go-live-gate`
- `GET /api/gate-watchdog`
- `GET /api/anomaly-monitor`
- `GET /api/risk/limits`
- `GET /api/risk/status`
- `GET /api/config/snapshot`
- `GET /api/config/drift`
- `GET /api/config/history`

### Catalyst, news and source evidence

- `GET /api/after-hours-filings`
- `GET /api/filings-panel`
- `GET /api/macro-events`
- `GET /api/news-logs`
- `GET /api/rejection-logs`
- `GET /api/realtime-news/providers`
- `GET /api/latency`
- `GET /api/telegram/alert-log`
- `GET /api/x_connector/status`
- `GET /api/x_connector/author-pnl`

### Research and edge analysis

- `GET /api/verticals`
- `GET /api/already-moved-report`
- `GET /api/head-to-head`
- `GET /api/move-origin-report`
- `GET /api/processor-bakeoff`
- `GET /api/scoreboard`
- `GET /api/exit-backtest`
- `GET /api/chased-move-report`
- `GET /api/dyntp-health`
- `GET /api/dyntp-vs-fixed`
- `GET /api/conviction-vs-flat`
- `GET /api/pre-move-scoreboard`
- `GET /api/crypto-lab`
- `GET /api/edge-proof`
- `GET /api/edge-proof-scorecard`
- `GET /api/ai-world`
- `GET /api/quantum-realm`
- `GET /api/white-house-trades`
- `GET /api/dsr/evaluate`
- `GET /api/shadow-arms/compare`
- `GET /api/exit-epoch/compare`

### Broker reconciliation evidence (read-only)

- `GET /api/ibkr/status`
- `GET /api/ibkr/fill-log`
- `GET /api/ibkr/reconciliation`
- `GET /api/ibkr/short-book`

These are evidence views only. The browser must never act on broker orders.

## Forbidden frontend routes

The frontend and frontend agents must not call:

- any `POST`, `PUT`, `PATCH`, or `DELETE` route
- any `/api/admin/*` route
- `/api/settings` or `/api/settings/test`
- `/api/simulate`
- `/api/test-openai`
- `/api/ibkr/ingest`
- `/api/ibkr/log-fill`
- `/api/ibkr/desired-orders`
- `/api/risk/kill-switch`
- `/api/ndax/auto/*`
- any Supabase write/RPC endpoint
- IBKR, NDAX, Kraken or other broker APIs directly

No service-role key, broker credential, Telegram token or other secret belongs in GitHub Pages. The public frontend may only use approved unauthenticated read endpoints.

## Fetch pattern

```js
const API_BASE = "https://live-agent-dashboard-web-production.up.railway.app";

export async function loadDashboard() {
  const response = await fetch(`${API_BASE}/api/live-agent/dashboard`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) throw new Error(`Dashboard API ${response.status}`);
  const data = await response.json();

  if (data.schema_version !== "live_agent_dashboard_v1") {
    throw new Error(`Unsupported schema: ${data.schema_version}`);
  }

  return data;
}
```

## Rendering rules

1. REAL and SHADOW populations are always separate.
2. Gross P/L, costs and net P/L are separate.
3. Missing, stale, WARN or failed reconciliation data remains visible.
4. No edge claim below the approved sample and concentration gates.
5. No mock/fallback financial values on a live page.
6. A failed refresh may retain the last verified response only when it is visibly labelled `Last verified snapshot`; if no verified snapshot exists, render `DATA UNAVAILABLE`.
7. Display `generated_at` and each section's `source_updated_at`.
8. Do not infer fills or broker activity from decisions, intents or SHADOW rows.
9. Keep every page no denser than its selected original Lovable reference.
10. When backend and frontend disagree, backend evidence wins and the page must show the mismatch.

## Typed adapter and exact REAL rule mapping

The production pages load `dashboard-data-adapter.js` before any renderer. It validates the complete response once and exposes the raw datasets plus a safe `DashboardViewModel`. Do not duplicate field conversion inside individual cards.

Exact five displayed rule groups:

1. `RULE_SEC_FILING_DEFAULT_LONG` → SEC Filing Long
2. `RULE_SEC_424B_DILUTION_SHORT` → 424B Dilution Short
3. `RULE_SEC_8K_202_DEFAULT_LONG` → 8-K 2.02 Long
4. `RULE_NAMED_POSITIVE_CATALYST` → Named Catalyst
5. `RULE_CATALYST_DEFAULT_LONG` → Catalyst Long

Unknown rules go to `unmappedRules`; do not create new visual cards automatically.

The adapter also provides:

- finite-number and timestamp validation;
- `net_pnl ≈ gross_pnl - commissions` within $0.03;
- rule sample, win/loss and win-rate reconciliation;
- chronological cumulative rule series;
- open-position concentration validation;
- separately labelled REAL and SHADOW source eligibility;
- a 15-second timeout, limited retry/backoff, request cancellation and one shared in-flight request;
- an in-memory last-success response and a compact persistent summary for a clearly labelled last-verified fallback.

Run the production contract check with:

```bash
node verify-dashboard-contract.cjs
```

## Current live verification (2026-07-29)

- Environment: PAPER.
- REAL: 34 closed, 32 costed, 2 open; gross $46.04; commissions $86.25; net −$40.21.
- Five mapped rule groups total costed n=32; unmapped rules: none.
- SHADOW: priced n=704; pending/unpriced n=296; research only.
- REAL quality: WARN; reconciliation: WARN.
- Current IBKR account snapshot: DATA_UNAVAILABLE.
- Verification verdict: `PASS_WITH_WARNINGS`.

These values are evidence notes, not hardcoded UI data. Production figures must always come from the endpoint or a visibly labelled last verified snapshot.
