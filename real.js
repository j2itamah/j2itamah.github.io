/* IBKR / REAL cockpit — reads ONLY data.real (public.agent_trades).
 * Rule 21: every figure shown here is a verified, costed, broker-backed result. */
const state = { lastLoadedAt: null, filter: "ALL", raw: null };

function netValue(row) {
  return Number(row?._net_pnl ?? row?.net_pnl_after_commissions_cad ?? row?.net_pnl_after_commissions ?? row?.net_pnl ?? 0);
}
function grossValue(row) {
  return Number(row?._gross_pnl ?? row?.gross_pnl_cad ?? row?.gross_pnl ?? 0);
}
function commissionValue(row) {
  const value = row?._commissions ?? row?.commissions_cad ?? row?.commissions;
  return typeof value === "number" ? Number(value) : Number(value?.total ?? value?.cad ?? 0);
}
function quantityValue(row) { return Number(row?.quantity ?? row?.qty ?? 0); }
function hasQuantity(row) {
  return ["quantity", "qty", "filled_qty", "shares", "units"].some((key) => row?.[key] !== null && row?.[key] !== undefined && row?.[key] !== "");
}
function quantityText(row) { return hasQuantity(row) ? num(quantityValue(row)) : "DATA UNAVAILABLE"; }
function deployedValue(row) {
  const qty = Math.abs(quantityValue(row));
  const entry = Number(row?.entry_price ?? 0);
  return qty && entry ? qty * entry : 0;
}
function unavailable(label = "DATA UNAVAILABLE") { return `<span class="pending-capture">${esc(label)}</span>`; }
function valueOrUnavailable(value, formatter = safe) {
  if (value === null || value === undefined || value === "") return unavailable();
  if (typeof value === "object") {
    try { return safe(JSON.stringify(value)); } catch { return unavailable(); }
  }
  return formatter(value);
}
function parseProof(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}
function firstPresent(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}
function proofValue(row, keys, proofObjects = []) {
  const direct = firstPresent(...keys.map((key) => row?.[key]));
  if (direct !== null) return direct;
  for (const proof of proofObjects) {
    if (!proof || typeof proof !== "object") continue;
    const found = firstPresent(...keys.map((key) => proof?.[key]));
    if (found !== null) return found;
  }
  return null;
}
function proofSummary(value) {
  const proof = parseProof(value);
  if (!proof) return unavailable();
  if (typeof proof !== "object") return safe(proof);
  const parts = [];
  if (proof.verified !== undefined) parts.push(proof.verified ? "verified ✅" : "not verified ⚠️");
  if (proof.source) parts.push(`source ${proof.source}`);
  if (proof.observed_at) parts.push(`observed ${when(proof.observed_at)}`);
  const ids = [
    proof.parent_order_id ? `parent ${proof.parent_order_id}` : "",
    proof.tp_order_id ? `TP ${proof.tp_order_id}` : "",
    proof.sl_order_id ? `SL ${proof.sl_order_id}` : "",
  ].filter(Boolean).join(" / ");
  if (ids) parts.push(ids);
  const statuses = [
    proof.parent_status ? `parent ${proof.parent_status}` : "",
    proof.tp_status ? `TP ${proof.tp_status}` : "",
    proof.sl_status ? `SL ${proof.sl_status}` : "",
  ].filter(Boolean).join(" / ");
  if (statuses) parts.push(statuses);
  if (proof.execution_mode) parts.push(`mode ${proof.execution_mode}`);
  return parts.length ? safe(parts.join(" · ")) : safe(JSON.stringify(proof));
}
function timestampOrUnavailable(value) { return value ? when(value) : unavailable(); }
function moneyOrUnavailable(value) { return value === null || value === undefined || value === "" ? unavailable() : money(value); }
function normalizedMoneyOrUnavailable(value, normalizedValue) {
  if (value === null || value === undefined || value === "") return unavailable();
  return money(normalizedValue);
}
function localTradingDate(row) {
  const ts = row?.entry_fill_ts || row?.decision_ts || row?.exit_ts || row?.decision_reference_ts;
  if (!ts) return unavailable();
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
  } catch { return safe(ts); }
}
function secondsText(value) {
  if (value === null || value === undefined || value === "") return unavailable();
  const n = Number(value);
  if (!Number.isFinite(n)) return safe(value);
  if (Math.abs(n) >= 3600) return `${(n / 3600).toFixed(2)}h`;
  if (Math.abs(n) >= 60) return `${(n / 60).toFixed(1)}m`;
  return `${n.toFixed(1)}s`;
}
function priceReturnPct(row) {
  const entry = Number(row?.entry_price);
  const exit = Number(row?.exit_price);
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || entry === 0) return null;
  const dir = String(row?.direction || "").toUpperCase();
  const raw = ((exit - entry) / entry) * 100;
  return dir === "SHORT" ? -raw : raw;
}
function capitalReturnPct(row) {
  const deployed = deployedValue(row);
  const net = netValue(row);
  return deployed ? (net / deployed) * 100 : null;
}
function tpContradiction(row) {
  if (String(row?.exit_reason || "").toUpperCase() !== "TP") return "";
  const entry = Number(row?.entry_price);
  const exit = Number(row?.exit_price);
  if (!Number.isFinite(entry) || !Number.isFinite(exit)) return "";
  const dir = String(row?.direction || "").toUpperCase();
  if (dir === "LONG" && exit < entry) return "TP contradiction: LONG take-profit exit is below entry. Check bracket/fill evidence before trusting this row.";
  if (dir === "SHORT" && exit > entry) return "TP contradiction: SHORT take-profit exit is above entry. Check bracket/fill evidence before trusting this row.";
  return "";
}
function sourceLink(row) {
  const url = row?.catalyst_url || row?.source_url || row?.url;
  if (!url) return unavailable();
  const label = row?.catalyst_accession || row?.source || row?.publisher || "Open source";
  return `<a class="source-link" href="${esc(url)}" target="_blank" rel="noreferrer">${safe(label)}</a>`;
}
function evidenceItem(label, value, className = "") {
  return `<div class="evidence-item ${className}">
    <span>${esc(label)}</span>
    <strong>${value}</strong>
  </div>`;
}
function evidencePanel(title, items, tone = "") {
  return `<section class="evidence-panel ${tone}">
    <h4>${esc(title)}</h4>
    <div class="evidence-list">${items.join("")}</div>
  </section>`;
}
function qualityFlagChips(flags) {
  if (!flags || typeof flags !== "object") return unavailable();
  const entries = Object.entries(flags).slice(0, 24);
  if (!entries.length) return unavailable();
  return `<div class="flag-cloud">${entries.map(([key, value]) => {
    const good = value === true || String(value).toUpperCase().includes("VALID") || String(value).toUpperCase().includes("COMPLETE") || String(value).toUpperCase().includes("COSTED");
    const text = typeof value === "boolean" ? (value ? "yes" : "no") : value;
    return `<span class="flag-chip ${good ? "ok" : "warn"}">${safe(key)}: ${safe(text)}</span>`;
  }).join("")}</div>`;
}
function realRowKey(row) {
  return row?.event_id || `${row?.symbol || ""}|${row?.entry_fill_ts || ""}|${row?.entry_price || ""}`;
}
function enrichRealDecisionRows(real, rows) {
  const lookup = new Map();
  for (const row of [].concat(real.recent_closed || [], real.recent_costed_closed || [], real.open_positions || [])) {
    lookup.set(realRowKey(row), row);
  }
  return (rows || []).map((row) => {
    const source = lookup.get(realRowKey(row)) || {};
    const merged = { ...row };
    for (const [key, value] of Object.entries(source)) {
      if (merged[key] === null || merged[key] === undefined || merged[key] === "") merged[key] = value;
    }
    return merged;
  });
}
function rowMatchesFilter(row) {
  return state.filter === "ALL" || catalystKey(row) === state.filter;
}
function groupReal(rows, field) {
  const groups = {};
  for (const row of rows || []) {
    const key = String(row?.[field] || "UNKNOWN");
    if (!groups[key]) groups[key] = { value: key, n: 0, wins: 0, gross_pnl: 0, commissions: 0, net_pnl: 0 };
    const group = groups[key];
    const net = netValue(row);
    group.n += 1;
    group.wins += net > 0 ? 1 : 0;
    group.gross_pnl += grossValue(row);
    group.commissions += commissionValue(row);
    group.net_pnl += net;
  }
  return Object.values(groups).map((g) => ({
    ...g,
    gross_pnl: Number(g.gross_pnl.toFixed(2)),
    commissions: Number(g.commissions.toFixed(2)),
    net_pnl: Number(g.net_pnl.toFixed(2)),
    win_rate: Number((g.wins / Math.max(g.n, 1) * 100).toFixed(1)),
  })).sort((a, b) => Math.abs(b.net_pnl) - Math.abs(a.net_pnl));
}
function filteredEquityCurve(rows) {
  let total = 0;
  return (rows || []).slice().sort((a, b) => new Date(a.exit_ts || 0) - new Date(b.exit_ts || 0)).map((row, index) => {
    const net = netValue(row);
    total += net;
    return { n: index + 1, ts: row.exit_ts, symbol: row.symbol, net_pnl: Number(net.toFixed(2)), cumulative_net_pnl: Number(total.toFixed(2)) };
  });
}
function realForFilter(real) {
  if (state.filter === "ALL") return { ...real, decision_feed: enrichRealDecisionRows(real, real.decision_feed || []) };
  const detail = real.by_catalyst_detail?.[state.filter];
  if (detail) return { ...real, ...detail, stale_open_n: 0, uncosted_closed_n: 0 };
  const closedAll = (real.recent_closed || []).filter(rowMatchesFilter);
  const costed = closedAll.filter((row) => row.exit_ts && row.exit_price != null && (row.net_pnl != null || row.net_pnl_after_commissions != null || row.net_pnl_after_commissions_cad != null || row._net_pnl != null));
  const open = (real.open_positions || []).filter(rowMatchesFilter);
  const wins = costed.filter((row) => netValue(row) > 0);
  const gross = costed.reduce((sum, row) => sum + grossValue(row), 0);
  const commissions = costed.reduce((sum, row) => sum + commissionValue(row), 0);
  const net = costed.reduce((sum, row) => sum + netValue(row), 0);
  return {
    ...real,
    n: costed.length,
    closed_n: closedAll.length,
    uncosted_closed_n: Math.max(0, closedAll.length - costed.length),
    open_n: open.length,
    stale_open_n: 0,
    wins: wins.length,
    losses: costed.length - wins.length,
    win_rate: Number((wins.length / Math.max(costed.length, 1) * 100).toFixed(1)),
    gross_pnl: Number(gross.toFixed(2)),
    commissions: Number(commissions.toFixed(2)),
    net_pnl: Number(net.toFixed(2)),
    by_rule: groupReal(costed, "rule_id"),
    by_catalyst: groupReal(costed, "catalyst_type"),
    by_direction: groupReal(costed, "direction"),
    equity_curve: filteredEquityCurve(costed),
    recent_closed: closedAll.slice(0, 100),
    recent_costed_closed: costed.slice(0, 100),
    open_positions: open.slice(0, 100),
    decision_feed: enrichRealDecisionRows(real, real.decision_feed || []).filter(rowMatchesFilter),
  };
}
function setupFilter(real) {
  const types = catalystTypesFrom(real.by_catalyst, real.decision_feed, real.recent_closed, real.open_positions);
  const counts = Object.fromEntries((real.by_catalyst || []).map((r) => [String(r.value || "UNKNOWN"), Number(r.n || 0)]));
  renderCatalystFilter("catalyst-filter", state.filter, types, counts, "real");
  $("filter-copy").textContent = state.filter === "ALL"
    ? "Showing all verified REAL trades."
    : `Showing REAL trades for ${catalystDisplay(state.filter)} only.`;
  $("catalyst-filter")?.querySelectorAll("[data-catalyst-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.getAttribute("data-catalyst-filter") || "ALL";
      renderAll();
    });
  });
}
function renderAll() {
  const real = realForFilter(state.raw || {});
  setupFilter(state.raw || {});
  renderDataContractPanel("data-contract-state", state.raw || {}, state.topData || {}, { population: "REAL", venue: "IBKR/PAPER", table: "public.agent_trades" });
  renderHero(real); renderMetrics(real); renderPnlBars(real); renderGauges(real);
  renderEquity(real); renderGroups(real); renderOpenPositions(real);
  renderCryptoStatus(real); renderDecisionFeed(real); renderReconciliation(real);
  $("refresh-status").className = "status-pill ok";
  const filterText = state.filter === "ALL" ? "" : ` · ${catalystDisplay(state.filter)}`;
  $("refresh-status").innerHTML = `<strong>Live${filterText}</strong> · REAL n=${num(real.n)} · updated ${state.lastLoadedAt?.toLocaleTimeString?.() || "now"}`;
}

