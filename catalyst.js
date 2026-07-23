/* Catalyst Edge page — live dashboard data only. No mock fallback. */
const EDGE_MIN_N = 30;
const EDGE_HORIZONS = ["5m", "15m", "1h", "EOD", "+1d", "+3d", "+5d"];
const edgeState = { raw: null, loadedAt: null };

function edgeNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
function edgePct(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(digits)}%` : "DATA UNAVAILABLE";
}
function edgeMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "DATA UNAVAILABLE";
  return money(n);
}
function edgeClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "muted";
  return n > 0 ? "positive" : "negative";
}
function edgeGuard(n) {
  return edgeNum(n) >= EDGE_MIN_N ? "RULE-ELIGIBLE n≥30" : "EARLY SAMPLE / INSUFFICIENT EVIDENCE";
}
function edgeGuardBadge(n) {
  return edgeNum(n) >= EDGE_MIN_N ? "real" : "warn";
}
function avgReturn(row) {
  return edgeNum(row?.avg_direction_adjusted_return_pct ?? row?.avg_return_pct ?? row?.return_pct);
}
function sourceLabel(value) {
  return catalystDisplay(String(value || "UNKNOWN").toLowerCase());
}
function shadowDetails(data) {
  const shadow = data.shadow || {};
  const detail = shadow.by_catalyst_detail || {};
  const rows = Object.entries(detail).map(([key, value]) => ({
    key,
    label: sourceLabel(key),
    priced_n: edgeNum(value.priced_n),
    pending_n: edgeNum(value.pending_or_unpriced_n),
    total_n: edgeNum(value.total_rows_diagnostic) || edgeNum(value.priced_n) + edgeNum(value.pending_or_unpriced_n),
    ladder: value.horizon_ladder || [],
    by_direction: value.by_direction || [],
    by_rule: value.by_rule || [],
    recent: value.recent_priced || [],
  }));
  const known = new Set(rows.map((row) => row.key));
  for (const row of shadow.by_catalyst || []) {
    const key = String(row.value || "UNKNOWN");
    if (!known.has(key)) rows.push({
      key,
      label: sourceLabel(key),
      priced_n: edgeNum(row.priced_n),
      pending_n: 0,
      total_n: edgeNum(row.priced_n),
      ladder: [],
      by_direction: [],
      by_rule: [],
      recent: [],
    });
  }
  return rows.sort((a, b) => b.priced_n - a.priced_n);
}
function realCatalysts(data) {
  return ((data.real || {}).by_catalyst || []).map((row) => ({
    key: String(row.value || "UNKNOWN"),
    label: sourceLabel(row.value || "UNKNOWN"),
    n: edgeNum(row.n),
    wins: edgeNum(row.wins),
    win_rate: edgeNum(row.win_rate),
    gross_pnl: edgeNum(row.gross_pnl),
    commissions: edgeNum(row.commissions),
    net_pnl: edgeNum(row.net_pnl),
    expectancy: edgeNum(row.n) ? edgeNum(row.net_pnl) / edgeNum(row.n) : 0,
  })).sort((a, b) => b.expectancy - a.expectancy);
}
function maxAbs(values) {
  return Math.max(1, ...values.map((value) => Math.abs(edgeNum(value))));
}
function barBlock(label, value, max, valueText, sub, tone = "") {
  const n = edgeNum(value);
  const width = Math.max(4, Math.min(100, Math.abs(n) / Math.max(max, 1) * 100));
  const fill = n >= 0 ? "good-fill" : "bad-fill";
  return `<div class="bar-row">
    <div class="bar-top"><span class="bar-label">${esc(label)}</span><span class="bar-value ${tone || edgeClass(n)}">${valueText}</span></div>
    <div class="bar-track"><span class="${fill}" style="width:${width}%"></span></div>
    <div class="small">${sub}</div>
  </div>`;
}
function wilson(wins, n) {
  n = edgeNum(n); wins = edgeNum(wins);
  if (!n) return null;
  const z = 1.96;
  const phat = wins / n;
  const denom = 1 + z * z / n;
  const center = (phat + z * z / (2 * n)) / denom;
  const margin = z * Math.sqrt((phat * (1 - phat) + z * z / (4 * n)) / n) / denom;
  return { lo: Math.max(0, (center - margin) * 100), hi: Math.min(100, (center + margin) * 100), mid: phat * 100 };
}
function quantiles(values) {
  const arr = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!arr.length) return null;
  const pick = (p) => arr[Math.min(arr.length - 1, Math.max(0, Math.floor((arr.length - 1) * p)))];
  return { n: arr.length, min: arr[0], q25: pick(.25), median: pick(.5), q75: pick(.75), max: arr[arr.length - 1] };
}
function horizonCell(row, horizon) {
  const match = (row.ladder || []).find((item) => String(item.horizon || "").toLowerCase() === horizon.toLowerCase());
  const n = edgeNum(match?.priced_n);
  if (!match || !n) return `<td><span class="chip warn">DATA UNAVAILABLE</span><div class="small">n=0</div></td>`;
  const ret = avgReturn(match);
  const alpha = Math.min(.32, Math.abs(ret) / 10 + .05);
  const bg = ret >= 0 ? `rgba(53,211,153,${alpha})` : `rgba(251,113,133,${alpha})`;
  return `<td style="background:${bg}">
    <strong class="${edgeClass(ret)}">${edgePct(ret, 3)}</strong>
    <div class="small">n=${num(n)} · hit ${edgePct(match.hit_rate, 1)}</div>
    <div><span class="badge ${edgeGuardBadge(n)}">${edgeGuard(n)}</span></div>
  </td>`;
}
function renderHero(data) {
  const real = data.real || {};
  const shadow = data.shadow || {};
  const realN = edgeNum(real.closed_n || real.n);
  const shadowN = edgeNum(shadow.priced_n);
  const eligibleShadow = shadowDetails(data).filter((row) => row.priced_n >= EDGE_MIN_N).length;
  const hasRealEdge = realCatalysts(data).some((row) => row.n >= EDGE_MIN_N);
  const hasShadowEligible = eligibleShadow > 0;
  $("edge-verdict").innerHTML = hasRealEdge || hasShadowEligible ? `<span class="positive">Measure, don’t declare yet</span>` : `<span class="negative">No proven edge</span>`;
  $("edge-verdict-sub").textContent = `Rule: do not call an edge below n≥${EDGE_MIN_N}. SHADOW eligible lanes=${eligibleShadow}; REAL eligible lanes=${hasRealEdge ? "yes" : "no"}.`;
  $("real-edge-n").textContent = num(realN);
  $("shadow-edge-n").textContent = num(shadowN);
  const pending = edgeNum(shadow.pending_or_unpriced_n);
  const total = shadowN + pending;
  const complete = total ? shadowN / total * 100 : null;
  $("edge-warning").innerHTML = complete === null ? `<span class="muted">DATA UNAVAILABLE</span>` : `<span class="${complete < 80 ? "negative" : "positive"}">${edgePct(complete, 1)}</span>`;
  $("edge-warning-sub").textContent = complete === null ? "No trusted completeness denominator exposed." : `${num(pending)} pending/unpriced rows excluded from edge claims.`;
}
function renderRealBars(data) {
  const rows = realCatalysts(data);
  const max = maxAbs(rows.map((row) => row.expectancy));
  $("real-expectancy-bars").innerHTML = rows.length ? rows.map((row) => barBlock(
    `${row.label} · ${edgeGuard(row.n)}`,
    row.expectancy,
    max,
    `${edgeMoney(row.expectancy)} / trade`,
    `n=${num(row.n)} · win ${edgePct(row.win_rate)} · gross ${edgeMoney(row.gross_pnl)} · fees ${edgeMoney(row.commissions)} · net ${edgeMoney(row.net_pnl)}`
  )).join("") : `<div class="empty">No REAL catalyst rows exposed yet.</div>`;
}
function renderShadowBars(data) {
  const rows = shadowDetails(data).map((row) => {
    const eod = (row.ladder || []).find((item) => String(item.horizon || "").toLowerCase() === "eod") || (row.ladder || [])[0];
    return { ...row, horizon: eod?.horizon || "—", value: eod ? avgReturn(eod) : null, horizon_n: edgeNum(eod?.priced_n), hit_rate: edgeNum(eod?.hit_rate) };
  });
  const max = maxAbs(rows.map((row) => row.value));
  $("shadow-expectancy-bars").innerHTML = rows.length ? rows.map((row) => {
    if (row.value === null || !row.horizon_n) {
      return barBlock(`${row.label} · DATA UNAVAILABLE`, 0, max, "DATA UNAVAILABLE", `priced n=${num(row.priced_n)} · no priced horizon exposed`, "muted");
    }
    return barBlock(
      `${row.label} · ${edgeGuard(row.horizon_n)}`,
      row.value,
      max,
      `${edgePct(row.value, 3)} at ${esc(row.horizon)}`,
      `horizon n=${num(row.horizon_n)} · lane priced n=${num(row.priced_n)} · hit ${edgePct(row.hit_rate)} · research only`
    );
  }).join("") : `<div class="empty">No SHADOW catalyst rows exposed yet.</div>`;
}
function renderHeatmap(data) {
  const rows = shadowDetails(data);
  if (!rows.length) {
    $("horizon-heatmap").innerHTML = `<div class="empty">No SHADOW horizon data exposed yet.</div>`;
    return;
  }
  $("horizon-heatmap").innerHTML = `<div class="table-scroll"><table class="edge-heatmap">
    <thead><tr><th>Catalyst</th>${EDGE_HORIZONS.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((row) => `<tr><td><strong>${esc(row.label)}</strong><div class="small">priced n=${num(row.priced_n)} · pending ${num(row.pending_n)}</div></td>${EDGE_HORIZONS.map((h) => horizonCell(row, h)).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}
function renderFunnel(data) {
  const shadowRows = shadowDetails(data);
  const seen = shadowRows.reduce((sum, row) => sum + row.total_n, 0);
  const priced = shadowRows.reduce((sum, row) => sum + row.priced_n, 0);
  const eligible = shadowRows.filter((row) => row.priced_n >= EDGE_MIN_N).reduce((sum, row) => sum + row.priced_n, 0);
  const realClosed = edgeNum((data.real || {}).closed_n || (data.real || {}).n);
  const max = Math.max(seen, priced, eligible, realClosed, 1);
  $("edge-funnel").innerHTML = [
    barBlock("Seen / diagnostic SHADOW rows", seen, max, num(seen), "all exposed research rows, including pending"),
    barBlock("Priced SHADOW rows", priced, max, num(priced), "entry + at least one forward mark"),
    barBlock("Rule-eligible SHADOW lane rows", eligible, max, num(eligible), `only catalyst lanes with n≥${EDGE_MIN_N}`, "positive"),
    barBlock("REAL costed closed rows", realClosed, max, num(realClosed), "broker-backed executions", "positive"),
  ].join("");
}
function renderConfidence(data) {
  const rows = [
    ...realCatalysts(data).map((row) => ({ label: `REAL ${row.label}`, n: row.n, wins: row.wins, rate: row.win_rate })),
    ...shadowDetails(data).map((row) => {
      const eod = (row.ladder || []).find((item) => String(item.horizon || "").toLowerCase() === "eod");
      const n = edgeNum(eod?.priced_n);
      return { label: `SHADOW ${row.label} EOD`, n, wins: Math.round(n * edgeNum(eod?.hit_rate) / 100), rate: edgeNum(eod?.hit_rate) };
    }),
  ].filter((row) => row.n > 0);
  $("confidence-intervals").innerHTML = rows.length ? rows.map((row) => {
    const ci = wilson(row.wins, row.n);
    const width = ci ? Math.max(4, ci.mid) : 0;
    return `<div class="bar-row">
      <div class="bar-top"><span class="bar-label">${esc(row.label)}</span><span class="bar-value">${edgePct(row.rate)} · n=${num(row.n)}</span></div>
      <div class="bar-track"><span class="${row.n >= EDGE_MIN_N ? "good-fill" : "warn-fill"}" style="width:${width}%"></span></div>
      <div class="small">Wilson 95%: ${ci ? `${edgePct(ci.lo)} to ${edgePct(ci.hi)}` : "DATA UNAVAILABLE"} · ${edgeGuard(row.n)}</div>
    </div>`;
  }).join("") : `<div class="empty">No win-rate samples exposed yet.</div>`;
}
function renderMfeMae(data) {
  const realRows = []
    .concat((data.real || {}).decision_feed || [], (data.real || {}).recent_closed || [])
    .filter((row) => row && (row.mfe_pct !== undefined || row.mae_pct !== undefined));
  const shadowRows = shadowDetails(data).flatMap((row) => row.recent || [])
    .filter((row) => row && (row.mfe_pct !== undefined || row.mae_pct !== undefined));
  const groups = [
    ["REAL MFE", quantiles(realRows.map((row) => row.mfe_pct))],
    ["REAL MAE", quantiles(realRows.map((row) => row.mae_pct))],
    ["SHADOW MFE", quantiles(shadowRows.map((row) => row.mfe_pct))],
    ["SHADOW MAE", quantiles(shadowRows.map((row) => row.mae_pct))],
  ];
  $("mfe-mae").innerHTML = groups.map(([label, q]) => {
    if (!q) return `<div class="metric"><div class="metric-label">${esc(label)}</div><div class="metric-value muted">DATA UNAVAILABLE</div><div class="metric-sub">Backend has not exposed enough excursion rows.</div></div>`;
    return `<div class="metric"><div class="metric-label">${esc(label)} <span class="n-tag">n=${num(q.n)}</span></div><div class="metric-value ${edgeClass(q.median)}">${edgePct(q.median, 3)}</div><div class="metric-sub">q25 ${edgePct(q.q25, 3)} · q75 ${edgePct(q.q75, 3)} · min ${edgePct(q.min, 3)} · max ${edgePct(q.max, 3)}</div></div>`;
  }).join("");
}
function renderFeeDrag(data) {
  const real = data.real || {};
  const gross = edgeNum(real.gross_pnl);
  const fees = -Math.abs(edgeNum(real.commissions));
  const net = edgeNum(real.net_pnl);
  const max = maxAbs([gross, fees, net]);
  const drag = gross ? Math.abs(edgeNum(real.commissions)) / Math.abs(gross) * 100 : null;
  $("fee-drag").innerHTML = [
    barBlock("Gross P&L", gross, max, edgeMoney(gross), `before commissions · n=${num(real.n || real.closed_n)}`),
    barBlock("Commissions", fees, max, edgeMoney(Math.abs(fees)), `fee drag ${drag === null ? "DATA UNAVAILABLE" : edgePct(drag)}`),
    barBlock("Net P&L", net, max, edgeMoney(net), "after reported broker commissions"),
  ].join("");
}
function renderTpVsEod(data) {
  const realRows = (data.real || {}).recent_closed || [];
  const byExit = new Map();
  for (const row of realRows) {
    const key = String(row.exit_reason || "UNKNOWN");
    const current = byExit.get(key) || { n: 0, net: 0, wins: 0 };
    current.n += 1;
    current.net += edgeNum(row.net_pnl);
    if (edgeNum(row.net_pnl) > 0) current.wins += 1;
    byExit.set(key, current);
  }
  const shadowEod = shadowDetails(data).map((row) => {
    const eod = (row.ladder || []).find((item) => String(item.horizon || "").toLowerCase() === "eod");
    return { label: row.label, n: edgeNum(eod?.priced_n), ret: avgReturn(eod), hit: edgeNum(eod?.hit_rate) };
  }).filter((row) => row.n);
  const exitRows = [...byExit.entries()].map(([reason, row]) => ({ reason, ...row, exp: row.n ? row.net / row.n : 0 }));
  const max = maxAbs([...exitRows.map((row) => row.exp), ...shadowEod.map((row) => row.ret)]);
  $("tp-vs-eod").innerHTML = [
    exitRows.length ? `<div class="mini-title">REAL exits</div>${exitRows.map((row) => barBlock(`${row.reason} · ${edgeGuard(row.n)}`, row.exp, max, `${edgeMoney(row.exp)} / trade`, `n=${num(row.n)} · wins ${num(row.wins)} · net ${edgeMoney(row.net)}`)).join("")}` : `<div class="empty">No REAL exit-reason rows exposed.</div>`,
    shadowEod.length ? `<div class="mini-title section-gap">SHADOW EOD holds</div>${shadowEod.map((row) => barBlock(`${row.label} EOD · ${edgeGuard(row.n)}`, row.ret, max, edgePct(row.ret, 3), `n=${num(row.n)} · hit ${edgePct(row.hit)} · research only`)).join("")}` : `<div class="empty">No SHADOW EOD rows exposed.</div>`,
  ].join("");
}
function renderTpSlMatrix(data) {
  const rows = shadowDetails(data);
  const anyGrid = rows.some((row) => row.recent.some((obs) => obs.shadow_tp_price || obs.shadow_sl_price || obs.outcome));
  if (!anyGrid) {
    $("tp-sl-matrix").innerHTML = `<div class="empty">
      DATA UNAVAILABLE — backend does not expose a complete TP/SL optimization grid yet. The dashboard will not fabricate one from partial mark-only rows.
    </div>`;
    return;
  }
  const outcomes = {};
  for (const row of rows) for (const obs of row.recent) {
    const key = `${obs.tp_pct ?? "TP?"} / ${obs.sl_pct ?? "SL?"}`;
    outcomes[key] = outcomes[key] || { n: 0, wins: 0 };
    outcomes[key].n += 1;
    if (String(obs.outcome || "").toUpperCase().includes("WIN") || edgeNum(obs.sim_net_pnl) > 0) outcomes[key].wins += 1;
  }
  $("tp-sl-matrix").innerHTML = `<div class="grid three">${Object.entries(outcomes).map(([key, row]) =>
    metric(key, edgePct(row.n ? row.wins / row.n * 100 : 0), row.n, `${edgeGuard(row.n)} · partial backend fields only`)
  ).join("")}</div>`;
}
function renderSourceQuality(data) {
  const src = data.source_observability || {};
  const coverage = src.coverage?.counts || {};
  const expected = edgeNum(coverage.expected_sources) || 13;
  const observed = edgeNum(coverage.observed_expected_sources);
  const rowEvidence = edgeNum(coverage.row_evidence_n || src.event_n);
  const shadow = data.shadow || {};
  const shadowPriced = edgeNum(shadow.priced_n);
  const shadowPending = edgeNum(shadow.pending_or_unpriced_n);
  const max = Math.max(expected, observed, rowEvidence, shadowPriced, shadowPending, 1);
  $("source-quality-bars").innerHTML = [
    barBlock("Expected source cards", expected, max, num(expected), "SEC, wires, IR, macro, crypto, X, FMP, IBKR, CoinGecko/Kraken", "muted"),
    barBlock("Observed expected sources", observed, max, num(observed), observed < expected ? "Coverage gap visible — do not treat missing sources as zero." : "All expected sources observed.", observed < expected ? "negative" : "positive"),
    barBlock("Source event evidence", rowEvidence, max, num(rowEvidence), "events visible in source observability / dashboard rows", "positive"),
    barBlock("SHADOW priced rows", shadowPriced, max, num(shadowPriced), "priced evidence", "positive"),
    barBlock("SHADOW pending/unpriced rows", shadowPending, max, num(shadowPending), "excluded from edge claims", "negative"),
  ].join("");
}
function renderGuardrails(data) {
  const realRows = realCatalysts(data);
  const shadowRows = shadowDetails(data);
  const below = [
    ...realRows.filter((row) => row.n < EDGE_MIN_N).map((row) => `REAL ${row.label}: n=${num(row.n)}`),
    ...shadowRows.filter((row) => row.priced_n < EDGE_MIN_N).map((row) => `SHADOW ${row.label}: priced n=${num(row.priced_n)}`),
  ];
  const eligible = [
    ...realRows.filter((row) => row.n >= EDGE_MIN_N).map((row) => `REAL ${row.label}: n=${num(row.n)}`),
    ...shadowRows.filter((row) => row.priced_n >= EDGE_MIN_N).map((row) => `SHADOW ${row.label}: priced n=${num(row.priced_n)}`),
  ];
  $("edge-guardrails").innerHTML = [
    `<div class="decision-card"><div class="decision-title">No proven edge below n≥${EDGE_MIN_N}</div><div class="decision-meta"><span class="chip warn">INSUFFICIENT EVIDENCE stays visible</span><span class="chip">No silent promotion</span></div></div>`,
    `<div class="decision-card"><div class="decision-title">Eligible lanes</div><div class="small">${eligible.length ? eligible.map(esc).join("<br>") : "No lane has reached the rule-eligible sample yet."}</div></div>`,
    `<div class="decision-card"><div class="decision-title">Still early</div><div class="small">${below.length ? below.map(esc).join("<br>") : "No early-sample lanes currently exposed."}</div></div>`,
    `<div class="decision-card"><div class="decision-title">Populations remain separate</div><div class="small">REAL = broker-backed, costed executions. SHADOW = research marks. This page compares evidence quality but does not merge their P&L.</div></div>`,
  ].join("");
}
async function loadCatalystEdge() {
  try {
    $("refresh-status").className = "status-pill";
    $("refresh-status").textContent = "Loading live edge data…";
    const data = await fetchDashboard();
    edgeState.raw = data;
    edgeState.loadedAt = new Date();
    renderHero(data);
    renderRealBars(data);
    renderShadowBars(data);
    renderHeatmap(data);
    renderFunnel(data);
    renderConfidence(data);
    renderMfeMae(data);
    renderFeeDrag(data);
    renderTpVsEod(data);
    renderTpSlMatrix(data);
    renderSourceQuality(data);
    renderGuardrails(data);
    $("refresh-status").className = "status-pill ok";
    $("refresh-status").innerHTML = `<strong>Live</strong> · edge guard n≥${EDGE_MIN_N} · updated ${edgeState.loadedAt.toLocaleTimeString()}`;
  } catch (error) {
    $("refresh-status").className = "status-pill bad";
    $("refresh-status").textContent = `DATA UNAVAILABLE · ${error.message || error}`;
  }
}

$("manual-refresh")?.addEventListener("click", loadCatalystEdge);
loadCatalystEdge();
