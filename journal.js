/* Daily Trading Journal — measurement view across REAL and SHADOW.
 * REAL remains broker-backed/costed. SHADOW remains research-only. */
const state = { raw: null, filter: "ALL", lastLoadedAt: null };

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
function summarizeReal(rows) {
  const n = rows.length;
  const net = rows.reduce((sum, row) => sum + realNet(row), 0);
  const gross = rows.reduce((sum, row) => sum + realGross(row), 0);
  const commissions = rows.reduce((sum, row) => sum + realCommission(row), 0);
  const wins = rows.filter((row) => realNet(row) > 0).length;
  return { n, net, gross, commissions, wins, losses: n - wins, winRate: n ? wins / n * 100 : 0 };
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
      return `<div class="journal-row">
        <strong>${safe(row.symbol)} · ${safe(row.direction)} · ${safe(catalystDisplay(row.catalyst_type))}</strong>
        <span class="mono ${cls(net)}">${money(net)}</span>
        <div class="small">${safe(row.exit_reason || "closed")} · ${safe(row.rule_id)} · ${safe(row.headline)}</div>
      </div>`;
    }
    const mark = latestShadowReturn(row);
    return `<div class="journal-row">
      <strong>${safe(row.symbol)} · ${safe(row.direction)} · ${safe(catalystDisplay(row.catalyst_type))}</strong>
      <span class="mono ${mark ? cls(mark.value) : "muted"}">${mark ? pct3(mark.value) : "pending"}</span>
      <div class="small">${safe(mark?.horizon || "mark")} · ${safe(row.rule_id)} · ${safe(row.headline)}</div>
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
  const days = buildDays(data);
  renderFilter(data);
  renderHero(days);
  renderCurve(days);
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
    renderAll();
  } catch (error) {
    showError(error);
  }
}
document.addEventListener("DOMContentLoaded", () => { load(); setInterval(load, 30000); });
