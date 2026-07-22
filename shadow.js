/* SHADOW / RESEARCH cockpit — reads ONLY data.shadow (public.agent_shadow_trades).
 * This is research reference, NOT executable and NOT a go/no-go for real capital.
 * Only priced observations are treated as evidence; total rows are diagnostic. */
const state = { lastLoadedAt: null, observationFilter: "complete" };
const RESEARCH_NOTIONAL = 10000;

function renderHero(shadow) {
  const best = bestHorizon(shadow.horizon_ladder);
  $("hero-priced").textContent = num(shadow.priced_n);
  $("hero-modeled").textContent = "$0";
  $("hero-multi").textContent = best ? `${safe(best.horizon)} ${pct3(best.avg_direction_adjusted_return_pct)}` : "—";
  $("hero-multi").className = `metric-value ${best ? cls(best.avg_direction_adjusted_return_pct) : "muted"}`;
  $("hero-multi-sub").textContent = best ? `priced n=${num(best.priced_n)} · hit ${pct(best.hit_rate)}` : "priced horizon";
  $("hero-diag").textContent = num(shadow.pending_or_unpriced_n);
}

function bestHorizon(ladder) {
  if (!ladder || !ladder.length) return null;
  return ladder.slice().sort((a, b) =>
    Number(b.avg_direction_adjusted_return_pct || 0) - Number(a.avg_direction_adjusted_return_pct || 0))[0];
}

function renderMetrics(shadow) {
  const multi = shadow.multi_day_status || {};
  const best = bestHorizon(shadow.horizon_ladder);
  $("shadow-metrics").innerHTML = [
    metric("Priced observations", num(shadow.priced_n), shadow.priced_n, "entry reference + ≥1 forward mark"),
    metric("Modeled P&L rows", num(shadow.modeled_pnl_n), shadow.modeled_pnl_n, "qty + modeled commissions + net"),
    metric("Best horizon", best ? `${safe(best.horizon)} ${pct3(best.avg_direction_adjusted_return_pct)}` : "—",
      best ? best.priced_n : 0, "direction-adjusted avg return"),
    metric("Slot-book applied", num(shadow.slot_book_applied_n), shadow.slot_book_applied_n,
      `${num(shadow.no_slot_n)} excluded: no slot`),
    metric("Multi-day ladder", num(multi.captured_n), multi.captured_n,
      `${num(multi.pending_n)} pending · ${num(multi.missed_n)} missed`),
    metric("Diagnostic rows", num(shadow.total_rows_diagnostic), shadow.total_rows_diagnostic,
      `${num(shadow.pending_or_unpriced_n)} unpriced · NOT evidence`),
  ].join("");
}

function horizonByName(shadow, name) {
  return (shadow.horizon_ladder || []).find((r) => String(r.horizon || "").toLowerCase() === name);
}

function hypotheticalPnl(returnPct, notional = RESEARCH_NOTIONAL) {
  return Number(returnPct || 0) * notional / 100;
}

function latestReturn(r) {
  for (const key of ["eod", "1h", "15m", "5m"]) {
    const value = returnValue(r, key);
    if (hasValue(value)) return { horizon: key.toUpperCase(), value: Number(value) };
  }
  return null;
}

function eodDollarStats(shadow) {
  const eod = horizonByName(shadow, "eod");
  if (!eod) return null;
  const n = Number(eod.priced_n || 0);
  const avgReturn = Number(eod.avg_direction_adjusted_return_pct || 0);
  const hitRate = Number(eod.hit_rate || 0);
  const avgPnl = hypotheticalPnl(avgReturn);
  return {
    n,
    avgReturn,
    hitRate,
    avgPnl,
    totalPnl: avgPnl * n,
    winners: Math.round(n * hitRate / 100),
    losers: Math.max(0, n - Math.round(n * hitRate / 100)),
  };
}