function renderHero(real) {
  $("hero-net").innerHTML = `<span class="${cls(real.net_pnl)}">${money(real.net_pnl)}</span>`;
  $("hero-net-sub").textContent = `${money(real.gross_pnl)} gross − ${money(real.commissions)} commissions · n=${num(real.n)}`;
  $("hero-real-n").textContent = num(real.n);
  $("hero-open-n").textContent = num(real.open_n);
  $("hero-win").textContent = pct(real.win_rate);
  $("hero-win-sub").textContent = `${num(real.wins)} wins / ${num(real.losses)} losses · n=${num(real.n)}`;
}

function renderMetrics(real) {
  const costed = (real.recent_costed_closed && real.recent_costed_closed.length ? real.recent_costed_closed : real.recent_closed) || [];
  const deployed = costed.reduce((sum, row) => sum + deployedValue(row), 0);
  const avgDeployed = real.n ? deployed / real.n : 0;
  $("real-metrics").innerHTML = [
    metric("Costed net P&L", `<span class="${cls(real.net_pnl)}">${money(real.net_pnl)}</span>`, real.n,
      `${money(real.gross_pnl)} gross − ${money(real.commissions)} commissions`),
    metric("Gross P&L", money(real.gross_pnl), real.n, "Before commissions", cls(real.gross_pnl)),
    metric("Commissions", money(real.commissions), real.n, "IBKR reported"),
    metric("Win rate", pct(real.win_rate), real.n, `${num(real.wins)} wins / ${num(real.losses)} losses`),
    metric("Avg capital used", money(avgDeployed), real.n, `${money(deployed)} total entry notional in visible costed rows`),
    metric("Open positions", num(real.open_n), real.open_n,
      `${num(real.stale_open_n)} superseded open rows · ${num(real.anomalous_closed_missing_exit_n)} anomalous closed rows`),
  ].join("");
}

