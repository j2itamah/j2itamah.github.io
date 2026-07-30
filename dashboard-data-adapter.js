/* Shared, read-only boundary between the Railway dashboard payload and every
 * public cockpit. No broker or Supabase credentials belong in this file. */
(function attachTradeDashboardData(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.TradeDashboardData = api;
})(typeof window !== "undefined" ? window : globalThis, function createTradeDashboardData() {
  "use strict";

  const DEFAULT_ENDPOINT = "https://live-agent-dashboard-web-production.up.railway.app/api/live-agent/dashboard";
  const SNAPSHOT_KEY = "trade-dashboard:last-verified:v2";
  const STALE_AFTER_MS = 90 * 60 * 1000;
  const RECONCILIATION_TOLERANCE = 0.03;
  const RULE_SPECS = [
    { id: "RULE_SEC_FILING_DEFAULT_LONG", name: "SEC Filing Long" },
    { id: "RULE_SEC_424B_DILUTION_SHORT", name: "424B Dilution Short" },
    { id: "RULE_SEC_8K_202_DEFAULT_LONG", name: "8-K 2.02 Long" },
    { id: "RULE_NAMED_POSITIVE_CATALYST", name: "Named Catalyst" },
    { id: "RULE_CATALYST_DEFAULT_LONG", name: "Catalyst Long" },
  ];

  let lastSuccess = null;
  let inFlight = null;

  function finiteOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function integerOrNull(value) {
    const number = finiteOrNull(value);
    return number !== null && Number.isInteger(number) && number >= 0 ? number : null;
  }

  function validTimestamp(value) {
    if (!value) return null;
    const timestamp = new Date(value);
    return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
  }

  function rowNet(row) {
    return finiteOrNull(
      row?._net_pnl ??
      row?.net_pnl_after_commissions_cad ??
      row?.net_pnl_after_commissions ??
      row?.net_pnl
    );
  }

  function rowNotional(row) {
    const explicit = finiteOrNull(row?.spent ?? row?.open_notional ?? row?.market_value);
    if (explicit !== null) return Math.abs(explicit);
    const quantity = finiteOrNull(row?.quantity ?? row?.qty);
    const price = finiteOrNull(row?.entry_price);
    return quantity !== null && price !== null ? Math.abs(quantity * price) : null;
  }

  function isCleanStatus(value) {
    const status = String(value || "").toUpperCase();
    return Boolean(status) && !/(WARN|FAIL|ERROR|UNAVAILABLE|UNKNOWN|STALE|PARTIAL)/.test(status);
  }

  function isReconciliationOk(value) {
    return /^(PASS|OK|VERIFIED)$/.test(String(value || "").toUpperCase());
  }

  function buildRuleSeries(real, ruleId, warnings) {
    const rows = (real?.recent_closed || [])
      .filter((row) => row?.rule_id === ruleId && rowNet(row) !== null && validTimestamp(row?.exit_ts))
      .sort((a, b) => new Date(a.exit_ts) - new Date(b.exit_ts));
    let cumulative = 0;
    const series = rows.map((row) => {
      cumulative += rowNet(row);
      return {
        timestamp: validTimestamp(row.exit_ts),
        cumulativeNetPnl: Number(cumulative.toFixed(2)),
      };
    });
    if (!series.length) warnings.push(`${ruleId}: cumulative series unavailable`);
    return series;
  }

  function mapRules(real, warnings) {
    const backendRules = Array.isArray(real?.by_rule) ? real.by_rule : [];
    const backendById = new Map(backendRules.map((rule) => [String(rule?.value || ""), rule]));
    const knownIds = new Set(RULE_SPECS.map((rule) => rule.id));
    const unmappedRules = backendRules
      .map((rule) => String(rule?.value || ""))
      .filter((ruleId) => ruleId && !knownIds.has(ruleId));

    const rules = RULE_SPECS.map((spec) => {
      const source = backendById.get(spec.id) || {};
      const completed = integerOrNull(source.n);
      const wins = integerOrNull(source.wins);
      const losses = completed !== null && wins !== null ? completed - wins : null;
      const winRate = finiteOrNull(source.win_rate);
      if (!backendById.has(spec.id)) warnings.push(`${spec.name}: backend rule group missing`);
      if (wins !== null && losses !== null && completed !== wins + losses) {
        warnings.push(`${spec.name}: wins + losses do not reconcile`);
      }
      if (winRate !== null && completed && wins !== null) {
        const expected = wins / completed * 100;
        if (Math.abs(expected - winRate) > 0.11) warnings.push(`${spec.name}: win rate does not reconcile`);
      }
      if (winRate !== null && (winRate < 0 || winRate > 100)) warnings.push(`${spec.name}: win rate outside 0–100`);
      return {
        id: spec.id,
        name: spec.name,
        netPnl: finiteOrNull(source.net_pnl),
        grossPnl: finiteOrNull(source.gross_pnl),
        commissions: finiteOrNull(source.commissions),
        winRate,
        wins,
        losses,
        closedTrades: completed,
        series: buildRuleSeries(real, spec.id, warnings),
      };
    });
    return { rules, unmappedRules };
  }

  function mapOpenConcentration(payload, warnings) {
    const supplied = payload?.execution_quality?.open_concentration;
    const rows = Array.isArray(supplied) && supplied.length
      ? supplied.map((row) => ({
          symbol: String(row?.symbol || "UNKNOWN"),
          percentage: finiteOrNull(row?.share_pct),
          marketValue: finiteOrNull(row?.open_notional),
        }))
      : (payload?.real?.open_positions || []).map((row) => ({
          symbol: String(row?.symbol || "UNKNOWN"),
          percentage: null,
          marketValue: rowNotional(row),
        }));
    const totalValue = rows.reduce((sum, row) => sum + (row.marketValue || 0), 0);
    for (const row of rows) {
      if (row.percentage === null && totalValue > 0 && row.marketValue !== null) {
        row.percentage = Number((row.marketValue / totalValue * 100).toFixed(2));
      }
      if (row.percentage !== null && (row.percentage < 0 || row.percentage > 100)) {
        warnings.push(`${row.symbol}: open concentration outside 0–100`);
      }
    }
    const percentageTotal = rows.reduce((sum, row) => sum + (row.percentage || 0), 0);
    if (rows.length && Math.abs(percentageTotal - 100) > 0.5) {
      warnings.push(`Open-position concentration totals ${percentageTotal.toFixed(2)}%, not approximately 100%`);
    }
    return rows;
  }

  function mapNewsSources(payload, warnings) {
    const source = payload?.source_observability || {};
    const observed = Array.isArray(source.observed_sources) ? source.observed_sources : [];
    const totalEvents = integerOrNull(source.event_n);
    const eligibleEvents = observed.reduce((sum, row) => sum + (integerOrNull(row?.real_eligible_n) || 0), 0);
    const activeSources = observed.filter((row) => (integerOrNull(row?.events_in_dashboard_window) || 0) > 0).length;
    if (totalEvents === null) warnings.push("News total-event count unavailable");
    if (!observed.length) warnings.push("News source activity unavailable");
    if (String(source.population || "").toUpperCase().includes("MIXED")) {
      warnings.push("News total-event activity is mixed REAL/SHADOW source evidence; eligibleEvents is REAL-only");
    }
    return {
      totalEvents,
      eligibleEvents,
      activeSources: observed.length ? activeSources : null,
    };
  }

  function adaptDashboardPayload(payload, options = {}) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Dashboard response is not an object");
    }
    if (!payload.real || !payload.shadow) throw new Error("Dashboard response is missing REAL or SHADOW population");

    const warnings = [];
    const real = payload.real;
    const totals = {
      netPnl: finiteOrNull(real.net_pnl),
      grossPnl: finiteOrNull(real.gross_pnl),
      commissions: finiteOrNull(real.commissions),
      closedTrades: integerOrNull(real.closed_n),
      openPositions: integerOrNull(real.open_n),
      wins: integerOrNull(real.wins),
      losses: integerOrNull(real.losses),
      winRate: finiteOrNull(real.win_rate),
    };
    for (const [field, value] of Object.entries(totals)) {
      if (value === null) warnings.push(`${field}: unavailable or invalid`);
    }
    if (totals.netPnl !== null && totals.grossPnl !== null && totals.commissions !== null) {
      const expectedNet = totals.grossPnl - totals.commissions;
      if (Math.abs(expectedNet - totals.netPnl) > RECONCILIATION_TOLERANCE) {
        warnings.push(`Net P&L does not reconcile: ${totals.grossPnl} - ${totals.commissions} != ${totals.netPnl}`);
      }
    }

    const { rules, unmappedRules } = mapRules(real, warnings);
    const mappedClosed = rules.reduce((sum, rule) => sum + (rule.closedTrades || 0), 0);
    const costedClosed = integerOrNull(real.n);
    if (costedClosed !== null && mappedClosed !== costedClosed) {
      warnings.push(`Displayed rule groups total ${mappedClosed}; verified costed total is ${costedClosed}`);
    }
    if (totals.closedTrades !== null && costedClosed !== null && totals.closedTrades !== costedClosed) {
      warnings.push(`${totals.closedTrades - costedClosed} closed trade(s) are not costed and remain excluded from P&L`);
    }
    if (unmappedRules.length) warnings.push(`Unmapped rules: ${unmappedRules.join(", ")}`);

    const generatedAt = validTimestamp(payload.generated_at);
    const dataAsOf = validTimestamp(real.source_updated_at);
    if (!generatedAt) warnings.push("Page generated_at is missing or invalid");
    if (!dataAsOf) warnings.push("REAL source_updated_at is missing or invalid");
    const ageMs = dataAsOf ? Date.now() - new Date(dataAsOf).getTime() : Infinity;
    const stale = ageMs > (options.staleAfterMs || STALE_AFTER_MS);
    if (stale) warnings.push("REAL source evidence is stale");
    if (!isReconciliationOk(real.reconciliation_status)) {
      warnings.push(`REAL reconciliation status is ${real.reconciliation_status || "unavailable"}`);
    }
    if (!isCleanStatus(real.data_quality_status)) {
      warnings.push(`REAL data-quality status is ${real.data_quality_status || "unavailable"}`);
    }
    const accountStatus = String(payload.account_capital?.snapshot_status || "DATA_UNAVAILABLE").toUpperCase();
    if (accountStatus !== "LIVE") warnings.push("Current IBKR account data unavailable");

    const status = stale || !isReconciliationOk(real.reconciliation_status) || !isCleanStatus(real.data_quality_status)
      ? "stale"
      : "live";
    const environment = /PAPER/.test(String(real.venue || payload.execution_quality?.venue || "").toUpperCase())
      ? "paper"
      : String(real.population || "").toUpperCase() === "REAL" ? "real" : "unknown";
    const viewModel = {
      status,
      environment,
      broker: String(real.venue || "IBKR").split("/")[0],
      lastUpdated: generatedAt,
      dataAsOf,
      totals,
      rules,
      leaderboard: rules.map((rule) => ({ ruleId: rule.id, name: rule.name, netPnl: rule.netPnl })),
      openPositionConcentration: mapOpenConcentration(payload, warnings),
      newsSources: mapNewsSources(payload, warnings),
      warnings: [...new Set(warnings)],
      unmappedRules,
    };
    return {
      raw: payload,
      viewModel,
      datasets: {
        real: payload.real,
        shadow: payload.shadow,
        sourceObservability: payload.source_observability || null,
        executionQuality: payload.execution_quality || null,
        accountCapital: payload.account_capital || null,
        security: payload.security || null,
      },
      verification: {
        endpointReached: true,
        environmentDetected: environment.toUpperCase(),
        totalsReconciled: !warnings.some((warning) => warning.startsWith("Net P&L does not reconcile")),
        mappedRulesReconciled: mappedClosed === costedClosed,
        unmappedRules,
        result: warnings.length ? "PASS_WITH_WARNINGS" : "PASS",
      },
    };
  }

  function compactSnapshot(adapted) {
    return {
      savedAt: new Date().toISOString(),
      viewModel: adapted.viewModel,
      verification: adapted.verification,
    };
  }

  function saveSnapshot(adapted) {
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(compactSnapshot(adapted)));
    } catch (_) {
      // Storage may be disabled; in-memory lastSuccess still protects refreshes.
    }
  }

  function loadSnapshot() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "null");
      return parsed?.viewModel ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function fallbackPayload(snapshot) {
    const vm = snapshot.viewModel;
    const byRule = vm.rules.map((rule) => ({
      field: "rule_id",
      value: rule.id,
      n: rule.closedTrades,
      wins: rule.wins,
      gross_pnl: rule.grossPnl,
      commissions: rule.commissions,
      net_pnl: rule.netPnl,
      win_rate: rule.winRate,
    }));
    return {
      generated_at: snapshot.savedAt,
      schema_version: "compact_last_verified_snapshot_v2",
      real: {
        generated_at: vm.lastUpdated,
        source_updated_at: vm.dataAsOf,
        schema_version: "compact_last_verified_snapshot_v2",
        population: "REAL",
        venue: "IBKR/PAPER",
        local_trading_date: vm.dataAsOf?.slice(0, 10) || null,
        data_quality_status: "LAST_VERIFIED_SNAPSHOT",
        reconciliation_status: "SNAPSHOT",
        n: vm.rules.reduce((sum, rule) => sum + (rule.closedTrades || 0), 0),
        closed_n: vm.totals.closedTrades,
        open_n: vm.totals.openPositions,
        wins: vm.totals.wins,
        losses: vm.totals.losses,
        win_rate: vm.totals.winRate,
        gross_pnl: vm.totals.grossPnl,
        commissions: vm.totals.commissions,
        net_pnl: vm.totals.netPnl,
        by_rule: byRule,
        by_catalyst: [],
        by_direction: [],
        equity_curve: [],
        recent_closed: [],
        recent_costed_closed: [],
        open_positions: [],
        decision_feed: [],
      },
      shadow: {
        population: "SHADOW",
        data_quality_status: "DATA_UNAVAILABLE_DURING_FALLBACK",
        priced_n: null,
        pending_or_unpriced_n: null,
        horizon_ladder: [],
      },
      account_capital: { snapshot_status: "DATA_UNAVAILABLE" },
    };
  }

  function attachMeta(payload, meta) {
    Object.defineProperty(payload, "__dashboardMeta", {
      value: meta,
      enumerable: false,
      configurable: true,
    });
    return payload;
  }

  function sanitizedError(error) {
    if (error?.name === "AbortError") return "Dashboard request timed out or was cancelled";
    return "Verified dashboard data is temporarily unavailable";
  }

  async function requestOnce(endpoint, timeoutMs, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal) signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, timeoutMs);
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`Dashboard API ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
      if (signal) signal.removeEventListener("abort", abort);
    }
  }

  async function fetchDashboard(options = {}) {
    if (inFlight) return inFlight;
    const endpoint = options.endpoint ||
      (typeof window !== "undefined" && window.DASHBOARD_API_URL) ||
      DEFAULT_ENDPOINT;
    const timeoutMs = options.timeoutMs || 15000;
    const delays = options.retryDelays || [0, 750, 1750];
    const signal = options.signal;

    inFlight = (async () => {
      let lastError = null;
      for (const delay of delays) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
        try {
          const raw = await requestOnce(endpoint, timeoutMs, signal);
          const adapted = adaptDashboardPayload(raw);
          lastSuccess = adapted;
          saveSnapshot(adapted);
          return attachMeta(raw, {
            source: "live_endpoint",
            fetchedAt: new Date().toISOString(),
            viewModel: adapted.viewModel,
            verification: adapted.verification,
          });
        } catch (error) {
          lastError = error;
          if (signal?.aborted) break;
        }
      }
      if (lastSuccess) {
        return attachMeta(lastSuccess.raw, {
          source: "memory_last_verified",
          fetchedAt: new Date().toISOString(),
          viewModel: { ...lastSuccess.viewModel, status: "stale" },
          verification: { ...lastSuccess.verification, result: "PASS_WITH_WARNINGS" },
          error: sanitizedError(lastError),
        });
      }
      const snapshot = typeof localStorage !== "undefined" ? loadSnapshot() : null;
      if (snapshot) {
        const raw = fallbackPayload(snapshot);
        return attachMeta(raw, {
          source: "persistent_last_verified",
          fetchedAt: new Date().toISOString(),
          viewModel: { ...snapshot.viewModel, status: "stale" },
          verification: { ...snapshot.verification, result: "PASS_WITH_WARNINGS" },
          error: sanitizedError(lastError),
        });
      }
      throw new Error(sanitizedError(lastError));
    })();
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  }

  return {
    DEFAULT_ENDPOINT,
    RULE_SPECS,
    adaptDashboardPayload,
    fetchDashboard,
    finiteOrNull,
    validTimestamp,
  };
});
