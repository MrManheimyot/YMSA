// ─── Telegram Alert & P&L Dashboard Routes ──────────────────

import type { Env } from '../types';
import * as yahooFinance from '../api/yahoo-finance';
import { getRecentTelegramAlerts, getTelegramAlertById, getTelegramAlertStats, updateTelegramAlertOutcome, getPnlDashboardData, getRecentTrades } from '../db/queries';
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

  return null;
}
