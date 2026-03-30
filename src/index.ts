// ─── YMSA Financial Automation — Main Entry Point ─────────────
// Cloudflare Worker: 5-agent signal system → Telegram
// Signal-only: no execution, manual trading

import type { Env } from './types';
import { handleCronEvent } from './cron-handler';
import { sendTelegramMessage } from './alert-router';
import * as yahooFinance from './api/yahoo-finance';
import * as taapi from './api/taapi';
import * as coingecko from './api/coingecko';
import * as dexscreener from './api/dexscreener';
import * as polymarket from './api/polymarket';
import * as fred from './api/fred';
import { calculateFibonacci, formatFibonacciAlert } from './analysis/fibonacci';
import { detectSignals, calculateSignalScore } from './analysis/signals';
import { renderDashboard, getSystemStatus } from './dashboard';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // ─── Health Check ──────────────────────────────
      if (path === '/' || path === '/health') {
        return jsonResponse({
          status: 'ok',
          service: 'YMSA Multi-Agent Trading System',
          version: '2.0.0',
          agents: ['stocks-technical', 'stat-arb', 'crypto', 'polymarket', 'commodities'],
          mode: 'signals-only (manual trading)',
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
        const results = [];
        for (const symbol of watchlist) {
          const quote = await yahooFinance.getQuote(symbol);
          if (!quote) continue;
          const indicators = await taapi.getBulkIndicators(symbol, env);
          const signals = detectSignals(quote, indicators, null, env);
          const score = calculateSignalScore(signals);
          results.push({ symbol, price: quote.price, changePercent: quote.changePercent, signalCount: signals.length, score, topSignals: signals.slice(0, 3).map((s) => s.title) });
        }
        results.sort((a, b) => b.score - a.score);
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
          quick: '*/15 14-21 * * 1-5',
          hourly: '0 15-21 * * 1-5',
          evening: '0 15 * * 1-5',
          afterhours: '0 18 * * 1-5',
          weekly: '0 7 * * 0',
        };

        if (!job || !validJobs[job]) {
          return jsonResponse({ error: 'Missing or invalid ?job= parameter', validJobs: Object.keys(validJobs) }, 400);
        }

        ctx.waitUntil(handleCronEvent(validJobs[job], env));
        return jsonResponse({ status: `Triggered job: ${job}` });
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
          'GET /api/test-alert',
          'GET /api/trigger?job=morning|open|quick|hourly|evening|afterhours|weekly',
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
