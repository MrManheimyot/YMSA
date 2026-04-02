// ─── SRE Dashboard v3.0 ──────────────────────────────────────
// 6-Engine Trading System — Full execution dashboard
// Material Design 3 dark theme, auto-refresh, live data
// Portfolio · Positions · P&L · Engines · Regime · Signals · Risk · Trades

import type { Env } from './types';

interface SystemStatus {
  health: string;
  version: string;
  mode: string;
  timestamp: string;
  engines: { id: string; name: string; weight: number }[];
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
    'ALPACA_API_KEY', 'ALPACA_SECRET_KEY',
  ];

  const secrets: Record<string, boolean> = {};
  for (const key of secretKeys) {
    secrets[key] = !!(env as any)[key];
  }

  const paperMode = env.ALPACA_PAPER_MODE !== 'false';
  const hasAlpaca = !!(env as any)['ALPACA_API_KEY'] && !!(env as any)['ALPACA_SECRET_KEY'];

  return {
    health: 'ok',
    version: '3.0.0',
    mode: hasAlpaca ? (paperMode ? 'PAPER TRADING' : 'LIVE TRADING') : 'SIGNALS ONLY',
    timestamp: new Date().toISOString(),
    engines: [
      { id: 'MTF_MOMENTUM', name: 'Multi-Timeframe Momentum', weight: 25 },
      { id: 'SMART_MONEY', name: 'Smart Money Concepts', weight: 20 },
      { id: 'STAT_ARB', name: 'Statistical Arbitrage', weight: 15 },
      { id: 'OPTIONS', name: 'Options Flow', weight: 10 },
      { id: 'CRYPTO_DEFI', name: 'Crypto & DeFi', weight: 15 },
      { id: 'EVENT_DRIVEN', name: 'Event-Driven / News', weight: 15 },
    ],
    crons: [
      { name: 'MORNING_BRIEFING', schedule: '0 5 * * 1-5', description: '07:00 IST — Pre-market regime + portfolio' },
      { name: 'MARKET_OPEN', schedule: '30 14 * * 1-5', description: '16:30 IST — 6-engine full scan + execute' },
      { name: 'OPENING_RANGE', schedule: '45 14 * * 1-5', description: '16:45 IST — Opening range breakout' },
      { name: 'QUICK_SCAN', schedule: '*/15 14-21 * * 1-5', description: 'Every 15min — Pulse + smart money' },
      { name: 'PULSE_5MIN', schedule: '*/5 14-21 * * 1-5', description: 'Every 5min — Fast momentum scalps' },
      { name: 'HOURLY_SCAN', schedule: '0 15-21 * * 1-5', description: 'Hourly — Full technical + pairs' },
      { name: 'MIDDAY_REBALANCE', schedule: '0 18 * * 1-5', description: '20:00 IST — Portfolio rebalance' },
      { name: 'EVENING_SUMMARY', schedule: '0 15 * * 1-5', description: '17:00 IST — Daily P&L snapshot' },
      { name: 'OVERNIGHT_SCAN', schedule: '30 21 * * 1-5', description: '23:30 IST — After-hours + crypto' },
      { name: 'WEEKLY_REVIEW', schedule: '0 7 * * 0', description: 'Sunday 09:00 IST — Weekly review' },
      { name: 'ENGINE_RETRAIN', schedule: '0 3 * * 6', description: 'Saturday 05:00 IST — Weight calibration' },
      { name: 'MONTHLY_REPORT', schedule: '0 0 1 * *', description: '1st of month — Full performance report' },
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
      alpaca: { name: 'Alpaca Broker', status: hasAlpaca ? 'configured' : 'missing-key', keyRequired: true },
    },
    secrets,
    config: {
      watchlist: env.DEFAULT_WATCHLIST,
      tier1: env.TIER1_WATCHLIST || '',
      tier2: env.TIER2_WATCHLIST || '',
      etfWatchlist: env.ETF_WATCHLIST || '',
      cryptoWatchlist: env.CRYPTO_WATCHLIST || '',
      expandedCrypto: env.EXPANDED_CRYPTO_WATCHLIST || '',
      alpacaPaperMode: env.ALPACA_PAPER_MODE,
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
      'GET /api/portfolio', 'GET /api/performance',
      'GET /api/account', 'GET /api/positions',
      'GET /api/trades?status=open&limit=20',
      'GET /api/d1-positions', 'GET /api/signals?limit=50',
      'GET /api/regime', 'GET /api/risk-events',
      'GET /api/daily-pnl?days=14', 'GET /api/engine-stats',
      'GET /api/news?category=&limit=30&fresh=true',
      'GET /api/test-alert',
      'GET /api/telegram-alerts?limit=50',
      'GET /api/telegram-alert?id=',
      'GET /api/telegram-alert-stats',
      'POST /api/telegram-alert-outcome',
      'GET /api/pnl-dashboard',
      'GET /api/dashboard-data',
      'GET /api/trigger?job=morning|open|quick|pulse|hourly|midday|evening|overnight|weekly|retrain|monthly',
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

export function renderDashboard(baseUrl: string, isAuthed: boolean = false): string {
  if (!isAuthed) {
    return renderLoginPage(baseUrl);
  }
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>YMSA v3 — Trading Dashboard</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📊</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --c-primary: #80CBC4;
  --c-on-primary: #003731;
  --c-primary-ctr: #00504A;
  --c-secondary: #B0BEC5;
  --c-tertiary: #FFB74D;
  --c-error: #EF5350;
  --c-success: #66BB6A;
  --c-warning: #FFA726;
  --c-surface: #0D1117;
  --c-surface-1: #161B22;
  --c-surface-2: #21262D;
  --c-surface-3: #30363D;
  --c-on-surface: #E6EDF3;
  --c-on-surface-2: #8B949E;
  --c-outline: #30363D;
  --c-buy: #3FB950;
  --c-sell: #F85149;
  --radius-l: 16px;
  --radius-m: 12px;
  --radius-s: 8px;
  --shadow-1: 0 1px 3px rgba(0,0,0,.4);
  --shadow-2: 0 4px 12px rgba(0,0,0,.4);
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Google Sans',sans-serif;background:var(--c-surface);color:var(--c-on-surface);min-height:100vh}
.top-bar{background:var(--c-surface-1);border-bottom:1px solid var(--c-outline);padding:14px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100;backdrop-filter:blur(12px)}
.top-bar h1{font-size:20px;font-weight:500;color:var(--c-primary);display:flex;align-items:center;gap:10px}
.top-bar .meta{display:flex;align-items:center;gap:14px;font-size:12px;color:var(--c-on-surface-2)}
.live-dot{width:8px;height:8px;background:var(--c-success);border-radius:50%;animation:pulse 2s infinite}
.mode-badge{padding:3px 10px;border-radius:12px;font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.5px}
.mode-badge.paper{background:rgba(255,183,77,.15);color:var(--c-tertiary);border:1px solid var(--c-tertiary)}
.mode-badge.live{background:rgba(248,81,73,.15);color:var(--c-error);border:1px solid var(--c-error)}
.mode-badge.signals{background:rgba(128,203,196,.15);color:var(--c-primary);border:1px solid var(--c-primary)}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

.container{max-width:1440px;margin:0 auto;padding:20px;display:flex;flex-direction:column;gap:16px}

/* Cards */
.card{background:var(--c-surface-1);border-radius:var(--radius-l);padding:20px;box-shadow:var(--shadow-1);border:1px solid var(--c-outline);transition:border-color .2s}
.card:hover{border-color:var(--c-primary)}
.card-title{font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:1px;color:var(--c-on-surface-2);margin-bottom:6px}
.card-value{font-family:'Roboto Mono',monospace;font-size:28px;font-weight:700;color:var(--c-primary)}
.card-value.up{color:var(--c-buy)}
.card-value.down{color:var(--c-sell)}
.card-sub{font-size:11px;color:var(--c-on-surface-2);margin-top:2px}

/* Grid layouts */
.hero-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:12px}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.three-col{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
@media(max-width:1100px){.hero-grid{grid-template-columns:repeat(3,1fr)}}
@media(max-width:900px){.two-col,.three-col{grid-template-columns:1fr}.hero-grid{grid-template-columns:repeat(2,1fr)}}

/* Section */
.section{display:flex;flex-direction:column;gap:12px}
.section-hdr{font-size:14px;font-weight:500;color:var(--c-secondary);display:flex;align-items:center;gap:8px;padding-bottom:4px;border-bottom:1px solid var(--c-outline)}

/* Tables */
.tbl{width:100%;border-collapse:collapse;font-size:12px}
.tbl th{text-align:left;padding:8px 10px;font-weight:500;color:var(--c-on-surface-2);border-bottom:1px solid var(--c-outline);font-size:10px;text-transform:uppercase;letter-spacing:.5px}
.tbl td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.04)}
.tbl tr:hover td{background:rgba(128,203,196,.04)}
.mono{font-family:'Roboto Mono',monospace;font-size:11px}

/* Regime badge */
.regime-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 16px;border-radius:20px;font-size:14px;font-weight:500}
.regime-badge.up{background:rgba(63,185,80,.15);color:var(--c-buy);border:1px solid var(--c-buy)}
.regime-badge.down{background:rgba(248,81,73,.15);color:var(--c-sell);border:1px solid var(--c-sell)}
.regime-badge.range{background:rgba(128,203,196,.15);color:var(--c-primary);border:1px solid var(--c-primary)}
.regime-badge.volatile{background:rgba(255,167,38,.15);color:var(--c-warning);border:1px solid var(--c-warning)}

/* Engine cards */
.engine-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
@media(max-width:900px){.engine-grid{grid-template-columns:1fr 1fr}}
.engine-card{background:var(--c-surface-2);border-radius:var(--radius-m);padding:14px;border-left:3px solid var(--c-primary)}
.engine-card .name{font-size:13px;font-weight:500;margin-bottom:2px}
.engine-card .eid{font-family:'Roboto Mono',monospace;font-size:10px;color:var(--c-on-surface-2)}
.engine-card .stats{display:flex;gap:8px;margin-top:8px;font-size:10px;color:var(--c-on-surface-2);flex-wrap:wrap}
.engine-card .stats span{display:flex;flex-direction:column;gap:1px;min-width:40px}
.engine-card .stats .val{font-family:'Roboto Mono',monospace;font-weight:500;color:var(--c-on-surface);font-size:12px}
.weight-bar{height:4px;background:var(--c-surface);border-radius:2px;margin-top:8px;overflow:hidden}
.weight-bar-fill{height:100%;background:var(--c-primary);border-radius:2px;transition:width .6s}

/* Signal chip */
.signal-chip{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--c-surface-2);border-radius:var(--radius-s);font-size:12px}
.signal-chip .dir{font-family:'Roboto Mono',monospace;font-weight:700;font-size:11px;padding:2px 8px;border-radius:4px}
.signal-chip .dir.BUY{background:rgba(63,185,80,.2);color:var(--c-buy)}
.signal-chip .dir.SELL{background:rgba(248,81,73,.2);color:var(--c-sell)}
.signal-chip .dir.HOLD{background:rgba(128,203,196,.2);color:var(--c-primary)}

/* Risk event */
.risk-event{display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--c-surface-2);border-radius:var(--radius-s);font-size:12px;border-left:3px solid var(--c-warning)}
.risk-event.CRITICAL{border-left-color:var(--c-error)}
.risk-event.HALT{border-left-color:var(--c-sell)}

/* Chips */
.chip-grid{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:16px;font-size:11px;font-family:'Roboto Mono',monospace;border:1px solid var(--c-outline)}
.chip.set{background:rgba(102,187,106,.1);border-color:var(--c-success);color:var(--c-success)}
.chip.unset{background:rgba(239,83,80,.1);border-color:var(--c-error);color:var(--c-error)}

/* API grid */
.api-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}
.api-item{display:flex;align-items:center;gap:8px;padding:10px;background:var(--c-surface-2);border-radius:var(--radius-s)}
.api-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.api-dot.ok{background:var(--c-success)}.api-dot.err{background:var(--c-error)}

/* Cron table */
.cron-expr{font-family:'Roboto Mono',monospace;font-size:11px;background:var(--c-surface);padding:2px 8px;border-radius:4px;color:var(--c-tertiary)}

