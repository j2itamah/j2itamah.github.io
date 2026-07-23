/* Daily Trading Journal — measurement view across REAL and SHADOW.
 * REAL remains broker-backed/costed. SHADOW remains research-only. */
const state = { raw: null, filter: "ALL", day: "ALL", lastLoadedAt: null };
const SHADOW_TEST_SIZE = 10000;

function dayKey(v) {
  if (!v) return "unknown";
  try { return new Date(v).toISOString().slice(0, 10); } catch { return "unknown"; }
}
function rowMatches(row) {
  return state.filter === "ALL" || catalystKey(row) === state.filter;
}
function realNet(row) {
  return Number(row?._net_pnl ?? row?.net_pnl_after_commissions_cad ?? row?.net_pnl_after_commissions ?? row?.net_pnl ?? 0);
}
function realGross(row) {
  return Number(row?._gross_pnl ?? row?.gross_pnl_cad ?? row?.gross_pnl ?? 0);
}
function realCommission(row) {
  const value = row?._commissions ?? row?.commissions_cad ?? row?.commissions;
  return typeof value === "number" ? value : Number(value?.total ?? value?.cad ?? 0);
}
function realQty(row) { return Number(row?.quantity ?? row?.qty ?? 0); }
function realCapitalUsed(row) {
  const qty = Math.abs(realQty(row));
  const entry = Number(row?.entry_price ?? 0);
  return qty && entry ? qty * entry : 0;
}
function hasValue(v) { return v !== null && v !== undefined && v !== ""; }
function shadowReturn(row, horizon) {
  return row?.[`direction_adjusted_return_${horizon}_pct`] ?? row?.[`return_${horizon}_pct`];
}
function latestShadowReturn(row) {
  for (const horizon of ["eod", "1h", "15m", "5m"]) {
    const value = shadowReturn(row, horizon);
    if (hasValue(value)) return { horizon: horizon.toUpperCase(), value: Number(value) };
  }
  return null;
}
function isShadowPriced(row) {
  return hasValue(row?.entry_reference_price) && ["5m", "15m", "1h", "eod"].some((h) => hasValue(row?.[`price_${h}`]));
}
function shadowBest(rows) {
  const horizons = ["5m", "15m", "1h", "eod"].map((h) => {
    const values = rows.map((row) => shadowReturn(row, h)).filter(hasValue).map(Number);
    const wins = values.filter((v) => v > 0).length;
    return {
      horizon: h === "eod" ? "EOD" : h,
      n: values.length,
      avg: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0,
      hit: values.length ? wins / values.length * 100 : 0,
    };
  }).filter((row) => row.n > 0);
  return horizons.sort((a, b) => b.avg - a.avg)[0] || null;
}
function ensureDay(map, key) {
  if (!map[key]) map[key] = { day: key, realClosed: [], realOpen: [], shadowPriced: [], shadowPending: [] };
  return map[key];
}
function buildDays(data) {
  const real = data.real || {};
  const shadow = data.shadow || {};
  const days = {};
  for (const row of real.recent_closed || []) {
    if (!rowMatches(row)) continue;
    ensureDay(days, dayKey(row.exit_ts || row.entry_fill_ts)).realClosed.push(row);
  }
  for (const row of real.open_positions || []) {
    if (!rowMatches(row)) continue;
    ensureDay(days, dayKey(row.entry_fill_ts || row.decision_ts)).realOpen.push(row);
  }
  for (const row of shadow.recent_priced || []) {
    if (!rowMatches(row)) continue;
    const day = ensureDay(days, dayKey(row.decision_ts || row.catalyst_ts || row.updated_at));
    if (isShadowPriced(row)) day.shadowPriced.push(row);
    else day.shadowPending.push(row);
  }
  return Object.values(days).sort((a, b) => b.day.localeCompare(a.day));
}
function visibleDays(days) {
  return state.day === "ALL" ? days : days.filter((day) => day.day === state.day);
}
function summarizeReal(rows) {
  const n = rows.length;
  const net = rows.reduce((sum, row) => sum + realNet(row), 0);
  const gross = rows.reduce((sum, row) => sum + realGross(row), 0);
  const commissions = rows.reduce((sum, row) => sum + realCommission(row), 0);
  const wins = rows.filter((row) => realNet(row) > 0).length;
  const capital = rows.reduce((sum, row) => sum + realCapitalUsed(row), 0);
  return { n, net, gross, commissions, capital, wins, losses: n - wins, winRate: n ? wins / n * 100 : 0 };
}
function catalystRows(rows) {
  const counts = {};
  for (const row of rows) counts[catalystKey(row)] = (counts[catalystKey(row)] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
function renderFilter(data) {
  const real = data.real || {};
  const shadow = data.shadow || {};
  const types = catalystTypesFrom(real.by_catalyst, real.recent_closed, real.open_positions, shadow.by_catalyst, shadow.recent_priced);
  const counts = {};
  for (const row of real.recent_closed || []) counts[catalystKey(row)] = (counts[catalystKey(row)] || 0) + 1;
  for (const row of shadow.recent_priced || []) counts[catalystKey(row)] = (counts[catalystKey(row)] || 0) + 1;
  renderCatalystFilter("catalyst-filter", state.filter, types, counts, "real");
  $("filter-copy").textContent = state.filter === "ALL"
    ? "Showing all catalyst types."
    : `Showing daily journal entries for ${catalystDisplay(state.filter)} only.`;
  $("catalyst-filter")?.querySelectorAll("[data-catalyst-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.getAttribute("data-catalyst-filter") || "ALL";
      renderAll();
    });
  });
}
function setDay(day) {
  state.day = day || "ALL";
  const hash = state.day === "ALL" ? "#all" : `#day=${encodeURIComponent(state.day)}`;
  if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
  renderAll();
}
function syncDayFromHash() {
  const hash = String(window.location.hash || "");
  const match = hash.match(/^#day=(\d{4}-\d{2}-\d{2})$/);
  state.day = match ? match[1] : "ALL";
}
function renderDateNav(days) {
  const counts = Object.fromEntries(days.map((day) => [day.day, day.realClosed.length + day.shadowPriced.length]));
  const chips = ["ALL", ...days.map((day) => day.day)];
  $("date-filter").innerHTML = chips.map((key) => {
    const active = key === state.day ? " active" : "";
    const label = key === "ALL" ? "All days" : key;
    const count = key === "ALL" ? days.reduce((sum, day) => sum + day.realClosed.length + day.shadowPriced.length, 0) : counts[key] || 0;
    return `<button class="filter-pill real${active}" type="button" data-day-filter="${esc(key)}">${esc(label)}<span class="pill-count">${num(count)}</span></button>`;
  }).join("");
  $("date-copy").textContent = state.day === "ALL"
    ? "Showing all days from the live visible feed. Click a date to inspect that day by itself."
    : `Showing ${state.day} from the live visible feed. Click All days to go back to the full journal.`;
  $("date-filter")?.querySelectorAll("[data-day-filter]").forEach((button) => {
    button.addEventListener("click", () => setDay(button.getAttribute("data-day-filter") || "ALL"));
  });
}
function renderHero(days) {
  const realRows = days.flatMap((d) => d.realClosed);
  const shadowRows = days.flatMap((d) => d.shadowPriced);
  const real = summarizeReal(realRows);
  const best = shadowBest(shadowRows);
  $("hero-real-net").innerHTML = `<span class="${cls(real.net)}">${money(real.net)}</span>`;
  $("hero-real-sub").textContent = `${money(real.gross)} gross − ${money(real.commissions)} commissions · n=${num(real.n)}`;
  $("hero-real-win").textContent = pct(real.winRate);
  $("hero-real-win-sub").textContent = `${num(real.wins)} wins / ${num(real.losses)} losses · n=${num(real.n)}`;
  $("hero-shadow-n").textContent = num(shadowRows.length);
  $("hero-shadow-best").textContent = best ? `${best.horizon} ${pct3(best.avg)}` : "—";
  $("hero-shadow-sub").textContent = best ? `priced n=${num(best.n)} · hit ${pct(best.hit)}` : "no priced shadow marks";
}
function renderDayDetail(allDays, days) {
  if (state.day === "ALL") {
    const best = allDays.slice().sort((a, b) => summarizeReal(b.realClosed).net - summarizeReal(a.realClosed).net)[0];
    $("day-detail-title").textContent = "Day detail";
    $("day-detail").innerHTML = [
      metric("Selected day", "All days", allDays.length, "click a date above to isolate one day"),
      metric("Best REAL day", best ? safe(best.day) : "—", best ? best.realClosed.length : 0, best ? `${money(summarizeReal(best.realClosed).net)} net` : "waiting for closed trades"),
      metric("Why this matters", "compare changes", allDays.length, "daily view shows whether new changes improve results; counts are from the visible feed"),
    ].join("");
    return;
  }
  const selectedIndex = allDays.findIndex((day) => day.day === state.day);
  const selected = allDays[selectedIndex];
  const previous = allDays[selectedIndex + 1];
  const currentReal = summarizeReal(selected?.realClosed || []);
  const previousReal = summarizeReal(previous?.realClosed || []);
  const delta = previous ? currentReal.net - previousReal.net : null;
  $("day-detail-title").textContent = `${state.day} detail`;
  $("day-detail").innerHTML = [
    metric("REAL net that day", `<span class="${cls(currentReal.net)}">${money(currentReal.net)}</span>`, currentReal.n, `${money(currentReal.capital)} capital used · ${pct(currentReal.winRate)} win`),
    metric("Vs prior day", delta == null ? "—" : `<span class="${cls(delta)}">${money(delta)}</span>`, previousReal.n, previous ? `${previous.day}: ${money(previousReal.net)} net` : "no prior day in current window"),
    metric("SHADOW evidence", num((selected?.shadowPriced || []).length), (selected?.shadowPriced || []).length, `${num((selected?.shadowPending || []).length)} pending/unpriced in current slice`),
  ].join("");
}
function renderCurve(days) {
  let total = 0;
  const points = days.slice().reverse().map((day) => {
    const summary = summarizeReal(day.realClosed);
    total += summary.net;
    return { ts: day.day, symbol: day.day.slice(5), cumulative_net_pnl: Number(total.toFixed(2)) };
  });
  $("daily-real-curve").innerHTML = lineChart(points, "cumulative_net_pnl", "Daily REAL cumulative net P&L");
}
function renderMix(days) {
  const max = Math.max(...days.map((d) => d.realClosed.length + d.shadowPriced.length), 1);
  $("daily-mix").innerHTML = days.slice(0, 12).map((d) => {
    const realN = d.realClosed.length;
    const shadowN = d.shadowPriced.length;
    return barRow(`${d.day} · REAL ${num(realN)} / SHADOW ${num(shadowN)}`, realN + shadowN, max, `n=${num(realN + shadowN)}`, "muted", "shadow");
  }).join("") || `<div class="empty">No journal rows for this filter yet.</div>`;
}
function tradeList(rows, mode) {
  if (!rows.length) return `<div class="empty">No ${mode} rows this day.</div>`;
  return rows.slice(0, 8).map((row) => {
    if (mode === "REAL") {
      const net = realNet(row);
      const capital = realCapitalUsed(row);
      const roc = capital ? net / capital * 100 : null;
      return `<div class="journal-row">
        <strong>${safe(row.symbol)} · ${safe(row.direction)} · ${safe(catalystDisplay(row.catalyst_type))}</strong>
        <span class="mono ${cls(net)}">${money(net)}</span>
        <div class="small">qty ${num(realQty(row))} · capital ${capital ? money(capital) : "—"} · return ${roc == null ? "—" : pct3(roc)} · ${safe(row.exit_reason || "closed")} · ${safe(row.rule_id)} · ${safe(row.headline)}</div>
      </div>`;
    }
    const mark = latestShadowReturn(row);
    const pnl = mark ? mark.value * SHADOW_TEST_SIZE / 100 : null;
    return `<div class="journal-row">
      <strong>${safe(row.symbol)} · ${safe(row.direction)} · ${safe(catalystDisplay(row.catalyst_type))}</strong>
      <span class="mono ${pnl == null ? "muted" : cls(pnl)}">${pnl == null ? "pending" : money(pnl)}</span>
      <div class="small">$10K test size · ${safe(mark?.horizon || "mark")} ${mark ? pct3(mark.value) : "pending"} · ${safe(row.rule_id)} · ${safe(row.headline)}</div>
    </div>`;
  }).join("");
}
function renderEntries(days) {
  if (!days.length) {
    $("journal-entries").innerHTML = `<div class="empty">No daily journal entries for this filter yet.</div>`;
    return;
  }
  $("journal-entries").innerHTML = days.slice(0, 20).map((day) => {
    const real = summarizeReal(day.realClosed);
    const best = shadowBest(day.shadowPriced);
    const realCatalysts = catalystRows(day.realClosed).map(([k, n]) => `${catalystDisplay(k)} ${n}`).join(" · ") || "none";
    const shadowCatalysts = catalystRows(day.shadowPriced).map(([k, n]) => `${catalystDisplay(k)} ${n}`).join(" · ") || "none";
    const verdict = real.n
      ? `${real.net >= 0 ? "Positive" : "Negative"} REAL day after costs`
      : day.shadowPriced.length ? "Research-only evidence day" : "Still waiting for priced evidence";
    return `<article class="journal-entry">
      <div class="decision-top">
        <div>
          <div class="decision-title">${safe(day.day)} · ${safe(verdict)}</div>
          <div class="small">REAL catalysts: ${safe(realCatalysts)} · SHADOW catalysts: ${safe(shadowCatalysts)}</div>
        </div>
        <div class="mono ${cls(real.net)}">${money(real.net)}</div>
      </div>
      <div class="grid three section-gap">
        ${metric("REAL closed", num(real.n), real.n, `${pct(real.winRate)} win · ${money(real.commissions)} comm`)}
        ${metric("REAL open", num(day.realOpen.length), day.realOpen.length, "still live")}
        ${metric("SHADOW priced", num(day.shadowPriced.length), day.shadowPriced.length, best ? `${best.horizon} ${pct3(best.avg)} avg` : "pending marks")}
      </div>
      <div class="grid two section-gap">
        <div><h3 class="mini-title">REAL trades</h3>${tradeList(day.realClosed, "REAL")}</div>
        <div><h3 class="mini-title">SHADOW observations</h3>${tradeList(day.shadowPriced, "SHADOW")}</div>
      </div>
    </article>`;
  }).join("");
}
function renderAll() {
  const data = state.raw || {};
  const allDays = buildDays(data);
  const days = visibleDays(allDays);
  renderFilter(data);
  renderDateNav(allDays);
  renderDataContractPanel("real-contract-state", data.real || {}, data, {
    population: "REAL",
    venue: "IBKR/PAPER",
    table: "public.agent_trades / daily journal projection",
  });
  renderDataContractPanel("shadow-contract-state", data.shadow || {}, data, {
    population: "SHADOW_RESEARCH",
    venue: "SHADOW",
    table: "public.agent_shadow_trades / daily journal projection",
  });
  renderHero(days);
  renderDayDetail(allDays, days);
  renderCurve(allDays);
  renderMix(days);
  renderEntries(days);
  $("refresh-status").className = "status-pill ok";
  const filterText = state.filter === "ALL" ? "" : ` · ${catalystDisplay(state.filter)}`;
  $("refresh-status").innerHTML = `<strong>Live journal${filterText}</strong> · days=${num(days.length)} · updated ${state.lastLoadedAt?.toLocaleTimeString?.() || "now"}`;
}
function showError(error) {
  $("refresh-status").className = "status-pill bad";
  $("refresh-status").innerHTML = `<strong>Blocked</strong> · ${new Date().toLocaleTimeString()}`;
  ["daily-real-curve", "daily-mix", "journal-entries"].forEach((id) => { if ($(id)) $(id).innerHTML = `<div class="empty">Journal failed closed: ${esc(error.message)}</div>`; });
}
async function load() {
  try {
    state.raw = await fetchDashboard();
    state.lastLoadedAt = new Date();
    syncDayFromHash();
    renderAll();
  } catch (error) {
    showError(error);
  }
}
document.addEventListener("DOMContentLoaded", () => {
  load();
  setInterval(load, 30000);
  window.addEventListener("hashchange", () => { syncDayFromHash(); renderAll(); });
});