function recentDollarStats(rows) {
  const priced = (rows || []).map((r) => ({ row: r, mark: latestReturn(r) })).filter((x) => x.mark);
  const pnls = priced.map((x) => hypotheticalPnl(x.mark.value));
  const total = pnls.reduce((a, b) => a + b, 0);
  const best = priced.slice().sort((a, b) => hypotheticalPnl(b.mark.value) - hypotheticalPnl(a.mark.value))[0];
  const worst = priced.slice().sort((a, b) => hypotheticalPnl(a.mark.value) - hypotheticalPnl(b.mark.value))[0];
  return {
    n: priced.length,
    total,
    avg: priced.length ? total / priced.length : 0,
    wins: pnls.filter((x) => x > 0).length,
    losses: pnls.filter((x) => x < 0).length,
    best,
    worst,
  };
}

function renderDollarView(shadow) {
  const eod = eodDollarStats(shadow);
  const completeRows = sortedObservations(shadow.recent_priced || [], "complete");
  const recent = recentDollarStats(completeRows);
  const eodCards = eod ? [
    metric("EOD research P/L", `<span class="${cls(eod.totalPnl)}">${money(eod.totalPnl)}</span>`, eod.n,
      `${money(RESEARCH_NOTIONAL)} × every EOD-priced observation`),
    metric("Avg per trade", `<span class="${cls(eod.avgPnl)}">${money(eod.avgPnl)}</span>`, eod.n,
      `${pct3(eod.avgReturn)} avg direction-adjusted EOD return`),
    metric("Wins / losses", `${num(eod.winners)} / ${num(eod.losers)}`, eod.n,
      `${pct(eod.hitRate)} hit rate at EOD`),
  ] : [
    metric("EOD research P/L", "—", 0, "no EOD-priced observations yet"),
    metric("Avg per trade", "—", 0, "no EOD-priced observations yet"),
    metric("Wins / losses", "—", 0, "no EOD-priced observations yet"),
  ];
  const recentLabel = recent.n
    ? `<span class="${cls(recent.total)}">${money(recent.total)}</span>`
    : "—";
  $("shadow-dollar-cards").innerHTML = [
    ...eodCards,
    metric("Visible complete rows", recentLabel, recent.n,
      `${money(recent.avg)} avg · best ${recent.best ? money(hypotheticalPnl(recent.best.mark.value)) : "—"} · worst ${recent.worst ? money(hypotheticalPnl(recent.worst.mark.value)) : "—"}`),
  ].join("");
  if ($("shadow-dollar-note")) {
    $("shadow-dollar-note").textContent = eod
      ? `Translation: Shadow has no real cash or equity. This converts the EOD research return into dollars using a fixed $10K test size so you can see trade count, estimated gains, estimated losses, and average dollars per idea.`
      : "Shadow has no real cash or equity. Dollar view will populate once EOD-priced observations exist.";
  }
}

function renderLadder(shadow) {
  const ladder = shadow.horizon_ladder || [];
  if (ladder.length === 0) { $("shadow-horizon-ladder").innerHTML = `<div class="empty">No priced SHADOW horizons yet.</div>`; return; }
  $("shadow-horizon-ladder").innerHTML = `<div class="ladder">${ladder.map((r) => {
    const avg = Number(r.avg_direction_adjusted_return_pct || 0);
    const hit = Number(r.hit_rate || 0);
    return `<div class="ladder-card">
        <div class="ladder-top"><strong>${safe(r.horizon)}</strong><span class="mono ${cls(avg)}">${avg.toFixed(3)}%</span></div>
        <div class="bar-track"><div class="bar-fill shadow" style="width:${Math.max(3, Math.min(100, hit))}%"></div></div>
        <div class="small">priced n=${num(r.priced_n)} · hit rate ${pct(hit)}</div>
      </div>`;
  }).join("")}</div>`;
}

function renderNetByCatalyst(shadow) {
  const rows = shadow.net_by_catalyst || [];
  if (rows.length === 0) { $("shadow-net-catalyst").innerHTML = `<div class="empty">No resolved modeled SHADOW net outcomes yet.</div>`; return; }
  const maxAbs = Math.max(...rows.map((r) => Math.abs(Number(r.net_pnl || 0))), 1);
  $("shadow-net-catalyst").innerHTML = rows.slice(0, 12).map((r) => barRow(
    `${safe(r.catalyst)} ${safe(r.horizon)} · resolved n=${num(r.resolved_n)}`,
    Number(r.net_pnl || 0), maxAbs, `${money(r.net_pnl)} net`, cls(r.net_pnl), "shadow"
  )).join("");
}