/* Risk limits */
.risk-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}
.risk-item{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--c-surface-2);border-radius:var(--radius-s)}
.risk-label{font-size:11px;color:var(--c-on-surface-2)}
.risk-value{font-family:'Roboto Mono',monospace;font-size:13px;font-weight:500;color:var(--c-tertiary)}

/* Endpoints */
.endpoint-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:4px}
.endpoint{font-family:'Roboto Mono',monospace;font-size:11px;padding:6px 10px;background:var(--c-surface-2);border-radius:4px;color:var(--c-on-surface-2);cursor:pointer;transition:background .15s}
.endpoint:hover{background:var(--c-surface-3);color:var(--c-primary)}
.endpoint .method{color:var(--c-success);font-weight:500}

/* Test panel */
.test-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}
.test-panel{background:var(--c-surface-1);border-radius:var(--radius-m);padding:14px;border:1px solid var(--c-outline)}
.test-btn{padding:6px 16px;font-size:12px;font-weight:500;border:none;border-radius:16px;cursor:pointer;background:var(--c-primary-ctr);color:var(--c-primary);transition:filter .15s}
.test-btn:hover{filter:brightness(1.2)}
.test-result{margin-top:8px;font-family:'Roboto Mono',monospace;font-size:11px;background:var(--c-surface);border-radius:6px;padding:10px;max-height:180px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;display:none}

/* Sparkline */
.sparkline{display:flex;align-items:flex-end;gap:2px;height:40px}
.spark-bar{min-width:4px;flex:1;border-radius:2px 2px 0 0;transition:height .3s}

/* Scrollable panel */
.scroll-panel{max-height:320px;overflow-y:auto}

/* Refresh bar */
.refresh-bar{height:2px;background:var(--c-surface-1);position:fixed;bottom:0;left:0;right:0;z-index:999}
.refresh-bar-fill{height:100%;background:var(--c-primary);width:100%;transition:width 1s linear}

/* Scrollbar */
::-webkit-scrollbar{width:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--c-outline);border-radius:3px}

/* Loading */
.loading{color:var(--c-on-surface-2);font-size:12px;padding:12px;text-align:center}
.empty{color:var(--c-on-surface-2);font-size:12px;padding:16px;text-align:center;font-style:italic}

/* ═══ WIN/LOSS TABLE ═══ */
.wl-filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;align-items:center}
.wl-filter-btn{padding:5px 14px;border-radius:16px;font-size:11px;font-weight:500;border:1px solid var(--c-outline);background:transparent;color:var(--c-on-surface-2);cursor:pointer;transition:all .2s}
.wl-filter-btn.active{background:var(--c-primary-ctr);color:var(--c-primary);border-color:var(--c-primary)}
.wl-filter-btn:hover{border-color:var(--c-primary);color:var(--c-primary)}
.wl-search{margin-left:auto;padding:5px 12px;border-radius:16px;font-size:11px;border:1px solid var(--c-outline);background:var(--c-surface-2);color:var(--c-on-surface);outline:none;width:140px;transition:border-color .2s}
.wl-search:focus{border-color:var(--c-primary);width:180px}
.wl-row{cursor:pointer;transition:background .15s}
.wl-row:hover td{background:rgba(128,203,196,.08)!important}
.wl-outcome{padding:2px 10px;border-radius:12px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px}
.wl-outcome.WIN{background:rgba(63,185,80,.15);color:var(--c-buy)}
.wl-outcome.LOSS{background:rgba(248,81,73,.15);color:var(--c-sell)}
.wl-outcome.PENDING{background:rgba(128,203,196,.15);color:var(--c-primary)}
.wl-outcome.BREAKEVEN{background:rgba(176,190,197,.15);color:var(--c-secondary)}
.wl-outcome.EXPIRED{background:rgba(176,190,197,.1);color:var(--c-on-surface-2)}
.wl-stats-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:10px;margin-bottom:16px}
.wl-stat{background:var(--c-surface-2);border-radius:var(--radius-s);padding:12px;text-align:center}
.wl-stat .label{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--c-on-surface-2);margin-bottom:4px}
.wl-stat .val{font-family:'Roboto Mono',monospace;font-size:18px;font-weight:700}
.wl-action-btns{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.wl-action-btn{padding:4px 12px;border-radius:12px;font-size:10px;font-weight:500;border:none;cursor:pointer;transition:filter .15s}
.wl-action-btn:hover{filter:brightness(1.2)}
.wl-action-btn.win{background:rgba(63,185,80,.2);color:var(--c-buy)}
.wl-action-btn.loss{background:rgba(248,81,73,.2);color:var(--c-sell)}
.wl-action-btn.be{background:rgba(176,190,197,.2);color:var(--c-secondary)}
.wl-action-btn.exp{background:rgba(176,190,197,.15);color:var(--c-on-surface-2)}
/* Sort */
.tbl th.sortable{cursor:pointer;user-select:none;position:relative;padding-right:14px}
.tbl th.sortable:hover{color:var(--c-primary)}
.tbl th.sortable::after{content:'⇅';position:absolute;right:2px;top:50%;transform:translateY(-50%);font-size:9px;opacity:.4}
.tbl th.sortable.asc::after{content:'↑';opacity:1;color:var(--c-primary)}
.tbl th.sortable.desc::after{content:'↓';opacity:1;color:var(--c-primary)}
/* Confidence bar */
.conf-bar{display:inline-flex;align-items:center;gap:4px}
.conf-fill{height:6px;border-radius:3px;min-width:4px}
/* R:R pill */
.rr-pill{padding:1px 6px;border-radius:8px;font-size:9px;font-weight:600;letter-spacing:.3px}
.rr-good{background:rgba(63,185,80,.12);color:var(--c-buy)}
.rr-ok{background:rgba(128,203,196,.12);color:var(--c-primary)}
.rr-bad{background:rgba(248,81,73,.12);color:var(--c-sell)}
/* Engine accuracy cards */
.engine-acc-row{display:flex;gap:10px;flex-wrap:wrap;margin:12px 0 16px}
.engine-acc-card{flex:1;min-width:130px;background:var(--c-surface-2);border-radius:var(--radius-s);padding:10px 12px;position:relative;overflow:hidden}
.engine-acc-card .eng-name{font-size:11px;font-weight:700;margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px}
.engine-acc-card .eng-stats{display:flex;gap:12px;font-size:10px;color:var(--c-on-surface-2)}
.engine-acc-card .eng-stats span{font-family:'Roboto Mono',monospace}
.engine-acc-bar{height:3px;border-radius:2px;background:var(--c-outline);margin-top:6px}
.engine-acc-fill{height:100%;border-radius:2px;transition:width .4s ease}
/* Age badge */
.age-badge{padding:1px 6px;border-radius:8px;font-size:9px;font-weight:500;background:var(--c-surface-2);color:var(--c-on-surface-2)}
.age-badge.fresh{background:rgba(128,203,196,.12);color:var(--c-primary)}
.age-badge.aging{background:rgba(255,193,7,.12);color:#ffc107}
.age-badge.old{background:rgba(248,81,73,.12);color:var(--c-sell)}

/* ═══ MODAL ═══ */
.modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);z-index:1000;display:none;align-items:center;justify-content:center;padding:20px}
.modal-overlay.active{display:flex}
.modal{background:var(--c-surface-1);border:1px solid var(--c-outline);border-radius:var(--radius-l);max-width:680px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.6);animation:modalIn .2s ease-out}
@keyframes modalIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.modal-header{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid var(--c-outline);position:sticky;top:0;background:var(--c-surface-1);z-index:1}
.modal-header h2{font-size:16px;font-weight:600;color:var(--c-on-surface);display:flex;align-items:center;gap:8px}
.modal-close{width:32px;height:32px;border-radius:50%;border:none;background:var(--c-surface-2);color:var(--c-on-surface-2);cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:all .15s}
.modal-close:hover{background:var(--c-surface-3);color:var(--c-on-surface)}
.modal-body{padding:20px 24px}
.modal-section{margin-bottom:20px}
.modal-section-title{font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:1px;color:var(--c-on-surface-2);margin-bottom:8px;display:flex;align-items:center;gap:6px}
.modal-kv{display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;font-size:12px}
.modal-kv .k{color:var(--c-on-surface-2)}.modal-kv .v{font-family:'Roboto Mono',monospace;font-weight:500;text-align:right}
.modal-alert-text{font-family:'Roboto Mono',monospace;font-size:11px;background:var(--c-surface);border-radius:var(--radius-s);padding:14px;white-space:pre-wrap;word-break:break-word;color:var(--c-on-surface-2);max-height:240px;overflow-y:auto;border:1px solid var(--c-outline)}
.modal-outcome-form{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.modal-outcome-form select,.modal-outcome-form input{padding:6px 12px;border-radius:8px;border:1px solid var(--c-outline);background:var(--c-surface-2);color:var(--c-on-surface);font-size:12px;font-family:'Roboto Mono',monospace}
.modal-outcome-form button{padding:6px 16px;border-radius:8px;border:none;background:var(--c-primary-ctr);color:var(--c-primary);font-size:12px;font-weight:500;cursor:pointer;transition:filter .15s}
.modal-outcome-form button:hover{filter:brightness(1.2)}

/* ═══ P&L DASHBOARD ═══ */
.pnl-hero{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
@media(max-width:900px){.pnl-hero{grid-template-columns:repeat(2,1fr)}}
.pnl-chart-container{position:relative;height:200px;background:var(--c-surface);border-radius:var(--radius-s);padding:12px;overflow:hidden}
.pnl-chart-container canvas{width:100%!important;height:100%!important}
.pnl-monthly-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:6px}
.pnl-month-cell{padding:10px 8px;border-radius:var(--radius-s);text-align:center;font-family:'Roboto Mono',monospace;font-size:11px;font-weight:600;transition:transform .15s}
.pnl-month-cell:hover{transform:scale(1.05)}
.pnl-month-cell .month-label{font-size:9px;font-weight:400;color:var(--c-on-surface-2);margin-bottom:2px;display:block}
.pnl-bar-chart{display:flex;align-items:flex-end;gap:3px;height:120px;padding:8px 0}
.pnl-bar{flex:1;min-width:0;border-radius:2px 2px 0 0;position:relative;transition:height .3s}
.pnl-bar:hover{opacity:.8}
.pnl-bar .bar-tip{position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:8px;white-space:nowrap;color:var(--c-on-surface-2);display:none}
.pnl-bar:hover .bar-tip{display:block}
.pnl-breakdown-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:900px){.pnl-breakdown-grid{grid-template-columns:1fr}}
.pnl-streak-badge{display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:12px;font-size:11px;font-weight:500}
.pnl-streak-badge.win{background:rgba(63,185,80,.15);color:var(--c-buy)}
.pnl-streak-badge.loss{background:rgba(248,81,73,.15);color:var(--c-sell)}
.tab-bar{display:flex;gap:2px;background:var(--c-surface-2);border-radius:var(--radius-s);padding:2px;margin-bottom:12px}
.tab-btn{flex:1;padding:8px 16px;border:none;border-radius:6px;font-size:11px;font-weight:500;background:transparent;color:var(--c-on-surface-2);cursor:pointer;transition:all .2s}
.tab-btn.active{background:var(--c-primary-ctr);color:var(--c-primary)}
.tab-btn:hover:not(.active){color:var(--c-on-surface)}
.tab-content{display:none}.tab-content.active{display:block}
</style>
</head>
<body>

<div class="top-bar">
  <h1>📊 YMSA v3 — Trading Dashboard</h1>
  <div class="meta">
    <span id="last-update">Loading...</span>
    <div class="live-dot"></div>
    <span id="mode-badge" class="mode-badge signals">SIGNALS</span>
    <span style="font-family:'Roboto Mono',monospace">v3.0.0</span>
  </div>
</div>

