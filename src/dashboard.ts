// ─── SRE Dashboard ────────────────────────────────────────────
// Google SRE-inspired monitoring dashboard with Material Design 3
// Self-contained HTML served from the Worker — no external assets needed
// Auto-refreshes, dark mode, responsive, real-time data

import type { Env } from './types';

interface SystemStatus {
  health: string;
  version: string;
  mode: string;
  timestamp: string;
  agents: { id: string; name: string; weight: number }[];
  crons: { name: string; schedule: string; description: string }[];
  apis: Record<string, { name: string; status: string; keyRequired: boolean }>;
  secrets: Record<string, boolean>;
  config: Record<string, string>;
  endpoints: string[];
  riskLimits: Record<string, number>;
}

export function getSystemStatus(env: Env): SystemStatus {
  const secretKeys = [
    'ALPHA_VANTAGE_API_KEY', 'TAAPI_API_KEY', 'FINNHUB_API_KEY',
    'FRED_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
  ];

  const secrets: Record<string, boolean> = {};
  for (const key of secretKeys) {
    secrets[key] = !!(env as any)[key];
  }

  return {
    health: 'ok',
    version: '2.0.0',
    mode: 'signals-only',
    timestamp: new Date().toISOString(),
    agents: [
      { id: 'STOCKS_TECHNICAL', name: 'Stocks Technical', weight: 30 },
      { id: 'STOCKS_STAT_ARB', name: 'Statistical Arbitrage', weight: 20 },
      { id: 'CRYPTO', name: 'Crypto & DeFi', weight: 15 },
      { id: 'POLYMARKET', name: 'Prediction Markets', weight: 15 },
      { id: 'COMMODITIES', name: 'Commodities & Macro', weight: 20 },
    ],
    crons: [
      { name: 'MORNING_BRIEFING', schedule: '0 5 * * 1-5', description: '07:00 IST — Pre-market overview' },
      { name: 'MARKET_OPEN_SCAN', schedule: '30 14 * * 1-5', description: '16:30 IST — Full 5-agent scan' },
      { name: 'QUICK_SCAN_15MIN', schedule: '*/15 14-21 * * 1-5', description: 'Every 15min — RSI/MACD monitoring' },
      { name: 'FULL_SCAN_HOURLY', schedule: '0 15-21 * * 1-5', description: 'Hourly — EMA/Fib/Screener' },
      { name: 'EVENING_SUMMARY', schedule: '0 15 * * 1-5', description: '17:00 IST — Day recap' },
      { name: 'AFTER_HOURS_SCAN', schedule: '0 18 * * 1-5', description: '20:00 IST — Earnings/news' },
      { name: 'WEEKLY_REVIEW', schedule: '0 7 * * SUN', description: '09:00 IST — Weekly portfolio review' },
    ],
    apis: {
      yahoo_finance: { name: 'Yahoo Finance', status: 'active', keyRequired: false },
      alpha_vantage: { name: 'Alpha Vantage', status: secrets.ALPHA_VANTAGE_API_KEY ? 'configured' : 'missing-key', keyRequired: true },
      taapi: { name: 'TAAPI.io', status: secrets.TAAPI_API_KEY ? 'configured' : 'missing-key', keyRequired: true },
      finnhub: { name: 'Finnhub', status: secrets.FINNHUB_API_KEY ? 'configured' : 'missing-key', keyRequired: true },
      fred: { name: 'FRED', status: secrets.FRED_API_KEY ? 'configured' : 'missing-key', keyRequired: true },
      coingecko: { name: 'CoinGecko', status: 'active', keyRequired: false },
      dexscreener: { name: 'DexScreener', status: 'active', keyRequired: false },
      polymarket: { name: 'Polymarket', status: 'active', keyRequired: false },
      telegram: { name: 'Telegram Bot', status: secrets.TELEGRAM_BOT_TOKEN ? 'configured' : 'missing-key', keyRequired: true },
    },
    secrets,
    config: {
      watchlist: env.DEFAULT_WATCHLIST,
      cryptoWatchlist: env.CRYPTO_WATCHLIST || '',
      rsiOverbought: env.RSI_OVERBOUGHT,
      rsiOversold: env.RSI_OVERSOLD,
      emaFast: env.EMA_FAST,
      emaSlow: env.EMA_SLOW,
      fiboLevels: env.FIBO_LEVELS,
      environment: env.ENVIRONMENT,
      timezone: env.TIMEZONE,
    },
    endpoints: [
      'GET /health', 'GET /dashboard', 'GET /api/system-status',
      'GET /api/quote?symbol=', 'GET /api/analysis?symbol=',
      'GET /api/fibonacci?symbol=', 'GET /api/scan',
      'GET /api/crypto', 'GET /api/polymarket',
      'GET /api/commodities', 'GET /api/indices',
      'GET /api/test-alert', 'GET /api/trigger?job=',
    ],
    riskLimits: {
      maxDailyDrawdown: 3,
      killSwitch: 5,
      maxPositionSize: 10,
      maxSectorExposure: 25,
      maxTotalExposure: 80,
      maxOpenPositions: 20,
      dailyLossLimit: 5000,
      maxCorrelation: 0.85,
    },
  };
}

