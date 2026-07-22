/* SHADOW / RESEARCH cockpit — reads ONLY data.shadow (public.agent_shadow_trades).
 * This is research reference, NOT executable and NOT a go/no-go for real capital.
 * Only priced observations are treated as evidence; total rows are diagnostic. */
const state = { lastLoadedAt: null };

function renderHero(shadow) {
  $("hero-priced").textContent = num(shadow.priced_n);
  $("hero-modeled").textContent = num(shadow.modeled_pnl_n);
  const multi = shadow.multi_day_status || {};
  $("hero-multi").textContent = num(multi.captured_n);
  $("hero-multi-sub").textContent = `${num(multi.pending_n)} pending · ${num(multi.missed_n)} missed`;
  $("hero-diag").textContent = num(shadow.total_rows_diagnostic);
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

function markSummary(r) {
  const marks = [["5m", r.price_5m, r.price_5m_ts], ["15m", r.price_15m, r.price_15m_ts],
    ["1h", r.price_1h, r.price_1h_ts], ["EOD", r.price_eod, r.price_eod_ts],
    ["+1d", r.price_1d, r.price_1d_ts], ["+3d", r.price_3d, r.price_3d_ts], ["+5d", r.price_5d, r.price_5d_ts]];
  return marks.map(([label, v, ts]) => (v == null || v === "") ? `${label} —` : `${label} ${safe(v)} @ ${shortTime(ts)}`).join(" · ");
}

function renderRecent(shadow) {
  $("recent-shadow").innerHTML = table(
    ["Symbol", "Dir", "Catalyst", "Rule", "$10k sim net", "Path (MFE/MAE)", "Forward marks"],
    shadow.recent_priced || [],
    (r) => {
      const simNet = (r.sim_net_pnl == null) ? "—" : `<span class="${cls(r.sim_net_pnl)}">${money(r.sim_net_pnl)}</span> ${safe(r.sim_horizon || r.sim_exit_reason || "SIM")}`;
      const mfe = r.mfe_pct == null ? "—" : pct(r.mfe_pct);
      const mae = r.mae_pct == null ? "—" : pct(r.mae_pct);
      return `<tr>
        <td><strong>${safe(r.symbol)}</strong><div class="small">${populationLabel(r)} · ${safe(r.source_provider)}</div></td>
        <td>${safe(r.direction)}</td>
        <td>${catalystLabel(r)}<div class="small">${safe(r.headline)}</div></td>
        <td>${safe(r.rule_id)}</td>
        <td class="mono">${simNet}</td>
        <td class="mono">outcome ${safe(r.outcome || r.exit_reason)}<div class="small">MFE ${mfe} / MAE ${mae}</div></td>
        <td class="mono">${markSummary(r)}<div class="small">entry ${safe(r.entry_reference_price)} @ ${shortTime(r.entry_reference_ts)} · ${safe(shortSource(r.entry_reference_source))}</div></td>
      </tr>`;
    },
    "No priced SHADOW observations yet."
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
    renderNetByCatalyst(shadow); renderGroups(shadow); renderRecent(shadow);
    state.lastLoadedAt = new Date();
    $("refresh-status").className = "status-pill ok";
    $("refresh-status").innerHTML = `<strong>Live · research only</strong> · priced n=${num(shadow.priced_n)} · updated ${state.lastLoadedAt.toLocaleTimeString()}`;
  } catch (error) { showError(error); }
}

document.addEventListener("DOMContentLoaded", () => { load(); setInterval(load, 30000); });