function pricedGroup(rows, emptyText) {
  return table(["Segment", "priced n"], rows || [],
    (r) => `<tr><td>${safe(r.value)}</td><td class="mono">${num(r.priced_n)}</td></tr>`, emptyText);
}

function renderGroups(shadow) {
  $("shadow-by-rule").innerHTML = pricedGroup(shadow.by_rule, "No priced SHADOW rows by rule yet.");
  $("shadow-by-catalyst").innerHTML = pricedGroup(shadow.by_catalyst, "No priced SHADOW rows by catalyst yet.");
  $("shadow-by-direction").innerHTML = pricedGroup(shadow.by_direction, "No priced SHADOW rows by direction yet.");
}

function hasValue(v) {
  return v !== null && v !== undefined && v !== "";
}

function returnValue(r, horizon) {
  return r[`direction_adjusted_return_${horizon}_pct`] ?? r[`return_${horizon}_pct`];
}

function markCompleteness(r) {
  return ["5m", "15m", "1h", "eod", "1d", "3d", "5d"].filter((h) => hasValue(r[`price_${h}`])).length;
}

function isCompleteObservation(r) {
  return String(r.status || "").toUpperCase() === "COMPLETE" || hasValue(r.price_eod) || hasValue(returnValue(r, "eod"));
}

function sortedObservations(rows, filter) {
  const all = (rows || []).slice();
  const wanted = all.filter((r) => filter === "pending" ? !isCompleteObservation(r) : isCompleteObservation(r));
  return wanted.sort((a, b) => {
    const completeDelta = Number(isCompleteObservation(b)) - Number(isCompleteObservation(a));
    if (completeDelta) return completeDelta;
    const markDelta = markCompleteness(b) - markCompleteness(a);
    if (markDelta) return markDelta;
    return new Date(b.decision_ts || b.created_at || 0) - new Date(a.decision_ts || a.created_at || 0);
  });
}

function returnSummary(r) {
  return `<div class="return-grid">${[
    ["5m", "5m"], ["15m", "15m"], ["1h", "1h"], ["EOD", "eod"],
  ].map(([label, key]) => {
    const ret = returnValue(r, key);
    const price = r[`price_${key}`];
    const ts = r[`price_${key}_ts`];
    return `<div class="return-cell">
      <span class="label">${label}</span>
      <strong class="${hasValue(ret) ? cls(ret) : "muted"}">${hasValue(ret) ? pct3(ret) : "—"}</strong>
      <div class="small">${hasValue(price) ? `px ${safe(price)} · ${shortTime(ts)}` : "mark pending"}</div>
    </div>`;
  }).join("")}</div>`;
}

function rowDollarResult(r) {
  const eod = returnValue(r, "eod");
  const latest = latestReturn(r);
  if (!latest) return `<div class="money-stack"><strong class="muted">—</strong><div class="small">no forward return yet</div></div>`;
  const useEod = hasValue(eod);
  const pnl = hypotheticalPnl(useEod ? eod : latest.value);
  return `<div class="money-stack">
    <strong class="${cls(pnl)}">${money(pnl)}</strong>
    <div class="small">${money(RESEARCH_NOTIONAL)} test · ${useEod ? "EOD" : `${safe(latest.horizon)} so far`} · ${pct3(useEod ? eod : latest.value)}</div>
  </div>`;
}

function pendingCapture(label) {
  return `<span class="pending-capture">${esc(label)} pending capture</span>`;
}