function renderReconciliation(real) {
  const target = $("reconciliation-state");
  if (!target) return;
  const rec = real.reconciliation || {};
  const warnings = rec.warnings || [];
  const status = rec.status || real.reconciliation_status || "UNKNOWN";
  target.innerHTML = `
    <div><strong>Status:</strong> ${safe(status)} ${status === "PASS" ? "✅" : "⚠️"}</div>
    <div><strong>Scope:</strong> ${safe(rec.scope || "IBKR/PAPER only")}</div>
    <div><strong>Open count basis:</strong> latest lifecycle projection; broker-backed close evidence supersedes older open rows.</div>
    <div><strong>Broker live check:</strong> ${safe(rec.broker_live_check || "not reported")}</div>
    <div><strong>Ledger mirror check:</strong> ${safe(rec.ledger_live_check || "not reported")}</div>
    <div><strong>Hidden stale/anomaly rows:</strong> ${num(real.stale_open_n)} stale open · ${num(real.anomalous_closed_missing_exit_n)} anomalous closed</div>
    ${warnings.length ? `<ul>${warnings.map((w) => `<li>${safe(w)}</li>`).join("")}</ul>` : `<div>No reconciliation warnings from the API projection.</div>`}
  `;
}

function renderPnlBars(real) {
  const gross = Number(real.gross_pnl || 0);
  const commissions = -Math.abs(Number(real.commissions || 0));
  const net = Number(real.net_pnl || 0);
  const maxAbs = Math.max(Math.abs(gross), Math.abs(commissions), Math.abs(net), 1);
  $("pnl-bars").innerHTML = [
    barRow("Gross P&L", gross, maxAbs, money(gross), cls(gross)),
    barRow("Commissions", commissions, maxAbs, money(Math.abs(commissions)), "negative"),
    barRow("Net P&L", net, maxAbs, money(net), cls(net)),
  ].join("");
}

