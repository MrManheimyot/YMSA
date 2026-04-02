// ─── Paper Trading Simulator ─────────────────────────────────
// Converts telegram_alerts into simulated trades in the trades table.
// Checks open sim trades against live prices → closes on SL/TP hit.
// Records daily_pnl snapshots without requiring an Alpaca account.
// This lets the P&L Analytics Dashboard populate from recommendations alone.

import type { Env } from '../types';
import * as yahooFinance from '../api/yahoo-finance';
import {
  getPendingTelegramAlerts,
  getOpenTrades,
  getRecentTrades,
  getRecentDailyPnl,
  insertTrade,
  closeTrade,
  upsertDailyPnl,
  generateId,
  type TelegramAlertRecord,
} from '../db/queries';

// ─── Constants ───────────────────────────────────────────────

/** Starting equity for the simulated portfolio */
const SIM_STARTING_EQUITY = 100_000;

/** Prefix for simulated trade IDs so they're distinguishable */
const SIM_PREFIX = 'sim_';

// ─── Simulated Trade Creation ────────────────────────────────

/**
 * Convert all un-simulated PENDING telegram alerts into trades.
 * Checks broker_order_id to avoid duplicating already-simulated alerts.
 */
export async function createSimulatedTrades(env: Env): Promise<number> {
  if (!env.DB) return 0;

  const pending = await getPendingTelegramAlerts(env.DB);
  if (pending.length === 0) return 0;

  // Get existing trades to avoid duplicates — keyed by alert ID stored in broker_order_id
  const existingTrades = await getRecentTrades(env.DB, 500);
  const simulatedAlertIds = new Set(
    existingTrades
      .filter(t => t.broker_order_id?.startsWith('tga_'))
      .map(t => t.broker_order_id!)
  );

  let created = 0;
  for (const alert of pending) {
    // Skip if already simulated
    if (simulatedAlertIds.has(alert.id)) continue;

    // Skip alerts without entry price
    if (!alert.entry_price || alert.entry_price <= 0) continue;

    const tradeId = generateId(SIM_PREFIX);
    const qty = calculateSimQty(alert);

    await insertTrade(env.DB, {
      id: tradeId,
      engine_id: alert.engine_id,
      symbol: alert.symbol,
      side: alert.action,
      qty,
      entry_price: alert.entry_price,
      stop_loss: alert.stop_loss ?? 0,
      take_profit: alert.take_profit_1 ?? 0,
      status: 'OPEN',
      opened_at: alert.sent_at,
      broker_order_id: alert.id, // links back to the telegram_alert
    });

    created++;
  }

  if (created > 0) {
    console.log(`[Simulator] Created ${created} simulated trades from pending alerts`);
  }
  return created;
}

/**
 * Calculate simulated quantity based on a fixed-risk model.
 * Risk 2% of SIM_STARTING_EQUITY per trade, sized by distance to stop loss.
 */
function calculateSimQty(alert: TelegramAlertRecord): number {
  const riskAmount = SIM_STARTING_EQUITY * 0.02; // 2% risk = $2,000
  const entry = alert.entry_price;
  const sl = alert.stop_loss;

  if (sl && sl > 0 && entry > 0) {
    const riskPerShare = Math.abs(entry - sl);
    if (riskPerShare > 0) {
      const qty = Math.floor(riskAmount / riskPerShare);
      return Math.max(1, Math.min(qty, 1000)); // clamp 1–1000
    }
  }

  // Fallback: invest ~$10,000 per position
  return Math.max(1, Math.floor(10_000 / entry));
}

// ─── Simulated Trade Resolution ──────────────────────────────

/**
 * Check all open simulated trades against current market prices.
 * Close trades that hit SL or TP. Returns count of resolved trades.
 */
export async function resolveSimulatedTrades(env: Env): Promise<number> {
  if (!env.DB) return 0;

  const openTrades = await getOpenTrades(env.DB);
  // Only process simulated trades (broker_order_id starts with 'tga_')
  const simTrades = openTrades.filter(t => t.broker_order_id?.startsWith('tga_'));
  if (simTrades.length === 0) return 0;

  const symbols = [...new Set(simTrades.map(t => t.symbol))];
  const quotes = await yahooFinance.getMultipleQuotes(symbols);
  const priceMap = new Map(quotes.map(q => [q.symbol, q.price]));

  let resolved = 0;
  for (const trade of simTrades) {
    const currentPrice = priceMap.get(trade.symbol);
    if (!currentPrice) continue;

    const isBuy = trade.side === 'BUY';
    const entry = trade.entry_price;
    const sl = trade.stop_loss;
    const tp = trade.take_profit;

    // Check stop loss
    if (sl && sl > 0 && ((isBuy && currentPrice <= sl) || (!isBuy && currentPrice >= sl))) {
      const exitPrice = sl; // assume filled at SL
      const pnl = isBuy ? (exitPrice - entry) * trade.qty : (entry - exitPrice) * trade.qty;
      const pnlPct = entry > 0 ? ((exitPrice - entry) / entry) * 100 * (isBuy ? 1 : -1) : 0;
      await closeTrade(env.DB, trade.id, exitPrice, pnl, pnlPct);
      resolved++;
      continue;
    }

    // Check take profit
    if (tp && tp > 0 && ((isBuy && currentPrice >= tp) || (!isBuy && currentPrice <= tp))) {
      const exitPrice = tp; // assume filled at TP
      const pnl = isBuy ? (exitPrice - entry) * trade.qty : (entry - exitPrice) * trade.qty;
      const pnlPct = entry > 0 ? ((exitPrice - entry) / entry) * 100 * (isBuy ? 1 : -1) : 0;
      await closeTrade(env.DB, trade.id, exitPrice, pnl, pnlPct);
      resolved++;
      continue;
    }

    // Auto-close after 7 days at market price (avoid stale trades)
    const ageMs = Date.now() - trade.opened_at;
    if (ageMs > 7 * 24 * 60 * 60 * 1000) {
      const pnl = isBuy ? (currentPrice - entry) * trade.qty : (entry - currentPrice) * trade.qty;
      const pnlPct = entry > 0 ? ((currentPrice - entry) / entry) * 100 * (isBuy ? 1 : -1) : 0;
      await closeTrade(env.DB, trade.id, currentPrice, pnl, pnlPct);
      resolved++;
    }
  }

  if (resolved > 0) {
    console.log(`[Simulator] Resolved ${resolved} simulated trades`);
  }
  return resolved;
}