export function renderDashboard(baseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>YMSA — SRE Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --md-sys-color-primary: #80CBC4;
  --md-sys-color-on-primary: #003731;
  --md-sys-color-primary-container: #00504A;
  --md-sys-color-secondary: #B0BEC5;
  --md-sys-color-tertiary: #FFB74D;
  --md-sys-color-error: #EF5350;
  --md-sys-color-success: #66BB6A;
  --md-sys-color-warning: #FFA726;
  --md-sys-color-surface: #121212;
  --md-sys-color-surface-container: #1E1E1E;
  --md-sys-color-surface-container-high: #2C2C2C;
  --md-sys-color-surface-container-highest: #383838;
  --md-sys-color-on-surface: #E0E0E0;
  --md-sys-color-on-surface-variant: #9E9E9E;
  --md-sys-color-outline: #444;
  --md-sys-shape-corner-large: 16px;
  --md-sys-shape-corner-medium: 12px;
  --md-sys-shape-corner-small: 8px;
  --md-sys-elevation-1: 0 1px 3px rgba(0,0,0,.3), 0 1px 2px rgba(0,0,0,.4);
  --md-sys-elevation-2: 0 2px 6px rgba(0,0,0,.3), 0 2px 4px rgba(0,0,0,.35);
}

* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'Google Sans', Roboto, sans-serif;
  background: var(--md-sys-color-surface);
  color: var(--md-sys-color-on-surface);
  min-height: 100vh;
  padding: 0;
}

.top-bar {
  background: var(--md-sys-color-surface-container);
  border-bottom: 1px solid var(--md-sys-color-outline);
  padding: 16px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: sticky;
  top: 0;
  z-index: 100;
}
.top-bar h1 {
  font-size: 22px;
  font-weight: 500;
  color: var(--md-sys-color-primary);
  display: flex;
  align-items: center;
  gap: 10px;
}
.top-bar .meta {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
  color: var(--md-sys-color-on-surface-variant);
}
.top-bar .meta .live-dot {
  width: 8px; height: 8px;
  background: var(--md-sys-color-success);
  border-radius: 50%;
  animation: pulse 2s infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .4; }
}

.container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* Golden Signals Row */
.signal-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.card {
  background: var(--md-sys-color-surface-container);
  border-radius: var(--md-sys-shape-corner-large);
  padding: 20px;
  box-shadow: var(--md-sys-elevation-1);
  border: 1px solid var(--md-sys-color-outline);
  transition: box-shadow .2s, border-color .2s;
}
.card:hover {
  box-shadow: var(--md-sys-elevation-2);
  border-color: var(--md-sys-color-primary);
}
.card-title {
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: var(--md-sys-color-on-surface-variant);
  margin-bottom: 8px;
}
.card-value {
  font-family: 'Roboto Mono', monospace;
  font-size: 32px;
  font-weight: 700;
  color: var(--md-sys-color-primary);
}
.card-value.error { color: var(--md-sys-color-error); }
.card-value.warning { color: var(--md-sys-color-warning); }
.card-value.success { color: var(--md-sys-color-success); }
.card-sub {
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
  margin-top: 4px;
}