function renderGauges(real) {
  const byDir = Object.fromEntries((real.by_direction || []).map((r) => [String(r.value || "").toUpperCase(), r]));
  const long = byDir.LONG || {}, short = byDir.SHORT || {};
  $("win-gauges").innerHTML = [
    donutGauge("Overall win", real.win_rate, real.n, "#35d399"),
    donutGauge("Long win", long.win_rate, long.n || 0, "#60a5fa"),
    donutGauge("Short win", short.win_rate, short.n || 0, "#fb7185"),
  ].join("");
}

function renderEquity(real) {
  $("equity-curve").innerHTML = lineChart(real.equity_curve || [], "cumulative_net_pnl", "Verified net P&L curve");
}

function ruleCards(rows, emptyText) {
  if (!rows || rows.length === 0) return `<div class="empty">${esc(emptyText)}</div>`;
  return `<div class="rule-cards">${rows.slice(0, 12).map((r) => `
    <div class="rule-card">
      <div class="rc-top">
        <div class="rc-name">${safe(r.value)}</div>
        <div class="rc-net ${cls(r.net_pnl)}">${money(r.net_pnl)}</div>
      </div>
      <div class="rc-meta">
        <span>n=${num(r.n)}</span>
        <span>win ${pct(r.win_rate)}</span>
        <span>gross ${money(r.gross_pnl)}</span>
        <span>comm ${money(r.commissions)}</span>
      </div>
    </div>`).join("")}</div>`;
}

