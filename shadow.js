/* SHADOW / RESEARCH cockpit — same shape as IBKR / REAL, but research-only.
 * Reads ONLY data.shadow (public.agent_shadow_trades). Percentage returns are
 * primary; dollar values are explicitly hypothetical sizing scenarios. */
const state = { lastLoadedAt: null, filter: "ALL", raw: null, scenarioNotional: 1000 };
const FORWARD_HORIZONS = ["5m", "15m", "1h", "eod", "1d", "3d", "5d"];

function hasValue(v) { return v !== null && v !== undefined && v !== ""; }
function returnValue(r, horizon) { return r[`direction_adjusted_return_${horizon}_pct`] ?? r[`return_${horizon}_pct`]; }
function isCompleteObservation(r) { return String(r.status || "").toUpperCase() === "COMPLETE" || hasValue(r.price_eod) || hasValue(returnValue(r, "eod")); }
function rowIdentity(row) {
  return row?.observation_id
    || row?.event_id
    || [row?.symbol, row?.direction, row?.decision_ts, row?.entry_reference_price, row?.headline].join("|");
}
function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const key = rowIdentity(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}
function latestReturn(r) {
  for (const key of ["5d", "3d", "1d", "eod", "1h", "15m", "5m"]) {
    const value = returnValue(r, key);
    if (hasValue(value)) return { horizon: key.toUpperCase(), value: Number(value) };
  }
  return null;
}
function researchNotional() { return Math.max(1, Number(state.scenarioNotional || 1000)); }
function scenarioLabel() { return `${money(researchNotional())} hypothetical`; }
function hypotheticalPnl(returnPct, notional = researchNotional()) { return Number(returnPct || 0) * notional / 100; }
function impliedQuantity(row, notional = researchNotional()) {
  const entry = Number(row?.entry_reference_price || 0);
  return entry ? notional / entry : null;
}
function visibleRows(shadow) { return dedupeRows(shadow.recent_priced || []); }
function completeRows(shadow) { return visibleRows(shadow).filter(isCompleteObservation); }
function pendingRows(shadow) { return visibleRows(shadow).filter((r) => !isCompleteObservation(r)); }
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
  const rows = dedupeRows(allRows.filter(rowMatchesFilter));
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
function setupScenarioControls() {
  const controls = $("scenario-controls");
  if (!controls) return;
  controls.querySelectorAll("[data-scenario-notional]").forEach((button) => {
    const value = Number(button.getAttribute("data-scenario-notional"));
    button.classList.toggle("active", value === researchNotional());
    if (!button.dataset.bound) {
      button.dataset.bound = "1";
      button.addEventListener("click", () => {
        state.scenarioNotional = Number(button.getAttribute("data-scenario-notional"));
        const custom = $("custom-notional");
        if (custom) custom.value = "";
        renderAll();
      });
    }
  });
  const custom = $("custom-notional");
  if (custom && !custom.dataset.bound) {
    custom.dataset.bound = "1";
    custom.addEventListener("change", () => {
      const value = Number(custom.value);
      if (value > 0) {
        state.scenarioNotional = value;
        renderAll();
      }
    });
  }
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
  $("hero-net").innerHTML = eod ? `<span class="${cls(eod.avgReturn)}">${pct3(eod.avgReturn)}</span>` : "—";
  $("hero-net-sub").textContent = eod ? `${basisLabel(shadow)} · direction-adjusted avg at ${safe(eod.horizon || "EOD")} · n=${num(eod.n)} · scenario ${money(eod.totalPnl)} total` : "waiting for priced EOD horizon";
  $("hero-real-n").textContent = num(shadow.priced_n);
  $("hero-open-n").textContent = num(shadow.pending_or_unpriced_n);
  $("hero-win").textContent = eod ? pct(eod.hitRate) : "—";
  $("hero-win-sub").textContent = eod ? `${num(eod.winners)} wins / ${num(eod.losses)} losses · n=${num(eod.n)}` : "no EOD hit rate yet";
}
function renderMetrics(shadow) {
  const eod = eodStats(shadow);
  const best = bestHorizon(shadow.horizon_ladder);
  $("real-metrics").innerHTML = [
    metric("EOD avg return", eod ? `<span class="${cls(eod.avgReturn)}">${pct3(eod.avgReturn)}</span>` : "—", eod?.n || 0, `${basisLabel(shadow)} · primary research result`),
    metric("Best horizon return", best ? `<span class="${cls(best.avg_direction_adjusted_return_pct)}">${safe(best.horizon)} ${pct3(best.avg_direction_adjusted_return_pct)}</span>` : "—", best?.priced_n || 0, "best average observed return"),
    metric("Scenario net", eod ? `<span class="${cls(eod.totalPnl)}">${money(eod.totalPnl)}</span>` : "—", eod?.n || 0, `${scenarioLabel()} per idea · HYPOTHETICAL SIZING — RESEARCH ONLY`),
    metric("Hit rate", eod ? pct(eod.hitRate) : "—", eod?.n || 0, eod ? `${num(eod.winners)} wins / ${num(eod.losses)} losses` : "no EOD hit rate yet"),
    metric("Priced observations", num(shadow.priced_n), shadow.priced_n, `${num(shadow.pending_or_unpriced_n)} unpriced / pending excluded`),
    metric("Scenario size", money(researchNotional()), shadow.priced_n, "not real cash/equity; only a sizing experiment", "muted"),
  ].join("");
}
function renderPnlBars(shadow) {
  const eod = eodStats(shadow);
  const total = eod?.totalPnl;
  const avg = eod?.avgPnl;
  const zero = 0;
  const maxAbs = Math.max(Math.abs(total || 0), Math.abs(avg || 0), 1);
  $("pnl-bars").innerHTML = [
    barRow(`Scenario total (${scenarioLabel()})`, total || 0, maxAbs, eod ? money(total) : "—", eod ? cls(total) : "muted", "shadow"),
    barRow("Scenario average per idea", avg || 0, maxAbs, eod ? money(avg) : "—", eod ? cls(avg) : "muted", "shadow"),
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
    const valueText = n ? pct3(avg) : "—";
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
  const rows = visibleRows(shadow).filter((row) => {
    if (state.filter === "ALL") return catalystKey(row) === "filing";
    return rowMatchesFilter(row);
  });
  return rows
    .filter(isCompleteObservation)
    .filter((row) => hasValue(row.entry_reference_price) || FORWARD_HORIZONS.some((h) => hasValue(returnValue(row, h))))
    .sort((a, b) => {
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
    ? `Defaulting this section to COMPLETE filing observations from the deduped visible feed (${visibleSliceLabel(shadow)}) so SEC filing move data is not buried by newer mixed catalysts. Pending rows stay in the Pending marks panel.`
    : `${filteredName} COMPLETE observations only from the deduped visible feed (${visibleSliceLabel(shadow)}). Returns are direction-adjusted percentage moves from the entry reference; pending rows stay in the Pending marks panel.`;

  const summary = horizonSummary(rows);
  $("forward-summary").innerHTML = summary.map((s) => {
    const value = s.captured ? (s.n ? `<span class="${cls(s.avg)}">${pct3(s.avg)}</span>` : "—") : `<span class="pending-capture">not captured</span>`;
    const sub = s.captured ? `priced n=${num(s.n)} · hit ${s.hitRate === null ? "—" : pct(s.hitRate)}` : "no rows with this real horizon in the visible feed";
    return metric(`${horizonLabel(s.horizon)} avg move`, value, s.n, sub);
  }).join("");

  $("forward-table").innerHTML = table(
    ["Time", "Symbol", "Catalyst", "Dir", "Test size", "Implied qty", "Entry", "Latest P/L", "5m", "15m", "1h", "EOD", "1d", "3d", "5d", "Status"],
    rows.slice(0, 24),
    (r) => {
      const latest = latestReturn(r);
      const pnl = latest ? hypotheticalPnl(latest.value) : null;
      return `<tr>
      <td>${shortTime(r.decision_ts)}</td>
      <td><strong>${safe(r.symbol)}</strong><div class="small">${safe(r.headline)}</div></td>
      <td>${catalystLabel(r)}</td>
      <td>${safe(r.direction)}</td>
      <td class="mono">${money(researchNotional())}</td>
      <td class="mono">${impliedQuantity(r) == null ? "—" : Number(impliedQuantity(r)).toFixed(2)}</td>
      <td class="mono">${safe(r.entry_reference_price)}</td>
      <td class="mono ${pnl == null ? "muted" : cls(pnl)}">${pnl == null ? "pending" : money(pnl)}</td>
      ${FORWARD_HORIZONS.map((horizon) => {
        const v = returnValue(r, horizon);
        const captured = horizonCaptureStatus(rows, horizon);
        return `<td class="mono ${hasValue(v) ? cls(v) : "muted"}">${hasValue(v) ? pct3(v) : (captured ? "pending" : "—")}</td>`;
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
    return `<span class="chip ${hasValue(v) ? cls(v) : "muted"}">${horizonLabel(h)} ${hasValue(v) ? pct3(v) : "—"}</span>`;
  }).join("");
}
function renderDecisionFeed(shadow) {
  const rows = completeRows(shadow).slice().sort((a, b) => new Date(b.decision_ts || 0) - new Date(a.decision_ts || 0));
  if (!rows.length) { $("decision-feed").innerHTML = `<div class="empty">No complete SHADOW observations to show yet.</div>`; return; }
  $("decision-feed").innerHTML = `<div class="small section-note">Showing deduped COMPLETE observations from the visible recent feed only (${visibleSliceLabel(shadow)}). Pending rows are hidden here and shown in Pending marks.</div>` + rows.slice(0, 14).map((r) => {
    const pnl = rowPnl(r);
    const latest = latestReturn(r);
    const qty = impliedQuantity(r);
    const returnOnTest = latest?.value ?? (pnl == null ? null : pnl / researchNotional() * 100);
    return `<article class="decision-card">
      <div class="decision-top">
        <div><div class="decision-title">${safe(r.symbol)} · ${safe(r.direction)} · ${catalystLabel(r)}</div><div class="small">${safe(r.headline)} · ${populationLabel(r)}</div></div>
        <div class="mono ${latest ? cls(latest.value) : "muted"}">${latest ? pct3(latest.value) : "—"}</div>
      </div>
      <div class="small section-gap">${safe(latest?.horizon || "mark")} direction-adjusted return ${latest ? pct3(latest.value) : "—"} · scenario P/L ${pnl == null ? "pending" : money(pnl)} on ${scenarioLabel()} · implied qty ${qty == null ? "—" : qty.toFixed(2)}. Research only — no broker fill.</div>
      <div class="decision-meta"><span class="chip">rule ${safe(r.rule_id)}</span><span class="chip">scenario ${money(researchNotional())}</span><span class="chip">primary return ${returnOnTest == null ? "—" : pct3(returnOnTest)}</span>${returnGrid(r)}<span class="chip">entry ${safe(r.entry_reference_price)}</span><span class="chip">${safe(r.status || "COMPLETE")}</span></div>
    </article>`;
  }).join("");
}
function renderShadowStatus(shadow) {
  const rawRows = shadow.recent_priced || [];
  const rows = visibleRows(shadow);
  const complete = completeRows(shadow).length;
  const pending = pendingRows(shadow).length;
  const hasCatalystDetail = Boolean(state.raw?.by_catalyst_detail);
  const aggregatePriced = Number(state.raw?.priced_n || shadow.priced_n || 0);
  const selectedAggregate = state.filter === "ALL"
    ? aggregatePriced
    : Number((state.raw?.by_catalyst || []).find((row) => String(row.value) === state.filter)?.priced_n || shadow.priced_n || 0);
  const visiblePriced = rows.filter(_isPricedLocal).length;
  $("shadow-status").innerHTML = `
    <div class="metric" style="margin-bottom:12px"><div class="metric-label">Research contract</div><div class="metric-value muted">SHADOW</div><div class="metric-sub">not executable · no real cash/equity · no broker fills · percentages first</div></div>
    <div class="small section-note">
      Accuracy note: backend aggregate priced evidence is n=${num(aggregatePriced)}${state.filter === "ALL" ? "" : `; selected ${catalystDisplay(state.filter)} aggregate is n=${num(selectedAggregate)}`}, but this static page currently receives ${num(rows.length)} recent rows for tables, curves, and the observation feed.
      ${hasCatalystDetail ? "Catalyst filters use backend aggregate detail." : "Catalyst filters use the visible recent slice until the backend exposes per-catalyst aggregate detail."}
      Dedupe is by observation_id; hidden duplicate render rows in visible feed: ${num(rawRows.length - rows.length)}.
    </div>
    ${table(["Bucket", "Rows"], [["complete visible feed", complete], ["pending visible feed", pending], ["priced visible feed", visiblePriced], ["selected catalyst aggregate priced", selectedAggregate], ["global priced aggregate total", aggregatePriced], ["diagnostic aggregate total", state.raw?.total_rows_diagnostic || shadow.total_rows_diagnostic || 0], ["duplicate render rows hidden", rawRows.length - rows.length]], ([k, v]) => `<tr><td>${esc(k)}</td><td class="mono">${num(v)}</td></tr>`, "No shadow status.")}`;
}
function renderAll() {
  const shadow = shadowForFilter(state.raw || {});
  setupFilter(state.raw || {});
  setupScenarioControls();
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
  if ($("security-state")) $("security-state").innerHTML = `<div class="empty">${esc(msg)} Security/RLS status is unavailable until the backend responds.</div>`;
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
