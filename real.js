/* IBKR / REAL cockpit — reads ONLY data.real (public.agent_trades).
 * Rule 21: every figure shown here is a verified, costed, broker-backed result. */
const state = { lastLoadedAt: null };

function renderHero(real) {
  $("hero-net").innerHTML = `<span class="${cls(real.net_pnl)}">${money(real.net_pnl)}</span>`;
  $("hero-net-sub").textContent = `${money(real.gross_pnl)} gross − ${money(real.commissions)} commissions · n=${num(real.n)}`;
  $("hero-real-n").textContent = num(real.n);
  $("hero-open-n").textContent = num(real.open_n);
  $("hero-win").textContent = pct(real.win_rate);
  $("hero-win-sub").textContent = `${num(real.wins)} wins / ${num(real.losses)} losses · n=${num(real.n)}`;
}

function renderMetrics(real) {
  $("real-metrics").innerHTML = [
    metric("Costed net P&L", `<span class="${cls(real.net_pnl)}">${money(real.net_pnl)}</span>`, real.n,
      `${money(real.gross_pnl)} gross − ${money(real.commissions)} commissions`),
    metric("Gross P&L", money(real.gross_pnl), real.n, "Before commissions", cls(real.gross_pnl)),
    metric("Commissions", money(real.commissions), real.n, "IBKR reported"),
    metric("Win rate", pct(real.win_rate), real.n, `${num(real.wins)} wins / ${num(real.losses)} losses`),
    metric("Verified closed", num(real.n), real.closed_n,
      `${num(real.uncosted_closed_n)} closed missing costs (fail-closed, excluded)`),
    metric("Open positions", num(real.open_n), real.open_n, `${num(real.stale_open_n)} stale-open flags`),
  ].join("");
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
    ["Symbol", "Venue", "Dir", "Rule", "Entry", "Entry time"],
    real.open_positions || [],
    (r) => `<tr>
        <td><strong>${safe(r.symbol)}</strong></td>
        <td>${populationLabel(r)}</td>
        <td>${safe(r.direction)}</td>
        <td>${safe(r.rule_id)}</td>
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
    const real = data.real || {};
    renderHero(real); renderMetrics(real); renderPnlBars(real); renderGauges(real);
    renderEquity(real); renderGroups(real); renderOpenPositions(real);
    renderCryptoStatus(real); renderDecisionFeed(real); renderSecurity(data, security);
    state.lastLoadedAt = new Date();
    $("refresh-status").className = "status-pill ok";
    $("refresh-status").innerHTML = `<strong>Live</strong> · REAL n=${num(real.n)} · updated ${state.lastLoadedAt.toLocaleTimeString()}`;
  } catch (error) { showError(error); }
}

document.addEventListener("DOMContentLoaded", () => { load(); setInterval(load, 30000); });
