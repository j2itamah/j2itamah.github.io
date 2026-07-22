/* SHADOW / RESEARCH cockpit — same shape as IBKR / REAL, but research-only.
 * Reads ONLY data.shadow (public.agent_shadow_trades). Dollar values are fixed
 * $10K hypothetical translations from observed forward returns, not real fills. */
const state = { lastLoadedAt: null, filter: "ALL", raw: null };
const RESEARCH_NOTIONAL = 10000;
const FORWARD_HORIZONS = ["5m", "15m", "30m", "1h", "eod"];

function hasValue(v) { return v !== null && v !== undefined && v !== ""; }
function returnValue(r, horizon) { return r[`direction_adjusted_return_${horizon}_pct`] ?? r[`return_${horizon}_pct`]; }
function isCompleteObservation(r) { return String(r.status || "").toUpperCase() === "COMPLETE" || hasValue(r.price_eod) || hasValue(returnValue(r, "eod")); }
function latestReturn(r) {
  for (const key of ["eod", "1h", "30m", "15m", "5m"]) {
    const value = returnValue(r, key);
    if (hasValue(value)) return { horizon: key.toUpperCase(), value: Number(value) };
  }
  return null;
}
function hypotheticalPnl(returnPct, notional = RESEARCH_NOTIONAL) { return Number(returnPct || 0) * notional / 100; }
function impliedQuantity(row, notional = RESEARCH_NOTIONAL) {
  const entry = Number(row?.entry_reference_price || 0);
  return entry ? notional / entry : null;
}
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
  return FORWARD_HORIZONS.map((h) => {
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
function visibleSliceLabel(shadow) {
  return `${num((shadow.recent_priced || []).length)} recent rows visible`;
}
function basisLabel(shadow) {
  return shadow?._basis || "backend aggregate";
}
function shadowForFilter(shadow) {
  if (state.filter === "ALL") return { ...shadow, _basis: "backend aggregate", _visible_n: (shadow.recent_priced || []).length };
  const detail = shadow.by_catalyst_detail?.[state.filter];
  if (detail) return { ...shadow, ...detail, _basis: "backend catalyst aggregate", _visible_n: (detail.recent_priced || shadow.recent_priced || []).length };
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
    _basis: "visible recent slice",
    _visible_n: rows.length,
  };
}
function _isPricedLocal(row) {
  return hasValue(row?.entry_reference_price) && FORWARD_HORIZONS.some((h) => hasValue(row?.[`price_${h}`]));
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
  if (!n) return null;
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
  const visibleBasis = basisLabel(shadow).includes("visible");
  $("hero-priced-label").textContent = visibleBasis ? "Visible priced observations" : "Backend priced observations";
  $("hero-priced-sub").textContent = visibleBasis ? "current filter uses recent rows only" : "priced evidence, not total rows";
  $("hero-pending-label").textContent = visibleBasis ? "Visible unpriced rows" : "Unpriced / diagnostic";
  $("hero-pending-sub").textContent = visibleBasis ? "not yet priced in visible feed" : "not used as priced evidence";
  $("hero-net").innerHTML = eod ? `<span class="${cls(eod.totalPnl)}">${money(eod.totalPnl)}</span>` : "—";
  $("hero-net-sub").textContent = eod ? `${basisLabel(shadow)} · ${money(eod.avgPnl)} avg per ${money(RESEARCH_NOTIONAL)} idea · ${safe(eod.horizon || "EOD")} n=${num(eod.n)}` : "waiting for priced EOD horizon";
  $("hero-real-n").textContent = num(shadow.priced_n);
  $("hero-open-n").textContent = num(shadow.pending_or_unpriced_n);
  $("hero-win").textContent = eod ? pct(eod.hitRate) : "—";
  $("hero-win-sub").textContent = eod ? `${num(eod.winners)} wins / ${num(eod.losses)} losses · n=${num(eod.n)}` : "no EOD hit rate yet";
}
function renderMetrics(shadow) {
  const eod = eodStats(shadow);
  const best = bestHorizon(shadow.horizon_ladder);
  $("real-metrics").innerHTML = [
    metric("Modeled P/L basis", eod ? `<span class="${cls(eod.totalPnl)}">${money(eod.totalPnl)}</span>` : "—", eod?.n || 0, `${basisLabel(shadow)} · ${money(RESEARCH_NOTIONAL)} test size · not real cash`),
    metric("Avg per trade", eod ? `<span class="${cls(eod.avgPnl)}">${money(eod.avgPnl)}</span>` : "—", eod?.n || 0, eod ? `${pct3(eod.avgReturn)} avg direction-adjusted return` : "no EOD average yet"),
    metric("Hypothetical size", money(RESEARCH_NOTIONAL), shadow.priced_n, "Every SHADOW idea is modeled as the same test size", "muted"),
    metric("Hit rate", eod ? pct(eod.hitRate) : "—", eod?.n || 0, eod ? `${num(eod.winners)} wins / ${num(eod.losses)} losses` : "no EOD hit rate yet"),
    metric("Priced observations", num(shadow.priced_n), shadow.priced_n, `${num(shadow.pending_or_unpriced_n)} unpriced / pending excluded`),
    metric("Best horizon", best ? `${safe(best.horizon)} ${pct3(best.avg_direction_adjusted_return_pct)}` : "—", best?.priced_n || 0, "best average observed return"),
  ].join("");
}
function renderPnlBars(shadow) {
  const eod = eodStats(shadow);
  const total = eod?.totalPnl;
  const avg = eod?.avgPnl;
  const zero = 0;
  const maxAbs = Math.max(Math.abs(total || 0), Math.abs(avg || 0), 1);
  $("pnl-bars").innerHTML = [
    barRow(`Modeled P/L (${basisLabel(shadow)})`, total || 0, maxAbs, eod ? money(total) : "—", eod ? cls(total) : "muted", "shadow"),
    barRow("Average per idea", avg || 0, maxAbs, eod ? money(avg) : "—", eod ? cls(avg) : "muted", "shadow"),
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
    donutGauge("Unpriced share", total ? pending * 100 / total : 0, pending, "#fbbf24"),
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
    const n = Number(r.priced_n || 0);
    const horizonName = String(r.horizon || "").toLowerCase();
    const valueText = n ? pct3(avg) : (horizonName === "30m" ? "not captured" : "—");
    const hitText = n ? pct(hit) : "—";
    return `<div class="ladder-card">
      <div class="ladder-top"><strong>${safe(r.horizon)}</strong><span class="mono ${n ? cls(avg) : "muted"}">${valueText}</span></div>
      <div class="bar-track"><div class="bar-fill shadow" style="width:${n ? Math.max(3, Math.min(100, Math.abs(avg) * 20 || hit)) : 0}%"></div></div>
      <div class="small">priced n=${num(r.priced_n)} · hit rate ${hitText}</div>
    </div>`;
  }).join("")}</div>`;
}
function horizonLabel(horizon) { return horizon === "eod" ? "EOD" : horizon.toUpperCase(); }
function horizonCaptureStatus(rows, horizon) {
  return (rows || []).some((row) => Object.prototype.hasOwnProperty.call(row, `direction_adjusted_return_${horizon}_pct`) || Object.prototype.hasOwnProperty.call(row, `return_${horizon}_pct`) || Object.prototype.hasOwnProperty.call(row, `price_${horizon}`));
}
function forwardRows(shadow) {
  const rows = (shadow.recent_priced || []).filter((row) => {
    if (state.filter === "ALL") return catalystKey(row) === "filing";
    return rowMatchesFilter(row);
  });
  return rows
    .filter((row) => hasValue(row.entry_reference_price) || FORWARD_HORIZONS.some((h) => hasValue(returnValue(row, h))))
    .sort((a, b) => {
      const completeDelta = Number(isCompleteObservation(b)) - Number(isCompleteObservation(a));
      if (completeDelta) return completeDelta;
      return new Date(b.decision_ts || 0) - new Date(a.decision_ts || 0);
    });
}
function horizonSummary(rows) {
  return FORWARD_HORIZONS.map((horizon) => {
    const captured = horizonCaptureStatus(rows, horizon);
    const values = rows.map((row) => returnValue(row, horizon)).filter(hasValue).map(Number);
    const wins = values.filter((value) => value > 0).length;
    const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    return { horizon, captured, n: values.length, wins, hitRate: values.length ? wins / values.length * 100 : null, avg };
  });
}
function renderForwardReturns(shadow) {
  const rows = forwardRows(shadow);
  const filteredName = state.filter === "ALL" ? "Filing" : catalystDisplay(state.filter);
  $("forward-title").textContent = `${filteredName} forward returns`;
  $("forward-note").textContent = state.filter === "ALL"
    ? `Defaulting this section to filing observations from the visible recent feed (${visibleSliceLabel(shadow)}) so SEC filing move data is not buried by newer mixed catalysts. Use the chips above to switch the whole cockpit to crypto news or trading halts.`
    : `${filteredName} observations only from the visible recent feed (${visibleSliceLabel(shadow)}). Returns are direction-adjusted percentage moves from the entry reference; pending horizons stay blank instead of being guessed.`;

  const summary = horizonSummary(rows);
  $("forward-summary").innerHTML = summary.map((s) => {
    const value = s.captured ? (s.n ? `<span class="${cls(s.avg)}">${pct3(s.avg)}</span>` : "—") : `<span class="pending-capture">not captured</span>`;
    const sub = s.captured ? `priced n=${num(s.n)} · hit ${s.hitRate === null ? "—" : pct(s.hitRate)}` : "backend/API has no 30m field yet";
    return metric(`${horizonLabel(s.horizon)} avg move`, value, s.n, sub);
  }).join("");

  $("forward-table").innerHTML = table(
    ["Time", "Symbol", "Catalyst", "Dir", "Test size", "Implied qty", "Entry", "Latest P/L", "5m", "15m", "30m", "1h", "EOD", "Status"],
    rows.slice(0, 24),
    (r) => {
      const latest = latestReturn(r);
      const pnl = latest ? hypotheticalPnl(latest.value) : null;
      return `<tr>
      <td>${shortTime(r.decision_ts)}</td>
      <td><strong>${safe(r.symbol)}</strong><div class="small">${safe(r.headline)}</div></td>
      <td>${catalystLabel(r)}</td>
      <td>${safe(r.direction)}</td>
      <td class="mono">${money(RESEARCH_NOTIONAL)}</td>
      <td class="mono">${impliedQuantity(r) == null ? "—" : Number(impliedQuantity(r)).toFixed(2)}</td>
      <td class="mono">${safe(r.entry_reference_price)}</td>
      <td class="mono ${pnl == null ? "muted" : cls(pnl)}">${pnl == null ? "pending" : money(pnl)}</td>
      ${FORWARD_HORIZONS.map((horizon) => {
        const v = returnValue(r, horizon);
        const captured = horizonCaptureStatus(rows, horizon);
        return `<td class="mono ${hasValue(v) ? cls(v) : "muted"}">${hasValue(v) ? pct3(v) : (captured ? "pending" : "not captured")}</td>`;
      }).join("")}
      <td>${safe(r.status)}</td>
    </tr>`;
    },
    `No ${filteredName.toLowerCase()} forward-return observations in the current live slice.`
  );
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
    const missing = FORWARD_HORIZONS.filter((h) => horizonCaptureStatus(rows, h) && !hasValue(returnValue(r, h))).map(horizonLabel).join(", ") || "later multi-day";
    return `<tr><td><strong>${safe(r.symbol)}</strong></td><td>${safe(r.direction)}</td><td class="mono ${latest ? cls(latest.value) : "muted"}">${latest ? `${safe(latest.horizon)} ${pct3(latest.value)}` : "—"}</td><td>${safe(missing)}</td></tr>`;
  }, "No pending SHADOW marks in current feed.");
}
function returnGrid(r) {
  return FORWARD_HORIZONS.map((h) => {
    const v = returnValue(r, h);
    return `<span class="chip ${hasValue(v) ? cls(v) : "muted"}">${horizonLabel(h)} ${hasValue(v) ? pct3(v) : (h === "30m" ? "not captured" : "—")}</span>`;
  }).join("");
}
function renderDecisionFeed(shadow) {
  const rows = completeRows(shadow).slice().sort((a, b) => new Date(b.decision_ts || 0) - new Date(a.decision_ts || 0));
  if (!rows.length) { $("decision-feed").innerHTML = `<div class="empty">No complete SHADOW observations to show yet.</div>`; return; }
  $("decision-feed").innerHTML = `<div class="small section-note">Showing complete observations from the visible recent feed only (${visibleSliceLabel(shadow)}). Aggregate priced totals above may be larger than this feed.</div>` + rows.slice(0, 14).map((r) => {
    const pnl = rowPnl(r);
    const latest = latestReturn(r);
    const qty = impliedQuantity(r);
    const returnOnTest = pnl == null ? null : pnl / RESEARCH_NOTIONAL * 100;
    return `<article class="decision-card">
      <div class="decision-top">
        <div><div class="decision-title">${safe(r.symbol)} · ${safe(r.direction)} · ${catalystLabel(r)}</div><div class="small">${safe(r.headline)} · ${populationLabel(r)}</div></div>
        <div class="mono ${cls(pnl)}">${money(pnl)}</div>
      </div>
      <div class="small section-gap">${money(RESEARCH_NOTIONAL)} hypothetical test size · implied qty ${qty == null ? "—" : qty.toFixed(2)} · ${safe(latest?.horizon || "mark")} return ${latest ? pct3(latest.value) : "—"}. Research only — no broker fill.</div>
      <div class="decision-meta"><span class="chip">rule ${safe(r.rule_id)}</span><span class="chip">test size ${money(RESEARCH_NOTIONAL)}</span><span class="chip">return on test ${returnOnTest == null ? "—" : pct3(returnOnTest)}</span>${returnGrid(r)}<span class="chip">entry ${safe(r.entry_reference_price)}</span><span class="chip">${safe(r.status || "COMPLETE")}</span></div>
    </article>`;
  }).join("");
}
function renderShadowStatus(shadow) {
  const rows = shadow.recent_priced || [];
  const complete = completeRows(shadow).length;
  const pending = pendingRows(shadow).length;
  const hasCatalystDetail = Boolean(state.raw?.by_catalyst_detail);
  const aggregatePriced = Number(state.raw?.priced_n || shadow.priced_n || 0);
  const selectedAggregate = state.filter === "ALL"
    ? aggregatePriced
    : Number((state.raw?.by_catalyst || []).find((row) => String(row.value) === state.filter)?.priced_n || shadow.priced_n || 0);
  const visiblePriced = rows.filter(_isPricedLocal).length;
  $("shadow-status").innerHTML = `
    <div class="metric" style="margin-bottom:12px"><div class="metric-label">Research contract</div><div class="metric-value muted">SHADOW</div><div class="metric-sub">not executable · no real cash/equity · no broker fills</div></div>
    <div class="small section-note">
      Accuracy note: backend aggregate priced evidence is n=${num(aggregatePriced)}${state.filter === "ALL" ? "" : `; selected ${catalystDisplay(state.filter)} aggregate is n=${num(selectedAggregate)}`}, but this static page currently receives ${num(rows.length)} recent rows for tables, curves, and the observation feed.
      ${hasCatalystDetail ? "Catalyst filters use backend aggregate detail." : "Catalyst filters use the visible recent slice until the backend exposes per-catalyst aggregate detail."}
      30m is labeled not captured because the live API does not send a 30m mark.
    </div>
    ${table(["Bucket", "Rows"], [["complete visible feed", complete], ["later-horizon pending visible feed", pending], ["priced visible feed", visiblePriced], ["selected catalyst aggregate priced", selectedAggregate], ["global priced aggregate total", aggregatePriced], ["diagnostic aggregate total", state.raw?.total_rows_diagnostic || shadow.total_rows_diagnostic || 0]], ([k, v]) => `<tr><td>${esc(k)}</td><td class="mono">${num(v)}</td></tr>`, "No shadow status.")}`;
}
function renderAll() {
  const shadow = shadowForFilter(state.raw || {});
  setupFilter(state.raw || {});
  renderHero(shadow); renderMetrics(shadow); renderPnlBars(shadow); renderGauges(shadow);
  renderForwardReturns(shadow); renderEquity(shadow); renderLadder(shadow); renderGroups(shadow); renderPending(shadow); renderShadowStatus(shadow);
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
  ["real-metrics", "forward-summary", "forward-table", "pnl-bars", "win-gauges", "equity-curve", "shadow-horizon-ladder", "shadow-by-rule", "shadow-by-catalyst", "shadow-by-direction", "pending-marks", "decision-feed", "shadow-status"].forEach((id) => { if ($(id)) $(id).innerHTML = `<div class="empty">${esc(msg)}</div>`; });
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
