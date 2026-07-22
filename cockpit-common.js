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