function leaderboard(rows, emptyText) {
  if (!rows || rows.length === 0) return `<div class="empty">${esc(emptyText)}</div>`;
  const maxAbs = Math.max(...rows.map((r) => Math.abs(Number(r.net_pnl || 0))), 1);
  return rows.slice(0, 12).map((r) =>
    barRow(`${safe(r.value)} · n=${num(r.n)} · win ${pct(r.win_rate)}`, Number(r.net_pnl || 0), maxAbs, money(r.net_pnl), cls(r.net_pnl))
  ).join("");
}

function renderGroups(real) {
  $("real-by-rule").innerHTML = ruleCards(real.by_rule, "No verified REAL trades by rule yet.");
  $("real-by-catalyst").innerHTML = leaderboard(real.by_catalyst, "No verified REAL trades by catalyst yet.");
  const headers = ["Direction", "n", "Win", "Gross", "Comm.", "Net"];
  $("real-by-direction").innerHTML = table(headers, real.by_direction || [], (r) => `
    <tr>
      <td>${safe(r.value)}</td><td class="mono">${num(r.n)}</td><td class="mono">${pct(r.win_rate)}</td>
      <td class="mono ${cls(r.gross_pnl)}">${money(r.gross_pnl)}</td>
      <td class="mono negative">${money(r.commissions)}</td>
      <td class="mono ${cls(r.net_pnl)}">${money(r.net_pnl)}</td>
    </tr>`, "No verified REAL trades by direction yet.");
}

function renderOpenPositions(real) {
  $("open-positions").innerHTML = table(
    ["Symbol", "Venue", "Dir", "Qty", "Capital used", "Entry", "Entry time"],
    real.open_positions || [],
    (r) => `<tr>
        <td><strong>${safe(r.symbol)}</strong></td>
        <td>${populationLabel(r)}</td>
        <td>${safe(r.direction)}</td>
        <td class="mono">${num(quantityValue(r))}</td>
        <td class="mono">${deployedValue(r) ? money(deployedValue(r)) : "—"}</td>
        <td class="mono">${maybeMoney(r.entry_price)}</td>
        <td>${when(r.entry_fill_ts)}</td>
      </tr>`,
    "No open REAL positions."
  );
}

