// ─── Telegram Alert & P&L Dashboard Routes ──────────────────

import type { Env } from '../types';import { createLogger } from '../utils/logger';
const logger = createLogger('Telegram');import * as yahooFinance from '../api/yahoo-finance';
import { getRecentTelegramAlerts, getTelegramAlertById, getTelegramAlertStats, updateTelegramAlertOutcome, getPnlDashboardData, getRecentTrades, insertTrade, closeTrade, generateId } from '../db/queries';
import { jsonResponse } from './helpers';

export async function handleTelegramRoutes(
  path: string, url: URL, request: Request, env: Env, corsHeaders: Record<string, string>
): Promise<Response | null> {
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
      } catch (err) {
        // Price enrichment is best-effort for dashboard display
        logger.warn('Live quote enrichment failed for open trades:', { error: err });
      }
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

  // ─── Manual Trade: Open (User took the trade) ──
  if (path === '/api/manual-trade-open' && request.method === 'POST') {
    try {
    let body: { alertId: string; qty: number; actualEntry?: number };
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders);
    }
    if (!body.alertId || !body.qty || body.qty <= 0) {
      return jsonResponse({ error: 'Missing alertId or qty (must be > 0)' }, 400, corsHeaders);
    }
    // Fetch the alert to get trade params
    const alert = await getTelegramAlertById(env.DB!, body.alertId);
    if (!alert) return jsonResponse({ error: 'Alert not found' }, 404, corsHeaders);
    if (alert.outcome !== 'PENDING') return jsonResponse({ error: 'Alert already resolved: ' + alert.outcome }, 400, corsHeaders);

    const entryPrice = body.actualEntry && body.actualEntry > 0 ? body.actualEntry : alert.entry_price;
    const tradeId = generateId('mt');

    await insertTrade(env.DB!, {
      id: tradeId,
      engine_id: 'MANUAL',
      symbol: alert.symbol,
      side: alert.action,
      qty: body.qty,
      entry_price: entryPrice,
      stop_loss: alert.stop_loss ?? 0,
      take_profit: alert.take_profit_1 ?? 0,
      status: 'OPEN',
      opened_at: Date.now(),
      broker_order_id: alert.id,
      trailing_state: JSON.stringify({
        alert_id: alert.id,
        take_profit_2: alert.take_profit_2,
        engine_id: alert.engine_id,
        confidence: alert.confidence,
      }),
    });

    logger.info('Manual trade opened', { tradeId, alertId: body.alertId, symbol: alert.symbol, qty: body.qty, entry: entryPrice });
    return jsonResponse({ ok: true, tradeId, symbol: alert.symbol, side: alert.action, qty: body.qty, entry: entryPrice }, 200, corsHeaders);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Manual trade open failed', { error: msg });
      return jsonResponse({ error: 'Internal error: ' + msg }, 500, corsHeaders);
    }
  }

  // ─── Manual Trade: Close (User exited) ─────────
  if (path === '/api/manual-trade-close' && request.method === 'POST') {
    try {
    let body: { tradeId: string; exitPrice: number; exitType?: string };
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400, corsHeaders);
    }
    if (!body.tradeId || !body.exitPrice || body.exitPrice <= 0) {
      return jsonResponse({ error: 'Missing tradeId or exitPrice' }, 400, corsHeaders);
    }

    // Find the trade
    const allTrades = await getRecentTrades(env.DB!, 500);
    const trade = allTrades.find(t => t.id === body.tradeId);
    if (!trade) return jsonResponse({ error: 'Trade not found' }, 404, corsHeaders);
    if (trade.status !== 'OPEN') return jsonResponse({ error: 'Trade already closed' }, 400, corsHeaders);

    const isBuy = trade.side === 'BUY';
    const pnl = isBuy
      ? (body.exitPrice - trade.entry_price) * trade.qty
      : (trade.entry_price - body.exitPrice) * trade.qty;
    const pnlPct = trade.entry_price > 0
      ? ((body.exitPrice - trade.entry_price) / trade.entry_price) * 100 * (isBuy ? 1 : -1)
      : 0;

    await closeTrade(env.DB!, body.tradeId, body.exitPrice, pnl, pnlPct);

    // Also update the linked alert outcome
    const alertId = trade.broker_order_id;
    if (alertId) {
      const outcome = pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : 'BREAKEVEN';
      await updateTelegramAlertOutcome(
        env.DB!, alertId,
        outcome as 'WIN' | 'LOSS' | 'BREAKEVEN',
        body.exitPrice, pnl, pnlPct,
        body.exitType ? `Manual exit: ${body.exitType}` : 'Manual close'
      );
    }

    logger.info('Manual trade closed', { tradeId: body.tradeId, exitPrice: body.exitPrice, pnl, exitType: body.exitType });
    return jsonResponse({ ok: true, tradeId: body.tradeId, exitPrice: body.exitPrice, pnl, pnlPct, outcome: pnl > 0 ? 'WIN' : pnl < 0 ? 'LOSS' : 'BREAKEVEN' }, 200, corsHeaders);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Manual trade close failed', { error: msg });
      return jsonResponse({ error: 'Internal error: ' + msg }, 500, corsHeaders);
    }
  }

  return null;
}