/* Section headers */
.section-title {
  font-size: 16px;
  font-weight: 500;
  color: var(--md-sys-color-secondary);
  padding: 8px 0 4px;
  border-bottom: 1px solid var(--md-sys-color-outline);
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Agent Grid */
.agent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}
.agent-card {
  background: var(--md-sys-color-surface-container-high);
  border-radius: var(--md-sys-shape-corner-medium);
  padding: 16px;
  border-left: 4px solid var(--md-sys-color-primary);
}
.agent-card .agent-name {
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 4px;
}
.agent-card .agent-id {
  font-family: 'Roboto Mono', monospace;
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant);
}
.agent-card .agent-weight {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.weight-bar {
  flex: 1;
  height: 6px;
  background: var(--md-sys-color-surface);
  border-radius: 3px;
  overflow: hidden;
}
.weight-bar-fill {
  height: 100%;
  background: var(--md-sys-color-primary);
  border-radius: 3px;
  transition: width .6s ease;
}
.weight-label {
  font-family: 'Roboto Mono', monospace;
  font-size: 12px;
  min-width: 35px;
  text-align: right;
}

/* Cron Table */
.cron-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.cron-table th {
  text-align: left;
  padding: 10px 12px;
  font-weight: 500;
  color: var(--md-sys-color-on-surface-variant);
  border-bottom: 1px solid var(--md-sys-color-outline);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .5px;
}
.cron-table td {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255,255,255,.05);
}
.cron-table tr:hover td {
  background: rgba(128,203,196,.05);
}
.cron-expr {
  font-family: 'Roboto Mono', monospace;
  font-size: 12px;
  background: var(--md-sys-color-surface);
  padding: 2px 8px;
  border-radius: 4px;
  color: var(--md-sys-color-tertiary);
}

/* API Status Grid */
.api-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
}
.api-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  background: var(--md-sys-color-surface-container-high);
  border-radius: var(--md-sys-shape-corner-small);
}
.api-dot {
  width: 10px; height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.api-dot.ok { background: var(--md-sys-color-success); }
.api-dot.warn { background: var(--md-sys-color-warning); }
.api-dot.err { background: var(--md-sys-color-error); }
.api-name { font-size: 13px; font-weight: 500; }
.api-detail { font-size: 11px; color: var(--md-sys-color-on-surface-variant); }

/* Secrets & Config */
.chip-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 12px;
  font-family: 'Roboto Mono', monospace;
  border: 1px solid var(--md-sys-color-outline);
}
.chip.set { background: rgba(102,187,106,.12); border-color: var(--md-sys-color-success); color: var(--md-sys-color-success); }
.chip.unset { background: rgba(239,83,80,.12); border-color: var(--md-sys-color-error); color: var(--md-sys-color-error); }

/* Risk Table */
.risk-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
}
.risk-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: var(--md-sys-color-surface-container-high);
  border-radius: var(--md-sys-shape-corner-small);
}
.risk-label { font-size: 12px; color: var(--md-sys-color-on-surface-variant); }
.risk-value {
  font-family: 'Roboto Mono', monospace;
  font-size: 14px;
  font-weight: 500;
  color: var(--md-sys-color-tertiary);
}

/* Endpoints */
.endpoint-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 6px;
}
.endpoint {
  font-family: 'Roboto Mono', monospace;
  font-size: 12px;
  padding: 8px 12px;
  background: var(--md-sys-color-surface);
  border-radius: 6px;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
  transition: background .15s;
}
.endpoint:hover {
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-primary);
}
.endpoint .method {
  color: var(--md-sys-color-success);
  font-weight: 500;
}