// ─── Simulated Daily P&L Recording ──────────────────────────

/**
 * Record a daily_pnl row from simulated trade data.
 * Computes equity from SIM_STARTING_EQUITY + cumulative realized P&L + unrealized P&L.
 * Does NOT require Alpaca.
 */
export async function recordSimulatedDailyPnl(env: Env): Promise<void> {
  if (!env.DB) return;

  const today = new Date().toISOString().split('T')[0];

  // All trades ever
  const allTrades = await getRecentTrades(env.DB, 10_000);
  const closedTrades = allTrades.filter(t => t.status === 'CLOSED');
  const openTrades = allTrades.filter(t => t.status === 'OPEN');

  // Cumulative realized P&L
  const realizedPnl = closedTrades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

  // Unrealized P&L from open positions
  const openSymbols = [...new Set(openTrades.map(t => t.symbol))];
  let unrealizedPnl = 0;
  if (openSymbols.length > 0) {
    const quotes = await yahooFinance.getMultipleQuotes(openSymbols);
    const priceMap = new Map(quotes.map(q => [q.symbol, q.price]));
    for (const trade of openTrades) {
      const price = priceMap.get(trade.symbol);
      if (!price) continue;
      const isBuy = trade.side === 'BUY';
      unrealizedPnl += isBuy
        ? (price - trade.entry_price) * trade.qty
        : (trade.entry_price - price) * trade.qty;
    }
  }

  const totalEquity = SIM_STARTING_EQUITY + realizedPnl + unrealizedPnl;

  // Yesterday's equity for daily change
  const recentPnl = await getRecentDailyPnl(env.DB, 1);
  const yesterdayEquity = recentPnl.length > 0 ? recentPnl[0].total_equity : SIM_STARTING_EQUITY;
  const dailyPnl = totalEquity - yesterdayEquity;
  const dailyPnlPct = yesterdayEquity > 0 ? (dailyPnl / yesterdayEquity) * 100 : 0;

  // Trades opened/closed today
  const todayStart = new Date(today).getTime();
  const todayTrades = allTrades.filter(t => t.opened_at >= todayStart);
  const closedToday = closedTrades.filter(t => t.closed_at && t.closed_at >= todayStart);
  const winsToday = closedToday.filter(t => (t.pnl ?? 0) > 0).length;
  const winRate = closedToday.length > 0 ? winsToday / closedToday.length : 0;

  // Sharpe from recent daily returns
  const recent30 = await getRecentDailyPnl(env.DB, 30);
  const returns = recent30.map(d => d.daily_pnl_pct / 100);
  const sharpe = calculateSharpe(returns);
  const maxDD = calculateMaxDrawdown([...recent30.map(d => d.total_equity), totalEquity]);

  await upsertDailyPnl(env.DB, {
    date: today,
    total_equity: totalEquity,
    daily_pnl: dailyPnl,
    daily_pnl_pct: dailyPnlPct,
    open_positions: openTrades.length,
    trades_today: todayTrades.length,
    win_rate: winRate,
    sharpe_snapshot: sharpe,
    max_drawdown: maxDD,
  });

  console.log(`[Simulator] Daily P&L recorded: equity=$${totalEquity.toFixed(2)}, daily=$${dailyPnl.toFixed(2)} (${dailyPnlPct.toFixed(2)}%)`);
}

// ─── Full Simulation Cycle ──────────────────────────────────

/**
 * Run the complete simulation cycle:
 * 1. Create trades from new alerts
 * 2. Resolve open trades against live prices
 * 3. Record daily P&L snapshot
 */
export async function runSimulationCycle(env: Env): Promise<{
  created: number;
  resolved: number;
}> {
  const created = await createSimulatedTrades(env);
  const resolved = await resolveSimulatedTrades(env);
  await recordSimulatedDailyPnl(env);
  return { created, resolved };
}

// ─── Utility Functions ──────────────────────────────────────

function calculateSharpe(dailyReturns: number[]): number {
  if (dailyReturns.length < 2) return 0;
  const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (dailyReturns.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(252); // annualized
}

function calculateMaxDrawdown(equitySeries: number[]): number {
  if (equitySeries.length < 2) return 0;
  let peak = equitySeries[0];
  let maxDD = 0;
  for (const equity of equitySeries) {
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((equity - peak) / peak) * 100 : 0;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD;
}