<div class="container">

  <!-- ═══ PORTFOLIO HERO ═══ -->
  <div class="hero-grid" id="hero-grid">
    <div class="card"><div class="card-title">Total Equity</div><div class="card-value" id="h-equity">—</div><div class="card-sub">Portfolio value</div></div>
    <div class="card"><div class="card-title">Cash / Buying Power</div><div class="card-value" id="h-cash" style="font-size:20px">—</div><div class="card-sub" id="h-cash-sub">Available</div></div>
    <div class="card"><div class="card-title">Daily P&L</div><div class="card-value" id="h-daily-pnl">—</div><div class="card-sub" id="h-daily-pnl-sub">Today</div></div>
    <div class="card"><div class="card-title">Unrealized P&L</div><div class="card-value" id="h-unrealized">—</div><div class="card-sub">Open positions</div></div>
    <div class="card"><div class="card-title">Win Rate</div><div class="card-value" id="h-winrate">—</div><div class="card-sub">All engines</div></div>
    <div class="card"><div class="card-title">System Health</div><div class="card-value" id="h-health">—</div><div class="card-sub" id="h-health-sub">Worker status</div></div>
  </div>

  <!-- ═══ REGIME + ENGINES ═══ -->
  <div class="two-col">
    <div class="section">
      <div class="section-hdr">🌊 Market Regime</div>
      <div class="card" id="regime-panel">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px">
          <span class="regime-badge range" id="regime-badge">LOADING</span>
          <div style="font-size:12px;color:var(--c-on-surface-2)">
            VIX: <span class="mono" id="regime-vix">—</span> &nbsp;|&nbsp;
            ADX: <span class="mono" id="regime-adx">—</span> &nbsp;|&nbsp;
            Confidence: <span class="mono" id="regime-conf">—</span>
          </div>
        </div>
        <div class="card-title">Engine Weight Adjustments</div>
        <div id="regime-weights" style="font-size:12px;color:var(--c-on-surface-2);margin-top:4px">Based on current regime</div>
      </div>
    </div>
    <div class="section">
      <div class="section-hdr">📈 P&L Sparkline (Last 14 Days)</div>
      <div class="card">
        <div class="sparkline" id="pnl-sparkline"><div class="empty">Collecting data...</div></div>
      </div>
    </div>
  </div>

  <!-- ═══ 6-ENGINE PERFORMANCE ═══ -->
  <div class="section">
    <div class="section-hdr">⚡ 6-Engine Performance</div>
    <div class="engine-grid" id="engine-grid"></div>
  </div>

  <!-- ═══ OPEN POSITIONS ═══ -->
  <div class="section">
    <div class="section-hdr">💼 Open Positions <span id="pos-count" style="font-family:'Roboto Mono',monospace;font-size:12px;color:var(--c-primary);margin-left:4px"></span></div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table class="tbl" id="positions-table">
        <thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Current</th><th>P&L</th><th>P&L %</th><th>Engine</th></tr></thead>
        <tbody id="positions-body"><tr><td colspan="8" class="loading">Loading positions...</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- ═══ SIGNALS + RISK EVENTS ═══ -->
  <div class="two-col">
    <div class="section">
      <div class="section-hdr">📡 Recent Signals <span id="sig-count" class="mono" style="color:var(--c-primary);font-size:12px;margin-left:4px"></span></div>
      <div class="card scroll-panel" id="signals-panel"><div class="loading">Loading signals...</div></div>
    </div>
    <div class="section">
      <div class="section-hdr">🛡️ Risk Events</div>
      <div class="card scroll-panel" id="risk-events-panel"><div class="loading">Loading events...</div></div>
    </div>
  </div>

  <!-- ═══ RECENT TRADES ═══ -->
  <div class="section">
    <div class="section-hdr">📋 Recent Trades</div>
    <div class="card" style="padding:0;overflow-x:auto">
      <table class="tbl">
        <thead><tr><th>ID</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>P&L</th><th>Status</th><th>Engine</th><th>Opened</th></tr></thead>
        <tbody id="trades-body"><tr><td colspan="10" class="loading">Loading trades...</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- ═══ GOOGLE ALERTS NEWS FEED ═══ -->
  <div class="section">
    <div class="section-hdr">📰 Google Alerts News Feed <span id="news-count" class="mono" style="color:var(--c-primary);font-size:12px;margin-left:4px"></span>
      <button class="test-btn" style="margin-left:auto;font-size:10px;padding:3px 10px" onclick="refreshNews()">⟳ Refresh</button>
    </div>
    <div class="two-col">
      <div class="card scroll-panel" id="news-panel" style="max-height:400px"><div class="loading">Loading news...</div></div>
      <div class="card">
        <div class="card-title">Feed Categories</div>
        <div id="news-feeds" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px"></div>
        <div class="card-title" style="margin-top:14px">Engine Mapping</div>
        <div id="news-engine-map" style="margin-top:4px;font-size:11px;color:var(--c-on-surface-2)"></div>
      </div>
    </div>
  </div>

  <!-- ═══ CRON + APIS ═══ -->
  <div class="two-col">
    <div class="section">
      <div class="section-hdr">⏰ Cron Schedule</div>
      <div class="card" style="padding:0;overflow:hidden">
        <table class="tbl" id="cron-table">
          <thead><tr><th>Job</th><th>Schedule (UTC)</th><th>Description</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
    <div class="section">
      <div class="section-hdr">🌐 API Connectivity</div>
      <div class="api-grid" id="api-grid" style="margin-top:4px"></div>
    </div>
  </div>

  <!-- ═══ SECRETS + RISK LIMITS ═══ -->
  <div class="two-col">
    <div class="section">
      <div class="section-hdr">🔐 Secrets Status</div>
      <div class="chip-grid" id="secrets-grid" style="margin-top:4px"></div>
    </div>
    <div class="section">
      <div class="section-hdr">🛡️ Risk Limits</div>
      <div class="risk-grid" id="risk-grid" style="margin-top:4px"></div>
    </div>
  </div>

  <!-- ═══ ENDPOINTS ═══ -->
  <div class="section">
    <div class="section-hdr">📡 HTTP Endpoints (<span id="ep-count">0</span>)</div>
    <div class="endpoint-list" id="endpoint-list"></div>
  </div>

  <!-- ═══ LIVE TESTS ═══ -->
  <div class="section">
    <div class="section-hdr">🧪 Live Connectivity Tests</div>
    <div class="test-grid">
      <div class="test-panel">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <strong style="font-size:13px">Health Check</strong>
          <button class="test-btn" onclick="runTest('/health','t-health')">Run</button>
        </div>
        <div class="test-result" id="t-health"></div>
      </div>
      <div class="test-panel">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <strong style="font-size:13px">Portfolio</strong>
          <button class="test-btn" onclick="runTest('/api/portfolio','t-portfolio')">Run</button>
        </div>
        <div class="test-result" id="t-portfolio"></div>
      </div>
      <div class="test-panel">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <strong style="font-size:13px">Market Regime</strong>
          <button class="test-btn" onclick="runTest('/api/regime','t-regime')">Run</button>
        </div>
        <div class="test-result" id="t-regime"></div>
      </div>
      <div class="test-panel">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <strong style="font-size:13px">Quote (AAPL)</strong>
          <button class="test-btn" onclick="runTest('/api/quote?symbol=AAPL','t-quote')">Run</button>
        </div>
        <div class="test-result" id="t-quote"></div>
      </div>
      <div class="test-panel">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <strong style="font-size:13px">Crypto</strong>
          <button class="test-btn" onclick="runTest('/api/crypto','t-crypto')">Run</button>
        </div>
        <div class="test-result" id="t-crypto"></div>
      </div>
      <div class="test-panel">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
          <strong style="font-size:13px">Signals</strong>
          <button class="test-btn" onclick="runTest('/api/signals?limit=5','t-signals')">Run</button>
        </div>
        <div class="test-result" id="t-signals"></div>
      </div>
    </div>
  </div>

  <!-- ═══ CONFIG ═══ -->
  <div class="section">
    <div class="section-hdr">⚙️ Runtime Configuration</div>
    <div class="card" id="config-panel" style="font-family:'Roboto Mono',monospace;font-size:11px;white-space:pre-wrap;color:var(--c-on-surface-2)">Loading...</div>
  </div>

  <!-- ═══════════════════════════════════════════════════════ -->
  <!-- v3.1: WIN/LOSS TELEGRAM ALERTS TABLE                    -->
  <!-- ═══════════════════════════════════════════════════════ -->
  <div class="section" id="wl-section">
    <div class="section-hdr">🏆 Recommendation Tracker — Intelligence P&L</div>
    <div class="card">
      <!-- Stats Row -->
      <div class="wl-stats-row" id="wl-stats-row">
        <div class="wl-stat"><div class="label">Total Alerts</div><div class="val" id="wl-total">—</div></div>
        <div class="wl-stat"><div class="label">Wins</div><div class="val up" id="wl-wins">—</div></div>
        <div class="wl-stat"><div class="label">Losses</div><div class="val down" id="wl-losses">—</div></div>
        <div class="wl-stat"><div class="label">Win Rate</div><div class="val" id="wl-winrate">—</div></div>
        <div class="wl-stat"><div class="label">Total P&L</div><div class="val" id="wl-pnl">—</div></div>
        <div class="wl-stat"><div class="label">Profit Factor</div><div class="val" id="wl-pf">—</div></div>
        <div class="wl-stat"><div class="label">Avg Win</div><div class="val up" id="wl-avgwin">—</div></div>
        <div class="wl-stat"><div class="label">Avg Loss</div><div class="val down" id="wl-avgloss">—</div></div>
        <div class="wl-stat"><div class="label">Expectancy</div><div class="val" id="wl-expect">—</div></div>
      </div>
      <!-- Engine Accuracy -->
      <div id="wl-engine-acc" class="engine-acc-row"></div>
      <!-- Filters + Search -->
      <div class="wl-filters">
        <button class="wl-filter-btn active" onclick="filterWLAlerts('ALL')">All</button>
        <button class="wl-filter-btn" onclick="filterWLAlerts('PENDING')">⏳ Pending</button>
        <button class="wl-filter-btn" onclick="filterWLAlerts('WIN')">✅ Wins</button>
        <button class="wl-filter-btn" onclick="filterWLAlerts('LOSS')">❌ Losses</button>
        <button class="wl-filter-btn" onclick="filterWLAlerts('BREAKEVEN')">➖ Breakeven</button>
        <button class="wl-filter-btn" onclick="filterWLAlerts('EXPIRED')">⏰ Expired</button>
        <input class="wl-search" type="text" placeholder="🔍 Search symbol..." id="wl-search" oninput="applyWLFilters()">
      </div>
      <!-- Table -->
      <div style="overflow-x:auto">
        <table class="tbl" id="wl-table">
          <thead><tr>
            <th class="sortable" data-sort="sent_at" onclick="sortWLTable(this)">Date</th>
            <th class="sortable" data-sort="symbol" onclick="sortWLTable(this)">Symbol</th>
            <th>Action</th>
            <th class="sortable" data-sort="engine_id" onclick="sortWLTable(this)">Engine</th>
            <th>Entry</th><th>SL</th><th>TP1</th>
            <th>R:R</th>
            <th class="sortable" data-sort="confidence" onclick="sortWLTable(this)">Conf</th>
            <th class="sortable" data-sort="age" onclick="sortWLTable(this)">Age</th>
            <th>Outcome</th>
            <th class="sortable" data-sort="outcome_pnl_pct" onclick="sortWLTable(this)">P&L</th>
          </tr></thead>
          <tbody id="wl-body"><tr><td colspan="12" class="loading">Loading alerts...</td></tr></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ═══════════════════════════════════════════════════════ -->
  <!-- v3.1: P&L ANALYTICS DASHBOARD                          -->
  <!-- ═══════════════════════════════════════════════════════ -->
  <div class="section" id="pnl-section">
    <div class="section-hdr">📊 P&L Analytics Dashboard <span style="font-size:11px;padding:2px 10px;border-radius:10px;background:rgba(49,141,255,.15);color:#319dff;margin-left:8px;vertical-align:middle;letter-spacing:.5px">PAPER TRADING</span></div>

    <!-- P&L Hero Metrics -->
    <div class="pnl-hero" id="pnl-hero">
      <div class="card"><div class="card-title">Portfolio P&L</div><div class="card-value" id="pnl-cumulative">—</div><div class="card-sub" id="pnl-cumulative-sub">Realized + Unrealized</div></div>
      <div class="card"><div class="card-title">Realized</div><div class="card-value" id="pnl-realized">—</div><div class="card-sub" id="pnl-realized-sub">Closed trades</div></div>
      <div class="card"><div class="card-title">Unrealized</div><div class="card-value" id="pnl-unrealized">—</div><div class="card-sub" id="pnl-unrealized-sub">Open positions</div></div>
      <div class="card"><div class="card-title">Win Rate</div><div class="card-value" id="pnl-winrate">—</div><div class="card-sub" id="pnl-winrate-sub">Closed trades</div></div>
      <div class="card"><div class="card-title">Max Drawdown</div><div class="card-value down" id="pnl-max-dd">—</div><div class="card-sub">Peak-to-trough</div></div>
      <div class="card"><div class="card-title">Current Streak</div><div id="pnl-streak" class="card-value">—</div><div class="card-sub" id="pnl-streak-sub">—</div></div>
    </div>

    <!-- Tab Navigation -->
    <div class="tab-bar">
      <button class="tab-btn active" onclick="switchPnlTab('equity', this)">📈 Equity Curve</button>
      <button class="tab-btn" onclick="switchPnlTab('drawdown', this)">📉 Drawdown</button>
      <button class="tab-btn" onclick="switchPnlTab('monthly', this)">📅 Monthly Returns</button>
      <button class="tab-btn" onclick="switchPnlTab('daily', this)">📊 Daily P&L</button>
      <button class="tab-btn" onclick="switchPnlTab('breakdown', this)">🔍 Breakdown</button>
      <button class="tab-btn" onclick="switchPnlTab('simtrades', this)">📋 Trades</button>
    </div>

    <!-- Tab: Equity Curve -->
    <div class="tab-content active" id="tab-equity">
      <div class="card">
        <div class="card-title">Equity Curve</div>
        <div class="pnl-chart-container"><canvas id="equity-canvas"></canvas></div>
      </div>
    </div>

    <!-- Tab: Drawdown -->
    <div class="tab-content" id="tab-drawdown">
      <div class="card">
        <div class="card-title">Drawdown from Peak</div>
        <div class="pnl-chart-container"><canvas id="drawdown-canvas"></canvas></div>
      </div>
    </div>

    <!-- Tab: Monthly Returns Heatmap -->
    <div class="tab-content" id="tab-monthly">
      <div class="card">
        <div class="card-title">Monthly Returns Heatmap</div>
        <div class="pnl-monthly-grid" id="pnl-monthly-grid"></div>
      </div>
    </div>

    <!-- Tab: Daily P&L Bars -->
    <div class="tab-content" id="tab-daily">
      <div class="card">
        <div class="card-title">Daily P&L (Last 60 Days)</div>
        <div class="pnl-bar-chart" id="pnl-daily-bars"></div>
      </div>
    </div>

    <!-- Tab: Breakdown by Engine & Symbol -->
    <div class="tab-content" id="tab-breakdown">
      <div class="pnl-breakdown-grid">
        <div class="card">
          <div class="card-title">P&L by Engine</div>
          <table class="tbl" id="pnl-engine-table">
            <thead><tr><th>Engine</th><th>Trades</th><th>Win Rate</th><th>P&L</th></tr></thead>
            <tbody id="pnl-engine-body"><tr><td colspan="4" class="loading">Loading...</td></tr></tbody>
          </table>
        </div>
        <div class="card">
          <div class="card-title">P&L by Symbol (Top 20)</div>
          <table class="tbl" id="pnl-symbol-table">
            <thead><tr><th>Symbol</th><th>Trades</th><th>Win Rate</th><th>P&L</th></tr></thead>
            <tbody id="pnl-symbol-body"><tr><td colspan="4" class="loading">Loading...</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Tab: Simulated Trades Detail -->
    <div class="tab-content" id="tab-simtrades">
      <div class="card" style="padding:0;overflow-x:auto">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.06)">
          <div class="card-title" style="margin:0">Simulated Trades <span style="font-size:9px;color:var(--c-on-surface-2);margin-left:4px">$100K virtual capital · 2% risk per trade</span></div>
          <div style="display:flex;gap:6px;flex-wrap:wrap" id="sim-trade-filters">
            <button class="chip active" onclick="filterSimTrades('all',this)">All</button>
            <button class="chip" onclick="filterSimTrades('OPEN',this)">🟢 Open</button>
            <button class="chip" onclick="filterSimTrades('CLOSED',this)">⚪ Closed</button>
          </div>
        </div>
        <table class="tbl" id="sim-trades-table">
          <thead><tr>
            <th>Date</th><th>Symbol</th><th>Side</th><th>Engine</th><th>Qty</th>
            <th>Entry</th><th>SL</th><th>TP</th><th>Exit / Current</th>
            <th>P&L $</th><th>P&L %</th><th>Status</th><th>Age</th>
          </tr></thead>
          <tbody id="sim-trades-body"><tr><td colspan="13" class="loading">Loading...</td></tr></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ═══ ALERT DETAIL MODAL ═══ -->
  <div class="modal-overlay" id="alert-modal" onclick="if(event.target===this)closeAlertModal()">
    <div class="modal">
      <div class="modal-header">
        <h2 id="modal-title">Alert Detail</h2>
        <button class="modal-close" onclick="closeAlertModal()">&times;</button>
      </div>
      <div class="modal-body" id="modal-body">
        <div class="loading">Loading...</div>
      </div>
    </div>
  </div>