/* Two column layout */
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}
@media (max-width: 900px) {
  .two-col { grid-template-columns: 1fr; }
}

/* Live test panel */
.test-panel {
  background: var(--md-sys-color-surface-container);
  border-radius: var(--md-sys-shape-corner-large);
  padding: 20px;
  border: 1px solid var(--md-sys-color-outline);
}
.test-btn {
  padding: 8px 20px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  border-radius: 20px;
  cursor: pointer;
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-primary);
  transition: background .15s, transform .1s;
}
.test-btn:hover { filter: brightness(1.15); }
.test-btn:active { transform: scale(.97); }
.test-btn:disabled { opacity: .5; cursor: not-allowed; }
.test-result {
  margin-top: 12px;
  font-family: 'Roboto Mono', monospace;
  font-size: 12px;
  background: var(--md-sys-color-surface);
  border-radius: 8px;
  padding: 12px;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  display: none;
}

/* Refresh bar */
.refresh-bar {
  height: 3px;
  background: var(--md-sys-color-surface-container-high);
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 999;
}
.refresh-bar-fill {
  height: 100%;
  background: var(--md-sys-color-primary);
  width: 100%;
  transition: width 1s linear;
}

/* Scrollbar */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--md-sys-color-outline); border-radius: 3px; }
</style>
</head>
<body>

<div class="top-bar">
  <h1>🛡️ YMSA — SRE Dashboard</h1>
  <div class="meta">
    <span id="last-update">Loading...</span>
    <div class="live-dot"></div>
    <span>v2.0.0</span>
  </div>
</div>

<div class="container">

  <!-- Golden Signals -->
  <div class="signal-grid" id="golden-signals">
    <div class="card"><div class="card-title">System Health</div><div class="card-value" id="gs-health">—</div><div class="card-sub">Worker Status</div></div>
    <div class="card"><div class="card-title">Secrets Status</div><div class="card-value" id="gs-secrets">—</div><div class="card-sub" id="gs-secrets-sub">Configured / Total</div></div>
    <div class="card"><div class="card-title">Active APIs</div><div class="card-value" id="gs-apis">—</div><div class="card-sub">Data providers online</div></div>
    <div class="card"><div class="card-title">Cron Jobs</div><div class="card-value" id="gs-crons">—</div><div class="card-sub">Scheduled triggers</div></div>
    <div class="card"><div class="card-title">Endpoints</div><div class="card-value" id="gs-endpoints">—</div><div class="card-sub">HTTP routes</div></div>
    <div class="card"><div class="card-title">Mode</div><div class="card-value" id="gs-mode" style="font-size:18px">—</div><div class="card-sub">Trading mode</div></div>
  </div>

  <!-- Agents -->
  <div class="section-title">🤖 Agent Health — 5-Agent Architecture</div>
  <div class="agent-grid" id="agent-grid"></div>

  <div class="two-col">
    <!-- Cron Schedule -->
    <div>
      <div class="section-title">⏰ Cron Schedule</div>
      <div class="card" style="margin-top:12px;padding:0;overflow:hidden">
        <table class="cron-table" id="cron-table">
          <thead><tr><th>Job</th><th>Schedule (UTC)</th><th>Description</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <!-- API Connectivity -->
    <div>
      <div class="section-title">🌐 API Connectivity</div>
      <div class="api-grid" id="api-grid" style="margin-top:12px"></div>
    </div>
  </div>

  <div class="two-col">
    <!-- Secrets -->
    <div>
      <div class="section-title">🔐 Secrets Status</div>
      <div class="chip-grid" id="secrets-grid" style="margin-top:12px"></div>
    </div>

    <!-- Risk Limits -->
    <div>
      <div class="section-title">🛡️ Risk Controller — Hard Limits</div>
      <div class="risk-grid" id="risk-grid" style="margin-top:12px"></div>
    </div>
  </div>

  <!-- Endpoints -->
  <div class="section-title">📡 HTTP Endpoints</div>
  <div class="endpoint-list" id="endpoint-list"></div>

  <!-- Live Tests -->
  <div class="section-title">🧪 Live Connectivity Tests</div>
  <div class="two-col">
    <div class="test-panel">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        <strong style="font-size:14px">Health Check</strong>
        <button class="test-btn" onclick="runTest('/health','test-health')">Run</button>
      </div>
      <div class="test-result" id="test-health"></div>
    </div>
    <div class="test-panel">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        <strong style="font-size:14px">Quote Test (AAPL)</strong>
        <button class="test-btn" onclick="runTest('/api/quote?symbol=AAPL','test-quote')">Run</button>
      </div>
      <div class="test-result" id="test-quote"></div>
    </div>
    <div class="test-panel">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        <strong style="font-size:14px">Crypto Dashboard</strong>
        <button class="test-btn" onclick="runTest('/api/crypto','test-crypto')">Run</button>
      </div>
      <div class="test-result" id="test-crypto"></div>
    </div>
    <div class="test-panel">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
        <strong style="font-size:14px">Market Indices</strong>
        <button class="test-btn" onclick="runTest('/api/indices','test-indices')">Run</button>
      </div>
      <div class="test-result" id="test-indices"></div>
    </div>
  </div>

  <!-- Config -->
  <div class="section-title">⚙️ Runtime Configuration</div>
  <div class="card" id="config-panel" style="font-family:'Roboto Mono',monospace;font-size:12px;white-space:pre-wrap;color:var(--md-sys-color-on-surface-variant)">Loading...</div>

