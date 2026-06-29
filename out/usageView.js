"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.showUsageView = showUsageView;
exports.refreshUsageView = refreshUsageView;
const vscode = __importStar(require("vscode"));
const chatImport_1 = require("./chatImport");
const usage_1 = require("./usage");
const HOUR = 3_600_000;
let current;
function showUsageView(context) {
    if (current) {
        current.reveal();
        return;
    }
    const panel = vscode.window.createWebviewPanel('aiBillingUsage', 'AI Billing', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
    current = panel;
    panel.webview.html = usageHtml(panel.webview);
    panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg?.type === 'reset') {
            await (0, usage_1.clearUsage)();
            if (current) {
                current.webview.html = usageHtml(current.webview);
            }
        }
    }, undefined, context.subscriptions);
    panel.onDidDispose(() => {
        current = undefined;
    }, undefined, context.subscriptions);
}
function refreshUsageView() {
    if (current) {
        current.webview.html = usageHtml(current.webview);
    }
}
const fmtUsd = (n) => `$${n.toFixed(4)}`;
const fmtNum = (n) => n.toLocaleString('en-US');
function nonce() {
    return Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
}
function usageTrendChart(series) {
    const W = 560;
    const H = 230;
    const padL = 46;
    const padB = 28;
    const padT = 14;
    const padR = 14;
    const chartW = W - padL - padR;
    const chartH = H - padB - padT;
    if (!series.length) {
        return '<div style="color: var(--vscode-descriptionForeground); font-size: 12px; margin: 6px 0 12px;">No chart data available</div>';
    }
    const max = Math.max(...series.map((s) => Math.max(s.cost, s.costForecast)), 0.0001);
    const xStep = series.length > 1 ? chartW / (series.length - 1) : 0;
    const px = (i) => padL + i * xStep;
    const py = (value) => padT + chartH - (value / max) * chartH;
    const actualPoints = series.map((s, i) => `${px(i).toFixed(1)},${py(s.cost).toFixed(1)}`).join(' ');
    const forecastPoints = series.map((s, i) => `${px(i).toFixed(1)},${py(s.costForecast).toFixed(1)}`).join(' ');
    const actualDots = series
        .map((s, i) => {
        const x = px(i);
        const y = py(s.cost);
        return (`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" class="line-dot actual-dot">` +
            `<title>${s.date} · Actual: ${fmtUsd(s.cost)} · Forecast: ${fmtUsd(s.costForecast)} · ${fmtNum(s.input + s.output)} tok</title></circle>`);
    })
        .join('');
    const forecastDots = series
        .map((s, i) => {
        const x = px(i);
        const y = py(s.costForecast);
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2" class="line-dot forecast-dot" />`;
    })
        .join('');
    const xLabels = series
        .map((s, i) => {
        const label = s.date.slice(8);
        return `<text x="${px(i).toFixed(1)}" y="${(H - padB + 14).toFixed(1)}" class="xlab">${label}</text>`;
    })
        .join('');
    const gridY = [0, 0.5, 1]
        .map((f) => {
        const y = padT + chartH - f * chartH;
        const val = f * max;
        return (`<line x1="${padL}" y1="${y.toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${y.toFixed(1)}" class="grid"/>` +
            `<text x="${padL - 6}" y="${(y + 3).toFixed(1)}" class="ylab">${fmtUsd(val)}</text>`);
    })
        .join('');
    const legend = `<g transform="translate(${padL}, ${padT - 2})">` +
        `<line x1="0" y1="0" x2="16" y2="0" class="actual-line"/>` +
        `<text x="20" y="3" class="legend">Actual</text>` +
        `<line x1="70" y1="0" x2="86" y2="0" class="forecast-line"/>` +
        `<text x="90" y="3" class="legend">Forecast</text>` +
        `</g>`;
    return (`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Daily AI cost trend with actual and forecast lines">` +
        `${gridY}` +
        `${legend}` +
        `<polyline points="${actualPoints}" class="actual-line"/>` +
        `<polyline points="${forecastPoints}" class="forecast-line"/>` +
        `${actualDots}` +
        `${forecastDots}` +
        `${xLabels}` +
        `</svg>`);
}
function windowsHtml() {
    const cardSplit = (label, auto, explicit) => {
        return (`<div class="cardsplit">` +
            `<div class="cl">${label}</div>` +
            `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px;">` +
            `<div style="padding: 8px; border: 1px solid #444; border-radius: 4px; background: #1a2a1a;">` +
            `<div style="font-size: 11px; color: #888;">Auto-routed</div>` +
            `<div style="font-weight: 600; color: #0f0;">${fmtUsd(auto.costForecast)}</div>` +
            `<div style="font-size: 11px; color: #888;">${fmtNum(auto.calls)} calls · ${auto.requestUnits.toFixed(2)} cr</div>` +
            `</div>` +
            `<div style="padding: 8px; border: 1px solid #444; border-radius: 4px; background: #2a1a1a;">` +
            `<div style="font-size: 11px; color: #888;">Explicit model</div>` +
            `<div style="font-weight: 600; color: #f90;">${fmtUsd(explicit.costForecast)}</div>` +
            `<div style="font-size: 11px; color: #888;">${fmtNum(explicit.calls)} calls · ${explicit.requestUnits.toFixed(2)} cr</div>` +
            `</div>` +
            `</div>` +
            `</div>`);
    };
    const billingPeriodRecords = recordsInCurrentBillingPeriod();
    return (`<div class="cards">` +
        cardSplit('Last 5 hours', (0, usage_1.windowAutoModelTotals)(5 * HOUR), (0, usage_1.windowExplicitModelTotals)(5 * HOUR)) +
        cardSplit('Last 7 days', (0, usage_1.windowAutoModelTotals)(7 * 24 * HOUR), (0, usage_1.windowExplicitModelTotals)(7 * 24 * HOUR)) +
        cardSplit('Current billing period', (0, usage_1.autoModelTotals)(billingPeriodRecords), (0, usage_1.explicitModelTotals)(billingPeriodRecords)) +
        cardSplit('All time', (0, usage_1.autoModelTotals)(), (0, usage_1.explicitModelTotals)()) +
        `</div>`);
}
function recordsInCurrentBillingPeriod() {
    const range = (0, usage_1.currentBillingPeriodRange)();
    return (0, usage_1.records)().filter((record) => record.ts >= range.start && record.ts < range.endExclusive);
}
function totalsTable(t) {
    const creditsLabel = '💳 Credits';
    const rows = [
        ['Calls', fmtNum(t.calls)],
        ['Input tokens', fmtNum(t.input)],
        ['Output tokens', fmtNum(t.output)],
        ['Cache write tokens', fmtNum(t.cacheCreate)],
        ['Cache read tokens', fmtNum(t.cacheRead)],
        [creditsLabel, t.requestUnits.toFixed(2)],
        ['Actual cost', fmtUsd(t.cost)],
        ['📈 Forecast cost', fmtUsd(t.costForecast)],
    ];
    return rows
        .map(([k, v], i) => `<tr class="${i === rows.length - 1 ? 'grand' : ''}"><td>${k}</td><td>${v}</td></tr>`)
        .join('');
}
function monthlyBillingSummaryTable() {
    const rows = (0, usage_1.billingCycleSummaries)(24);
    if (!rows.length) {
        return '<div style="color: var(--vscode-descriptionForeground); font-size: 12px; margin: 8px 0 14px;">No monthly billing periods available yet.</div>';
    }
    const header = `<thead>` +
        `<tr style="border-bottom: 1px solid #444; font-weight: 600; text-align: left; background: var(--vscode-editor-background);">` +
        `<th style="padding: 8px; text-align: left; width: 24%;">Period</th>` +
        `<th style="padding: 8px; text-align: left; width: 10%;">Status</th>` +
        `<th style="padding: 8px; text-align: right; width: 8%;">Calls</th>` +
        `<th style="padding: 8px; text-align: right; width: 13%;">Tokens</th>` +
        `<th style="padding: 8px; text-align: right; width: 12%;">Credits</th>` +
        `<th style="padding: 8px; text-align: right; width: 14%;">Actual</th>` +
        `<th style="padding: 8px; text-align: right; width: 14%;">Forecast</th>` +
        `</tr>` +
        `</thead>`;
    const body = rows
        .map((row) => {
        const start = new Date(row.start).toLocaleDateString();
        const end = new Date(row.endExclusive - 1).toLocaleDateString();
        const rowClass = row.isCurrent ? ' style="background: color-mix(in srgb, var(--vscode-editor-background) 78%, #0f6f4f 22%);"' : '';
        return (`<tr${rowClass}>` +
            `<td style="padding: 8px; text-align: left;">${start} - ${end}</td>` +
            `<td style="padding: 8px; text-align: left; color: ${row.isCurrent ? '#0e9' : 'var(--vscode-descriptionForeground)'};">${row.isCurrent ? 'Current' : 'Closed'}</td>` +
            `<td style="padding: 8px; text-align: right;">${fmtNum(row.totals.calls)}</td>` +
            `<td style="padding: 8px; text-align: right;">${fmtNum(row.totals.input + row.totals.output)}</td>` +
            `<td style="padding: 8px; text-align: right; font-weight: 600;">${row.totals.requestUnits.toFixed(2)}</td>` +
            `<td style="padding: 8px; text-align: right; color: #999;">${fmtUsd(row.totals.cost)}</td>` +
            `<td style="padding: 8px; text-align: right; font-weight: 600; color: #0e9;">${fmtUsd(row.totals.costForecast)}</td>` +
            `</tr>`);
    })
        .join('');
    return `<table style="width: 100%; border-collapse: collapse; font-size: 12px;">${header}<tbody>${body}</tbody></table>`;
}
function modelMetricsTable() {
    const metrics = (0, usage_1.modelMetrics)();
    if (!metrics.length) {
        return '<tr><td colspan="9" style="text-align:center; padding: 12px; color: #999;">No model usage data</td></tr>';
    }
    return metrics
        .map((m) => `<tr>` +
        `<td data-sort-value="${m.model.toLowerCase()}" style="text-align:left; padding: 8px;">${m.model}</td>` +
        `<td data-sort-value="${m.routing}" style="text-align:center; padding: 8px;">${m.routing}</td>` +
        `<td data-sort-value="${m.provider}" style="text-align:center; padding: 8px;">${m.provider}</td>` +
        `<td data-sort-value="${m.calls}" style="text-align:right; padding: 8px;">${fmtNum(m.calls)}</td>` +
        `<td data-sort-value="${m.input + m.output}" style="text-align:right; padding: 8px;">${fmtNum(m.input + m.output)}</td>` +
        `<td data-sort-value="${m.requestUnits}" style="text-align:right; padding: 8px; font-weight:600;">${m.requestUnits.toFixed(2)}</td>` +
        `<td data-sort-value="${m.cost}" style="text-align:right; padding: 8px; color:#999;">${fmtUsd(m.cost)}</td>` +
        `<td data-sort-value="${m.costForecast}" style="text-align:right; padding: 8px; font-weight:600; color:#0e9;">${fmtUsd(m.costForecast)}</td>` +
        `</tr>`)
        .join('');
}
function vendorMetricsTable() {
    const metrics = (0, usage_1.vendorMetrics)();
    if (!metrics.length) {
        return '<tr><td colspan="8" style="text-align:center; padding: 12px; color: #999;">No vendor usage data</td></tr>';
    }
    const vendorLabel = (v) => {
        switch (v) {
            case 'claude':
                return 'Claude (Anthropic)';
            case 'copilot':
                return 'Copilot (GitHub)';
            case 'ollama':
                return 'Ollama (Local)';
            default:
                return v;
        }
    };
    return metrics
        .map((m) => `<tr>` +
        `<td data-sort-value="${vendorLabel(m.vendor).toLowerCase()}" style="text-align:left; padding: 8px;">${vendorLabel(m.vendor)}</td>` +
        `<td data-sort-value="${m.autoCredits}" style="text-align:right; padding: 8px;">${fmtNum(m.autoCredits)}</td>` +
        `<td data-sort-value="${m.explicitCredits}" style="text-align:right; padding: 8px;">${fmtNum(m.explicitCredits)}</td>` +
        `<td data-sort-value="${m.totalCredits}" style="text-align:right; padding: 8px; font-weight:600;">${fmtNum(m.totalCredits)}</td>` +
        `<td data-sort-value="${m.calls}" style="text-align:right; padding: 8px;">${fmtNum(m.calls)}</td>` +
        `<td data-sort-value="${m.cost}" style="text-align:right; padding: 8px; color:#999;">${fmtUsd(m.cost)}</td>` +
        `<td data-sort-value="${m.costForecast}" style="text-align:right; padding: 8px; font-weight:600; color:#0e9;">${fmtUsd(m.costForecast)}</td>` +
        `<td data-sort-value="${m.discountApplied ?? 0}" style="text-align:right; padding: 8px; color:${m.discountApplied ? '#f0f' : '#666'};">${m.discountApplied ? `-${(m.discountApplied || 0).toFixed(2)}%` : '—'}</td>` +
        `</tr>`)
        .join('');
}
function usageHtml(webview) {
    const series = (0, usage_1.dailySeries)(14);
    const t = (0, usage_1.billingPeriodTotals)();
    const allTime = (0, usage_1.totals)();
    const periodRange = (0, usage_1.currentBillingPeriodRange)();
    const stats = (0, chatImport_1.getChatImportStats)();
    const forecastMethod = 'Linear regression trend over the last 14 days; forecast excludes discounts.';
    const syncTime = stats.lastSyncAt ? new Date(stats.lastSyncAt).toLocaleTimeString() : 'n/a';
    const noNewTurns = (stats.lastRunFoundTurns ?? 0) === 0;
    const n = nonce();
    const csp = `default-src 'none'; img-src ${webview.cspSource}; ` +
        `style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${n}';`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
  h1 { font-size: 1.1rem; margin: 0 0 2px; }
  h2 { margin: 0 0 12px; font-size: 14px; color: #999; text-transform: uppercase; letter-spacing: 0.5px; }
  .sub { color: var(--vscode-descriptionForeground); font-size: 0.8rem; margin-bottom: 16px; }
  .grid { stroke: var(--vscode-panel-border, #888); stroke-opacity: 0.3; }
  .xlab, .ylab { fill: var(--vscode-descriptionForeground); font-size: 9px; }
  .xlab { text-anchor: middle; }
  .ylab { text-anchor: end; }
  .legend { fill: var(--vscode-descriptionForeground); font-size: 9px; }
  .actual-line { fill: none; stroke: #48c9ff; stroke-width: 2; }
  .forecast-line { fill: none; stroke: #f8b84e; stroke-width: 2; stroke-dasharray: 5 3; }
  .line-dot { stroke: var(--vscode-editor-background); stroke-width: 1; }
  .actual-dot { fill: #48c9ff; }
  .forecast-dot { fill: #f8b84e; }
  .tabs { display: flex; gap: 8px; margin: 4px 0 14px; }
  .tab-btn {
    margin-top: 0;
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-panel-border, #888);
    padding: 6px 10px;
    border-radius: 999px;
    cursor: pointer;
    font-size: 12px;
  }
  .tab-btn.active {
    border-color: #0e9;
    color: #0e9;
    background: color-mix(in srgb, var(--vscode-editor-background) 82%, #0f6f4f 18%);
  }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  th.sortable { cursor: pointer; user-select: none; }
  th.sortable:hover { background: color-mix(in srgb, var(--vscode-editor-background) 75%, var(--vscode-focusBorder) 25%); }
  th.sortable .sort-indicator { color: var(--vscode-descriptionForeground); font-size: 10px; margin-left: 4px; }
  table { border-collapse: collapse; margin-top: 18px; font-size: 0.85rem; }
  td { padding: 4px 18px 4px 0; }
  td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  tr.grand td { border-top: 1px solid var(--vscode-panel-border, #888); font-weight: 600; padding-top: 8px; }
  button { margin-top: 18px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .cards { display: flex; gap: 10px; margin: 4px 0 18px; }
  .card { flex: 1; padding: 10px 12px; border: 1px solid var(--vscode-panel-border, #888); border-radius: 6px; }
  .cl { color: var(--vscode-descriptionForeground); font-size: 0.72rem; text-transform: uppercase; letter-spacing: .04em; }
  .cv { font-size: 1.3rem; font-weight: 600; font-variant-numeric: tabular-nums; margin: 2px 0; }
  .cs { color: var(--vscode-descriptionForeground); font-size: 0.75rem; }
</style>
</head>
<body>
  <h1>AI usage</h1>
  <div class="sub">Billing period (${new Date(periodRange.start).toLocaleDateString()} - ${new Date(periodRange.endExclusive - 1).toLocaleDateString()}) and token-priced billing. Credits use Copilot-reported usage units when available.</div>
  <div class="sub" title="${forecastMethod}">Forecast method: linear trend (14d), discount excluded.</div>
  <div class="sub">Last sync (${syncTime}): Debug View ${fmtNum(stats.importedFromDebugView)} · Debug logs ${fmtNum(stats.importedFromDebugLogs)} · Transcript tokens ${fmtNum(stats.importedFromTranscriptTokens)} · Skipped ${fmtNum(stats.skippedNonAuthoritative)}${noNewTurns ? ' · No new turns found' : ''}</div>
  <div class="tabs">
    <button class="tab-btn active" data-tab-target="overview">Overview</button>
    <button class="tab-btn" data-tab-target="monthly">Monthly Billing Summary</button>
  </div>

  <section id="tab-overview" class="tab-panel active">
    ${windowsHtml()}
    ${usageTrendChart(series)}
    <table>${totalsTable(t)}</table>
    <div class="sub">All-time total (forecast): ${fmtUsd(allTime.costForecast)}.</div>

    <section style="margin-top: 24px;">
      <h2>📊 Cost per Model</h2>
    <table id="model-cost-table" style="width: 100%; border-collapse: collapse; font-size: 12px;">
      <thead>
        <tr style="border-bottom: 1px solid #444; font-weight: 600; text-align: left; background: var(--vscode-editor-background);">
          <th class="sortable" data-col="0" data-type="text" style="padding: 8px; width: 28%; text-align: left;">Model <span class="sort-indicator">⇅</span></th>
          <th class="sortable" data-col="1" data-type="text" style="padding: 8px; width: 12%; text-align: center;">Routing <span class="sort-indicator">⇅</span></th>
          <th class="sortable" data-col="2" data-type="text" style="padding: 8px; width: 10%; text-align: center;">Provider <span class="sort-indicator">⇅</span></th>
          <th class="sortable" data-col="3" data-type="number" style="padding: 8px; width: 8px; text-align: right;">Calls <span class="sort-indicator">⇅</span></th>
          <th class="sortable" data-col="4" data-type="number" style="padding: 8px; width: 10%; text-align: right;">Tokens <span class="sort-indicator">⇅</span></th>
          <th class="sortable" data-col="5" data-type="number" style="padding: 8px; width: 10%; text-align: right;" title="Credits prefer Copilot-reported usage units when available.">💳 Credits <span class="sort-indicator">⇅</span></th>
          <th class="sortable" data-col="6" data-type="number" style="padding: 8px; width: 9%; text-align: right;">Actual Cost <span class="sort-indicator">⇅</span></th>
          <th class="sortable" data-col="7" data-type="number" style="padding: 8px; width: 11%; text-align: right;" title="${forecastMethod}">📈 Forecast <span class="sort-indicator">⇅</span></th>
        </tr>
      </thead>
      <tbody>${modelMetricsTable()}</tbody>
    </table>
    </section>

    <section style="margin-top: 24px;">
      <h2>🏭 Cost per Vendor</h2>
    <div style="color: var(--vscode-descriptionForeground); font-size: 12px; margin-bottom: 8px;">Aggregated usage by AI provider (Claude, Copilot, Ollama) with auto/explicit split. Forecast excludes discounts.</div>
    <table id="vendor-cost-table" style="width: 100%; border-collapse: collapse; font-size: 12px;">
      <thead>
        <tr style="border-bottom: 1px solid #444; font-weight: 600; text-align: left; background: var(--vscode-editor-background);">
          <th class="sortable" data-col="0" data-type="text" style="padding: 8px; width: 25%; text-align: left;">Vendor <span class="sort-indicator">⇅</span></th>
          <th class="sortable" data-col="1" data-type="number" style="padding: 8px; width: 11%; text-align: right;">Auto credits <span class="sort-indicator">⇅</span></th>
          <th class="sortable" data-col="2" data-type="number" style="padding: 8px; width: 11%; text-align: right;">Explicit credits <span class="sort-indicator">⇅</span></th>
          <th class="sortable" data-col="3" data-type="number" style="padding: 8px; width: 10%; text-align: right;">Total credits <span class="sort-indicator">⇅</span></th>
          <th class="sortable" data-col="4" data-type="number" style="padding: 8px; width: 8%; text-align: right;">Calls <span class="sort-indicator">⇅</span></th>
          <th class="sortable" data-col="5" data-type="number" style="padding: 8px; width: 9%; text-align: right;">Actual Cost <span class="sort-indicator">⇅</span></th>
          <th class="sortable" data-col="6" data-type="number" style="padding: 8px; width: 10%; text-align: right;" title="${forecastMethod}">📈 Forecast <span class="sort-indicator">⇅</span></th>
          <th class="sortable" data-col="7" data-type="number" style="padding: 8px; width: 8%; text-align: right;">Discount <span class="sort-indicator">⇅</span></th>
        </tr>
      </thead>
      <tbody>${vendorMetricsTable()}</tbody>
    </table>
    </section>
  </section>

  <section id="tab-monthly" class="tab-panel">
    <h2>🗓️ Monthly Billing Summary</h2>
    <div class="sub">Use this view to reconcile each billing cycle against GitHub billing statements. The current cycle remains open until period end.</div>
    ${monthlyBillingSummaryTable()}
  </section>

<script nonce="${n}">
(() => {
  function initTabs() {
    const buttons = Array.from(document.querySelectorAll('.tab-btn'));
    const panels = {
      overview: document.getElementById('tab-overview'),
      monthly: document.getElementById('tab-monthly'),
    };

    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const target = button.getAttribute('data-tab-target');
        if (!target || !Object.prototype.hasOwnProperty.call(panels, target)) {
          return;
        }

        buttons.forEach((b) => b.classList.toggle('active', b === button));
        Object.entries(panels).forEach(([name, panel]) => {
          if (!panel) {
            return;
          }
          panel.classList.toggle('active', name === target);
        });
      });
    });
  }

  function initSortableTable(tableId, defaultCol, defaultDir) {
    const table = document.getElementById(tableId);
    if (!table) return;
    const tbody = table.querySelector('tbody');
    if (!tbody) return;

    const state = { col: defaultCol, dir: defaultDir };
    const headers = Array.from(table.querySelectorAll('th.sortable'));

    function getCellValue(row, col, type) {
      const cell = row.children[col];
      if (!cell) return type === 'number' ? 0 : '';
      const raw = cell.getAttribute('data-sort-value') ?? cell.textContent ?? '';
      if (type === 'number') {
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
      }
      return raw.toLowerCase();
    }

    function renderIndicators() {
      headers.forEach((h) => {
        const indicator = h.querySelector('.sort-indicator');
        if (!indicator) return;
        const col = Number(h.getAttribute('data-col') || -1);
        if (col === state.col) {
          indicator.textContent = state.dir === 'asc' ? '↑' : '↓';
        } else {
          indicator.textContent = '⇅';
        }
      });
    }

    function sortBy(col, type, dir) {
      const rows = Array.from(tbody.querySelectorAll('tr'));
      rows.sort((a, b) => {
        const av = getCellValue(a, col, type);
        const bv = getCellValue(b, col, type);
        if (av < bv) return dir === 'asc' ? -1 : 1;
        if (av > bv) return dir === 'asc' ? 1 : -1;
        return 0;
      });
      rows.forEach((r) => tbody.appendChild(r));
      renderIndicators();
    }

    headers.forEach((h) => {
      h.addEventListener('click', () => {
        const col = Number(h.getAttribute('data-col') || -1);
        const type = h.getAttribute('data-type') || 'text';
        if (col < 0) return;
        if (state.col === col) {
          state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        } else {
          state.col = col;
          state.dir = type === 'number' ? 'desc' : 'asc';
        }
        sortBy(state.col, type, state.dir);
      });
    });

    const defaultType = headers.find((h) => Number(h.getAttribute('data-col') || -1) === defaultCol)?.getAttribute('data-type') || 'number';
    sortBy(defaultCol, defaultType, defaultDir);
  }

  initTabs();
  initSortableTable('model-cost-table', 7, 'desc');
  initSortableTable('vendor-cost-table', 6, 'desc');
})();
</script>

</body>
</html>`;
}
//# sourceMappingURL=usageView.js.map