(function () {
  const byId = (id) => document.getElementById(id);
  const htmlSafe = (value) => String(value ?? "—")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const dollars = (value) => {
    if (value === null || value === undefined || value === "") return "DATA UNAVAILABLE";
    const n = Number(value);
    if (!Number.isFinite(n)) return "DATA UNAVAILABLE";
    return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const percent = (value) => {
    if (value === null || value === undefined || value === "") return "DATA UNAVAILABLE";
    const n = Number(value);
    if (!Number.isFinite(n)) return "DATA UNAVAILABLE";
    return `${n.toFixed(2)}%`;
  };
  const number = (value) => Number.isFinite(Number(value)) ? Number(value).toLocaleString() : "0";
  const signed = (value) => Number(value || 0) >= 0 ? "positive" : "negative";
  const seconds = (value) => {
    if (value === null || value === undefined || value === "") return "DATA UNAVAILABLE";
    const n = Number(value);
    if (!Number.isFinite(n)) return "DATA UNAVAILABLE";
    if (Math.abs(n) >= 3600) return `${(n / 3600).toFixed(1)}h`;
    if (Math.abs(n) >= 60) return `${(n / 60).toFixed(1)}m`;
    return `${n.toFixed(1)}s`;
  };
  const whenLocal = (value) => {
    if (!value) return "DATA UNAVAILABLE";
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Edmonton",
        year: "numeric", month: "short", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        timeZoneName: "short",
      }).format(new Date(value));
    } catch {
      return htmlSafe(value);
    }
  };

  const EXPECTED_SOURCE_NAMES = [
    "SEC EDGAR", "Business Wire", "PR Newswire", "GlobeNewswire", "Company IR",
    "Federal Reserve", "BLS", "Crypto RSS", "Binance", "X", "FMP", "IBKR prices", "CoinGecko/Kraken prices",
  ];
  const CODE_LABELS = {
    DATA_UNAVAILABLE: "Data unavailable",
    DERIVED_FROM_DASHBOARD_ROWS: "Derived from dashboard rows",
    OBSERVED_FROM_DASHBOARD_ROWS: "Observed from dashboard rows",
    NO_ROWS_IN_DASHBOARD_WINDOW: "No rows in dashboard window",
    NOT_EXPOSED: "Not exposed",
    NOT_EXPOSED_BY_ROW_DERIVED_FALLBACK: "Rate-limit usage not exposed by row-derived fallback",
    ROW_DERIVED: "Derived from dashboard rows",
    SOURCE_OBSERVABILITY_SCHEMA_PENDING_DERIVED_FROM_DASHBOARD_ROWS: "Dedicated source monitor is pending — this view is derived from dashboard rows",
  };
  const readableCode = (value) => {
    if (value === null || value === undefined || value === "") return "Data unavailable";
    const raw = String(value).trim();
    const normalized = raw.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    if (/SOURCE_OBSERVABILITY_TABLES(?:_ARE)?_NOT_ENABLED/.test(normalized)) {
      return "Dedicated source-observability tables are not enabled yet — source cards are derived from live REAL/SHADOW dashboard rows";
    }
    return CODE_LABELS[normalized] || raw.replaceAll("_", " ").replaceAll("-", " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
  };
  const warningText = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "No warning text supplied";
    const match = raw.match(/^([^:]+):\s*(.+)$/);
    return match ? `${match[1]}: ${readableCode(match[2])}` : readableCode(raw);
  };
  const rawCodeDetail = (value) => {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const human = warningText(raw);
    return human === raw ? "" : `<div class="raw-code">raw: ${htmlSafe(raw)}</div>`;
  };
  const keyOf = (value) => String(value || "").trim().toLowerCase();
  const sourceObservationCount = (row) => Number(row?.events_in_dashboard_window ?? row?.seen ?? row?.events_today ?? 0) || 0;
  const firstValue = (...values) => values.find((value) => value !== null && value !== undefined && value !== "") ?? null;
  const avg = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const percentile = (values, p) => {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
  };

  function renderNav(active) {
    const pages = [
      ["./index.html", "Overview", "overview"],
      ["./real.html", "Real trades", "real"],
      ["./shadow.html", "Shadow research", "shadow"],
      ["./journal.html", "Journal", "journal"],
      ["./sources.html", "Sources", "sources"],
      ["./execution.html", "Execution", "execution"],
    ];
    return `<nav class="tabs" aria-label="Dashboard pages">${pages.map(([href, label, key]) =>
      `<a class="tab-link ${active === key ? "active" : ""}" href="${href}">${htmlSafe(label)}</a>`).join("")}</nav>`;
  }
  function freshnessBadge(label, updatedAt, generatedAt) {
    if (!updatedAt) return `<span class="badge warn">${htmlSafe(label)} · DATA UNAVAILABLE</span>`;
    const ageMin = (new Date(generatedAt || Date.now()) - new Date(updatedAt)) / 60000;
    const live = Number.isFinite(ageMin) && ageMin <= 90;
    return `<span class="badge ${live ? "real" : "warn"}">${htmlSafe(label)} · ${live ? "LIVE" : "STALE"} · ${whenLocal(updatedAt)}</span>`;
  }
  function metricCard(label, value, sub, tone = "") {
    return `<div class="metric"><div class="metric-label">${htmlSafe(label)}</div><div class="metric-value ${tone}">${value}</div><div class="metric-sub">${sub}</div></div>`;
  }
  function emptyCard(title, copy) {
    return `<div class="metric"><div class="metric-label">${htmlSafe(title)}</div><div class="metric-sub">${htmlSafe(copy)}</div></div>`;
  }
  function bar(label, value, sub, maxAbs = 1, moneyMode = true) {
    const n = Number(value || 0);
    const width = Math.max(4, Math.min(100, Math.abs(n) / Math.max(maxAbs, 1) * 100));
    const cls = n >= 0 ? "good-fill" : "bad-fill";
    return `<div class="bar-row">
      <div class="bar-top"><span class="bar-label">${htmlSafe(label)}</span><span class="bar-value ${signed(n)}">${moneyMode ? dollars(n) : number(n)}</span></div>
      <div class="bar-track"><span class="${cls}" style="width:${width}%"></span></div>
      <div class="small">${htmlSafe(sub)}</div>
    </div>`;
  }
  function countBar(label, value, sub, maxValue = 1) {
    const n = Number(value || 0);
    const width = Math.max(4, Math.min(100, n / Math.max(maxValue, 1) * 100));
    return `<div class="bar-row">
      <div class="bar-top"><span class="bar-label">${htmlSafe(label)}</span><span class="bar-value">${number(n)}</span></div>
      <div class="bar-track"><span class="info-fill" style="width:${width}%"></span></div>
      <div class="small">${htmlSafe(sub)}</div>
    </div>`;
  }
  function unavailableCount(label, sub) {
    return `<div class="bar-row unavailable-row">
      <div class="bar-top"><span class="bar-label">${htmlSafe(label)}</span><span class="bar-value">DATA UNAVAILABLE</span></div>
      <div class="bar-track"><span class="warn-fill" style="width:100%"></span></div>
      <div class="small">${htmlSafe(sub)}</div>
    </div>`;
  }
  function sourceRows(src = {}) {
    const provided = Array.isArray(src.by_source) ? src.by_source : [];
    const byKey = new Map(provided.map((row) => [keyOf(row.source || row.name), row]));
    const expected = EXPECTED_SOURCE_NAMES.map((name) => byKey.get(keyOf(name)) || {
      source: name,
      status: "DATA_UNAVAILABLE_EXPECTED_SOURCE_MISSING",
      data_quality_status: "DATA_UNAVAILABLE_EXPECTED_SOURCE_MISSING",
      data_freshness: "DATA_UNAVAILABLE",
      rate_limit_usage: "NOT_EXPOSED",
      events_today: 0,
      events_in_dashboard_window: 0,
      real_eligible_n: 0,
      shadow_eligible_n: 0,
      last_successful_fetch: null,
      last_failure_reason: "Expected source is missing from source observability rows",
      observed_providers: [],
    });
    const expectedKeys = new Set(EXPECTED_SOURCE_NAMES.map(keyOf));
    return [...expected, ...provided.filter((row) => !expectedKeys.has(keyOf(row.source || row.name)))];
  }
  function sourceCoverage(src = {}) {
    const rows = sourceRows(src);
    const expectedRows = rows.filter((row) => EXPECTED_SOURCE_NAMES.map(keyOf).includes(keyOf(row.source || row.name)));
    const observedExpectedRows = expectedRows.filter((row) => sourceObservationCount(row) > 0);
    const missingExpectedRows = expectedRows.filter((row) => sourceObservationCount(row) <= 0);
    const counts = src.coverage?.counts || {};
    const expectedN = Number(counts.expected_sources || 0) || EXPECTED_SOURCE_NAMES.length;
    const observedExpectedN = Number(counts.observed_expected_sources || 0) || observedExpectedRows.length;
    const rowEvidenceN = Number(counts.row_evidence_n || 0) || rows.reduce((sum, row) => sum + sourceObservationCount(row), 0);
    const derivedWarnings = missingExpectedRows.length ? [`EXPECTED_SOURCE_COVERAGE_MISSING: ${missingExpectedRows.map((row) => row.source || row.name).join(", ")}`] : [];
    return { rows, missingExpectedRows, expectedN, observedExpectedN, rowEvidenceN, visibleWarning: Boolean(src.coverage?.visible_warning) || missingExpectedRows.length > 0, derivedWarnings };
  }

  function renderSources(data) {
    byId("insight-nav").innerHTML = renderNav("sources");
    const src = data.source_observability || {};
    const coverage = src.coverage || {};
    const derived = sourceCoverage(src);
    const warnings = Array.from(new Set([...(coverage.warnings || []), ...(src.warnings || []), ...derived.derivedWarnings].filter(Boolean)));
    const coveragePct = derived.expectedN ? derived.observedExpectedN / derived.expectedN * 100 : null;
    byId("freshness").innerHTML = [
      freshnessBadge("Source monitor", src.source_updated_at, src.generated_at || data.generated_at),
      `<span class="badge ${derived.visibleWarning ? "warn" : "real"}">Source status · ${htmlSafe(readableCode(src.data_quality_status || src.status || "UNKNOWN"))}</span>`,
      `<span class="badge info">schema ${htmlSafe(readableCode(src.schema_version || "DATA_UNAVAILABLE"))}</span>`,
    ].join("");
    byId("source-summary").innerHTML = [
      metricCard("Events today", number(src.event_n), "live source events found today"),
      metricCard("Expected sources observed", `${number(derived.observedExpectedN)} / ${number(derived.expectedN)}`, `${coveragePct == null ? "DATA UNAVAILABLE" : percent(coveragePct)} expected-source coverage`),
      metricCard("Visible warning", derived.visibleWarning ? "YES" : "NO", warnings.length ? `${htmlSafe(warningText(warnings[0]))}${rawCodeDetail(warnings[0])}` : "No coverage warning from backend or fallback", derived.visibleWarning ? "negative" : "positive"),
      metricCard("Contract freshness", htmlSafe(readableCode(src.data_quality_status || "DATA_UNAVAILABLE")), `updated ${whenLocal(src.source_updated_at)} · local date ${htmlSafe(src.local_trading_date || "DATA UNAVAILABLE")}`),
    ].join("");
    byId("coverage-completeness").innerHTML = `<div class="coverage-meter">
      <div class="metric"><div class="metric-label">Source coverage</div><div class="metric-value ${derived.visibleWarning ? "negative" : "positive"}">${coveragePct == null ? "DATA UNAVAILABLE" : percent(coveragePct)}</div><div class="metric-sub">${number(derived.observedExpectedN)} observed of ${number(derived.expectedN)} expected · row evidence n=${number(derived.rowEvidenceN)}</div></div>
      <div><div class="bar-track"><span class="${derived.visibleWarning ? "bad-fill" : "good-fill"}" style="width:${Math.max(4, Math.min(100, coveragePct || 0))}%"></span></div><div class="small section-gap">${htmlSafe(warningText(coverage.caveat || "Dedicated source evidence is live. Missing sources remain visible."))}${coverage.caveat ? rawCodeDetail(coverage.caveat) : ""}</div></div>
    </div>`;
    const map = Object.fromEntries(derived.rows.map((row) => [keyOf(row.source || row.name), row]));
    byId("source-cards").innerHTML = EXPECTED_SOURCE_NAMES.map((name) => {
      const row = map[keyOf(name)];
      const observedN = sourceObservationCount(row);
      const hasRows = observedN > 0;
      const stateText = hasRows ? "HEALTHY" : (row ? "DOWN / ZERO COVERAGE" : "DATA UNAVAILABLE");
      const stateCls = hasRows ? "healthy" : (row ? "down" : "degraded");
      const providers = (row?.observed_providers || []).slice(0, 4).map((provider) => `<span class="provider-chip">${htmlSafe(provider.value)} · n=${number(provider.n)}</span>`).join("");
      return `<div class="metric source-card ${stateCls}">
        <div class="metric-label">${htmlSafe(name)}</div>
        <div class="metric-value" style="font-size:22px">${htmlSafe(stateText)}</div>
        <div class="source-health-line">
          <span class="badge ${hasRows ? "real" : "warn"}">${hasRows ? "✅ rows observed" : "⚠ zero rows"}</span>
          <span class="badge info">today n=${number(row?.events_today)}</span>
          <span class="badge info">window n=${number(observedN)}</span>
        </div>
        <div class="metric-sub">REAL eligible ${number(row?.real_eligible_n)} · SHADOW eligible ${number(row?.shadow_eligible_n)}</div>
        <div class="metric-sub">last success ${row?.last_successful_fetch ? whenLocal(row.last_successful_fetch) : "DATA UNAVAILABLE"} · freshness ${htmlSafe(readableCode(row?.data_freshness || "DATA_UNAVAILABLE"))}</div>
        <div class="metric-sub">rate limit ${htmlSafe(readableCode(row?.rate_limit_usage || "NOT_EXPOSED"))} · status ${htmlSafe(readableCode(row?.status || "DATA_UNAVAILABLE"))}</div>
        <div class="metric-sub">last failure ${htmlSafe(warningText(row?.last_failure_reason || row?.last_failure || "none reported"))}</div>
        <div class="provider-chips">${providers || `<span class="provider-chip">no observed provider rows</span>`}</div>
      </div>`;
    }).join("");
    byId("source-warnings").innerHTML = warnings.length
      ? warnings.map((warning) => `<div class="warning-row">⚠️ <strong>${htmlSafe(warningText(warning))}</strong>${rawCodeDetail(warning)}</div>`).join("")
      : `<div class="empty">No source warning emitted by the live API.</div>`;
    const missing = derived.missingExpectedRows.map((row) => row.source || row.name);
    byId("source-actions").innerHTML = `<div class="grid three">
      ${metricCard("Zero-row expected sources", number(missing.length), missing.length ? `Missing: ${htmlSafe(missing.slice(0, 6).join(", "))}${missing.length > 6 ? "…" : ""}` : "All expected sources have row evidence", missing.length ? "negative" : "positive")}
      ${metricCard("Rate-limit visibility", derived.rows.some((row) => String(row.rate_limit_usage || "").includes("NOT_EXPOSED")) ? "not exposed" : "visible", "If rate-limit usage is not exposed, the dashboard cannot claim provider budget health.", "muted")}
      ${metricCard("Failure rows", number(derived.rows.filter((row) => row.last_failure || row.last_failure_reason).length), "Failures and schema-pending states stay visible until explained.", "muted")}
    </div>`;
    const observed = src.observed_sources || [];
    byId("observed-sources").innerHTML = observed.length ? `<div class="table-scroll"><table><thead><tr><th>Observed source_provider</th><th>Window n</th><th>REAL</th><th>SHADOW</th></tr></thead><tbody>${observed.map((row) => `<tr><td>${htmlSafe(row.source)}</td><td>${number(row.events_in_dashboard_window)}</td><td>${number(row.real_eligible_n)}</td><td>${number(row.shadow_eligible_n)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">No source_provider values were present in live dashboard rows.</div>`;
    const recent = src.recent_events || [];
    byId("recent-source-events").innerHTML = recent.length ? `<div>${recent.slice(0, 25).map((row) => `<div class="event-row">
      <div><span class="event-symbol">${htmlSafe(row.symbol || "—")}</span><div class="event-id">${htmlSafe(row.event_id || "—")}</div></div>
      <div><span class="badge info">${htmlSafe(row.catalyst_type || "—")}</span></div>
      <div><span class="badge ${String(row.population).toUpperCase() === "REAL" ? "real" : "shadow"}">${htmlSafe(row.population || "—")}</span></div>
      <div><strong>${htmlSafe(row.source_provider || "unknown source")}</strong><div class="small">catalyst ${whenLocal(row.catalyst_ts)}</div></div>
      <div class="small">updated ${whenLocal(row.updated_at)}</div>
    </div>`).join("")}</div>` : `<div class="empty">No recent source events are exposed by the live dashboard contract.</div>`;
  }

  function distributionCard(title, dist, unit = "s") {
    const n = Number(dist?.n || 0);
    const fmt = (v) => unit === "s" ? seconds(v) : (v == null ? "DATA UNAVAILABLE" : percent(v));
    return `<div class="metric"><div class="metric-label">${htmlSafe(title)}</div><div class="metric-value" style="font-size:22px">${n ? fmt(dist.median) : "DATA UNAVAILABLE"}</div><div class="metric-sub">n=${number(n)} · avg ${dist?.avg == null ? "—" : fmt(dist.avg)} · p95 ${dist?.p95 == null ? "—" : fmt(dist.p95)}</div></div>`;
  }
  function localDateKey(value) {
    if (!value) return "unknown";
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
    } catch { return "unknown"; }
  }
  function deriveDailyMaxConcurrent(real, generatedAt) {
    const rows = [].concat(real?.recent_closed || [], real?.open_positions || []);
    const fallbackEnd = generatedAt || real?.generated_at || new Date().toISOString();
    const eventsByDay = new Map();
    for (const row of rows) {
      const startRaw = row.entry_fill_ts || row.entry_ts || row.decision_ts;
      if (!startRaw) continue;
      const start = new Date(startRaw);
      if (Number.isNaN(start.getTime())) continue;
      const end = new Date(row.exit_ts || row.updated_at || fallbackEnd);
      const safeEnd = Number.isNaN(end.getTime()) || end < start ? start : end;
      const day = row.local_trading_date || localDateKey(startRaw);
      if (!eventsByDay.has(day)) eventsByDay.set(day, []);
      eventsByDay.get(day).push({ ts: start.getTime(), delta: 1 }, { ts: safeEnd.getTime(), delta: -1 });
    }
    let best = null;
    for (const [day, events] of eventsByDay.entries()) {
      let current = 0, max = 0;
      events.sort((a, b) => a.ts - b.ts || b.delta - a.delta);
      for (const event of events) { current += event.delta; max = Math.max(max, current); }
      const row = { day, max, interval_rows_n: events.length / 2 };
      if (!best || row.max > best.max || (row.max === best.max && row.day > best.day)) best = row;
    }
    return best;
  }
  function statusCard(title, status, detail, tone = "info") {
    const icon = tone === "real" ? "✅" : tone === "negative" ? "🚨" : tone === "warn" ? "⚠️" : "ℹ️";
    return `<div class="metric"><div class="metric-label">${icon} ${htmlSafe(title)}</div><div class="metric-value" style="font-size:20px"><span class="badge ${tone}">${htmlSafe(status)}</span></div><div class="metric-sub">${htmlSafe(detail)}</div></div>`;
  }
  function renderExecutionContract(eq, real, derivedConcurrency) {
    const hasNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
    const hasDist = (value) => value && hasNumber(value.n) && Number(value.n) > 0;
    const gaps = eq?.rejections_and_skips || {};
    const dragValue = eq?.commission_drag_pct_of_gross ?? (hasNumber(real?.gross_pnl) && Number(real.gross_pnl) !== 0 ? Math.abs(Number(real?.commissions || 0) / Number(real.gross_pnl) * 100) : null);
    const field = (label, ok, detail, unavailableCopy = "Backend field is not exposed yet → fail-closed") => `<div class="metric"><div class="metric-label">${htmlSafe(label)}</div><div class="metric-value" style="font-size:20px"><span class="badge ${ok ? "real" : "warn"}">${ok ? "✅ LIVE" : "— DATA UNAVAILABLE"}</span></div><div class="metric-sub">${htmlSafe(ok ? detail : unavailableCopy)}</div></div>`;
    const concurrencyValue = firstValue(gaps.daily_max_concurrent_positions, gaps.max_concurrent_positions_today, eq?.daily_max_concurrent_positions, derivedConcurrency?.max);
    byId("execution-contract").innerHTML = `<div class="grid three">
      ${field("Gross / fees / net", hasNumber(real?.gross_pnl) && hasNumber(real?.commissions) && hasNumber(real?.net_pnl), `${dollars(real?.gross_pnl)} gross · ${dollars(real?.commissions)} fees · ${dollars(real?.net_pnl)} net · closed n=${number(real?.closed_n)}`)}
      ${field("Commission drag %", hasNumber(dragValue), hasNumber(dragValue) ? `${percent(dragValue)} of gross P&L` : "")}
      ${field("Slippage distribution", hasDist(eq?.slippage_vs_reference), hasDist(eq?.slippage_vs_reference) ? `n=${number(eq.slippage_vs_reference.n)} · median ${percent(eq.slippage_vs_reference.median)} · p95 ${percent(eq.slippage_vs_reference.p95)}` : "")}
      ${field("Decision/fill latency", hasDist(eq?.latency?.order_to_fill_s) || hasDist(eq?.latency?.latency_decision_to_fill_s), "backend exposes a latency distribution")}
      ${field("Catalyst → decision latency", hasDist(eq?.latency?.latency_catalyst_to_decision_s) || hasDist(eq?.latency?.news_to_decision_s), "backend exposes catalyst-to-decision timing")}
      ${field("Bracket completeness", hasNumber(eq?.bracket?.bracket_complete_pct), `${percent(eq?.bracket?.bracket_complete_pct)} complete · proof ${percent(eq?.bracket?.fill_adjusted_proof_pct)} · rows n=${number(eq?.bracket?.rows_n)}`)}
      ${field("Rejections / skip counts", Object.keys(gaps).length > 0, Object.entries(gaps).map(([key, value]) => `${key.replaceAll("_", " ")}=${number(value)}`).join(" · "))}
      ${field("Average notional", hasNumber(eq?.notional?.avg_closed_notional), `${dollars(eq?.notional?.avg_closed_notional)} · closed notional n=${number(eq?.notional?.n)}`)}
      ${field("Daily max concurrent positions", hasNumber(concurrencyValue), derivedConcurrency ? `n=${number(concurrencyValue)} derived from public REAL intervals for ${derivedConcurrency.day}` : `n=${number(concurrencyValue)} from backend`)}
    </div><div class="empty section-gap">Missing fields stay unavailable; this page does not infer broker-health evidence from unrelated rows.</div>`;
  }
  function renderExecutionOps(data, eq, real) {
    const security = data.security || {};
    const generatedAt = data.generated_at || eq?.generated_at;
    const sourceUpdatedAt = eq?.source_updated_at || real?.source_updated_at;
    const ageMin = sourceUpdatedAt ? (new Date(generatedAt || Date.now()) - new Date(sourceUpdatedAt)) / 60000 : null;
    const feedLive = Number.isFinite(ageMin) && ageMin <= 90;
    const rlsTables = security.rls_verified_tables || {};
    const rlsOk = Boolean(rlsTables.agent_trades && rlsTables.agent_shadow_trades);
    const keyRole = String(security.key_role || "DATA UNAVAILABLE").toLowerCase();
    byId("execution-ops").innerHTML = `<div class="grid three">
      ${statusCard("IBKR Gateway", feedLive ? "ROW EVIDENCE LIVE · DIRECT STATUS MISSING" : "ROW EVIDENCE STALE · DIRECT STATUS MISSING", `Public contract exposes ${htmlSafe(eq?.venue || real?.venue || "IBKR/PAPER")} execution rows, last updated ${whenLocal(sourceUpdatedAt)}. It does not expose the Gateway heartbeat itself.`, feedLive ? "warn" : "negative")}
      ${statusCard("NDAX", "DATA UNAVAILABLE / GATED", "NDAX is not mixed into IBKR/PAPER results on this public page.", "warn")}
      ${statusCard("Telegram alerts", "DATA UNAVAILABLE", "Public status does not expose delivery proof. Expected material alerts: real fills, exits, kill-switch/Gateway events, and daily digest.", "warn")}
      ${statusCard("Kill switch", "DATA UNAVAILABLE", "No kill-switch state is exposed by the public contract.", "warn")}
      ${statusCard("Security / RLS", rlsOk && keyRole === "anon" ? "RLS VERIFIED · ANON KEY" : "CHECK REQUIRED", `agent_trades RLS=${htmlSafe(rlsTables.agent_trades)} · agent_shadow_trades RLS=${htmlSafe(rlsTables.agent_shadow_trades)} · key role ${htmlSafe(security.key_role)} · verified ${whenLocal(security.rls_verified_at)}`, rlsOk && keyRole === "anon" ? "real" : "warn")}
    </div>`;
  }
  function renderExecutionGaps(eq, real, derivedConcurrency) {
    if (!eq) { byId("execution-gaps").innerHTML = emptyCard("DATA UNAVAILABLE", "execution_quality schema is not available; gap counts are not inferred."); return; }
    const gaps = eq.rejections_and_skips || {};
    const valueOrNull = (...keys) => {
      for (const key of keys) {
        if (gaps[key] !== null && gaps[key] !== undefined && gaps[key] !== "") return gaps[key];
        if (eq[key] !== null && eq[key] !== undefined && eq[key] !== "") return eq[key];
      }
      return null;
    };
    const items = [
      ["Uncosted closed", gaps.uncosted_closed_n, "closed rows excluded until commissions are visible"],
      ["Stale open", gaps.stale_open_n, "open rows that failed freshness reconciliation"],
      ["Missing exit", gaps.anomalous_closed_missing_exit_n, "closed rows missing exit reason"],
      ["Excluded population", gaps.excluded_population_n, "rows not admitted to trusted REAL accounting"],
      ["Spread missing", gaps.spread_missing_unflagged_n, "spread missing without an explicit flag"],
      ["Commission missing", gaps.commissions_missing_unflagged_n, "commission missing without an explicit flag"],
      ["Skipped by commission gate", valueOrNull("skipped_by_commission_gate_n", "commission_gate_skipped_n"), "not exposed by current backend schema → fail-closed"],
      ["Skipped by capacity", valueOrNull("skipped_by_capacity_n", "capacity_skipped_n"), "not exposed by current backend schema → fail-closed"],
      ["Daily max concurrent positions", valueOrNull("daily_max_concurrent_positions", "max_concurrent_positions_today") ?? derivedConcurrency?.max ?? null, derivedConcurrency ? `derived from public REAL intervals for ${derivedConcurrency.day}` : "not exposed by current backend schema → fail-closed"],
    ];
    const max = Math.max(1, ...items.map(([, value]) => Number(value || 0)).filter(Number.isFinite));
    byId("execution-gaps").innerHTML = `<div class="grid two">
      ${metricCard("Execution status", htmlSafe(eq.status || "DATA UNAVAILABLE"), `${htmlSafe(eq.source || "source unavailable")} · venue ${htmlSafe(eq.venue || real.venue || "—")}`)}
      ${metricCard("Bracket completeness", percent(eq.bracket?.bracket_complete_pct), `proof ${percent(eq.bracket?.fill_adjusted_proof_pct)} · rows n=${number(eq.bracket?.rows_n)}`, Number(eq.bracket?.bracket_complete_pct || 0) >= 100 ? "positive" : "negative")}
    </div><div class="section-gap">${items.map(([label, value, sub]) => value === null ? unavailableCount(label, sub) : countBar(label, value, sub, max)).join("")}</div>${(eq.warnings || []).length ? `<div class="section-gap">${eq.warnings.map((warning) => `<div class="warning-row">⚠️ ${htmlSafe(warning)}</div>`).join("")}</div>` : `<div class="empty section-gap">No execution-quality warnings emitted by the backend.</div>`}`;
  }
  function renderExecution(data) {
    byId("insight-nav").innerHTML = renderNav("execution");
    const real = data.real || {};
    const eq = data.execution_quality;
    byId("freshness").innerHTML = [
      freshnessBadge("Execution quality", eq?.source_updated_at, eq?.generated_at || data.generated_at),
      `<span class="badge ${eq?.data_quality_status === "VERIFIED_PARTIAL" ? "real" : "warn"}">Execution status · ${htmlSafe(eq?.data_quality_status || eq?.status || "DATA UNAVAILABLE")}</span>`,
      `<span class="badge info">schema ${htmlSafe(eq?.schema_version || "DATA_UNAVAILABLE")}</span>`,
    ].join("");
    const closed = Number(real.closed_n || 0);
    const gross = Number(real.gross_pnl || 0);
    const fees = Number(real.commissions || 0);
    const drag = gross ? Math.abs(fees / gross * 100) : null;
    const recentRows = real.recent_closed || real.recent_costed_closed || [];
    const avgNotional = eq?.notional?.avg_closed_notional ?? avg(recentRows.map((row) => Number(row.spent || row.entry_notional || row.amount_spent || (Number(row.quantity || 0) * Number(row.entry_price || 0)) || 0)));
    const derivedConcurrency = deriveDailyMaxConcurrent(real, data.generated_at);
    byId("execution-summary").innerHTML = [
      metricCard("Gross P&L", dollars(gross), `closed n=${number(closed)}`, signed(gross)),
      metricCard("Commissions", dollars(fees), `drag ${drag == null ? "DATA UNAVAILABLE" : percent(drag)}`, "negative"),
      metricCard("Net P&L", dollars(real.net_pnl), "gross − commissions", signed(real.net_pnl)),
      metricCard("Avg notional", dollars(avgNotional), `closed notional n=${number(eq?.notional?.n || recentRows.length)}`),
    ].join("");
    renderExecutionContract(eq, real, derivedConcurrency);
    renderExecutionOps(data, eq, real);
    const maxAbs = Math.max(1, Math.abs(gross), Math.abs(fees), Math.abs(Number(real.net_pnl || 0)));
    byId("fee-waterfall").innerHTML = [
      bar("Gross before costs", gross, `closed n=${number(closed)}`, maxAbs),
      bar("Commission drag", -Math.abs(fees), "broker commission evidence", maxAbs),
      bar("Net after fees", real.net_pnl, "trusted public accounting", maxAbs),
    ].join("");
    byId("latency-quality").innerHTML = eq ? `<div class="grid two">
      ${distributionCard("Catalyst → decision", eq.latency?.latency_catalyst_to_decision_s || eq.latency?.news_to_decision_s)}
      ${distributionCard("Decision → fill", eq.latency?.latency_decision_to_fill_s || eq.latency?.order_to_fill_s)}
      ${distributionCard("Slippage vs reference", eq.slippage_vs_reference, "%")}
      ${distributionCard("Spread at entry", eq.spread_at_entry, "%")}
    </div><div class="grid two section-gap">
      ${metricCard("Bracket completeness", percent(eq.bracket?.bracket_complete_pct), `complete n=${number(eq.bracket?.bracket_complete_n)} / rows n=${number(eq.bracket?.rows_n)} · fill-adjusted proof ${percent(eq.bracket?.fill_adjusted_proof_pct)}`)}
      ${metricCard("Open concentration", htmlSafe(eq.open_concentration?.[0]?.symbol || "none"), `open notional ${dollars(eq.notional?.open_notional)} · top share ${percent(eq.open_concentration?.[0]?.share_pct)}`)}
    </div><div class="section-gap"><div class="panel-header"><h3 class="panel-title">Exit reasons</h3><span class="badge info">closed n=${number(eq.closed_n)}</span></div>${(eq.exit_reasons || []).map((row) => countBar(row.reason, row.n, `n=${number(row.n)}`, Math.max(1, ...(eq.exit_reasons || []).map((x) => Number(x.n || 0))))).join("") || emptyCard("No exit reasons", "No closed execution rows available.")}</div>` : emptyCard("Detailed execution-quality schema", "Backend currently returns execution_quality=null. No slippage/latency distribution is inferred.");
    const openRows = eq?.open_concentration || [];
    const maxOpen = Math.max(1, ...openRows.map((row) => Number(row.open_notional || 0)));
    byId("open-concentration").innerHTML = eq ? `<div class="grid two">
      ${metricCard("Open notional", dollars(eq.notional?.open_notional), `open n=${number(eq.open_n || eq.notional?.open_notional_n)}`)}
      ${metricCard("Top concentration", htmlSafe(openRows[0]?.symbol || "none"), `${dollars(openRows[0]?.open_notional)} · ${percent(openRows[0]?.share_pct)} of open notional`)}
    </div><div class="section-gap">${openRows.length ? openRows.map((row) => bar(row.symbol, row.open_notional, `${percent(row.share_pct)} of open exposure`, maxOpen)).join("") : emptyCard("No open exposure", "No open positions in execution_quality.")}</div>` : emptyCard("DATA UNAVAILABLE", "execution_quality schema is not available; concentration is not inferred.");
    renderExecutionGaps(eq, real, derivedConcurrency);
    const rows = recentRows.slice(0, 25);
    byId("execution-table").innerHTML = rows.length ? `<div class="table-scroll"><table><thead><tr><th>Trade</th><th>Notional</th><th>Exit</th><th>Gross</th><th>Fees</th><th>Net</th><th>Latency / slippage</th><th>Rule</th></tr></thead><tbody>${rows.map((row) => `<tr>
      <td>${htmlSafe(row.symbol)} ${htmlSafe(row.direction)}<div class="small">${htmlSafe(row.catalyst_type)} · ${htmlSafe(row.money_status || row.venue || "REAL")}</div></td>
      <td>${dollars(row.spent || row.entry_notional || row.amount_spent || (Number(row.quantity || 0) * Number(row.entry_price || 0)))}<div class="small">qty ${htmlSafe(row.quantity ?? "—")} @ ${dollars(row.entry_price)}</div></td>
      <td>${htmlSafe(row.exit_reason || "—")}<div class="small">${whenLocal(row.exit_ts)}</div></td>
      <td>${dollars(row._gross_pnl ?? row.gross_pnl_cad ?? row.gross_pnl)}</td>
      <td>${dollars(row._commissions ?? row.commissions_cad ?? row.commissions)}</td>
      <td>${dollars(row._net_pnl ?? row.net_pnl_after_commissions_cad ?? row.net_pnl_after_commissions ?? row.net_pnl)}</td>
      <td>${seconds(row.latency_decision_to_fill_s ?? row.order_to_fill_s)}<div class="small">slip ${row.slippage_vs_reference == null ? "DATA UNAVAILABLE" : percent(row.slippage_vs_reference)}</div></td>
      <td>${htmlSafe(row.rule_id)}<div class="small">${htmlSafe(row.headline || row.reason || "")}</div></td>
    </tr>`).join("")}</tbody></table></div>` : emptyCard("No recent closed trades", "No verified execution rows available.");
  }
  function insightError(error) {
    document.querySelector("main").innerHTML = `<section class="panel"><h1>DATA UNAVAILABLE</h1><p class="subtitle">${htmlSafe(error.message || error)}</p></section>`;
  }
  async function main() {
    const refreshButton = byId("manual-refresh");
    if (refreshButton) refreshButton.disabled = true;
    try {
      const data = await fetchDashboard();
      byId("generated-at").textContent = `Updated ${whenLocal(data.generated_at)} · schema ${htmlSafe(data.schema_version)}`;
      if (document.body.dataset.page === "sources") renderSources(data);
      if (document.body.dataset.page === "execution") renderExecution(data);
    } catch (error) {
      insightError(error);
    } finally {
      if (refreshButton) refreshButton.disabled = false;
    }
  }
  document.addEventListener("DOMContentLoaded", () => {
    byId("manual-refresh")?.addEventListener("click", main);
    main();
    setInterval(() => { if (document.visibilityState === "visible") main(); }, 60000);
  });
}());
