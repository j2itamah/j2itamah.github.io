/* Shared cockpit helpers for REAL and SHADOW pages.
 * Data always comes from the verified backend endpoint /api/live-agent/dashboard.
 * On GitHub Pages the page sets window.API_BASE to the Railway backend; on the
 * Railway app it is same-origin (empty prefix). No Supabase key ever lives here. */
const API_BASE = (typeof window !== "undefined" && window.API_BASE) || "";
const $ = (id) => document.getElementById(id);

const money = (v) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(v || 0));
const maybeMoney = (v) => (v === null || v === undefined || v === "" ? "—" : money(v));
const num = (v) => new Intl.NumberFormat("en-US").format(Number(v || 0));
const pct = (v) => `${Number(v || 0).toFixed(1)}%`;
const pct3 = (v) => `${Number(v || 0).toFixed(3)}%`;
const cls = (v) => (Number(v || 0) > 0 ? "positive" : Number(v || 0) < 0 ? "negative" : "muted");

function esc(v) {
  return String(v ?? "—")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function safe(v, fallback = "—") {
  if (v === null || v === undefined || v === "") return fallback;
  return esc(v);
}
function when(v) { if (!v) return "—"; try { return new Date(v).toLocaleString(); } catch { return esc(v); } }
function shortTime(v) { if (!v) return "—"; try { return new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return esc(v); } }
function shortSource(v) { if (!v) return "no source"; const r = String(v); return r.includes(":") ? r.split(":").slice(0, 2).join(":") : r; }
function catalystKey(row) { return String(row?.catalyst_type || row?.value || "UNKNOWN"); }
function catalystDisplay(value) {
  const raw = String(value || "UNKNOWN");
  const labels = {
    ALL: "All",
    filing: "Filing",
    crypto_news: "Crypto news",
    trading_halt: "Trading halt",
    news: "News",
    macro: "Macro",
    UNKNOWN: "Unknown",
  };
  return labels[raw] || raw.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function catalystTypesFrom(...lists) {
  const preferred = ["filing", "crypto_news", "trading_halt", "news", "macro"];
  const found = new Set();
  for (const list of lists) {
    for (const row of list || []) {
      const key = catalystKey(row);
      if (key && key !== "ALL") found.add(key);
    }
  }
  return preferred.filter((key) => found.has(key)).concat(
    [...found].filter((key) => !preferred.includes(key)).sort()
  );
}
function renderCatalystFilter(id, selected, types, counts = {}, variant = "real") {
  const el = $(id);
  if (!el) return;
  const chips = ["ALL", ...types];
  el.innerHTML = chips.map((key) => {
    const count = key === "ALL"
      ? Object.values(counts).reduce((acc, value) => acc + Number(value || 0), 0)
      : Number(counts[key] || 0);
    const active = key === selected ? " active" : "";
    return `<button class="filter-pill ${variant}${active}" type="button" data-catalyst-filter="${esc(key)}">${esc(catalystDisplay(key))}<span class="pill-count">${num(count)}</span></button>`;
  }).join("");
}

async function fetchDashboard() {
  const res = await fetch(API_BASE + "/api/live-agent/dashboard", { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.error || `HTTP ${res.status}`);
  return data;
}
async function fetchSecurity() {
  try {
    const res = await fetch(API_BASE + "/api/live-agent/security", { cache: "no-store" });
    return await res.json();
  } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
}

/* n is always shown next to a metric so no figure is read without its sample. */
function metric(label, value, n, sub = "", className = "") {
  const nTag = n === undefined || n === null ? "" : `<span class="n-tag">n=${num(n)}</span>`;
  return `<div class="metric">
      <div class="metric-label">${esc(label)}${nTag}</div>
      <div class="metric-value ${className}">${value}</div>
      ${sub ? `<div class="metric-sub">${sub}</div>` : ""}
    </div>`;
}

function dataContractState(dataset, topData, expected = {}) {
  const required = ["generated_at", "source_updated_at", "schema_version", "population", "venue", "local_trading_date", "data_quality_status"];
  const missing = required.filter((key) => !dataset?.[key]);
  const sourceTs = dataset?.source_updated_at;
  const generatedTs = dataset?.generated_at || topData?.generated_at;
  const sourceAgeMin = sourceTs ? (new Date(generatedTs || Date.now()) - new Date(sourceTs)) / 60000 : null;
  const stale = Number.isFinite(sourceAgeMin) && sourceAgeMin > 90;
  const populationOk = !expected.population || dataset?.population === expected.population;
  const venueOk = !expected.venue || dataset?.venue === expected.venue;
  const qualityText = String(dataset?.data_quality_status || "").toUpperCase();
  const qualityOk = Boolean(qualityText) && !/(WARN|FAIL|ERROR|UNAVAILABLE|UNKNOWN|STALE|PARTIAL|DERIVED)/.test(qualityText);
  const ok = missing.length === 0 && !stale && populationOk && venueOk && qualityOk;
  return { required, missing, sourceAgeMin, stale, populationOk, venueOk, qualityOk, ok };
}

function renderDataContractPanel(id, dataset, topData, expected = {}) {
  const el = $(id);
  if (!el) return;
  const state = dataContractState(dataset, topData, expected);
  const sourceTs = dataset?.source_updated_at;
  const quality = dataset?.data_quality_status || "DATA UNAVAILABLE";
  const expectedLine = [
    expected.population ? `expected population ${expected.population}` : null,
    expected.venue ? `expected venue ${expected.venue}` : null,
    expected.table ? `source ${expected.table}` : null,
  ].filter(Boolean).join(" · ");
  el.innerHTML = `
    <div class="research-banner section-note">
      <span>${state.ok ? "✅ LIVE CONTRACT" : "⚠️ CONTRACT WATCH"}</span>
      <span>${state.ok ? "Required backend contract fields are present, fresh, clean, and population/venue match this page." : "One or more contract fields are missing, stale, mismatched, or reporting a warning quality state; treat the page as visible-but-watch."}</span>
    </div>
    <div class="grid three section-gap">
      ${metric("Generated at", dataset?.generated_at ? when(dataset.generated_at) : "DATA UNAVAILABLE", undefined, `top generated_at ${topData?.generated_at ? when(topData.generated_at) : "DATA UNAVAILABLE"}`, dataset?.generated_at ? "positive" : "negative")}
      ${metric("Source updated", sourceTs ? when(sourceTs) : "DATA UNAVAILABLE", undefined, state.sourceAgeMin == null ? "source freshness unavailable" : `${Math.max(0, state.sourceAgeMin).toFixed(1)}m before generated_at`, state.stale ? "negative" : sourceTs ? "positive" : "negative")}
      ${metric("Schema / quality", `${safe(dataset?.schema_version || "DATA UNAVAILABLE")} · ${safe(quality)}`, undefined, state.missing.length ? `missing: ${state.missing.join(", ")}` : (state.qualityOk ? "quality state is clean" : "quality state requires attention"), state.missing.length || !state.qualityOk ? "negative" : "positive")}
      ${metric("Population", safe(dataset?.population || "DATA UNAVAILABLE"), undefined, expected.population ? `expected ${safe(expected.population)}` : "no expected population supplied", state.populationOk ? "positive" : "negative")}
      ${metric("Venue", safe(dataset?.venue || "DATA UNAVAILABLE"), undefined, expected.venue ? `expected ${safe(expected.venue)}` : "no expected venue supplied", state.venueOk ? "positive" : "negative")}
      ${metric("Local date", safe(dataset?.local_trading_date || "DATA UNAVAILABLE"), undefined, expectedLine || "backend contract evidence", dataset?.local_trading_date ? "positive" : "negative")}
    </div>`;
}

function table(headers, rows, renderRow, emptyText) {
  if (!rows || rows.length === 0) return `<div class="empty">${esc(emptyText || "No rows yet.")}</div>`;
  return `<div class="table-scroll"><table>
      <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(renderRow).join("")}</tbody>
    </table></div>`;
}

function barRow(label, value, maxAbs, valueText, className = "", variant = "") {
  const width = maxAbs > 0 ? Math.max(3, Math.round((Math.abs(Number(value || 0)) / maxAbs) * 100)) : 0;
  const neg = Number(value || 0) < 0 ? " neg" : "";
  const v = variant === "shadow" ? " shadow" : "";
  return `<div class="bar-row">
      <div class="bar-label" title="${safe(label)}">${safe(label)}</div>
      <div class="bar-track"><div class="bar-fill${neg}${v}" style="width:${width}%"></div></div>
      <div class="bar-value ${className || cls(value)}">${valueText}</div>
    </div>`;
}

/* Donut win gauge — win rate as an arc, sample n in the caption. */
function donutGauge(title, ratePct, n, stroke = "#35d399") {
  const r = 40, c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, Number(ratePct || 0)));
  const dash = (p / 100) * c;
  return `<div class="gauge">
    <svg viewBox="0 0 100 100" role="img" aria-label="${esc(title)} ${p.toFixed(1)} percent, n ${num(n)}">
      <circle cx="50" cy="50" r="${r}" fill="none" stroke="rgba(148,163,184,0.16)" stroke-width="10" />
      <circle cx="50" cy="50" r="${r}" fill="none" stroke="${stroke}" stroke-width="10" stroke-linecap="round"
        stroke-dasharray="${dash.toFixed(2)} ${(c - dash).toFixed(2)}" transform="rotate(-90 50 50)" />
      <text x="50" y="55" text-anchor="middle" class="gauge-center" fill="#e5eefb">${p.toFixed(0)}%</text>
    </svg>
    <div class="gauge-title">${esc(title)} · n=${num(n)}</div>
  </div>`;
}

function lineChart(points, key, ariaLabel) {
  if (!points || points.length === 0) return `<div class="empty">No data points yet — the curve has not started.</div>`;
  const width = 720, height = 220, pad = { left: 46, right: 16, top: 18, bottom: 30 };
  const values = points.map((p) => Number(p[key] || 0));
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const spread = Math.max(max - min, 1);
  const x = (i) => pad.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * (width - pad.left - pad.right));
  const y = (v) => pad.top + ((max - v) / spread) * (height - pad.top - pad.bottom);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(Number(p[key] || 0)).toFixed(1)}`).join(" ");
  const zeroY = y(0).toFixed(1);
  const last = Number(points[points.length - 1][key] || 0);
  const stroke = last >= 0 ? "#35d399" : "#fb7185";
  return `<svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(ariaLabel)}">
      <line x1="${pad.left}" y1="${zeroY}" x2="${width - pad.right}" y2="${zeroY}" stroke="rgba(148,163,184,0.25)" stroke-dasharray="4 5" />
      <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="rgba(148,163,184,0.18)" />
      <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="rgba(148,163,184,0.18)" />
      <path d="${path}" fill="none" stroke="${stroke}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
      <text x="${pad.left}" y="13" fill="#93a4ba" font-size="11">${money(max)}</text>
      <text x="${pad.left}" y="${height - 8}" fill="#93a4ba" font-size="11">${money(min)}</text>
      <text x="${width - pad.right}" y="${height - 8}" fill="#93a4ba" font-size="11" text-anchor="end">n=${points.length}</text>
    </svg>`;
}

function populationLabel(row) {
  const venue = row?.venue || (row?.is_real === false ? "SHADOW" : "UNKNOWN");
  const moneyStatus = row?.money_status || (row?.is_real === false ? "SHADOW" : "UNKNOWN");
  return `${safe(venue)} · ${safe(moneyStatus)}`;
}
function catalystLabel(row) {
  const base = row?.catalyst_type || "UNKNOWN";
  return row?.catalyst_subtype ? `${safe(base)} · ${safe(row.catalyst_subtype)}` : safe(base);
}