</div>

<div class="refresh-bar"><div class="refresh-bar-fill" id="refresh-bar"></div></div>

<script>
const BASE = '${baseUrl}';
const REFRESH = 60;
let countdown = REFRESH;

// ─── Helpers ─────────────────────────────────────
function $(id) { return document.getElementById(id); }
function fmt(n, d) { return n != null ? Number(n).toFixed(d ?? 2) : '—'; }
function fmtUsd(n) { return n != null ? '$' + Number(n).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2}) : '—'; }
function fmtPct(n) { return n != null ? (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%' : '—'; }
function pnlClass(n) { return n > 0 ? 'up' : n < 0 ? 'down' : ''; }
function ts(epoch) { if (!epoch) return '—'; const d = new Date(epoch); return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); }
function safeFetch(path) { return fetch(BASE + path, {credentials:'include'}).then(r => r.ok ? r.json() : null).catch(() => null); }

// ─── Main Load ───────────────────────────────────
async function loadDashboard() {
  const [status, portfolio, regime, signals, trades, riskEvents, positions, news, performance, dailyPnl, engineStats, dashData] = await Promise.all([
    safeFetch('/api/system-status'),
    safeFetch('/api/portfolio'),
    safeFetch('/api/regime'),
    safeFetch('/api/signals?limit=30'),
    safeFetch('/api/trades?limit=15'),
    safeFetch('/api/risk-events'),
    safeFetch('/api/positions'),
    safeFetch('/api/news?limit=30'),
    safeFetch('/api/performance'),
    safeFetch('/api/daily-pnl?days=14'),
    safeFetch('/api/engine-stats'),
    safeFetch('/api/dashboard-data'),
  ]);

  if (status) renderStatus(status, engineStats);
  renderPortfolio(portfolio, performance);
  renderRegime(regime);
  renderSignals(signals);
  renderTrades(trades);
  renderRiskEvents(riskEvents);
  renderPositions(positions);
  renderNews(news);
  renderSparkline(dailyPnl);
  renderWinLossTable(dashData?.tgAlerts, dashData?.tgStats);
  renderPnlDashboard(dashData?.pnlDash, dashData?.simTrades);
  renderSimTrades(dashData?.simTrades);
  $('last-update').textContent = 'Updated: ' + new Date().toLocaleTimeString();
}

// ─── System Status ───────────────────────────────
function renderStatus(d, engineStats) {
  // Health
  const h = $('h-health');
  h.textContent = d.health === 'ok' ? 'HEALTHY' : 'DEGRADED';
  h.className = 'card-value ' + (d.health === 'ok' ? 'up' : 'down');

  // Mode badge
  const mb = $('mode-badge');
  mb.textContent = d.mode;
  if (d.mode.includes('PAPER')) { mb.className = 'mode-badge paper'; }
  else if (d.mode.includes('LIVE')) { mb.className = 'mode-badge live'; }
  else { mb.className = 'mode-badge signals'; }

  // Health sub
  const setCount = Object.values(d.secrets).filter(Boolean).length;
  const total = Object.keys(d.secrets).length;
  $('h-health-sub').textContent = setCount + '/' + total + ' secrets · ' + d.crons.length + ' crons · ' + d.endpoints.length + ' endpoints';

  // Engines — merge static config with live D1 stats
  const statsMap = {};
  if (engineStats && engineStats.engines) {
    engineStats.engines.forEach(s => { statsMap[s.engine_id] = s; });
  }
  const eg = $('engine-grid');
  eg.innerHTML = d.engines.map(e => {
    const s = statsMap[e.id];
    const wr = s ? (s.win_rate * 100).toFixed(0) + '%' : '—';
    const pnl = s ? (s.pnl >= 0 ? '+' : '') + '$' + Number(s.pnl).toFixed(0) : '—';
    const trades = s ? s.trades_executed : 0;
    const sigs = s ? s.signals_generated : 0;
    const pnlColor = s ? (s.pnl >= 0 ? 'var(--c-buy)' : 'var(--c-sell)') : 'var(--c-on-surface-2)';
    return \`
    <div class="engine-card">
      <div class="name">\${e.name}</div>
      <div class="eid">\${e.id}</div>
      <div class="stats">
        <span>Win Rate<div class="val">\${wr}</div></span>
        <span>P&L<div class="val" style="color:\${pnlColor}">\${pnl}</div></span>
        <span>Trades<div class="val">\${trades}</div></span>
        <span>Signals<div class="val">\${sigs}</div></span>
      </div>
      <div class="weight-bar"><div class="weight-bar-fill" style="width:\${e.weight}%"></div></div>
      <div style="text-align:right;font-size:9px;color:var(--c-on-surface-2);margin-top:2px">Weight: \${e.weight}%\${s ? ' · ' + s.date : ''}</div>
    </div>
  \`;
  }).join('');

  // Crons
  const ct = document.querySelector('#cron-table tbody');
  ct.innerHTML = d.crons.map(c => \`<tr>
    <td style="font-weight:500;font-size:12px">\${c.name}</td>
    <td><span class="cron-expr">\${c.schedule}</span></td>
    <td style="color:var(--c-on-surface-2);font-size:12px">\${c.description}</td>
  </tr>\`).join('');

  // APIs
  const ag = $('api-grid');
  ag.innerHTML = Object.values(d.apis).map(a => {
    const dot = a.status === 'missing-key' ? 'err' : 'ok';
    return \`<div class="api-item">
      <div class="api-dot \${dot}"></div>
      <div><div style="font-size:12px;font-weight:500">\${a.name}</div><div style="font-size:10px;color:var(--c-on-surface-2)">\${a.keyRequired ? '🔑' : '🆓'} \${a.status}</div></div>
    </div>\`;
  }).join('');

  // Secrets
  $('secrets-grid').innerHTML = Object.entries(d.secrets).map(([k,v]) =>
    \`<div class="chip \${v?'set':'unset'}">\${v?'✓':'✗'} \${k}</div>\`
  ).join('');

  // Risk limits
  const rl = {maxDailyDrawdown:'Max Daily DD',killSwitch:'Kill Switch',maxPositionSize:'Position Size',maxSectorExposure:'Sector Exp.',maxTotalExposure:'Total Exp.',maxOpenPositions:'Open Positions',dailyLossLimit:'Daily Loss Limit',maxCorrelation:'Max Corr.'};
  $('risk-grid').innerHTML = Object.entries(d.riskLimits).map(([k,v]) => {
    const u = k.includes('Limit') ? fmtUsd(v) : k === 'maxCorrelation' ? v : k === 'maxOpenPositions' ? v : v+'%';
    return \`<div class="risk-item"><span class="risk-label">\${rl[k]||k}</span><span class="risk-value">\${u}</span></div>\`;
  }).join('');

  // Endpoints
  $('ep-count').textContent = d.endpoints.length;
  $('endpoint-list').innerHTML = d.endpoints.map(e => {
    const [m, p] = e.split(' ');
    return \`<div class="endpoint" onclick="runTest('\${p.split('?')[0]}','t-health')"><span class="method">\${m}</span> \${p}</div>\`;
  }).join('');

  // Config
  $('config-panel').textContent = JSON.stringify(d.config, null, 2);
}

// ─── Portfolio ───────────────────────────────────
function renderPortfolio(p, perf) {
  if (!p) {
    $('h-equity').textContent = '—';
    $('h-equity').className = 'card-value';
    $('h-cash').textContent = '—';
    $('h-daily-pnl').textContent = '—';
    $('h-daily-pnl').className = 'card-value';
    $('h-unrealized').textContent = '—';
    $('h-unrealized').className = 'card-value';
    $('h-cash-sub').textContent = 'Broker not connected';
    $('h-daily-pnl-sub').textContent = 'Connect Alpaca to see P&L';
    // Still show win rate from performance metrics if available
    if (perf && perf.totalTrades > 0) {
      $('h-winrate').textContent = fmt(perf.winRate * 100, 1) + '%';
      $('h-winrate').className = 'card-value ' + (perf.winRate > 0.5 ? 'up' : perf.winRate < 0.4 ? 'down' : '');
    } else {
      $('h-winrate').textContent = perf ? '0%' : '—';
      $('h-winrate').className = 'card-value';
    }
    return;
  }
  $('h-equity').textContent = fmtUsd(p.equity || p.total_equity);
  $('h-equity').className = 'card-value';

  $('h-cash').textContent = fmtUsd(p.cash || p.buying_power);
  $('h-cash-sub').textContent = p.buying_power ? 'BP: ' + fmtUsd(p.buying_power) : 'Available';

  const dpnl = p.daily_pnl ?? p.dailyPnl ?? 0;
  $('h-daily-pnl').textContent = fmtUsd(dpnl);
  $('h-daily-pnl').className = 'card-value ' + pnlClass(dpnl);
  const rpnl = p.realizedPnlToday ?? p.realized_pnl_today ?? 0;
  const dpnlSub = fmtPct(p.daily_pnl_pct ?? p.dailyPnlPct) + ' today';
  $('h-daily-pnl-sub').textContent = rpnl !== 0 ? dpnlSub + ' (realized: ' + fmtUsd(rpnl) + ')' : dpnlSub;

  const upnl = p.unrealized_pnl ?? p.unrealizedPnl ?? p.totalUnrealizedPnl ?? 0;
  $('h-unrealized').textContent = fmtUsd(upnl);
  $('h-unrealized').className = 'card-value ' + pnlClass(upnl);

  const wr = p.win_rate ?? p.winRate ?? (perf ? perf.winRate : null);
  $('h-winrate').textContent = wr != null ? fmt(wr * 100, 1) + '%' : '—';
  $('h-winrate').className = 'card-value ' + (wr > 0.5 ? 'up' : wr < 0.4 ? 'down' : '');
}

// ─── Regime ──────────────────────────────────────
function renderRegime(r) {
  if (!r) {
    $('regime-badge').textContent = 'UNKNOWN';
    return;
  }
  const regime = r.regime || r.current || 'UNKNOWN';
  const rb = $('regime-badge');
  rb.textContent = regime.replace(/_/g, ' ');
  const cls = regime.includes('UP') ? 'up' : regime.includes('DOWN') ? 'down' : regime.includes('VOLATILE') ? 'volatile' : 'range';
  rb.className = 'regime-badge ' + cls;

  $('regime-vix').textContent = fmt(r.vix ?? r.vix_level, 1);
  $('regime-adx').textContent = fmt(r.adx, 1);
  $('regime-conf').textContent = r.confidence != null ? fmt(r.confidence, 0) + '%' : '—';

  if (r.suggestedEngines && r.suggestedEngines.length) {
    $('regime-weights').innerHTML = '<span style="color:var(--c-on-surface-2);font-size:11px">Suggested: </span>' + r.suggestedEngines.map(e =>
      \`<span class="mono" style="margin-right:8px;padding:2px 8px;background:var(--c-surface-2);border-radius:4px;font-size:11px">\${e}</span>\`
    ).join('');
  } else if (r.weights || r.engineWeights) {
    const w = r.weights || r.engineWeights;
    $('regime-weights').innerHTML = Object.entries(w).map(([k,v]) =>
      \`<span class="mono" style="margin-right:12px">\${k}: <strong>\${typeof v === 'number' ? v+'%' : v}</strong></span>\`
    ).join('');
  }
}

// ─── Positions ───────────────────────────────────
function renderPositions(data) {
  const pos = data?.positions || [];
  $('pos-count').textContent = pos.length ? '(' + pos.length + ')' : '(0)';
  const body = $('positions-body');
  if (!pos.length) {
    body.innerHTML = '<tr><td colspan="8" class="empty">No open positions</td></tr>';
    return;
  }
  body.innerHTML = pos.map(p => {
    const entry = p.avg_entry || p.avg_entry_price || p.cost_basis;
    const current = p.current_price || p.market_value;
    const pnl = p.unrealized_pnl ?? p.unrealized_pl ?? 0;
    const pnlPct = p.unrealized_pnl_pct ?? p.unrealized_plpc ?? (entry ? ((current/entry-1)*100) : 0);
    return \`<tr>
      <td class="mono" style="font-weight:500">\${p.symbol}</td>
      <td style="color:\${p.side === 'long' || p.side === 'LONG' ? 'var(--c-buy)' : 'var(--c-sell)'}">\${(p.side||'').toUpperCase()}</td>
      <td class="mono">\${p.qty || p.quantity || '—'}</td>
      <td class="mono">\${fmtUsd(entry)}</td>
      <td class="mono">\${fmtUsd(current)}</td>
      <td class="mono" style="color:\${pnl>=0?'var(--c-buy)':'var(--c-sell)'}">\${fmtUsd(pnl)}</td>
      <td class="mono" style="color:\${pnlPct>=0?'var(--c-buy)':'var(--c-sell)'}">\${fmtPct(pnlPct)}</td>
      <td class="mono" style="font-size:10px">\${p.engine_id || '—'}</td>
    </tr>\`;
  }).join('');
}

// ─── Signals ─────────────────────────────────────
function renderSignals(data) {
  const sigs = data?.signals || [];
  $('sig-count').textContent = sigs.length ? '(' + sigs.length + ')' : '';
  const panel = $('signals-panel');
  if (!sigs.length) { panel.innerHTML = '<div class="empty">No signals yet</div>'; return; }
  panel.innerHTML = sigs.slice(0, 20).map(s => \`
    <div class="signal-chip" style="margin-bottom:4px">
      <span class="dir \${s.direction}">\${s.direction}</span>
      <span class="mono" style="font-weight:500">\${s.symbol}</span>
      <span style="color:var(--c-on-surface-2);font-size:11px">\${s.signal_type} · \${s.engine_id}</span>
      <span class="mono" style="margin-left:auto;font-size:10px;color:var(--c-on-surface-2)">\${ts(s.created_at)}</span>
    </div>
  \`).join('');
}

// ─── Risk Events ─────────────────────────────────
function renderRiskEvents(data) {
  const events = data?.events || [];
  const panel = $('risk-events-panel');
  if (!events.length) { panel.innerHTML = '<div class="empty">No risk events — system operating normally</div>'; return; }
  panel.innerHTML = events.map(e => \`
    <div class="risk-event \${e.severity}" style="margin-bottom:4px">
      <span style="font-weight:500;min-width:70px">\${e.severity}</span>
      <span style="flex:1">\${e.description}</span>
      <span class="mono" style="font-size:10px;color:var(--c-on-surface-2)">\${ts(e.created_at)}</span>
    </div>
  \`).join('');
}

// ─── Trades ──────────────────────────────────────
function renderTrades(data) {
  const trades = data?.trades || [];
  const body = $('trades-body');
  if (!trades.length) { body.innerHTML = '<tr><td colspan="10" class="empty">No trades recorded yet</td></tr>'; return; }
  body.innerHTML = trades.map(t => {
    const pnl = t.pnl ?? 0;
    return \`<tr>
      <td class="mono" style="font-size:10px">\${(t.id||'').slice(0,12)}...</td>
      <td class="mono" style="font-weight:500">\${t.symbol}</td>
      <td style="color:\${t.side==='BUY'?'var(--c-buy)':'var(--c-sell)'}">\${t.side}</td>
      <td class="mono">\${t.qty}</td>
      <td class="mono">\${fmtUsd(t.entry_price)}</td>
      <td class="mono">\${t.exit_price ? fmtUsd(t.exit_price) : '—'}</td>
      <td class="mono" style="color:\${pnl>=0?'var(--c-buy)':'var(--c-sell)'}">\${t.pnl != null ? fmtUsd(pnl) : '—'}</td>
      <td>\${t.status === 'OPEN' ? '🟢' : t.status === 'CLOSED' ? '⚪' : '🔴'} \${t.status}</td>
      <td class="mono" style="font-size:10px">\${t.engine_id}</td>
      <td class="mono" style="font-size:10px">\${ts(t.opened_at)}</td>
    </tr>\`;
  }).join('');
}

// ─── News Feed ───────────────────────────────────
const FEED_COLORS = {
  'mega-tech':'#80CBC4','more-tech':'#80CBC4','banks':'#80CBC4','semis':'#FFB74D',
  'mna':'#CE93D8','short-squeeze':'#EF5350','fed-rates':'#42A5F5','earnings':'#66BB6A',
  'sec-13f':'#FFA726','crypto':'#AB47BC','buybacks':'#26A69A','crash-signals':'#F44336'
};
function renderNews(data) {
  const alerts = data?.alerts || [];
  const feeds = data?.feeds || [];
  $('news-count').textContent = alerts.length ? '(' + alerts.length + ')' : '';

  const panel = $('news-panel');
  if (!alerts.length) {
    panel.innerHTML = '<div class="empty">No news alerts yet — trigger a midday or overnight scan to populate</div>';
  } else {
    panel.innerHTML = alerts.map(a => {
      const color = FEED_COLORS[a.category] || 'var(--c-on-surface-2)';
      const ago = a.published_at ? ts(a.published_at) : (a.published ? new Date(a.published).toLocaleString() : '');
      const title = (a.title || '').replace(/<[^>]*>/g, '').slice(0, 100);
      const link = a.url || '#';
      return \`<div style="display:flex;gap:8px;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.04);font-size:12px;align-items:flex-start">
        <span class="mono" style="min-width:80px;color:\${color};font-size:10px;padding-top:2px">\${a.category}</span>
        <div style="flex:1">
          <a href="\${link}" target="_blank" rel="noopener" style="color:var(--c-on-surface);text-decoration:none">\${title}</a>
          <div style="font-size:10px;color:var(--c-on-surface-2);margin-top:2px">\${ago}</div>
        </div>
      </div>\`;
    }).join('');
  }

  // Feed categories
  const fc = $('news-feeds');
  if (feeds.length) {
    fc.innerHTML = feeds.map(f => {
      const color = FEED_COLORS[f.id] || 'var(--c-on-surface-2)';
      return \`<span class="chip" style="border-color:\${color};color:\${color};font-size:10px;cursor:pointer" onclick="filterNews('\${f.id}')">\${f.name}</span>\`;
    }).join('');
  }

  // Engine mapping
  const em = $('news-engine-map');
  if (feeds.length) {
    const engineMap = {};
    feeds.forEach(f => f.engines.forEach(e => {
      if (!engineMap[e]) engineMap[e] = [];
      engineMap[e].push(f.name);
    }));
    em.innerHTML = Object.entries(engineMap).map(([eng, feedNames]) =>
      \`<div style="margin-bottom:4px"><span class="mono" style="color:var(--c-primary);font-weight:500">\${eng}</span>: \${feedNames.join(', ')}</div>\`
    ).join('');
  }
}

async function refreshNews() {
  $('news-panel').innerHTML = '<div class="loading">Fetching fresh Google Alerts...</div>';
  const data = await safeFetch('/api/news?limit=30&fresh=true');
  renderNews(data);
}

async function filterNews(category) {
  $('news-panel').innerHTML = '<div class="loading">Loading ' + category + '...</div>';
  const data = await safeFetch('/api/news?limit=20&category=' + category);
  renderNews(data);
}

// ─── P&L Sparkline ───────────────────────────────
function renderSparkline(data) {
  const panel = $('pnl-sparkline');
  const days = data?.pnl || [];
  if (!days.length) {
    panel.innerHTML = '<div class="empty">No P&L history yet — data populates after first trading day</div>';
    return;
  }
  // Sort ascending by date
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const vals = sorted.map(d => d.daily_pnl);
  const maxAbs = Math.max(...vals.map(Math.abs), 1);
  const barH = 36; // max bar height in px
  panel.innerHTML = sorted.map((d, i) => {
    const v = d.daily_pnl;
    const h = Math.max(2, Math.abs(v) / maxAbs * barH);
    const color = v >= 0 ? 'var(--c-buy)' : 'var(--c-sell)';
    const pct = d.daily_pnl_pct != null ? fmtPct(d.daily_pnl_pct) : '';
    return \`<div title="\${d.date}: \${fmtUsd(v)} (\${pct})" style="display:flex;flex-direction:column;align-items:\${v>=0?'flex-end':'flex-end'};justify-content:flex-end;flex:1;min-width:0">
      <div style="width:100%;max-width:24px;height:\${h}px;background:\${color};border-radius:2px 2px 0 0;opacity:.8"></div>
      <div style="font-size:7px;color:var(--c-on-surface-2);text-align:center;white-space:nowrap;overflow:hidden">\${d.date.slice(5)}</div>
    </div>\`;
  }).join('');
}

// ─── Test Runner ─────────────────────────────────
async function runTest(path, targetId) {
  const el = $(targetId);
  el.style.display = 'block';
  el.textContent = 'Fetching ' + path + '...';
  try {
    const start = performance.now();
    const res = await fetch(BASE + path, {credentials:'include'});
    const ms = (performance.now() - start).toFixed(0);
    const data = await res.json();
    el.textContent = '[' + res.status + '] ' + ms + 'ms\\n' + JSON.stringify(data, null, 2).slice(0, 2000);
    el.style.color = res.ok ? 'var(--c-success)' : 'var(--c-error)';
  } catch (err) {
    el.textContent = 'ERROR: ' + err.message;
    el.style.color = 'var(--c-error)';
  }
}

// ═══════════════════════════════════════════════════════════
// WIN/LOSS TELEGRAM ALERT TABLE
// ═══════════════════════════════════════════════════════════

let allTgAlerts = [];
let currentWLFilter = 'ALL';
let wlSortKey = 'sent_at';
let wlSortDir = 'desc';
let wlSearchQuery = '';

const ENGINE_NAMES = {
  'smart-money': 'SMC', 'fibonacci': 'FIB', 'stock-screener': 'SCR',
  'multi-timeframe': 'MTF', 'pairs-trading': 'PAIR', 'regime': 'REG',
  'crypto-dex': 'DEX', 'commodity': 'CMD', 'momentum': 'MOM',
  'Smart Money': 'SMAR', 'Event Driven': 'EVEN', 'Options': 'OPTI',
  'Momentum': 'MOM', 'Stock Screener': 'SCR', 'Fibonacci': 'FIB',
};

function shortEngine(engineId) {
  if (!engineId) return '—';
  return engineId.split('+').map(e => ENGINE_NAMES[e] || e.slice(0,4).toUpperCase()).join('+');
}

function calcRR(a) {
  if (!a.entry_price || a.entry_price === 0 || !a.stop_loss || !a.take_profit_1) return null;
  const risk = Math.abs(a.entry_price - a.stop_loss);
  const reward = Math.abs(a.take_profit_1 - a.entry_price);
  return risk > 0 ? reward / risk : null;
}

function ageDays(sentAt) {
  return Math.floor((Date.now() - sentAt) / (24*60*60*1000));
}

function renderWinLossTable(data, stats) {
  allTgAlerts = Array.isArray(data) ? data : data?.alerts || [];
  // Stats
  if (stats) {
    $('wl-total').textContent = stats.total || '0';
    $('wl-wins').textContent = stats.wins || '0';
    $('wl-losses').textContent = stats.losses || '0';
    $('wl-winrate').textContent = stats.total > 0 ? fmt(stats.winRate * 100, 1) + '%' : '—';
    $('wl-winrate').className = 'val ' + (stats.winRate > 0.5 ? 'up' : stats.winRate < 0.4 ? 'down' : '');
    $('wl-pnl').textContent = fmtUsd(stats.totalPnl);
    $('wl-pnl').className = 'val ' + pnlClass(stats.totalPnl);
    $('wl-pf').textContent = stats.profitFactor === Infinity ? '∞' : fmt(stats.profitFactor, 2);
    $('wl-pf').className = 'val ' + (stats.profitFactor >= 1.5 ? 'up' : stats.profitFactor < 1 ? 'down' : '');
    // New stats
    $('wl-avgwin').textContent = stats.avgWinPnl ? fmtUsd(stats.avgWinPnl) : '—';
    $('wl-avgloss').textContent = stats.avgLossPnl ? '-' + fmtUsd(stats.avgLossPnl) : '—';
    $('wl-expect').textContent = stats.expectancy ? fmtUsd(stats.expectancy) : '—';
    $('wl-expect').className = 'val ' + pnlClass(stats.expectancy || 0);

    // Engine accuracy cards
    renderEngineAccuracy(stats.byEngine || []);
  }
  applyWLFilters();
}

function renderEngineAccuracy(engines) {
  const el = $('wl-engine-acc');
  if (!engines.length) { el.innerHTML = ''; return; }
  el.innerHTML = engines.map(e => {
    const wrPct = fmt(e.winRate * 100, 0);
    const barColor = e.winRate >= 0.6 ? 'var(--c-buy)' : e.winRate >= 0.4 ? 'var(--c-primary)' : 'var(--c-sell)';
    return \`<div class="engine-acc-card">
      <div class="eng-name">\${shortEngine(e.engine)}</div>
      <div class="eng-stats">
        <span>\${e.total} alerts</span>
        <span style="color:\${barColor}">\${wrPct}% WR</span>
        <span class="\${pnlClass(e.pnl)}">\${fmtUsd(e.pnl)}</span>
      </div>
      <div class="engine-acc-bar"><div class="engine-acc-fill" style="width:\${wrPct}%;background:\${barColor}"></div></div>
    </div>\`;
  }).join('');
}

function applyWLFilters() {
  let filtered = currentWLFilter === 'ALL' ? [...allTgAlerts] : allTgAlerts.filter(a => a.outcome === currentWLFilter);
  // Search
  wlSearchQuery = ($('wl-search')?.value || '').trim().toUpperCase();
  if (wlSearchQuery) {
    filtered = filtered.filter(a => a.symbol.toUpperCase().includes(wlSearchQuery) || (a.engine_id || '').toUpperCase().includes(wlSearchQuery));
  }
  // Sort
  filtered.sort((a, b) => {
    let va, vb;
    if (wlSortKey === 'age') { va = a.sent_at; vb = b.sent_at; }
    else if (wlSortKey === 'confidence') { va = a.confidence || 0; vb = b.confidence || 0; }
    else if (wlSortKey === 'outcome_pnl_pct') { va = a.outcome_pnl_pct || 0; vb = b.outcome_pnl_pct || 0; }
    else if (wlSortKey === 'symbol') { va = a.symbol; vb = b.symbol; }
    else if (wlSortKey === 'engine_id') { va = a.engine_id; vb = b.engine_id; }
    else { va = a.sent_at; vb = b.sent_at; }
    if (typeof va === 'string') return wlSortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return wlSortDir === 'asc' ? va - vb : vb - va;
  });
  renderWLRows(filtered);
}

function sortWLTable(th) {
  const key = th.dataset.sort;
  if (wlSortKey === key) { wlSortDir = wlSortDir === 'asc' ? 'desc' : 'asc'; }
  else { wlSortKey = key; wlSortDir = 'desc'; }
  document.querySelectorAll('#wl-table th.sortable').forEach(h => h.classList.remove('asc','desc'));
  th.classList.add(wlSortDir);
  applyWLFilters();
}

function filterWLAlerts(filter) {
  currentWLFilter = filter;
  document.querySelectorAll('.wl-filter-btn').forEach(b => b.classList.remove('active'));
  event.target.classList.add('active');
  applyWLFilters();
}

function renderWLRows(alerts) {
  const body = $('wl-body');
  if (!alerts.length) {
    body.innerHTML = '<tr><td colspan="12" class="empty">No alerts ' + (currentWLFilter !== 'ALL' ? 'with status ' + currentWLFilter : 'recorded yet') + '</td></tr>';
    return;
  }
  body.innerHTML = alerts.map(a => {
    const pnl = a.outcome_pnl;
    const pnlPct = a.outcome_pnl_pct;
    const pnlColor = pnl > 0 ? 'var(--c-buy)' : pnl < 0 ? 'var(--c-sell)' : 'var(--c-on-surface-2)';
    const actionColor = a.action === 'BUY' ? 'var(--c-buy)' : 'var(--c-sell)';
    const rr = calcRR(a);
    const rrClass = rr >= 2 ? 'rr-good' : rr >= 1 ? 'rr-ok' : 'rr-bad';
    const conf = a.confidence || 0;
    const confColor = conf >= 80 ? 'var(--c-buy)' : conf >= 65 ? 'var(--c-primary)' : conf >= 50 ? '#ffc107' : 'var(--c-sell)';
    const age = ageDays(a.sent_at);
    const ageClass = age <= 1 ? 'fresh' : age <= 4 ? 'aging' : 'old';
    const pnlDisplay = pnl != null ? fmtUsd(pnl) + (pnlPct != null ? ' <span style="opacity:.6;font-size:9px">(' + (pnlPct >= 0 ? '+' : '') + fmt(pnlPct,1) + '%)</span>' : '') : '—';
    return \`<tr class="wl-row" onclick="openAlertModal('\${a.id}')">
      <td class="mono" style="font-size:10px">\${ts(a.sent_at)}</td>
      <td class="mono" style="font-weight:600">\${a.symbol}</td>
      <td style="color:\${actionColor};font-weight:600">\${a.action}</td>
      <td class="mono" style="font-size:10px" title="\${a.engine_id}">\${shortEngine(a.engine_id)}</td>
      <td class="mono">\${a.entry_price > 0 ? fmtUsd(a.entry_price) : '<span style="color:var(--c-sell)">N/A</span>'}</td>
      <td class="mono">\${a.stop_loss ? fmtUsd(a.stop_loss) : '—'}</td>
      <td class="mono">\${a.take_profit_1 ? fmtUsd(a.take_profit_1) : '—'}</td>
      <td>\${rr != null ? '<span class="rr-pill ' + rrClass + '">' + fmt(rr,1) + ':1</span>' : '—'}</td>
      <td><div class="conf-bar"><div class="conf-fill" style="width:\${conf/2}px;background:\${confColor}"></div><span class="mono" style="font-size:10px">\${conf}</span></div></td>
      <td><span class="age-badge \${ageClass}">\${age}d</span></td>
      <td><span class="wl-outcome \${a.outcome}">\${a.outcome}</span></td>
      <td class="mono" style="color:\${pnlColor}">\${pnlDisplay}</td>
    </tr>\`;
  }).join('');
}

// ─── Alert Detail Modal ──────────────────────────
async function openAlertModal(id) {
  const modal = $('alert-modal');
  modal.classList.add('active');
  $('modal-body').innerHTML = '<div class="loading">Loading alert details...</div>';
  $('modal-title').textContent = 'Alert Detail';

  const alert = await safeFetch('/api/telegram-alert?id=' + encodeURIComponent(id));
  if (!alert) {
    $('modal-body').innerHTML = '<div class="empty">Could not load alert</div>';
    return;
  }

  const actionColor = alert.action === 'BUY' ? 'var(--c-buy)' : 'var(--c-sell)';
  const pnlColor = alert.outcome_pnl > 0 ? 'var(--c-buy)' : alert.outcome_pnl < 0 ? 'var(--c-sell)' : 'var(--c-on-surface-2)';
  const outcomeClass = alert.outcome || 'PENDING';

  $('modal-title').innerHTML = \`<span style="color:\${actionColor}">\${alert.action}</span> \${alert.symbol} <span class="wl-outcome \${outcomeClass}" style="margin-left:8px">\${alert.outcome}</span>\`;

  let metadata = {};
  try { metadata = JSON.parse(alert.metadata || '{}'); } catch {}

  const rr = calcRR(alert);
  const age = ageDays(alert.sent_at);
  const risk = alert.entry_price && alert.stop_loss ? Math.abs(alert.entry_price - alert.stop_loss) : null;
  const reward = alert.entry_price && alert.take_profit_1 ? Math.abs(alert.take_profit_1 - alert.entry_price) : null;

  // Structured metadata rendering
  const metaEngines = metadata.engines || [];
  const metaReasons = metadata.reasons || [];
  const metaSignals = metadata.signals || [];
  const hasStructuredMeta = metaEngines.length || metaReasons.length || metaSignals.length;

  $('modal-body').innerHTML = \`
    <div class="modal-section">
      <div class="modal-section-title">📋 Trade Setup</div>
      <div class="modal-kv">
        <span class="k">Symbol</span><span class="v" style="font-weight:700">\${alert.symbol}</span>
        <span class="k">Action</span><span class="v" style="color:\${actionColor}">\${alert.action}</span>
        <span class="k">Engine(s)</span><span class="v">\${shortEngine(alert.engine_id)} <span style="opacity:.5;font-size:9px">(\${alert.engine_id})</span></span>
        <span class="k">Entry Price</span><span class="v">\${alert.entry_price > 0 ? fmtUsd(alert.entry_price) : '<span style="color:var(--c-sell)">Missing</span>'}</span>
        <span class="k">Stop Loss</span><span class="v">\${alert.stop_loss ? fmtUsd(alert.stop_loss) + (risk ? ' <span style="opacity:.5;font-size:9px">(risk: ' + fmtUsd(risk) + ')</span>' : '') : '—'}</span>
        <span class="k">Take Profit 1</span><span class="v">\${alert.take_profit_1 ? fmtUsd(alert.take_profit_1) + (reward ? ' <span style="opacity:.5;font-size:9px">(reward: ' + fmtUsd(reward) + ')</span>' : '') : '—'}</span>
        <span class="k">Take Profit 2</span><span class="v">\${alert.take_profit_2 ? fmtUsd(alert.take_profit_2) : '—'}</span>
        <span class="k">Confidence</span><span class="v">\${alert.confidence}/100</span>
        <span class="k">Risk : Reward</span><span class="v">\${rr != null ? fmt(rr,2) + ':1' : '—'}</span>
        <span class="k">Regime</span><span class="v">\${alert.regime || '—'}</span>
        <span class="k">Age</span><span class="v">\${age} day\${age !== 1 ? 's' : ''}</span>
        <span class="k">Sent At</span><span class="v">\${ts(alert.sent_at)}</span>
      </div>
    </div>

    <div class="modal-section">
      <div class="modal-section-title">📊 Outcome</div>
      <div class="modal-kv">
        <span class="k">Status</span><span class="v"><span class="wl-outcome \${outcomeClass}">\${alert.outcome}</span></span>
        <span class="k">Outcome Price</span><span class="v">\${alert.outcome_price ? fmtUsd(alert.outcome_price) : '—'}</span>
        <span class="k">P&L</span><span class="v" style="color:\${pnlColor}">\${alert.outcome_pnl != null ? fmtUsd(alert.outcome_pnl) : '—'}</span>
        <span class="k">P&L %</span><span class="v" style="color:\${pnlColor}">\${alert.outcome_pnl_pct != null ? fmtPct(alert.outcome_pnl_pct) : '—'}</span>
        <span class="k">Resolved At</span><span class="v">\${alert.outcome_at ? ts(alert.outcome_at) : '—'}</span>
        <span class="k">Notes</span><span class="v" style="font-size:10px;text-align:left;grid-column:span 2">\${alert.outcome_notes || '—'}</span>
      </div>
    </div>

    \${alert.outcome === 'PENDING' ? \`
    <div class="modal-section">
      <div class="modal-section-title">✏️ Update Outcome</div>
      <div class="modal-outcome-form" id="outcome-form">
        <select id="outcome-select">
          <option value="WIN">✅ Win</option>
          <option value="LOSS">❌ Loss</option>
          <option value="BREAKEVEN">➖ Breakeven</option>
          <option value="EXPIRED">⏰ Expired</option>
        </select>
        <input type="number" id="outcome-price" placeholder="Exit Price" step="0.01" style="width:100px">
        <input type="number" id="outcome-pnl" placeholder="P&L ($)" step="0.01" style="width:90px">
        <input type="number" id="outcome-pnl-pct" placeholder="P&L %" step="0.01" style="width:80px">
        <input type="text" id="outcome-notes" placeholder="Notes..." style="width:140px">
        <button onclick="submitOutcome('\${alert.id}')">Save</button>
      </div>
    </div>
    \` : ''}

    \${hasStructuredMeta ? \`
    <div class="modal-section">
      <div class="modal-section-title">🧠 Signal Intelligence</div>
      \${metaEngines.length ? '<div style="margin-bottom:8px"><span style="font-size:10px;color:var(--c-on-surface-2);text-transform:uppercase;letter-spacing:.5px">Contributing Engines:</span><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">' + metaEngines.map(e => '<span style="padding:2px 8px;border-radius:10px;font-size:10px;background:var(--c-primary-ctr);color:var(--c-primary)">' + shortEngine(e) + '</span>').join('') + '</div></div>' : ''}
      \${metaReasons.length ? '<div style="margin-bottom:8px"><span style="font-size:10px;color:var(--c-on-surface-2);text-transform:uppercase;letter-spacing:.5px">Reasons:</span><ul style="margin:4px 0 0 16px;font-size:11px;color:var(--c-on-surface)">' + metaReasons.map(r => '<li>' + String(r).replace(/</g,'&lt;') + '</li>').join('') + '</ul></div>' : ''}
      \${metaSignals.length ? '<div><span style="font-size:10px;color:var(--c-on-surface-2);text-transform:uppercase;letter-spacing:.5px">Signals:</span><div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">' + metaSignals.map(s => '<span style="padding:2px 8px;border-radius:10px;font-size:10px;background:var(--c-surface-2);color:var(--c-on-surface)">' + String(s).replace(/</g,'&lt;') + '</span>').join('') + '</div></div>' : ''}
    </div>
    \` : (metadata && Object.keys(metadata).length > 0 ? \`
    <div class="modal-section">
      <div class="modal-section-title">🔍 Signal Metadata</div>
      <div style="font-family:'Roboto Mono',monospace;font-size:10px;background:var(--c-surface);border-radius:var(--radius-s);padding:10px;max-height:160px;overflow-y:auto;color:var(--c-on-surface-2)">\${JSON.stringify(metadata, null, 2)}</div>
    </div>
    \` : '')}

    <div class="modal-section">
      <div class="modal-section-title">📨 Original Telegram Message</div>
      <div class="modal-alert-text">\${(alert.alert_text || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
    </div>
  \`;
}

function closeAlertModal() {
  $('alert-modal').classList.remove('active');
}

async function submitOutcome(id) {
  const outcome = $('outcome-select').value;
  const outcomePrice = parseFloat($('outcome-price').value) || null;
  const outcomePnl = parseFloat($('outcome-pnl').value) || null;
  const outcomePnlPct = parseFloat($('outcome-pnl-pct').value) || null;
  const outcomeNotes = $('outcome-notes').value || null;

  try {
    const res = await fetch(BASE + '/api/telegram-alert-outcome', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      credentials: 'include',
      body: JSON.stringify({ id, outcome, outcomePrice, outcomePnl, outcomePnlPct, outcomeNotes })
    });
    if (res.ok) {
      closeAlertModal();
      loadDashboard();
    } else {
      alert('Failed to update: ' + (await res.text()));
    }
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

// Close modal with Escape key
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAlertModal(); });

// ═══════════════════════════════════════════════════════════
// P&L ANALYTICS DASHBOARD
// ═══════════════════════════════════════════════════════════

function switchPnlTab(tabId, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  $('tab-' + tabId).classList.add('active');
}

function renderPnlDashboard(data, simTrades) {
  if (!data) {
    $('pnl-cumulative').textContent = '—';
    return;
  }

  const { dailyPnl, monthlyPnl, equityCurve, drawdownSeries, tradesByEngine, tradesBySymbol, streaks } = data;
  const trades = Array.isArray(simTrades) ? simTrades : [];

  // ── LIVE P&L from actual trade data (not stale daily_pnl snapshot) ──
  const closedTrades = trades.filter(t => t.status === 'CLOSED');
  const openTrades = trades.filter(t => t.status === 'OPEN');
  const realizedPnl = closedTrades.reduce((s, t) => s + (t.pnl || 0), 0);
  const unrealizedPnl = openTrades.reduce((s, t) => s + (t.pnl || 0), 0);
  const totalPnl = realizedPnl + unrealizedPnl;

  $('pnl-cumulative').textContent = fmtUsd(totalPnl);
  $('pnl-cumulative').className = 'card-value ' + pnlClass(totalPnl);
  const portfolioValue = 100000 + totalPnl;
  $('pnl-cumulative-sub').textContent = 'Portfolio: ' + fmtUsd(portfolioValue);

  // Realized card
  $('pnl-realized').textContent = fmtUsd(realizedPnl);
  $('pnl-realized').className = 'card-value ' + pnlClass(realizedPnl);
  $('pnl-realized-sub').textContent = closedTrades.length + ' closed trade' + (closedTrades.length !== 1 ? 's' : '');

  // Unrealized card
  $('pnl-unrealized').textContent = fmtUsd(unrealizedPnl);
  $('pnl-unrealized').className = 'card-value ' + pnlClass(unrealizedPnl);
  $('pnl-unrealized-sub').textContent = openTrades.length + ' open position' + (openTrades.length !== 1 ? 's' : '');

  // Live Win Rate from closed trades
  const wins = closedTrades.filter(t => (t.pnl || 0) > 0);
  const losses = closedTrades.filter(t => (t.pnl || 0) < 0);
  if (closedTrades.length > 0) {
    const wr = (wins.length / closedTrades.length) * 100;
    $('pnl-winrate').textContent = fmt(wr, 0) + '%';
    $('pnl-winrate').className = 'card-value ' + (wr >= 50 ? 'up' : 'down');
    $('pnl-winrate-sub').textContent = wins.length + 'W / ' + losses.length + 'L';
  }

  // Max drawdown
  if (drawdownSeries.length > 0) {
    const maxDd = Math.min(...drawdownSeries.map(d => d.drawdown_pct));
    $('pnl-max-dd').textContent = fmt(maxDd, 2) + '%';
  }

  // Streaks
  if (streaks) {
    const s = streaks;
    if (s.currentStreak > 0 && s.currentType !== 'NONE') {
      $('pnl-streak').textContent = s.currentStreak + ' ' + s.currentType;
      $('pnl-streak').className = 'card-value ' + (s.currentType === 'WIN' ? 'up' : 'down');
    } else {
      $('pnl-streak').textContent = '—';
    }
    $('pnl-streak-sub').textContent = 'Best: ' + s.longestWin + 'W / Worst: ' + s.longestLoss + 'L';
  }

  // ── Equity Curve (Canvas) ──
  renderLineChart('equity-canvas', equityCurve.map(d => d.date), equityCurve.map(d => d.equity), 'var(--c-primary)', true);

  // ── Drawdown Chart (Canvas) ──
  renderLineChart('drawdown-canvas', drawdownSeries.map(d => d.date), drawdownSeries.map(d => d.drawdown_pct), 'var(--c-sell)', false);

  // ── Monthly Returns Heatmap ──
  const grid = $('pnl-monthly-grid');
  if (monthlyPnl.length > 0) {
    grid.innerHTML = monthlyPnl.map(m => {
      const intensity = Math.min(Math.abs(m.pnl_pct) / 10, 1);
      const bg = m.pnl >= 0
        ? \`rgba(63,185,80,\${0.1 + intensity * 0.4})\`
        : \`rgba(248,81,73,\${0.1 + intensity * 0.4})\`;
      const color = m.pnl >= 0 ? 'var(--c-buy)' : 'var(--c-sell)';
      return \`<div class="pnl-month-cell" style="background:\${bg};color:\${color}" title="\${m.month}: \${fmtUsd(m.pnl)} (\${fmtPct(m.pnl_pct)}) - \${m.trades} trades, \${fmt(m.win_rate*100,0)}% WR">
        <span class="month-label">\${m.month}</span>
        \${fmtPct(m.pnl_pct)}
      </div>\`;
    }).join('');
  } else {
    grid.innerHTML = '<div class="empty" style="grid-column:span 6">No monthly data yet</div>';
  }

  // ── Daily P&L Bars ──
  const bars = $('pnl-daily-bars');
  const recent60 = dailyPnl.slice(-60);
  if (recent60.length > 0) {
    const maxAbs = Math.max(...recent60.map(d => Math.abs(d.daily_pnl)), 1);
    const barH = 100;
    bars.innerHTML = recent60.map(d => {
      const v = d.daily_pnl;
      const h = Math.max(2, Math.abs(v) / maxAbs * barH);
      const color = v >= 0 ? 'var(--c-buy)' : 'var(--c-sell)';
      return \`<div class="pnl-bar" style="height:\${h}px;background:\${color}" title="\${d.date}: \${fmtUsd(v)} (\${fmtPct(d.daily_pnl_pct)})">
        <span class="bar-tip">\${d.date.slice(5)}: \${fmtUsd(v)}</span>
      </div>\`;
    }).join('');
  } else {
    bars.innerHTML = '<div class="empty" style="width:100%">No daily P&L data yet</div>';
  }

  // ── Breakdown Tables ──
  renderBreakdownTable('pnl-engine-body', tradesByEngine, 'engine_id');
  renderBreakdownTable('pnl-symbol-body', tradesBySymbol, 'symbol');
}

function renderBreakdownTable(bodyId, data, nameKey) {
  const body = $(bodyId);
  if (!data || !data.length) {
    body.innerHTML = '<tr><td colspan="4" class="empty">No data yet</td></tr>';
    return;
  }
  body.innerHTML = data.map(row => {
    const pnl = row.pnl || 0;
    const wr = row.win_rate != null ? fmt(row.win_rate * 100, 0) + '%' : '—';
    return \`<tr>
      <td class="mono" style="font-weight:500;font-size:11px">\${row[nameKey]}</td>
      <td class="mono">\${row.count}</td>
      <td class="mono" style="color:\${(row.win_rate||0) > 0.5 ? 'var(--c-buy)' : 'var(--c-sell)'}">\${wr}</td>
      <td class="mono" style="color:\${pnl >= 0 ? 'var(--c-buy)' : 'var(--c-sell)'}">\${fmtUsd(pnl)}</td>
    </tr>\`;
  }).join('');
}

// ── Simulated Trades Table ──
let _simTradesData = [];
let _simTradeFilter = 'all';

function renderSimTrades(data) {
  const trades = data || [];
  _simTradesData = trades;
  _renderSimTradesFiltered();
}

function filterSimTrades(filter, btn) {
  _simTradeFilter = filter;
  document.querySelectorAll('#sim-trade-filters .chip').forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');
  _renderSimTradesFiltered();
}

function _renderSimTradesFiltered() {
  const body = $('sim-trades-body');
  let trades = _simTradesData;
  if (_simTradeFilter !== 'all') {
    trades = trades.filter(t => t.status === _simTradeFilter);
  }
  if (!trades.length) {
    body.innerHTML = '<tr><td colspan="13" class="empty">No simulated trades yet</td></tr>';
    return;
  }
  const now = Date.now();
  body.innerHTML = trades.map(t => {
    const pnl = t.pnl ?? 0;
    const pnlPct = t.pnl_pct ?? 0;
    const isBuy = t.side === 'BUY';
    const isOpen = t.status === 'OPEN';

    // For open trades, show unrealized P&L (server enriches with live prices)
    let displayPnl = '—';
    let displayPnlPct = '—';
    let pnlColor = 'var(--c-on-surface-2)';

    if (t.pnl != null) {
      displayPnl = fmtUsd(t.pnl);
      displayPnlPct = fmtPct(t.pnl_pct);
      pnlColor = t.pnl >= 0 ? 'var(--c-buy)' : 'var(--c-sell)';
    }

    // Status badge
    let statusBadge;
    if (isOpen && t.pnl != null && t.pnl >= 0) {
      statusBadge = '<span style="color:var(--c-buy)">🟢 IN PROFIT</span>';
    } else if (isOpen && t.pnl != null && t.pnl < 0) {
      statusBadge = '<span style="color:var(--c-sell)">🔴 IN LOSS</span>';
    } else if (isOpen) {
      statusBadge = '<span style="color:var(--c-buy)">🟢 OPEN</span>';
    } else if (t.status === 'CLOSED' && pnl >= 0) {
      statusBadge = '<span style="color:var(--c-buy)">✅ WIN</span>';
    } else if (t.status === 'CLOSED' && pnl < 0) {
      statusBadge = '<span style="color:var(--c-sell)">❌ LOSS</span>';
    } else {
      statusBadge = '<span>⚪ ' + t.status + '</span>';
    }

    // Age
    const ageMs = (t.closed_at || now) - t.opened_at;
    const ageDays = Math.floor(ageMs / (24*60*60*1000));
    const ageHrs = Math.floor((ageMs % (24*60*60*1000)) / (60*60*1000));
    const ageLabel = ageDays > 0 ? ageDays + 'd ' + ageHrs + 'h' : ageHrs + 'h';

    // Side color
    const sideColor = isBuy ? 'var(--c-buy)' : 'var(--c-sell)';

    return \`<tr>
      <td class="mono" style="font-size:11px;white-space:nowrap">\${new Date(t.opened_at).toLocaleDateString()} \${new Date(t.opened_at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</td>
      <td class="mono" style="font-weight:600">\${t.symbol}</td>
      <td style="color:\${sideColor};font-weight:600">\${t.side}</td>
      <td class="mono" style="font-size:10px" title="\${t.engine_id}">\${shortEngine(t.engine_id)}</td>
      <td class="mono">\${t.qty}</td>
      <td class="mono">\${fmtUsd(t.entry_price)}</td>
      <td class="mono" style="color:var(--c-sell)">\${t.stop_loss ? fmtUsd(t.stop_loss) : '—'}</td>
      <td class="mono" style="color:var(--c-buy)">\${t.take_profit ? fmtUsd(t.take_profit) : '—'}</td>
      <td class="mono">\${t.exit_price ? fmtUsd(t.exit_price) : (isOpen && t.current_price ? '<i style="color:var(--c-on-surface-2)">' + fmtUsd(t.current_price) + '</i>' : '—')}</td>
      <td class="mono" style="color:\${pnlColor};font-weight:500">\${displayPnl}</td>
      <td class="mono" style="color:\${pnlColor}">\${displayPnlPct}</td>
      <td style="font-size:11px">\${statusBadge}</td>
      <td class="mono" style="font-size:11px">\${ageLabel}</td>
    </tr>\`;
  }).join('');

  // ── Summary row ──
  const totalPnl = trades.reduce((s, t) => s + (t.pnl || 0), 0);
  const openCount = trades.filter(t => t.status === 'OPEN').length;
  const closedCount = trades.filter(t => t.status === 'CLOSED').length;
  const winsCount = trades.filter(t => t.status === 'CLOSED' && (t.pnl || 0) > 0).length;
  const lossCount = trades.filter(t => t.status === 'CLOSED' && (t.pnl || 0) < 0).length;
  const summaryColor = totalPnl >= 0 ? 'var(--c-buy)' : 'var(--c-sell)';
  body.innerHTML += \`<tr style="border-top:2px solid rgba(255,255,255,.15);background:rgba(255,255,255,.03);font-weight:600">
    <td colspan="5" style="text-align:right;font-size:11px;padding-right:8px">PORTFOLIO TOTAL — \${trades.length} trades (\${openCount} open, \${winsCount}W / \${lossCount}L)</td>
    <td colspan="4"></td>
    <td class="mono" style="color:\${summaryColor}">\${fmtUsd(totalPnl)}</td>
    <td colspan="3" class="mono" style="color:\${summaryColor}">\${totalPnl >= 0 ? '+' : ''}\${fmt(totalPnl / 1000, 2)}K</td>
  </tr>\`;
}

// ── Canvas Line Chart (lightweight, no external libs) ──
function renderLineChart(canvasId, labels, values, color, fillBelow) {
  const canvas = $(canvasId);
  if (!canvas || !values.length) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;
  const pad = { top: 10, right: 10, bottom: 24, left: 60 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;

  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = maxV - minV || 1;

  ctx.clearRect(0, 0, W, H);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (cH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    const val = maxV - (range / 4) * i;
    ctx.fillStyle = 'rgba(255,255,255,.3)';
    ctx.font = '9px Roboto Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(val >= 1000 ? (val/1000).toFixed(1) + 'k' : val.toFixed(val < 10 ? 2 : 0), pad.left - 6, y + 3);
  }

  // X-axis labels (every nth)
  const step = Math.max(1, Math.floor(labels.length / 8));
  ctx.fillStyle = 'rgba(255,255,255,.3)';
  ctx.font = '8px Roboto Mono, monospace';
  ctx.textAlign = 'center';
  for (let i = 0; i < labels.length; i += step) {
    const x = pad.left + (i / (labels.length - 1)) * cW;
    ctx.fillText(labels[i].slice(5), x, H - 4);
  }

  // Line path
  ctx.beginPath();
  const resolvedColor = (color.startsWith('var(')
    ? getComputedStyle(document.documentElement).getPropertyValue(color.slice(4, -1).trim()).trim()
    : color) || '#80CBC4';
  for (let i = 0; i < values.length; i++) {
    const x = pad.left + (i / (values.length - 1)) * cW;
    const y = pad.top + cH - ((values[i] - minV) / range) * cH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = resolvedColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Fill below
  if (fillBelow && values.length > 1) {
    const lastX = pad.left + cW;
    ctx.lineTo(lastX, pad.top + cH);
    ctx.lineTo(pad.left, pad.top + cH);
    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + cH);
    gradient.addColorStop(0, resolvedColor + '33');
    gradient.addColorStop(1, resolvedColor + '05');
    ctx.fillStyle = gradient;
    ctx.fill();
  }
}

// ─── Auto-refresh ────────────────────────────────
function tick() {
  countdown--;
  $('refresh-bar').style.width = ((countdown / REFRESH) * 100) + '%';
  if (countdown <= 0) { countdown = REFRESH; loadDashboard(); }
}

loadDashboard();
setInterval(tick, 1000);
</script>
</body>
</html>`;
}

function renderLoginPage(baseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>YMSA — Sign In</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📊</text></svg>">
<link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<script src="https://accounts.google.com/gsi/client" async defer><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Google Sans',sans-serif;background:#0D1117;color:#E6EDF3;min-height:100vh;display:flex;align-items:center;justify-content:center}
.login-box{background:#161B22;border:1px solid #30363D;border-radius:16px;padding:48px;max-width:420px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.5)}
.login-box h1{font-size:28px;font-weight:700;color:#80CBC4;margin-bottom:8px}
.login-box p{color:#8B949E;font-size:14px;margin-bottom:32px;line-height:1.5}
.login-box .logo{font-size:64px;margin-bottom:16px}
#error-msg{color:#EF5350;font-size:13px;margin-top:16px;display:none}
#loading-msg{color:#80CBC4;font-size:13px;margin-top:16px;display:none}
.g-signin{display:flex;justify-content:center;margin-top:8px}
</style>
</head>
<body>
<div class="login-box">
  <div class="logo">📊</div>
  <h1>YMSA Trading System</h1>
  <p>6-Engine Trading Intelligence<br>Sign in with your authorized Google account</p>
  <div class="g-signin">
    <div id="g_id_onload"
      data-client_id="121161777538-sm5bar8ufps6jtvll243rk29c9ppvrc0.apps.googleusercontent.com"
      data-callback="handleCredentialResponse"
      data-auto_prompt="false">
    </div>
    <div class="g_id_signin"
      data-type="standard"
      data-shape="pill"
      data-theme="filled_black"
      data-text="signin_with"
      data-size="large"
      data-logo_alignment="left">
    </div>
  </div>
  <div id="error-msg"></div>
  <div id="loading-msg">Verifying...</div>
</div>
<script>
const BASE = '${baseUrl}';
async function handleCredentialResponse(response) {
  document.getElementById('loading-msg').style.display = 'block';
  document.getElementById('error-msg').style.display = 'none';
  try {
    const res = await fetch(BASE + '/auth/google', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ idToken: response.credential }),
      credentials: 'include',
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      window.location.reload();
    } else {
      document.getElementById('loading-msg').style.display = 'none';
      const e = document.getElementById('error-msg');
      e.textContent = data.error || 'Access denied';
      e.style.display = 'block';
    }
  } catch (err) {
    document.getElementById('loading-msg').style.display = 'none';
    const e = document.getElementById('error-msg');
    e.textContent = 'Network error — try again';
    e.style.display = 'block';
  }
}
// Set client ID from meta or leave blank for API-key-only auth fallback
fetch(BASE + '/health').then(r=>r.json()).then(d=>{
  // Check if Google client ID is configured
}).catch(()=>{});
</script>
</body>
</html>`;
}
