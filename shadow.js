/* SHADOW / RESEARCH cockpit — same shape as IBKR / REAL, but research-only.
 * Reads ONLY data.shadow (public.agent_shadow_trades). Dollar values are fixed
 * $10K hypothetical translations from observed forward returns, not real fills. */
const state = { lastLoadedAt: null, filter: "ALL", raw: null };
const RESEARCH_NOTIONAL = 10000;

function hasValue(v) { return v !== null && v !== undefined && v !== ""; }
function returnValue(r, horizon) { return r[`direction_adjusted_return_${horizon}_pct`] ?? r[`return_${horizon}_pct`]; }
function isCompleteObservation(r) { return String(r.status || "").toUpperCase() === "COMPLETE" || hasValue(r.price_eod) || hasValue(returnValue(r, "eod")); }
function latestReturn(r) {
  for (const key of ["eod", "1h", "15m", "5m"]) {
    const value = returnValue(r, key);
    if (hasValue(value)) return { horizon: key.toUpperCase(), value: Number(value) };
  }
  return null;
}
function hypotheticalPnl(returnPct, notional = RESEARCH_NOTIONAL) { return Number(returnPct || 0) * notional / 100; }
function completeRows(shadow) { return (shadow.recent_priced || []).filter(isCompleteObservation); }
function pendingRows(shadow) { return (shadow.recent_priced || []).filter((r) => !isCompleteObservation(r)); }
function horizonByName(shadow, name) { return (shadow.horizon_ladder || []).find((r) => String(r.horizon || "").toLowerCase() === name); }
function rowMatchesFilter(row) { return state.filter === "ALL" || catalystKey(row) === state.filter; }
function pricedCounts(rows, field) {
  const counts = {};
  for (const row of rows || []) {
    const key = String(row?.[field] || "UNKNOWN");
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.entries(counts).map(([value, priced_n]) => ({ value, priced_n })).sort((a, b) => b.priced_n - a.priced_n);
}
function filteredLadder(rows) {
  return ["5m", "15m", "1h", "eod"].map((h) => {
    const values = (rows || []).map((row) => returnValue(row, h)).filter(hasValue).map(Number);
    const wins = values.filter((v) => v > 0).length;
    return {
      horizon: h === "eod" ? "EOD" : h,
      priced_n: values.length,
      avg_direction_adjusted_return_pct: values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3)) : 0,
      hit_rate: values.length ? Number((wins / values.length * 100).toFixed(1)) : 0,
    };
  });
}
function shadowForFilter(shadow) {
  if (state.filter === "ALL") return shadow;
  const detail = shadow.by_catalyst_detail?.[state.filter];
  if (detail) return { ...shadow, ...detail };
  const allRows = shadow.recent_priced || [];
  const rows = allRows.filter(rowMatchesFilter);
  const priced = rows.filter(_isPricedLocal);
  const pending = rows.filter((row) => !_isPricedLocal(row));
  return {
    ...shadow,
    priced_n: priced.length,
    pending_or_unpriced_n: pending.length,
    total_rows_diagnostic: rows.length,
    horizon_ladder: filteredLadder(priced),
    net_by_catalyst: [],
    by_rule: pricedCounts(priced, "rule_id"),
    by_catalyst: pricedCounts(priced, "catalyst_type"),
    by_direction: pricedCounts(priced, "direction"),
    recent_priced: rows,
  };
}
function _isPricedLocal(row) {
  return hasValue(row?.entry_reference_price) && ["5m", "15m", "1h", "eod"].some((h) => hasValue(row?.[`price_${h}`]));
}
function setupFilter(shadow) {
  const types = catalystTypesFrom(shadow.by_catalyst, shadow.recent_priced);
  const counts = Object.fromEntries((shadow.by_catalyst || []).map((r) => [String(r.value || "UNKNOWN"), Number(r.priced_n || 0)]));
  renderCatalystFilter("catalyst-filter", state.filter, types, counts, "shadow");
  $("filter-copy").textContent = state.filter === "ALL"
    ? "Showing all SHADOW research observations."
    : `Showing SHADOW research for ${catalystDisplay(state.filter)} only.`;
  $("catalyst-filter")?.querySelectorAll("[data-catalyst-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.getAttribute("data-catalyst-filter") || "ALL";
      renderAll();
    });
  });
}
function eodStats(shadow) {
  const eod = horizonByName(shadow, "eod") || bestHorizon(shadow.horizon_ladder);
  if (!eod) return null;
  const n = Number(eod.priced_n || 0);
  const avgReturn = Number(eod.avg_direction_adjusted_return_pct || 0);
  const hitRate = Number(eod.hit_rate || 0);
  const avgPnl = hypotheticalPnl(avgReturn);
  const winners = Math.round(n * hitRate / 100);
  return { ...eod, n, avgReturn, hitRate, avgPnl, totalPnl: avgPnl * n, winners, losses: Math.max(0, n - winners) };
}
function bestHorizon(ladder) {
  if (!ladder || !ladder.length) return null;
  return ladder.slice().sort((a, b) => Number(b.avg_direction_adjusted_return_pct || 0) - Number(a.avg_direction_adjusted_return_pct || 0))[0];
}
function rowPnl(r) { const mark = latestReturn(r); return mark ? hypotheticalPnl(mark.value) : null; }
function researchCurve(rows) {
  return rows.slice().sort((a, b) => new Date(a.decision_ts || 0) - new Date(b.decision_ts || 0)).map((r, i, arr) => {
    const pnl = rowPnl(r) || 0;
    const prior = i ? arr[i - 1]._cum || 0 : 0;
    r._cum = prior + pnl;
    return { cumulative_net_pnl: r._cum, label: r.symbol, ts: r.decision_ts };
  });
}
function renderHero(shadow) {
  const eod = eodStats(shadow);
  $("hero-net").innerHTML = eod ? `<span class="${cls(eod.totalPnl)}">${money(eod.totalPnl)}</span>` : "—";
  $("hero-net-sub").textContent = eod ? `${money(eod.avgPnl)} avg per ${money(RESEARCH_NOTIONAL)} idea · ${safe(eod.horizon || "EOD")} n=${num(eod.n)}` : "waiting for priced EOD horizon";
  $("hero-real-n").textContent = num(shadow.priced_n);
  $("hero-open-n").textContent = num(shadow.pending_or_unpriced_n);
  $("hero-win").textContent = eod ? pct(eod.hitRate) : "—";
  $("hero-win-sub").textContent = eod ? `${num(eod.winners)} wins / ${num(eod.losses)} losses · n=${num(eod.n)}` : "no EOD hit rate yet";
}
function renderMetrics(shadow) {
  const eod = eodStats(shadow);
  const best = bestHorizon(shadow.horizon_ladder);
  $("real-metrics").innerHTML = [
    metric("Research P/L", eod ? `<span class="${cls(eod.totalPnl)}">${money(eod.totalPnl)}</span>` : "—", eod?.n || 0, `${money(RESEARCH_NOTIONAL)} test size · not real cash`),
    metric("Avg per trade", eod ? `<span class="${cls(eod.avgPnl)}">${money(eod.avgPnl)}</span>` : "—", eod?.n || 0, eod ? `${pct3(eod.avgReturn)} avg direction-adjusted return` : "no EOD average yet"),
    metric("Real cash / equity", "$0", 0, "Shadow is research only; use IBKR / REAL for actual cash", "muted"),
    metric("Hit rate", eod ? pct(eod.hitRate) : "—", eod?.n || 0, eod ? `${num(eod.winners)} wins / ${num(eod.losses)} losses` : "no EOD hit rate yet"),
    metric("Priced observations", num(shadow.priced_n), shadow.priced_n, `${num(shadow.pending_or_unpriced_n)} unpriced / pending excluded`),
    metric("Best horizon", best ? `${safe(best.horizon)} ${pct3(best.avg_direction_adjusted_return_pct)}` : "—", best?.priced_n || 0, "best average observed return"),
  ].join("");
}
function renderPnlBars(shadow) {
  const eod = eodStats(shadow);
  const total = eod?.totalPnl || 0;
  const avg = eod?.avgPnl || 0;
  const zero = 0;
  const maxAbs = Math.max(Math.abs(total), Math.abs(avg), 1);
  $("pnl-bars").innerHTML = [
    barRow("Total research P/L", total, maxAbs, money(total), cls(total), "shadow"),
    barRow("Average per idea", avg, maxAbs, money(avg), cls(avg), "shadow"),
    barRow("Real cash/equity", zero, maxAbs, "$0", "muted", "shadow"),
  ].join("");
}
function renderGauges(shadow) {
  const eod = eodStats(shadow);
  const priced = Number(shadow.priced_n || 0);
  const pending = Number(shadow.pending_or_unpriced_n || 0);
  const total = priced + pending;
  $("win-gauges").innerHTML = [
    donutGauge("EOD hit", eod?.hitRate || 0, eod?.n || 0, "#c4b5fd"),
    donutGauge("Priced coverage", total ? priced * 100 / total : 0, priced, "#60a5fa"),
    donutGauge("Pending share", total ? pending * 100 / total : 0, pending, "#fbbf24"),
  ].join("");
}
function renderEquity(shadow) {
  const rows = completeRows(shadow);
  $("equity-curve").innerHTML = lineChart(researchCurve(rows), "cumulative_net_pnl", "Shadow hypothetical research P/L curve");
}
function renderLadder(shadow) {
  const ladder = shadow.horizon_ladder || [];
  if (ladder.length === 0) { $("shadow-horizon-ladder").innerHTML = `<div class="empty">No priced SHADOW horizons for this catalyst yet.</div>`; return; }
  $("shadow-horizon-ladder").innerHTML = `<div class="ladder">${ladder.map((r) => {
    const avg = Number(r.avg_direction_adjusted_return_pct || 0);
    const hit = Number(r.hit_rate || 0);
    return `<div class="ladder-card">
      <div class="ladder-top"><strong>${safe(r.horizon)}</strong><span class="mono ${cls(avg)}">${pct3(avg)}</span></div>
      <div class="bar-track"><div class="bar-fill shadow" style="width:${Math.max(3, Math.min(100, Math.abs(avg) * 20 || hit))}%"></div></div>
      <div class="small">priced n=${num(r.priced_n)} · hit rate ${pct(hit)}</div>
    </div>`;
  }).join("")}</div>`;
}
function ruleCards(rows, emptyText) {
  if (!rows || rows.length === 0) return `<div class="empty">${esc(emptyText)}</div>`;
  return `<div class="rule-cards">${rows.slice(0, 12).map((r) => `
    <div class="rule-card">
      <div class="rc-top"><div class="rc-name">${safe(r.value)}</div><div class="rc-net muted">n=${num(r.priced_n)}</div></div>
      <div class="rc-meta"><span>priced n=${num(r.priced_n)}</span><span>research only</span><span>no real fills</span></div>
    </div>`).join("")}</div>`;
}
function catalystLeaderboard(shadow) {
  const detail = state.raw?.by_catalyst_detail;
  if (state.filter === "ALL" && detail && Object.keys(detail).length) {
    return Object.entries(detail).map(([key, summary]) => {
      const eod = horizonByName(summary, "eod") || bestHorizon(summary.horizon_ladder);
      const net = (summary.net_by_catalyst || [])[0];
      return `<div class="rule-card">
        <div class="rc-top"><div class="rc-name">${safe(catalystDisplay(key))}</div><div class="rc-net muted">priced n=${num(summary.priced_n)}</div></div>
        <div class="rc-meta">
          <span>${safe(eod?.horizon || "horizon")} ${eod ? pct3(eod.avg_direction_adjusted_return_pct) : "—"}</span>
          <span>hit ${eod ? pct(eod.hit_rate) : "—"}</span>
          <span>${net ? `${money(net.net_pnl)} modeled` : "net pending capture"}</span>
        </div>
      </div>`;
    }).join("");
  }
  const rows = shadow.by_catalyst || [];
  if (!rows.length) return `<div class="empty">No priced SHADOW rows by catalyst yet.</div>`;
  const max = Math.max(...rows.map((r) => Number(r.priced_n || 0)), 1);
  return rows.slice(0, 12).map((r) => barRow(
    `${safe(r.value)} · priced n=${num(r.priced_n)}`,
    Number(r.priced_n || 0),
    max,
    `n=${num(r.priced_n)}`,
    "muted",
    "shadow"
  )).join("");
}
function renderGroups(shadow) {
  $("shadow-by-rule").innerHTML = ruleCards(shadow.by_rule, "No priced SHADOW rows by rule yet.");
  $("shadow-by-catalyst").innerHTML = catalystLeaderboard(shadow);
  $("shadow-by-direction").innerHTML = table(["Direction", "priced n", "Research status"], shadow.by_direction || [], (r) => `
    <tr><td>${safe(r.value)}</td><td class="mono">${num(r.priced_n)}</td><td>priced marks only · no real fills</td></tr>`, "No priced SHADOW rows by direction yet.");
}
function renderPending(shadow) {
  const rows = pendingRows(shadow).slice().sort((a, b) => new Date(b.decision_ts || 0) - new Date(a.decision_ts || 0));
  $("pending-marks").innerHTML = table(["Symbol", "Dir", "Latest mark", "Waiting on"], rows.slice(0, 10), (r) => {
    const latest = latestReturn(r);
    const missing = ["5m", "15m", "1h", "eod"].filter((h) => !hasValue(returnValue(r, h))).map((h) => h.toUpperCase()).join(", ") || "later multi-day";
    return `<tr><td><strong>${safe(r.symbol)}</strong></td><td>${safe(r.direction)}</td><td class="mono ${latest ? cls(latest.value) : "muted"}">${latest ? `${safe(latest.horizon)} ${pct3(latest.value)}` : "—"}</td><td>${safe(missing)}</td></tr>`;
  }, "No pending SHADOW marks in current feed.");
}
function returnGrid(r) {
  return ["5m", "15m", "1h", "eod"].map((h) => {
    const v = returnValue(r, h);
    return `<span class="chip ${hasValue(v) ? cls(v) : "muted"}">${h.toUpperCase()} ${hasValue(v) ? pct3(v) : "—"}</span>`;
  }).join("");
}
function renderDecisionFeed(shadow) {
  const rows = completeRows(shadow).slice().sort((a, b) => new Date(b.decision_ts || 0) - new Date(a.decision_ts || 0));
  if (!rows.length) { $("decision-feed").innerHTML = `<div class="empty">No complete SHADOW observations to show yet.</div>`; return; }
  $("decision-feed").innerHTML = rows.slice(0, 14).map((r) => {
    const pnl = rowPnl(r);
    const latest = latestReturn(r);
    return `<article class="decision-card">
      <div class="decision-top">
        <div><div class="decision-title">${safe(r.symbol)} · ${safe(r.direction)} · ${catalystLabel(r)}</div><div class="small">${safe(r.headline)} · ${populationLabel(r)}</div></div>
        <div class="mono ${cls(pnl)}">${money(pnl)}</div>
      </div>
      <div class="small section-gap">${money(RESEARCH_NOTIONAL)} hypothetical · ${safe(latest?.horizon || "mark")} return ${latest ? pct3(latest.value) : "—"}. Research only — no broker fill.</div>
      <div class="decision-meta"><span class="chip">rule ${safe(r.rule_id)}</span>${returnGrid(r)}<span class="chip">entry ${safe(r.entry_reference_price)}</span><span class="chip">${safe(r.status || "COMPLETE")}</span></div>
    </article>`;
  }).join("");
}
function renderShadowStatus(shadow) {
  const rows = shadow.recent_priced || [];
  const complete = completeRows(shadow).length;
  const pending = pendingRows(shadow).length;
  $("shadow-status").innerHTML = `
    <div class="metric" style="margin-bottom:12px"><div class="metric-label">Research contract</div><div class="metric-value muted">SHADOW</div><div class="metric-sub">not executable · no real cash/equity · no broker fills</div></div>
    ${table(["Bucket", "Rows"], [["complete in feed", complete], ["pending in feed", pending], ["priced total", shadow.priced_n || 0], ["diagnostic total", shadow.total_rows_diagnostic || 0]], ([k, v]) => `<tr><td>${esc(k)}</td><td class="mono">${num(v)}</td></tr>`, "No shadow status.")}`;
}
function renderAll() {
  const shadow = shadowForFilter(state.raw || {});
  setupFilter(state.raw || {});
  renderHero(shadow); renderMetrics(shadow); renderPnlBars(shadow); renderGauges(shadow);
  renderEquity(shadow); renderLadder(shadow); renderGroups(shadow); renderPending(shadow); renderShadowStatus(shadow);
  renderDecisionFeed(shadow);
  $("refresh-status").className = "status-pill ok";
  const filterText = state.filter === "ALL" ? "" : ` · ${catalystDisplay(state.filter)}`;
  $("refresh-status").innerHTML = `<strong>Live · research only${filterText}</strong> · priced n=${num(shadow.priced_n)} · updated ${state.lastLoadedAt?.toLocaleTimeString?.() || "now"}`;
}
function renderSecurity(data, security) {
  const apiSec = data.security || {};
  $("security-state").innerHTML = `
    <div><strong>Source table:</strong> public.agent_shadow_trades</div>
    <div><strong>Money status:</strong> research-only; real cash/equity is intentionally $0 here</div>
    <div><strong>Anon key role:</strong> ${safe(apiSec.key_role || security?.anon_key_role)} <span class="small">(no Supabase key in static page)</span></div>
    <div><strong>agent_shadow_trades RLS:</strong> ${apiSec.rls_verified_tables?.agent_shadow_trades ? "enabled ✅" : "unknown ⚠️"}</div>`;
}
function showError(error) {
  const msg = `SHADOW cockpit is fail-closed: ${error.message}`;
  $("refresh-status").className = "status-pill bad";
  $("refresh-status").innerHTML = `<strong>Blocked</strong> · ${new Date().toLocaleTimeString()}`;
  ["real-metrics", "pnl-bars", "win-gauges", "equity-curve", "shadow-horizon-ladder", "shadow-by-rule", "shadow-by-catalyst", "shadow-by-direction", "pending-marks", "decision-feed", "shadow-status"].forEach((id) => { if ($(id)) $(id).innerHTML = `<div class="empty">${esc(msg)}</div>`; });
}
async function load() {
  try {
    const security = await fetchSecurity();
    const data = await fetchDashboard();
    state.raw = data.shadow || {};
    state.lastLoadedAt = new Date();
    renderAll();
    renderSecurity(data, security);
  } catch (error) { showError(error); }
}
document.addEventListener("DOMContentLoaded", () => { load(); setInterval(load, 30000); });
