// ─── YMSA Financial Automation — Main Entry Point ─────────────
// Cloudflare Worker: 6-engine trading system → Execution → Telegram
// v3.0: Signal generation + execution via Alpaca

import type { Env } from './types';
import { handleCronEvent } from './cron-handler';
import { sendTelegramMessage } from './alert-router';
import * as yahooFinance from './api/yahoo-finance';
import * as coingecko from './api/coingecko';
import * as dexscreener from './api/dexscreener';
import * as polymarket from './api/polymarket';
import * as fred from './api/fred';
import * as alpaca from './api/alpaca';
import { calculateFibonacci, formatFibonacciAlert } from './analysis/fibonacci';
import { detectSignals, calculateSignalScore } from './analysis/signals';
import { computeIndicators } from './analysis/indicators';
import { detectRegime } from './analysis/regime';
import { analyzeSmartMoney } from './analysis/smart-money';
import { formatSmartMoneyTradeAlert, setCurrentRegime } from './alert-formatter';
import { renderDashboard, getSystemStatus } from './dashboard';
import { getPortfolioSnapshot, getPerformanceMetrics } from './execution/portfolio';
import { runSimulationCycle } from './execution/simulator';
import { getOpenTrades, getRecentTrades, getOpenPositions, getRecentSignals, getRecentRiskEvents, getRecentNewsAlerts, getNewsAlertsByCategory, getRecentDailyPnl, getAllLatestEnginePerformance, getRecentTelegramAlerts, getTelegramAlertById, getTelegramAlertStats, updateTelegramAlertOutcome, getPnlDashboardData } from './db/queries';
import { fetchGoogleAlerts, storeNewsAlerts, getFeedConfig } from './api/google-alerts';
import { isAuthenticated, handleGoogleAuth, handleLogout, handleAuthMe } from './auth';
import { ensureEnv } from './utils/env-validator';
import { log } from './utils/logger';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Env validation (logged once per isolate)
    ensureEnv(env);

    // CORS headers
    const origin = request.headers.get('Origin') || '';
    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      'Access-Control-Allow-Credentials': 'true',
    };
    // Allow same-origin + localhost for dev
    const allowedOrigins = [url.origin, 'http://localhost:8787'];
    corsHeaders['Access-Control-Allow-Origin'] = allowedOrigins.includes(origin) ? origin : url.origin;

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      // ─── Health Check (public) ─────────────────────
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
          ai: !!(env as any).AI ? 'Z.AI enabled' : 'Z.AI unavailable',
        }, 200, corsHeaders);
      }

      // ─── Auth Routes (public) ──────────────────────
      if (path === '/auth/google' && request.method === 'POST') {
        const res = await handleGoogleAuth(request, env);
        return addHeaders(res, corsHeaders);
      }
      if (path === '/auth/logout' && request.method === 'POST') {
        return addHeaders(handleLogout(), corsHeaders);
      }
      if (path === '/auth/me') {
        const res = await handleAuthMe(request, env);
        return addHeaders(res, corsHeaders);
      }

      // ─── Auth Check — everything below requires auth ─────
      const auth = await isAuthenticated(request, env);
      if (!auth.ok) {
        // If requesting dashboard without auth, show login page
        if (path === '/dashboard') {
          const html = renderDashboard(url.origin, false);
          return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...corsHeaders },
          });
        }
        return jsonResponse({ error: 'Unauthorized — sign in at /dashboard or provide X-API-Key' }, 401, corsHeaders);
      }
      log.info('auth', `Authenticated: ${auth.email}`, { path });

      // ─── SRE Dashboard (authed) ─────────────────────
      if (path === '/dashboard') {
        const html = renderDashboard(url.origin, true);
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...corsHeaders },
        });
      }

      // ─── System Status (authed) ─────────────────────
      if (path === '/api/system-status') {
        const status = getSystemStatus(env);
        return jsonResponse(status, 200, corsHeaders);
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

        const [quote, ohlcv] = await Promise.all([
          yahooFinance.getQuote(sym),
          yahooFinance.getOHLCV(sym, '2y', '1d'),
        ]);

        if (!quote) return jsonResponse({ error: `No data for ${sym}` }, 404);

        const indicators = computeIndicators(sym, ohlcv);
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
        const scanOne = async (symbol: string) => {
          try {
            const [quote, ohlcv] = await Promise.all([
              yahooFinance.getQuote(symbol),
              yahooFinance.getOHLCV(symbol, '2y', '1d'),
            ]);
            if (!quote) return null;
            const indicators = computeIndicators(symbol, ohlcv);
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

      // ─── Send Live Trade Alert ─────────────────────
      if (path === '/api/send-trade-alert') {
        const symbols = (url.searchParams.get('symbols') || env.TIER1_WATCHLIST || env.DEFAULT_WATCHLIST).split(',').map(s => s.trim());
        const sentAlerts: { symbol: string; message: string }[] = [];

        // Set regime context first
        try {
          const regime = await detectRegime(env);
          setCurrentRegime(regime);
        } catch (e) { console.error('[TradeAlert] Regime error:', e); }

        for (const symbol of symbols.slice(0, 5)) {
          try {
            const ohlcv = await yahooFinance.getOHLCV(symbol, '3mo', '1d');
            if (ohlcv.length < 20) continue;

            const candles = ohlcv.map(c => ({ open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, timestamp: c.timestamp }));
            const quote = await yahooFinance.getQuote(symbol);
            if (!quote) continue;

            const smc = analyzeSmartMoney(symbol, candles, quote.price);
            if (smc.score < 40) continue; // skip weak signals

            const indicators = computeIndicators(symbol, ohlcv);
            const alertMsg = formatSmartMoneyTradeAlert(smc, quote, indicators);
            if (alertMsg) {
              await sendTelegramMessage(alertMsg, env);
              sentAlerts.push({ symbol, message: alertMsg });
            }
          } catch (err) {
            console.error(`[TradeAlert] ${symbol} error:`, err);
          }
        }

        return jsonResponse({
          status: sentAlerts.length > 0 ? 'Alerts sent to Telegram' : 'No actionable signals found',
          count: sentAlerts.length,
          alerts: sentAlerts,
          timestamp: new Date().toISOString(),
        });
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

        await handleCronEvent(validJobs[job], env);
        return jsonResponse({ status: `Triggered job: ${job}`, completed: true });
      }

      // ─── Manual Simulation Trigger ─────────────────
      if (path === '/api/simulate') {
        const result = await runSimulationCycle(env);
        return jsonResponse({ status: 'Simulation cycle complete', ...result });
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

      // ─── Daily P&L History ─────────────────────────
      if (path === '/api/daily-pnl') {
        const days = parseInt(url.searchParams.get('days') || '14', 10);
        const pnl = await getRecentDailyPnl(env.DB!, days);
        return jsonResponse({ pnl, count: pnl.length });
      }

      // ─── Engine Performance Stats ──────────────────
      if (path === '/api/engine-stats') {
        const latest = await getAllLatestEnginePerformance(env.DB!);
        // Merge live signal counts + real-time win rates from trades table
        try {
          const todayStart = new Date(new Date().toISOString().split('T')[0]).getTime();
          const [sigRows, tradeRows] = await Promise.all([
            env.DB!.prepare(
              `SELECT engine_id, COUNT(*) as cnt FROM signals WHERE created_at >= ? GROUP BY engine_id`
            ).bind(todayStart).all(),
            env.DB!.prepare(
              `SELECT engine_id, COUNT(*) as total, SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins, SUM(COALESCE(pnl, 0)) as total_pnl FROM trades WHERE status = 'CLOSED' GROUP BY engine_id`
            ).all(),
          ]);
          const liveCounts: Record<string, number> = {};
          for (const r of (sigRows.results || []) as any[]) {
            liveCounts[r.engine_id] = r.cnt;
          }
          const liveTradeStats: Record<string, { wins: number; total: number; pnl: number }> = {};
          for (const r of (tradeRows.results || []) as any[]) {
            liveTradeStats[r.engine_id] = { wins: r.wins || 0, total: r.total || 0, pnl: r.total_pnl || 0 };
          }
          for (const eng of latest) {
            if (liveCounts[eng.engine_id] && liveCounts[eng.engine_id] > eng.signals_generated) {
              eng.signals_generated = liveCounts[eng.engine_id];
              eng.date = new Date().toISOString().split('T')[0];
            }
            // Override with real-time win rate and P&L from closed trades
            const ts = liveTradeStats[eng.engine_id];
            if (ts && ts.total > 0) {
              eng.win_rate = ts.wins / ts.total;
              eng.pnl = ts.pnl;
              eng.trades_executed = ts.total;
            }
          }
        } catch {}
        return jsonResponse({ engines: latest, count: latest.length });
      }

      // ─── Google Alerts News ────────────────────────
      if (path === '/api/news') {
        const category = url.searchParams.get('category');
        const limit = parseInt(url.searchParams.get('limit') || '30', 10);
        const fresh = url.searchParams.get('fresh') === 'true';

        // Optionally fetch live from RSS feeds
        if (fresh) {
          try {
            const liveNews = await fetchGoogleAlerts();
            if (liveNews.length > 0 && env.DB) {
              await storeNewsAlerts(liveNews, env.DB);
            }
          } catch {}
        }

        // Return from D1 (cached)
        if (env.DB) {
          const alerts = category
            ? await getNewsAlertsByCategory(env.DB, category, limit)
            : await getRecentNewsAlerts(env.DB, limit);
          return jsonResponse({ alerts, count: alerts.length, feeds: getFeedConfig().map(f => ({ id: f.id, name: f.name, engines: f.engines })) });
        }

        // No D1 — fetch live
        const liveNews = await fetchGoogleAlerts();
        return jsonResponse({ alerts: liveNews.slice(0, limit), count: liveNews.length, live: true });
      }

      // ═══════════════════════════════════════════════════
      // v3.1: TELEGRAM ALERT LOG + P&L DASHBOARD ROUTES
      // ═══════════════════════════════════════════════════

      // ─── Telegram Alert Log ────────────────────────
      if (path === '/api/telegram-alerts') {
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        const alerts = await getRecentTelegramAlerts(env.DB!, limit);
        return jsonResponse({ alerts, count: alerts.length }, 200, corsHeaders);
      }

      // ─── Telegram Alert Detail ─────────────────────
      if (path === '/api/telegram-alert') {
        const id = url.searchParams.get('id');
        if (!id) return jsonResponse({ error: 'Missing ?id= parameter' }, 400, corsHeaders);
        const alert = await getTelegramAlertById(env.DB!, id);
        if (!alert) return jsonResponse({ error: 'Alert not found' }, 404, corsHeaders);
        return jsonResponse(alert, 200, corsHeaders);
      }

      // ─── Telegram Alert Stats ──────────────────────
      if (path === '/api/telegram-alert-stats') {
        const stats = await getTelegramAlertStats(env.DB!);
        return jsonResponse(stats, 200, corsHeaders);
      }

      // ─── Update Telegram Alert Outcome ─────────────
      if (path === '/api/telegram-alert-outcome' && request.method === 'POST') {
        let body: { id: string; outcome: string; outcomePrice?: number; outcomePnl?: number; outcomePnlPct?: number; outcomeNotes?: string };
        try {
          body = await request.json();
        } catch {
          return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders);
        }
        if (!body.id || !body.outcome) return jsonResponse({ error: 'Missing id or outcome' }, 400, corsHeaders);
        const validOutcomes = ['WIN', 'LOSS', 'BREAKEVEN', 'EXPIRED'];
        if (!validOutcomes.includes(body.outcome)) return jsonResponse({ error: 'Invalid outcome. Must be WIN, LOSS, BREAKEVEN, or EXPIRED' }, 400, corsHeaders);
        await updateTelegramAlertOutcome(
          env.DB!, body.id,
          body.outcome as 'WIN' | 'LOSS' | 'BREAKEVEN' | 'EXPIRED',
          body.outcomePrice ?? null, body.outcomePnl ?? null,
          body.outcomePnlPct ?? null, body.outcomeNotes ?? null
        );
        return jsonResponse({ ok: true, id: body.id, outcome: body.outcome }, 200, corsHeaders);
      }

      // ─── P&L Dashboard Data ────────────────────────
      if (path === '/api/pnl-dashboard') {
        const data = await getPnlDashboardData(env.DB!);
        return jsonResponse(data, 200, corsHeaders);
      }

      // ─── Batch Dashboard Data (reduces API calls) ──
      if (path === '/api/dashboard-data') {
        const [tgAlerts, tgStats, pnlDash, rawTrades] = await Promise.all([
          getRecentTelegramAlerts(env.DB!, 100),
          getTelegramAlertStats(env.DB!),
          getPnlDashboardData(env.DB!),
          getRecentTrades(env.DB!, 200),
        ]);

        // Filter out CANCELLED trades — only show OPEN and CLOSED
        const activeTrades = rawTrades.filter(t => t.status !== 'CANCELLED');

        // Enrich open trades with live unrealized P&L
        const openTrades = activeTrades.filter(t => t.status === 'OPEN');
        const openSymbols = [...new Set(openTrades.map(t => t.symbol))];
        let priceMap = new Map<string, number>();
        if (openSymbols.length > 0) {
          try {
            const quotes = await yahooFinance.getMultipleQuotes(openSymbols);
            priceMap = new Map(quotes.map(q => [q.symbol, q.price]));
          } catch {}
        }
        const simTrades = activeTrades.map(t => {
          if (t.status !== 'OPEN') return t;
          const price = priceMap.get(t.symbol);
          if (!price) return t;
          const isBuy = t.side === 'BUY';
          const unrealizedPnl = isBuy ? (price - t.entry_price) * t.qty : (t.entry_price - price) * t.qty;
          const unrealizedPnlPct = t.entry_price > 0 ? ((price - t.entry_price) / t.entry_price) * 100 * (isBuy ? 1 : -1) : 0;
          return { ...t, pnl: unrealizedPnl, pnl_pct: unrealizedPnlPct, current_price: price };
        });

        return jsonResponse({ tgAlerts, tgStats, pnlDash, simTrades }, 200, corsHeaders);
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
          'GET /api/daily-pnl?days=14',
          'GET /api/engine-stats',
          'GET /api/news?category=&limit=30&fresh=true',
          'GET /api/test-alert',
          'GET /api/telegram-alerts?limit=50',
          'GET /api/telegram-alert?id=',
          'GET /api/telegram-alert-stats',
          'POST /api/telegram-alert-outcome',
          'GET /api/pnl-dashboard',
          'GET /api/dashboard-data',
          'GET /api/trigger?job=morning|open|opening_range|quick|pulse|hourly|midday|evening|overnight|weekly|retrain|monthly',
          'GET /api/simulate',
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

function jsonResponse(data: unknown, status: number = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...extra,
    },
  });
}

function addHeaders(res: Response, extra: Record<string, string>): Response {
  const newRes = new Response(res.body, res);
  for (const [k, v] of Object.entries(extra)) newRes.headers.set(k, v);
  return newRes;
}