</div>

<div class="refresh-bar"><div class="refresh-bar-fill" id="refresh-bar"></div></div>

<script>
const BASE = '${baseUrl}';
const REFRESH_INTERVAL = 60;
let countdown = REFRESH_INTERVAL;

async function loadDashboard() {
  try {
    const res = await fetch(BASE + '/api/system-status');
    const data = await res.json();
    render(data);
    document.getElementById('last-update').textContent = 'Updated: ' + new Date().toLocaleTimeString();
  } catch (err) {
    document.getElementById('gs-health').textContent = 'ERROR';
    document.getElementById('gs-health').className = 'card-value error';
    document.getElementById('last-update').textContent = 'Failed: ' + err.message;
  }
}

function render(d) {
  // Golden signals
  const h = document.getElementById('gs-health');
  h.textContent = d.health === 'ok' ? 'HEALTHY' : 'DEGRADED';
  h.className = 'card-value ' + (d.health === 'ok' ? 'success' : 'error');

  const setCount = Object.values(d.secrets).filter(Boolean).length;
  const totalSecrets = Object.keys(d.secrets).length;
  const gs = document.getElementById('gs-secrets');
  gs.textContent = setCount + '/' + totalSecrets;
  gs.className = 'card-value ' + (setCount === totalSecrets ? 'success' : setCount > 3 ? 'warning' : 'error');
  document.getElementById('gs-secrets-sub').textContent = setCount + ' of ' + totalSecrets + ' secrets configured';

  const activeApis = Object.values(d.apis).filter(a => a.status !== 'missing-key').length;
  const ga = document.getElementById('gs-apis');
  ga.textContent = activeApis + '/' + Object.keys(d.apis).length;
  ga.className = 'card-value ' + (activeApis >= 7 ? 'success' : 'warning');

  document.getElementById('gs-crons').textContent = d.crons.length;
  document.getElementById('gs-crons').className = 'card-value success';
  document.getElementById('gs-endpoints').textContent = d.endpoints.length;
  document.getElementById('gs-endpoints').className = 'card-value';
  const gm = document.getElementById('gs-mode');
  gm.textContent = 'SIGNALS ONLY';
  gm.className = 'card-value';
  gm.style.color = 'var(--md-sys-color-tertiary)';

  // Agents
  const ag = document.getElementById('agent-grid');
  ag.innerHTML = d.agents.map(a => \`
    <div class="agent-card">
      <div class="agent-name">\${a.name}</div>
      <div class="agent-id">\${a.id}</div>
      <div class="agent-weight">
        <div class="weight-bar"><div class="weight-bar-fill" style="width:\${a.weight}%"></div></div>
        <span class="weight-label">\${a.weight}%</span>
      </div>
    </div>
  \`).join('');

  // Crons
  const ct = document.querySelector('#cron-table tbody');
  ct.innerHTML = d.crons.map(c => \`<tr>
    <td style="font-weight:500">\${c.name}</td>
    <td><span class="cron-expr">\${c.schedule}</span></td>
    <td style="color:var(--md-sys-color-on-surface-variant)">\${c.description}</td>
  </tr>\`).join('');

  // APIs
  const apiGrid = document.getElementById('api-grid');
  apiGrid.innerHTML = Object.values(d.apis).map(a => {
    const dot = a.status === 'missing-key' ? 'err' : 'ok';
    return \`<div class="api-item">
      <div class="api-dot \${dot}"></div>
      <div><div class="api-name">\${a.name}</div><div class="api-detail">\${a.keyRequired ? '🔑 Key required' : '🆓 Free'} · \${a.status}</div></div>
    </div>\`;
  }).join('');

  // Secrets
  const sg = document.getElementById('secrets-grid');
  sg.innerHTML = Object.entries(d.secrets).map(([k, v]) =>
    \`<div class="chip \${v ? 'set' : 'unset'}">\${v ? '✓' : '✗'} \${k}</div>\`
  ).join('');

  // Risk limits
  const rg = document.getElementById('risk-grid');
  const riskLabels = {
    maxDailyDrawdown: 'Max Daily Drawdown',
    killSwitch: 'Kill Switch Threshold',
    maxPositionSize: 'Max Position Size',
    maxSectorExposure: 'Max Sector Exposure',
    maxTotalExposure: 'Max Total Exposure',
    maxOpenPositions: 'Max Open Positions',
    dailyLossLimit: 'Daily Loss Limit',
    maxCorrelation: 'Max Correlation',
  };
  rg.innerHTML = Object.entries(d.riskLimits).map(([k, v]) => {
    const unit = k.includes('Limit') ? '$' + v.toLocaleString() : k === 'maxCorrelation' ? v : k === 'maxOpenPositions' ? v : v + '%';
    return \`<div class="risk-item"><span class="risk-label">\${riskLabels[k] || k}</span><span class="risk-value">\${unit}</span></div>\`;
  }).join('');

  // Endpoints
  const el = document.getElementById('endpoint-list');
  el.innerHTML = d.endpoints.map(e => {
    const [method, path] = e.split(' ');
    return \`<div class="endpoint" onclick="runTest('\${path.split('?')[0]}','test-health')"><span class="method">\${method}</span> \${path}</div>\`;
  }).join('');

  // Config
  document.getElementById('config-panel').textContent = JSON.stringify(d.config, null, 2);
}

async function runTest(path, targetId) {
  const el = document.getElementById(targetId);
  el.style.display = 'block';
  el.textContent = 'Fetching ' + path + '...';
  try {
    const start = performance.now();
    const res = await fetch(BASE + path);
    const ms = (performance.now() - start).toFixed(0);
    const data = await res.json();
    el.textContent = \`[\${res.status}] \${ms}ms\\n\${JSON.stringify(data, null, 2).slice(0, 2000)}\`;
    el.style.color = res.ok ? 'var(--md-sys-color-success)' : 'var(--md-sys-color-error)';
  } catch (err) {
    el.textContent = 'ERROR: ' + err.message;
    el.style.color = 'var(--md-sys-color-error)';
  }
}

// Auto-refresh countdown
function tick() {
  countdown--;
  const pct = (countdown / REFRESH_INTERVAL) * 100;
  document.getElementById('refresh-bar').style.width = pct + '%';
  if (countdown <= 0) {
    countdown = REFRESH_INTERVAL;
    loadDashboard();
  }
}

loadDashboard();
setInterval(tick, 1000);
</script>
</body>
</html>`;
}
