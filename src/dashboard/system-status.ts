// ─── System Status — getSystemStatus + SystemStatus interface ───

import type { Env } from '../types';

export interface SystemStatus {
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
    'TAAPI_API_KEY', 'FINNHUB_API_KEY',
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
    version: '3.7.1',
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
      { name: 'PREMARKET_SCAN', schedule: '0 12 * * 1-5', description: '14:00 IST — Universe discovery + candidate promotion' },
      { name: 'MARKET_OPEN', schedule: '30 14 * * 1-5', description: '16:30 IST — 6-engine full scan + execute' },
      { name: 'OPENING_RANGE', schedule: '45 14 * * 1-5', description: '16:45 IST — Opening range breakout' },
      { name: 'QUICK_SCAN', schedule: '*/15 14-21 * * 1-5', description: 'Every 15min — Pulse + smart money' },
      { name: 'PULSE_5MIN', schedule: '*/5 14-21 * * 1-5', description: 'Every 5min — Fast momentum scalps' },
      { name: 'HOURLY_SCAN', schedule: '0 15-21 * * 1-5', description: 'Hourly — Full technical + pairs' },
      { name: 'MIDDAY_REBALANCE', schedule: '0 18 * * 1-5', description: '20:00 IST — Portfolio rebalance' },
      { name: 'EVENING_SUMMARY', schedule: '0 15 * * 1-5', description: '17:00 IST — Daily P&L snapshot' },
      { name: 'DAILY_SUMMARY', schedule: '0 21 * * 1-5', description: '23:00 IST — Daily execution summary + holdings' },
      { name: 'OVERNIGHT_SCAN', schedule: '30 21 * * 1-5', description: '23:30 IST — After-hours + crypto' },
      { name: 'WEEKLY_REVIEW', schedule: '0 7 * * 0', description: 'Sunday 09:00 IST — Weekly review' },
      { name: 'ENGINE_RETRAIN', schedule: '0 3 * * 6', description: 'Saturday 05:00 IST — Weight calibration' },
      { name: 'MONTHLY_REPORT', schedule: '0 0 1 * *', description: '1st of month — Full performance report' },
    ],
    apis: {
      yahoo_finance: { name: 'Yahoo Finance', status: 'active', keyRequired: false },
      taapi: { name: 'TAAPI.io', status: secrets.TAAPI_API_KEY ? 'configured' : 'missing-key', keyRequired: true },
      finnhub: { name: 'Finnhub', status: secrets.FINNHUB_API_KEY ? 'configured' : 'missing-key', keyRequired: true },
      fred: { name: 'FRED', status: secrets.FRED_API_KEY ? 'configured' : 'missing-key', keyRequired: true },
      coingecko: { name: 'CoinGecko', status: 'active', keyRequired: false },
      dexscreener: { name: 'DexScreener', status: 'active', keyRequired: false },
      polymarket: { name: 'Polymarket', status: 'active', keyRequired: false },
      telegram: { name: 'Telegram Bot', status: secrets.TELEGRAM_BOT_TOKEN ? 'configured' : 'missing-key', keyRequired: true },
      alpaca: { name: 'Alpaca Broker', status: hasAlpaca ? 'configured' : 'missing-key', keyRequired: true },
      tradingview: { name: 'TradingView Scanner', status: 'active', keyRequired: false },
      cnbc: { name: 'CNBC Quotes', status: 'active', keyRequired: false },
      stocktwits: { name: 'StockTwits Sentiment', status: 'active', keyRequired: false },
      marketwatch: { name: 'MarketWatch OHLCV', status: 'active', keyRequired: false },
      sec_edgar: { name: 'SEC EDGAR', status: 'active', keyRequired: false },
      rss_aggregator: { name: 'RSS Aggregator (25+ feeds)', status: 'active', keyRequired: false },
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
      'GET /api/rss-feed?hours=24&limit=50',
      'GET /api/social-sentiment?limit=30',
      'GET /api/tv-snapshots',
      'GET /api/feed-health',
      'GET /api/candidates',
      'GET /api/universe',
      'GET /api/trigger?job=morning|open|quick|pulse|hourly|midday|evening|overnight|weekly|retrain|monthly|premarket',
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