function renderCryptoStatus(real) {
  const rows = []
    .concat(real.decision_feed || [], real.open_positions || [], real.recent_closed || []);
  const seen = new Set();
  let ndaxRealCrypto = 0;
  const proxies = { COIN: 0, IBIT: 0, ETHA: 0 };
  for (const r of rows) {
    const key = r.event_id || `${r.symbol}|${r.entry_fill_ts}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const venue = String(r.venue || "").toUpperCase();
    const sym = String(r.symbol || "").toUpperCase();
    if (venue === "NDAX") ndaxRealCrypto += 1;
    if (sym in proxies) proxies[sym] += 1;
  }
  const proxyRows = Object.entries(proxies);
  $("crypto-status").innerHTML = `
    <div class="metric" style="margin-bottom:12px">
      <div class="metric-label">NDAX crypto (real money)</div>
      <div class="metric-value ${ndaxRealCrypto > 0 ? "" : "muted"}">${ndaxRealCrypto === 0 ? "GATED" : num(ndaxRealCrypto)}</div>
      <div class="metric-sub">NDAX crypto: gated — ${num(ndaxRealCrypto)} real crypto yet</div>
    </div>
    <div class="small" style="margin:4px 0 8px">crypto_news equity proxies (separate from NDAX spot; these are US-listed, not crypto):</div>
    ${table(["Proxy", "REAL rows seen"], proxyRows,
      ([sym, n]) => `<tr><td><strong>${esc(sym)}</strong></td><td class="mono">${num(n)}</td></tr>`,
      "No proxy rows.")}
  `;
}

function renderDecisionFeed(real) {
  const rows = real.decision_feed || [];
  if (rows.length === 0) { $("decision-feed").innerHTML = `<div class="empty">No REAL decisions to show yet.</div>`; return; }
  $("decision-feed").innerHTML = rows.map((r) => {
    const isClosed = r.exit_ts && r.exit_price !== null && r.exit_price !== undefined;
    const isCosted = r.net_pnl !== null && r.net_pnl !== undefined;
    const net = Number(r.net_pnl || 0);
    const deployed = deployedValue(r);
    const roc = isClosed && isCosted ? capitalReturnPct(r) : null;
    const priceReturn = isClosed ? priceReturnPct(r) : null;
    const contradiction = tpContradiction(r);
    const catalystPublished = r.catalyst_ts || r.source_published_at || r.published_at || r.provider_ts;
    return `<article class="decision-card trade-evidence-card">
        <div class="decision-top">
          <div>
            <div class="decision-title">${safe(r.symbol)} · ${safe(r.direction)} · ${catalystLabel(r)}</div>
            <div class="small">${populationLabel(r)} · local trading date ${localTradingDate(r)} · ${safe(r.headline)}</div>
          </div>
          <div class="mono ${isClosed && isCosted ? cls(net) : "muted"}">${isClosed ? (isCosted ? money(net) : "COST PENDING") : "OPEN"}</div>
        </div>
        ${contradiction ? `<div class="warning-row boundary-error">${esc(contradiction)}</div>` : ""}
        <div class="trade-evidence-grid">
          ${evidencePanel("Money + venue", [
            evidenceItem("Venue", safe(r.venue)),
            evidenceItem("Money status", safe(r.money_status)),
            evidenceItem("Validation", safe(r.validation_state)),
            evidenceItem("Local trading date", localTradingDate(r)),
            evidenceItem("Quantity", quantityText(r), hasQuantity(r) ? "" : "warn"),
            evidenceItem("Entry notional", deployed ? money(deployed) : unavailable()),
          ], "real")}
          ${evidencePanel("Entry / exit / P&L", [
            evidenceItem("Entry fill", `${moneyOrUnavailable(r.entry_price)} · ${timestampOrUnavailable(r.entry_fill_ts)}`),
            evidenceItem("Exit fill", isClosed ? `${moneyOrUnavailable(r.exit_price)} · ${timestampOrUnavailable(r.exit_ts)}` : unavailable("OPEN")),
            evidenceItem("Exit reason", isClosed ? safe(r.exit_reason) : unavailable("OPEN")),
            evidenceItem("Gross P&L", moneyOrUnavailable(r.gross_pnl), cls(grossValue(r))),
            evidenceItem("Commissions", normalizedMoneyOrUnavailable(r.commissions ?? r.commissions_cad ?? r._commissions, commissionValue(r)), "negative"),
            evidenceItem("Net P&L", moneyOrUnavailable(r.net_pnl), cls(net)),
            evidenceItem("Price return", priceReturn == null ? unavailable() : pct3(priceReturn), priceReturn == null ? "warn" : cls(priceReturn)),
            evidenceItem("Net return on capital", roc == null ? unavailable() : pct3(roc), roc == null ? "warn" : cls(roc)),
            evidenceItem("MFE / MAE", `${r.mfe_pct == null ? unavailable() : pct(r.mfe_pct)} / ${r.mae_pct == null ? unavailable() : pct(r.mae_pct)}`),
          ], "real")}
          ${evidencePanel("Catalyst + source", [
            evidenceItem("Catalyst", catalystLabel(r)),
            evidenceItem("Headline", safe(r.headline)),
            evidenceItem("Source", sourceLink(r)),
            evidenceItem("Catalyst publication time", timestampOrUnavailable(catalystPublished)),
            evidenceItem("Decision time", timestampOrUnavailable(r.decision_ts)),
            evidenceItem("Decision reference", `${moneyOrUnavailable(r.decision_reference_price)} · ${timestampOrUnavailable(r.decision_reference_ts)}`),
          ])}
          ${evidencePanel("Rule + why", [
            evidenceItem("Rule ID", safe(r.rule_id)),
            evidenceItem("Direction basis", safe(r.direction_basis)),
            evidenceItem("Why", safe(r.reason, "No reason text captured.")),
            evidenceItem("Catalyst rank", valueOrUnavailable(r.catalyst_rank, safe)),
            evidenceItem("Catalyst strength", valueOrUnavailable(r.catalyst_strength, safe)),
          ])}
          ${evidencePanel("Latency", [
            evidenceItem("Catalyst → decision", secondsText(r.latency_catalyst_to_decision_s ?? r.news_to_decision_s)),
            evidenceItem("Decision → order", secondsText(r.decision_to_order_s)),
            evidenceItem("Order → fill", secondsText(r.order_to_fill_s)),
            evidenceItem("Decision → fill", secondsText(r.latency_decision_to_fill_s)),
            evidenceItem("Hold time", r.hold_duration_min == null ? unavailable() : `${Number(r.hold_duration_min).toFixed(1)}m`),
          ])}
          ${evidencePanel("Bracket proof", [
            (() => {
              const initialProof = parseProof(r.initial_bracket_proof || r.bracket_initial_state);
              const adjustedProof = parseProof(r.fill_adjusted_bracket_proof || r.bracket_adjusted_state);
              const proofs = [adjustedProof, initialProof];
              const parentId = proofValue(r, ["parent_order_id", "parent_order_ref"], proofs);
              const tpId = proofValue(r, ["tp_order_id", "take_profit_order_id"], proofs);
              const slId = proofValue(r, ["sl_order_id", "stop_loss_order_id"], proofs);
              return [
                evidenceItem("Parent order ID", valueOrUnavailable(parentId, safe), parentId ? "" : "warn"),
                evidenceItem("TP order ID", valueOrUnavailable(tpId, safe), tpId ? "" : "warn"),
                evidenceItem("SL order ID", valueOrUnavailable(slId, safe), slId ? "" : "warn"),
                evidenceItem("Initial bracket", proofSummary(r.initial_bracket_proof || r.bracket_initial_state), (r.initial_bracket_proof || r.bracket_initial_state) ? "" : "warn"),
                evidenceItem("Fill-adjusted bracket", proofSummary(r.fill_adjusted_bracket_proof || r.bracket_adjusted_state), (r.fill_adjusted_bracket_proof || r.bracket_adjusted_state) ? "" : "warn"),
              ].join("");
            })(),
          ], "warn")}
        </div>
        <details class="quality-details">
          <summary>Data-quality flags</summary>
          ${qualityFlagChips(r.quality_flags)}
        </details>
      </article>`;
  }).join("");
}

function renderSecurity(data, security) {
  const apiSec = data.security || {};
  const ok = security?.ok !== false && (apiSec.key_role === "anon" || security?.anon_key_role === "anon");
  $("security-state").innerHTML = `
    <div><strong>Supabase project:</strong> ${safe(security?.supabase_project_ref || "—")}</div>
    <div><strong>Anon key role:</strong> ${safe(apiSec.key_role || security?.anon_key_role)} ${ok ? "✅" : "⚠️"} <span class="small">(privileged service key never reaches the front end)</span></div>
    <div><strong>agent_trades RLS:</strong> ${apiSec.rls_verified_tables?.agent_trades ? "enabled ✅" : "unknown ⚠️"}</div>
    <div><strong>RLS verified:</strong> ${safe(apiSec.rls_verified_at || security?.rls_verified_at)}</div>`;
}

function showError(error) {
  const msg = `IBKR/REAL cockpit is fail-closed: ${error.message}`;
  $("refresh-status").className = "status-pill bad";
  $("refresh-status").innerHTML = `<strong>Blocked</strong> · ${new Date().toLocaleTimeString()}`;
  ["data-contract-state", "real-metrics", "pnl-bars", "win-gauges", "equity-curve", "real-by-rule", "real-by-catalyst",
    "real-by-direction", "open-positions", "decision-feed", "crypto-status"].forEach((id) => {
    if ($(id)) $(id).innerHTML = `<div class="empty">${esc(msg)}</div>`;
  });
}

async function load() {
  try {
    const security = await fetchSecurity();
    const data = await fetchDashboard();
    state.raw = data.real || {};
    state.topData = data || {};
    state.lastLoadedAt = new Date();
    renderAll();
    renderSecurity(data, security);
  } catch (error) { showError(error); }
}

document.addEventListener("DOMContentLoaded", () => { load(); setInterval(load, 30000); });
