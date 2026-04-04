// ─── Trading & Execution Routes ──────────────────────────────

import type { Env } from '../types';
import * as yahooFinance from '../api/yahoo-finance';
import * as alpaca from '../api/alpaca';
import { sendTelegramMessage } from '../alert-router';
import { detectRegime } from '../analysis/regime';
import { analyzeSmartMoney } from '../analysis/smart-money';
import { computeIndicators } from '../analysis/indicators';
import { formatSmartMoneyTradeAlert, setCurrentRegime } from '../alert-formatter';
import { handleCronEvent } from '../cron-handler';
import { getPortfolioSnapshot, getPerformanceMetrics } from '../execution/portfolio';
import { runSimulationCycle } from '../execution/simulator';
import { getOpenTrades, getRecentTrades, getOpenPositions, getRecentSignals } from '../db/queries';
import { jsonResponse } from './helpers';

export async function handleTradingRoutes(
  path: string, url: URL, _request: Request, env: Env, _corsHeaders: Record<string, string>
): Promise<Response | null> {
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

  return null;
}
