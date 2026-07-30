#!/usr/bin/env node
"use strict";

const { adaptDashboardPayload, DEFAULT_ENDPOINT } = require("./dashboard-data-adapter.js");

async function main() {
  const endpoint = process.env.DASHBOARD_API_URL || DEFAULT_ENDPOINT;
  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) throw new Error(`Dashboard API ${response.status}`);
  const payload = await response.json();
  const adapted = adaptDashboardPayload(payload);
  const output = {
    endpointReached: true,
    environmentDetected: adapted.verification.environmentDetected,
    backendFields: Object.keys(payload),
    totals: adapted.viewModel.totals,
    ruleMapping: adapted.viewModel.rules.map((rule) => ({
      backend: rule.id,
      frontend: rule.name,
      n: rule.closedTrades,
      netPnl: rule.netPnl,
      seriesPoints: rule.series.length,
    })),
    missingOrWarnings: adapted.viewModel.warnings,
    reconciliation: adapted.verification,
    accountSnapshot: payload.account_capital?.snapshot_status || "DATA_UNAVAILABLE",
    shadow: {
      pricedN: payload.shadow?.priced_n ?? null,
      pendingN: payload.shadow?.pending_or_unpriced_n ?? null,
    },
    finalResult: adapted.verification.result,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (adapted.verification.result === "FAIL") process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`FAIL: ${error.message}\n`);
  process.exitCode = 1;
});