function renderRecent(shadow) {
  const all = shadow.recent_priced || [];
  const completeCount = all.filter(isCompleteObservation).length;
  const pendingCount = all.length - completeCount;
  const rows = sortedObservations(all, state.observationFilter);
  const showingPending = state.observationFilter === "pending";
  if ($("recent-shadow-subtitle")) {
    $("recent-shadow-subtitle").textContent = showingPending
      ? `Pending marks view: ${num(pendingCount)} newest rows still waiting for later horizons.`
      : `Default view: ${num(completeCount)} EOD-resolved rows first; ${num(pendingCount)} pending rows are behind the Pending Marks filter.`;
  }
  document.querySelectorAll("[data-shadow-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.shadowFilter === state.observationFilter);
    const count = button.dataset.shadowFilter === "pending" ? pendingCount : completeCount;
    button.textContent = `${button.dataset.shadowFilter === "pending" ? "Pending marks" : "Complete"} (${num(count)})`;
  });
  $("recent-shadow").innerHTML = table(
    ["Symbol", "Dir", "$10K gain/loss", "Forward returns", "Catalyst", "Rule", "MFE/MAE + outcome"],
    rows,
    (r) => {
      const mfe = hasValue(r.mfe_pct) ? pct3(r.mfe_pct) : "—";
      const mae = hasValue(r.mae_pct) ? pct3(r.mae_pct) : "—";
      const outcome = r.outcome || r.exit_reason || (isCompleteObservation(r) ? "priced returns only" : "pending marks");
      return `<tr>
        <td><strong>${safe(r.symbol)}</strong><div class="small">${populationLabel(r)} · ${safe(r.source_provider)}</div><div class="small"><span class="chip ${isCompleteObservation(r) ? "" : "warn"}">${isCompleteObservation(r) ? "EOD resolved" : "pending marks"}</span></div></td>
        <td>${safe(r.direction)}</td>
        <td class="mono">${rowDollarResult(r)}</td>
        <td class="mono">${returnSummary(r)}<div class="small">entry ${safe(r.entry_reference_price)} @ ${shortTime(r.entry_reference_ts)} · ${safe(shortSource(r.entry_reference_source))}</div></td>
        <td>${catalystLabel(r)}<div class="small">${safe(r.headline)}</div></td>
        <td>${safe(r.rule_id)}</td>
        <td class="mono">outcome ${safe(outcome)}<div class="small">MFE ${mfe} / MAE ${mae}</div><div class="small">${(!hasValue(r.mfe_pct) && !hasValue(r.mae_pct)) ? pendingCapture("MFE/MAE") : ""} ${(!r.outcome && !r.exit_reason) ? pendingCapture("outcome") : ""} ${pendingCapture("multi-day")}</div></td>
      </tr>`;
    },
    showingPending ? "No pending priced SHADOW observations right now." : "No complete/EOD-resolved SHADOW observations in the current feed yet."
  );
}

function showError(error) {
  const msg = `SHADOW cockpit is fail-closed: ${error.message}`;
  $("refresh-status").className = "status-pill bad";
  $("refresh-status").innerHTML = `<strong>Blocked</strong> · ${new Date().toLocaleTimeString()}`;
  ["shadow-metrics", "shadow-horizon-ladder", "shadow-net-catalyst", "shadow-by-rule",
    "shadow-by-catalyst", "shadow-by-direction", "recent-shadow"].forEach((id) => {
    if ($(id)) $(id).innerHTML = `<div class="empty">${esc(msg)}</div>`;
  });
}

async function load() {
  try {
    const data = await fetchDashboard();
    const shadow = data.shadow || {};
    renderHero(shadow); renderMetrics(shadow); renderLadder(shadow);
    renderDollarView(shadow); renderNetByCatalyst(shadow); renderGroups(shadow); renderRecent(shadow);
    state.lastLoadedAt = new Date();
    $("refresh-status").className = "status-pill ok";
    $("refresh-status").innerHTML = `<strong>Live · research only</strong> · priced n=${num(shadow.priced_n)} · updated ${state.lastLoadedAt.toLocaleTimeString()}`;
  } catch (error) { showError(error); }
}

document.addEventListener("DOMContentLoaded", () => { load(); setInterval(load, 30000); });
document.addEventListener("click", (event) => {
  const button = event.target.closest?.("[data-shadow-filter]");
  if (!button) return;
  state.observationFilter = button.dataset.shadowFilter || "complete";
  load();
});
