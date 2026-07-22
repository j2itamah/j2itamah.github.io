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
function deployedValue(row) {
  const qty = Math.abs(quantityValue(row));
  const entry = Number(row?.entry_price ?? 0);
  return qty && entry ? qty * entry : 0;
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
    const returnOnCapital = isClosed && isCosted && deployed ? net / deployed * 100 : null;
    return `<article class="decision-card">
        <div class="decision-top">
          <div>
            <div class="decision-title">${safe(r.symbol)} · ${safe(r.direction)} · ${catalystLabel(r)}</div>
            <div class="small">${populationLabel(r)} · ${safe(r.headline)}</div>
          </div>
          <div class="mono ${isClosed && isCosted ? cls(net) : "muted"}">${isClosed ? (isCosted ? money(net) : "COST PENDING") : "OPEN"}</div>
        </div>
        <div class="small section-gap">${safe(r.reason, "No reason text captured.")}</div>
        <div class="decision-meta">
          <span class="chip">rule ${safe(r.rule_id)}</span>
          <span class="chip">basis ${safe(r.direction_basis)}</span>
          <span class="chip">qty ${num(quantityValue(r))}</span>
          <span class="chip">capital used ${deployed ? money(deployed) : "—"}</span>
          <span class="chip">return on capital ${returnOnCapital == null ? "—" : pct3(returnOnCapital)}</span>
          <span class="chip">entry ${maybeMoney(r.entry_price)} · ${when(r.entry_fill_ts)}</span>
          <span class="chip">${isClosed ? `exit ${maybeMoney(r.exit_price)} · ${safe(r.exit_reason)}` : "exit pending"}</span>
          <span class="chip">MFE ${r.mfe_pct == null ? "—" : pct(r.mfe_pct)}</span>
          <span class="chip">MAE ${r.mae_pct == null ? "—" : pct(r.mae_pct)}</span>
          <span class="chip">hold ${safe(r.hold_duration_min)}m</span>
        </div>
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
  ["real-metrics", "pnl-bars", "win-gauges", "equity-curve", "real-by-rule", "real-by-catalyst",
    "real-by-direction", "open-positions", "decision-feed", "crypto-status"].forEach((id) => {
    if ($(id)) $(id).innerHTML = `<div class="empty">${esc(msg)}</div>`;
  });
}

async function load() {
  try {
    const security = await fetchSecurity();
    const data = await fetchDashboard();
    state.raw = data.real || {};
    state.lastLoadedAt = new Date();
    renderAll();
    renderSecurity(data, security);
  } catch (error) { showError(error); }
}

document.addEventListener("DOMContentLoaded", () => { load(); setInterval(load, 30000); });
