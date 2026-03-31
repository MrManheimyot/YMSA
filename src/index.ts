// ─── YMSA Financial Automation — Main Entry Point ─────────────
// Cloudflare Worker: 6-engine trading system → Execution → Telegram
// v3.0: Signal generation + execution via Alpaca

import type { Env, TechnicalIndicator } from './types';
import { handleCronEvent } from './cron-handler';
import { sendTelegramMessage } from './alert-router';
import * as yahooFinance from './api/yahoo-finance';
import * as taapi from './api/taapi';
import * as coingecko from './api/coingecko';
import * as dexscreener from './api/dexscreener';
import * as polymarket from './api/polymarket';
import * as fred from './api/fred';
import * as alpaca from './api/alpaca';
import { calculateFibonacci, formatFibonacciAlert } from './analysis/fibonacci';
import { detectSignals, calculateSignalScore } from './analysis/signals';
import { detectRegime } from './analysis/regime';
import { renderDashboard, getSystemStatus } from './dashboard';
import { getPortfolioSnapshot, getPerformanceMetrics } from './execution/portfolio';
import { getOpenTrades, getRecentTrades, getOpenPositions, getRecentSignals, getRecentRiskEvents } from './db/queries';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ─── Health Check ──────────────────────────────
      if (path === '/' || path === '/health') {
        return jsonResponse({
          status: 'ok',
          service: 'YMSA Multi-Engine Trading System',
          version: '3.0.0',
          engines: ['MTF_MOMENTUM', 'SMART_MONEY', 'STAT_ARB', 'OPTIONS', 'CRYPTO_DEFI', 'EVENT_DRIVEN'],
          mode: !(env as any).ALPACA_API_KEY ? 'SIGNALS ONLY' : env.ALPACA_PAPER_MODE === 'false' ? 'LIVE TRADING' : 'PAPER TRADING',
          timestamp: new Date().toISOString(),
          watchlist: env.DEFAULT_WATCHLIST.split(','),
          cryptoWatchlist: (env.CRYPTO_WATCHLIST || '').split(','),
        });
      }

      // ─── SRE Dashboard ─────────────────────────────
      if (path === '/dashboard') {
        const html = renderDashboard(url.origin);
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
        });
      }

      // ─── System Status (for dashboard) ─────────────
      if (path === '/api/system-status') {
        const status = getSystemStatus(env);
        return jsonResponse(status);
      }

      // ─── Auth Check — all /api/* routes require key ─────
      if (path.startsWith('/api/')) {
        const apiKey = request.headers.get('X-API-Key') || url.searchParams.get('key');
        if (env.YMSA_API_KEY && apiKey !== env.YMSA_API_KEY) {
          return jsonResponse({ error: 'Unauthorized — provide X-API-Key header or ?key= param' }, 401);
        }
      }

      // ─── Stock Quote (Yahoo Finance — FREE) ────────
      if (path === '/api/quote') {
        const symbol = url.searchParams.get('symbol');
        if (!symbol) return jsonResponse({ error: 'Missing ?symbol= parameter' }, 400);
        const quote = await yahooFinance.getQuote(symbol.toUpperCase());
        if (!quote) return jsonResponse({ error: `No data for ${symbol}` }, 404);
        return jsonResponse(quote);
      }

      // ─── Full Technical Analysis ───────────────────
      if (path === '/api/analysis') {
        const symbol = url.searchParams.get('symbol');
        if (!symbol) return jsonResponse({ error: 'Missing ?symbol= parameter' }, 400);
        const sym = symbol.toUpperCase();

        const [quote, indicators, ohlcv] = await Promise.all([
          yahooFinance.getQuote(sym),
          taapi.getBulkIndicators(sym, env),
          yahooFinance.getOHLCV(sym, '6mo', '1d'),
        ]);

        if (!quote) return jsonResponse({ error: `No data for ${sym}` }, 404);

        const fibonacci = ohlcv.length > 0 ? calculateFibonacci(sym, ohlcv, quote.price) : null;
        const signals = detectSignals(quote, indicators, fibonacci, env);
        const score = calculateSignalScore(signals);
        const w52 = await yahooFinance.getQuoteWith52WeekAnalysis(sym);

        return jsonResponse({
          symbol: sym, quote, indicators, fibonacci, signals, score,
          week52: w52 ? { position: w52.position52w, nearHigh: w52.nearHigh, nearLow: w52.nearLow } : null,
          timestamp: new Date().toISOString(),
        });
      }

      // ─── Fibonacci ─────────────────────────────────
      if (path === '/api/fibonacci') {
        const symbol = url.searchParams.get('symbol');
        if (!symbol) return jsonResponse({ error: 'Missing ?symbol= parameter' }, 400);
        const sym = symbol.toUpperCase();
        const [quote, ohlcv] = await Promise.all([
          yahooFinance.getQuote(sym),
          yahooFinance.getOHLCV(sym, '6mo', '1d'),
        ]);
        if (!quote || ohlcv.length === 0) return jsonResponse({ error: `Insufficient data for ${sym}` }, 404);
        const fibonacci = calculateFibonacci(sym, ohlcv, quote.price);
        return jsonResponse({ symbol: sym, currentPrice: quote.price, fibonacci, formatted: fibonacci ? formatFibonacciAlert(fibonacci) : null });
      }

      // ─── Watchlist Scan ────────────────────────────
      if (path === '/api/scan') {
        const watchlist = env.DEFAULT_WATCHLIST.split(',').map((s) => s.trim());
        const useTaapi = url.searchParams.get('indicators') !== 'false';
        const scanOne = async (symbol: string) => {
          try {
            const quote = await yahooFinance.getQuote(symbol);
            if (!quote) return null;
            let indicators: TechnicalIndicator[] = [];
            if (useTaapi) {
              try {
                const result = await Promise.race([
                  taapi.getBulkIndicators(symbol, env),
                  new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
                ]);
                if (result) indicators = result;
              } catch {}
            }
            const signals = detectSignals(quote, indicators, null, env);
            const score = calculateSignalScore(signals);
            return { symbol, price: quote.price, changePercent: quote.changePercent, signalCount: signals.length, score, topSignals: signals.slice(0, 3).map((s) => s.title) };
          } catch { return null; }
        };
        const settled = await Promise.all(watchlist.map(scanOne));
        const results = settled.filter(Boolean).sort((a, b) => b!.score - a!.score);
        return jsonResponse({ watchlist: results, timestamp: new Date().toISOString() });
      }

      // ─── Crypto Dashboard ──────────────────────────
      if (path === '/api/crypto') {
        const cryptoList = (env.CRYPTO_WATCHLIST || 'bitcoin,ethereum,solana').split(',');
        const [prices, global, trending] = await Promise.all([
          coingecko.getCryptoPrices(cryptoList),
          coingecko.getGlobalMarket(),
          coingecko.getTrendingCoins(),
        ]);
        const ethPairs = await dexscreener.searchPairs('WETH');
        const whaleSignals = dexscreener.detectWhaleActivity(ethPairs);
        return jsonResponse({ prices, global, trending: trending.slice(0, 5), whaleSignals: whaleSignals.slice(0, 5) });
      }

      // ─── Prediction Markets ────────────────────────
      if (path === '/api/polymarket') {
        const markets = await polymarket.getActiveMarkets(20);
        const valueBets = polymarket.findValueBets(markets, 10000, [0.15, 0.85]);
        return jsonResponse({ markets: markets.slice(0, 10), valueBets });
      }

      // ─── Commodities + Macro ───────────────────────
      if (path === '/api/commodities') {
        const [commodities, yieldCurve, macro] = await Promise.all([
          yahooFinance.getCommodityPrices(),
          fred.checkYieldCurve(env.FRED_API_KEY),
          fred.getMacroDashboard(env.FRED_API_KEY),
        ]);
        return jsonResponse({ commodities, yieldCurve, macro });
      }

      // ─── Market Indices ────────────────────────────
      if (path === '/api/indices') {
        const indices = await yahooFinance.getMarketIndices();
        return jsonResponse({ indices, timestamp: new Date().toISOString() });
      }

      // ─── Test Alert ────────────────────────────────
      if (path === '/api/test-alert') {
        await sendTelegramMessage(
          `✅ <b>YMSA v2.0 Test Alert</b>\n\n🤖 5-Agent System Operational!\n⏰ ${new Date().toISOString()}\n\nAgents: Stocks | Crypto | Polymarket | Commodities | Macro`,
          env
        );
        return jsonResponse({ status: 'Test alert sent to Telegram' });
      }

      // ─── Manual Trigger ────────────────────────────
      if (path === '/api/trigger') {
        const job = url.searchParams.get('job');
        const validJobs: Record<string, string> = {
          morning: '0 5 * * 1-5',
          open: '30 14 * * 1-5',
          opening_range: '45 14 * * 1-5',
          quick: '*/15 14-21 * * 1-5',
          pulse: '*/5 14-21 * * 1-5',
          hourly: '0 15-21 * * 1-5',
          midday: '0 18 * * 1-5',
          evening: '0 15 * * 1-5',
          overnight: '30 21 * * 1-5',
          weekly: '0 7 * * 0',
          retrain: '0 3 * * 6',
          monthly: '0 0 1 * *',
        };

        if (!job || !validJobs[job]) {
          return jsonResponse({ error: 'Missing or invalid ?job= parameter', validJobs: Object.keys(validJobs) }, 400);
        }

        ctx.waitUntil(handleCronEvent(validJobs[job], env));
        return jsonResponse({ status: `Triggered job: ${job}` });
      }

      // ═══════════════════════════════════════════════════
      // v3: EXECUTION & PORTFOLIO ROUTES
      // ═══════════════════════════════════════════════════

      // ─── Portfolio Snapshot ─────────────────────────
      if (path === '/api/portfolio') {
        const snapshot = await getPortfolioSnapshot(env);
        if (!snapshot) return jsonResponse({ error: 'Cannot connect to broker' }, 503);
        return jsonResponse(snapshot);
      }

      // ─── Performance Metrics ───────────────────────
      if (path === '/api/performance') {
        const metrics = await getPerformanceMetrics(env);
        return jsonResponse(metrics);
      }

      // ─── Alpaca Account ────────────────────────────
      if (path === '/api/account') {
        const account = await alpaca.getAccount(env);
        if (!account) return jsonResponse({ error: 'Cannot connect to Alpaca' }, 503);
        return jsonResponse(account);
      }

      // ─── Open Positions (broker) ───────────────────
      if (path === '/api/positions') {
        const positions = await alpaca.getPositions(env);
        return jsonResponse({ positions, count: positions.length });
      }

      // ─── Open Trades (D1) ──────────────────────────
      if (path === '/api/trades') {
        const limit = parseInt(url.searchParams.get('limit') || '20', 10);
        const open = url.searchParams.get('status') === 'open';
        const trades = open ? await getOpenTrades(env.DB!) : await getRecentTrades(env.DB!, limit);
        return jsonResponse({ trades, count: trades.length });
      }

      // ─── Open Positions (D1) ───────────────────────
      if (path === '/api/d1-positions') {
        const positions = await getOpenPositions(env.DB!);
        return jsonResponse({ positions, count: positions.length });
      }

      // ─── Recent Signals ────────────────────────────
      if (path === '/api/signals') {
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        const signals = await getRecentSignals(env.DB!, limit);
        return jsonResponse({ signals, count: signals.length });
      }

      // ─── Market Regime ─────────────────────────────
      if (path === '/api/regime') {
        const regime = await detectRegime(env);
        return jsonResponse(regime);
      }

      // ─── Risk Events ──────────────────────────────
      if (path === '/api/risk-events') {
        const events = await getRecentRiskEvents(env.DB!, 20);
        return jsonResponse({ events, count: events.length });
      }

      // ─── 404 ───────────────────────────────────────
      return jsonResponse({
        error: 'Not found',
        endpoints: [
          'GET /health',
          'GET /dashboard',
          'GET /api/system-status',
          'GET /api/quote?symbol=AAPL',
          'GET /api/analysis?symbol=AAPL',
          'GET /api/fibonacci?symbol=AAPL',
          'GET /api/scan',
          'GET /api/crypto',
          'GET /api/polymarket',
          'GET /api/commodities',
          'GET /api/indices',
          'GET /api/portfolio',
          'GET /api/performance',
          'GET /api/account',
          'GET /api/positions',
          'GET /api/trades?status=open&limit=20',
          'GET /api/d1-positions',
          'GET /api/signals?limit=50',
          'GET /api/regime',
          'GET /api/risk-events',
          'GET /api/test-alert',
          'GET /api/trigger?job=morning|open|opening_range|quick|pulse|hourly|midday|evening|overnight|weekly|retrain|monthly',
        ],
      }, 404);
    } catch (err) {
      console.error('[YMSA] Request error:', err);
      return jsonResponse({ error: 'Internal server error' }, 500);
    }
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(handleCronEvent(controller.cron, env));
  },
};

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    },
  });
}
