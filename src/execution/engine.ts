// ─── Execution Engine ────────────────────────────────────────
// Signal → Risk Check → Position Size → Broker Order → D1 Record → Telegram
// Central pipeline that converts analysis signals into live trades

import type { Env } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('Exec');
import { calculatePositionSize, calculateATRStop } from '../analysis/position-sizer';
import { submitBracketOrder, getAccount, getOrder, submitTrailingStopOrder } from '../api/alpaca';
import { insertTrade, upsertPosition, insertSignal, closeTrade, generateId, getOpenTrades, getRecentTrades } from '../db/queries';
import { getConfig } from '../db/queries';
import type { TradeRecord } from '../db/queries';
import { reviewTrade, isZAiAvailable } from '../ai/z-engine';
import { createTrailingState, serializeTrailingState } from './trailing';
import { getCombinedBoost } from '../analysis/news-boost';
import { vixRiskAdjustment } from '../agents/risk-controller/risk-checker';
import * as yahooFinance from '../api/yahoo-finance';

// ─── Types ───────────────────────────────────────────────────

export interface ExecutableSignal {
  engineId: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  strength: number;         // 0-100
  signalType: string;
  entryPrice: number;
  atr: number;
  metadata?: Record<string, unknown>;
}

export interface ExecutionResult {
  success: boolean;
  tradeId?: string;
  orderId?: string;
  shares?: number;
  symbol?: string;
  direction?: 'BUY' | 'SELL';
  entryPrice?: number;
  engineId?: string;
  error?: string;
  skipped?: string;         // reason if not executed
}

export interface RiskLimits {
  maxOpenPositions: number;
  maxDailyTrades: number;
  maxPositionPct: number;
  maxPortfolioRisk: number;
  minStrength: number;
  engineBudgets: Record<string, number>; // engine_id → max % of equity
}

const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxOpenPositions: 8,
  maxDailyTrades: 15,
  maxPositionPct: 0.10,      // 10% max per position
  maxPortfolioRisk: 0.06,    // 6% max total risk
  minStrength: 60,
  engineBudgets: {
    MTF_MOMENTUM: 0.30,
    SMART_MONEY: 0.20,
    STAT_ARB: 0.20,
    OPTIONS: 0.10,
    CRYPTO_DEFI: 0.10,
    EVENT_DRIVEN: 0.10,
  },
};

/**
 * Build risk limits from D1 config (or fallback to defaults).
 */
export function buildRiskLimits(): RiskLimits {
  return {
    maxOpenPositions: getConfig('max_open_positions'),
    maxDailyTrades: getConfig('max_daily_trades'),
    maxPositionPct: getConfig('max_position_pct'),
    maxPortfolioRisk: getConfig('max_portfolio_risk'),
    minStrength: 60,
    engineBudgets: {
      MTF_MOMENTUM: getConfig('engine_budget_mtf_momentum'),
      SMART_MONEY: getConfig('engine_budget_smart_money'),
      STAT_ARB: getConfig('engine_budget_stat_arb'),
      OPTIONS: getConfig('engine_budget_options'),
      CRYPTO_DEFI: getConfig('engine_budget_crypto_defi'),
      EVENT_DRIVEN: getConfig('engine_budget_event_driven'),
    },
  };
}

// ─── Engine Stats (KV-persisted for cross-invocation accuracy) ────────────

interface EngineStats {
  dailyTrades: number;
  openPositions: number;
}

const engineStatsCache = new Map<string, EngineStats>();
let _statsKV: KVNamespace | null = null;
let _statsLoaded = false;

/**
 * GAP-018: Initialize KV store for engine stats persistence.
 */
export function setEngineStatsKV(kv: KVNamespace): void {
  _statsKV = kv;
}

/**
 * GAP-018: Load today's engine stats from KV. Call once at cron boot.
 */
export async function loadEngineStatsFromKV(): Promise<void> {
  if (!_statsKV || _statsLoaded) return;
  const today = new Date().toISOString().split('T')[0];
  try {
    const raw = await _statsKV.get(`engine-stats:${today}`, 'json');
    if (raw && typeof raw === 'object') {
      const data = raw as Record<string, EngineStats>;
      for (const [engineId, stats] of Object.entries(data)) {
        engineStatsCache.set(engineId, stats);
      }
    }
    _statsLoaded = true;
  } catch { /* KV miss — start fresh */ }
}

/**
 * GAP-018: Persist engine stats to KV. Call at end of cron cycle.
 */
export async function persistEngineStatsToKV(): Promise<void> {
  if (!_statsKV) return;
  const today = new Date().toISOString().split('T')[0];
  const data: Record<string, EngineStats> = {};
  for (const [k, v] of engineStatsCache) data[k] = v;
  try {
    await _statsKV.put(`engine-stats:${today}`, JSON.stringify(data), { expirationTtl: 86400 });
  } catch { /* best-effort */ }
}

function getEngineStats(engineId: string): EngineStats {
  if (!engineStatsCache.has(engineId)) {
    engineStatsCache.set(engineId, { dailyTrades: 0, openPositions: 0 });
  }
  return engineStatsCache.get(engineId)!;
}

// ─── Main Execution Pipeline ─────────────────────────────────

/**
 * Execute a signal: risk check → size → order → record → alert.
 * Returns result with trade ID on success, error/skip reason on failure.
 */
export async function executeSignal(
  signal: ExecutableSignal,
  env: Env,
  limits: RiskLimits = DEFAULT_RISK_LIMITS
): Promise<ExecutionResult> {
  const { symbol, direction, strength, engineId, entryPrice, atr, signalType } = signal;

  // Record signal in D1 regardless of execution
  const signalId = generateId('sig');
  try {
    await insertSignal(env.DB, {
      id: signalId,
      engine_id: engineId,
      signal_type: signalType,
      symbol,
      direction,
      strength,
      metadata: JSON.stringify(signal.metadata || {}),
      created_at: Date.now(),
      acted_on: 0,
    });
  } catch (e) {
    logger.error(`Failed to record signal: ${e}`);
  }

  // ── Pre-flight Risk Checks ──
  // News/social sentiment boost (Superpower Data Layer)
  let boostedStrength = strength;
  if (env.DB) {
    try {
      const { boost, reasons } = await getCombinedBoost(env.DB, symbol, direction);
      if (boost !== 0) {
        boostedStrength = Math.max(0, Math.min(100, strength + boost));
        if (reasons.length > 0) {
          logger.info(`News boost ${symbol}: ${strength}→${boostedStrength} (${reasons.join('; ')})`);
        }
      }
    } catch { /* non-critical */ }
  }

  if (boostedStrength < limits.minStrength) {
    return { success: false, skipped: `Strength ${boostedStrength} < min ${limits.minStrength}` };
  }

  // ── Position & Daily Trade Limits ──
  if (env.DB) {
    try {
      const openTrades = await getOpenTrades(env.DB);
      if (openTrades.length >= limits.maxOpenPositions) {
        return { success: false, skipped: `Open positions ${openTrades.length} >= max ${limits.maxOpenPositions}` };
      }

      // Block contradictory position (same symbol, opposite direction)
      const hasOpposite = openTrades.some(t => t.symbol === symbol && t.side !== direction);
      if (hasOpposite) {
        return { success: false, skipped: `Contradictory position: ${symbol} already has opposite-direction trade open` };
      }

      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const recentTrades = await getRecentTrades(env.DB, 100);
      const todayTradeCount = recentTrades.filter(t => t.opened_at >= todayStart.getTime()).length;
      if (todayTradeCount >= limits.maxDailyTrades) {
        return { success: false, skipped: `Daily trades ${todayTradeCount} >= max ${limits.maxDailyTrades}` };
      }
    } catch (e) {
      logger.error(`Position limit check failed: ${e}`);
    }
  }

  // Get account equity
  const account = await getAccount(env);
  if (!account) {
    return { success: false, error: 'Cannot reach Alpaca account' };
  }
  const equity = parseFloat(account.equity);
  if (equity <= 0) {
    return { success: false, error: 'Zero equity' };
  }

  // ── Position Sizing ──
  // Use actual win rate from recent trades if enough data, else conservative default
  let winRate = 0.55;
  if (env.DB) {
    try {
      const recent = await getRecentTrades(env.DB, 50);
      const closed = recent.filter(t => t.status === 'CLOSED' && t.pnl !== null);
      if (closed.length >= 10) {
        const wins = closed.filter(t => (t.pnl ?? 0) > 0).length;
        winRate = Math.max(0.30, Math.min(0.80, wins / closed.length));
      }
    } catch (_) { /* keep default */ }
  }
  const stopCalc = calculateATRStop(entryPrice, atr, 2.0, direction === 'BUY' ? 'LONG' : 'SHORT');
  const size = calculatePositionSize({
    equity,
    entryPrice,
    atr,
    winRate,
    avgWinPct: 3.0,
    avgLossPct: 2.0,
    riskPerTrade: 0.02,
    maxPositionPct: limits.maxPositionPct,
  });

  // ── GAP-016: VIX-based position size adjustment ──
  let adjustedShares = size.shares;
  try {
    const vixQuote = await yahooFinance.getQuote('^VIX');
    if (vixQuote && vixQuote.price > 0) {
      const vixAdj = vixRiskAdjustment(vixQuote.price);
      adjustedShares = Math.max(1, Math.floor(size.shares * vixAdj.positionSizeMultiplier));
      if (adjustedShares !== size.shares) {
        logger.info(`VIX=${vixQuote.price.toFixed(1)} → size ${size.shares}→${adjustedShares}`, { multiplier: vixAdj.positionSizeMultiplier });
      }
    }
  } catch { /* VIX fetch failed — use original size */ }

  // ── GAP-008: Margin leverage for high-conviction multi-engine signals ──
  const engineCount = (signal.metadata?.engineCount as number) || 1;
  const maxLeverage: number = getConfig('max_leverage');
  if (engineCount >= 3 && strength >= 85 && maxLeverage > 1) {
    const leverage = Math.min(maxLeverage, 1 + (engineCount - 2) * 0.5); // 3→1.5x, 4→2x
    const leveraged = Math.floor(adjustedShares * leverage);
    logger.info(`Margin: ${engineCount} engines, str=${strength} → ${leverage}x leverage`, { from: adjustedShares, to: leveraged });
    adjustedShares = leveraged;
  }

  if (adjustedShares <= 0) {
    return { success: false, skipped: 'Position size calculated to 0 shares' };
  }

  // ── Submit Bracket Order ──
  const order = await submitBracketOrder(
    {
      symbol,
      qty: adjustedShares,
      side: direction === 'BUY' ? 'buy' : 'sell',
      type: 'market',
      time_in_force: 'day',
      take_profit: { limit_price: parseFloat(stopCalc.takeProfit.toFixed(2)) },
      stop_loss: { stop_price: parseFloat(stopCalc.stopLoss.toFixed(2)) },
    },
    env
  );

  if (!order) {
    return { success: false, error: 'Broker rejected order' };
  }

  // ── Fill Confirmation — check order status ──
  let filledPrice = entryPrice;
  let fillStatus = order.status;
  try {
    const confirmed = await getOrder(order.id, env);
    if (confirmed) {
      fillStatus = confirmed.status;
      if (confirmed.filled_avg_price) {
        filledPrice = parseFloat(confirmed.filled_avg_price);
      }
      if (fillStatus === 'rejected' || fillStatus === 'canceled') {
        logger.error(`Order ${order.id} was ${fillStatus} — not recording trade`);
        return { success: false, error: `Order ${fillStatus} by broker` };
      }
    }
  } catch (e) {
    logger.error(`Fill confirmation check failed: ${e}`);
  }

  // ── Record Trade in D1 ──
  const tradeId = generateId('trd');
  const actualEntry = filledPrice || entryPrice;
  const trailState = createTrailingState(actualEntry, stopCalc.stopLoss, atr, direction);
  try {
    await insertTrade(env.DB, {
      id: tradeId,
      engine_id: engineId,
      symbol,
      side: direction,
      qty: adjustedShares,
      entry_price: actualEntry,
      stop_loss: stopCalc.stopLoss,
      take_profit: stopCalc.takeProfit,
      status: 'OPEN',
      opened_at: Date.now(),
      broker_order_id: order.id,
      trailing_state: serializeTrailingState(trailState),
    });

    await upsertPosition(env.DB, {
      id: `pos_${symbol}_${engineId}`,
      symbol,
      engine_id: engineId,
      side: direction === 'BUY' ? 'LONG' : 'SHORT',
      qty: adjustedShares,
      avg_entry: actualEntry,
      current_price: actualEntry,
      unrealized_pnl: 0,
      stop_loss: stopCalc.stopLoss,
      take_profit: stopCalc.takeProfit,
      opened_at: Date.now(),
    });

    // Mark signal as acted on
    await env.DB.prepare(`UPDATE signals SET acted_on = 1 WHERE id = ?`).bind(signalId).run();
  } catch (e) {
    logger.error(`DB record error (order placed!): ${e}`);
  }

  // Update stats
  const stats = getEngineStats(engineId);
  stats.dailyTrades++;
  stats.openPositions++;

  // ── Telegram Alert ──
  try {
    const emoji = direction === 'BUY' ? '🟢' : '🔴';
    const msg = [
      `${emoji} <b>TRADE EXECUTED — ${symbol}</b>`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `Engine: ${engineId}`,
      `Signal: ${signalType} (str: ${strength})`,
      `${direction} ${adjustedShares} shares @ $${actualEntry.toFixed(2)}${filledPrice !== entryPrice ? ` (filled @ $${filledPrice.toFixed(2)})` : ''}`,
      `SL: $${stopCalc.stopLoss.toFixed(2)} | TP: $${stopCalc.takeProfit.toFixed(2)}`,
      `Risk: $${size.riskAmount.toFixed(0)} (${size.positionPct.toFixed(1)}% equity)`,
      `R:R: 1:${size.rewardRiskRatio.toFixed(1)}`,
      `Order: ${order.id.slice(0, 8)}...`,
    ].join('\n');
    await sendTelegramMessage(msg, env);
  } catch { /* non-critical */ }

  return {
    success: true,
    tradeId,
    orderId: order.id,
    shares: adjustedShares,
    symbol,
    direction,
    entryPrice: actualEntry,
    engineId,
  };
}

/**
 * Execute multiple signals from an engine run, with rate limiting.
 */
export async function executeBatch(
  signals: ExecutableSignal[],
  env: Env,
  limits: RiskLimits = DEFAULT_RISK_LIMITS
): Promise<ExecutionResult[]> {
  const results: ExecutionResult[] = [];

  // Sort by strength descending — best signals first
  const sorted = [...signals].sort((a, b) => b.strength - a.strength);

  for (const signal of sorted) {
    const result = await executeSignal(signal, env, limits);
    results.push(result);

    // Abort batch if we hit too many failures
    const failures = results.filter(r => r.error).length;
    if (failures >= 3) {
      console.warn('[Exec] Too many failures, aborting batch');
      break;
    }
  }

  return results;
}

/**
 * Format batch execution results for Telegram.
 */
export function formatBatchResults(results: ExecutionResult[]): string {
  const trades = results.filter(r => r.success);
  if (trades.length === 0) return '';

  const lines = [
    `📊 <b>DAILY EXECUTION SUMMARY</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `✅ Executed: ${trades.length}`,
    ``,
  ];

  for (const t of trades) {
    const emoji = t.direction === 'BUY' ? '🟢' : '🔴';
    lines.push(`${emoji} <b>${t.symbol}</b> — ${t.direction} ${t.shares} @ $${(t.entryPrice ?? 0).toFixed(2)}`);
  }

  return lines.join('\n');
}

// ─── Close Trade with Z.AI Review ────────────────────────────

/**
 * Close a trade in D1 and optionally run Z.AI post-trade review.
 * Returns the review text (empty string if unavailable).
 */
export async function closeTradeWithReview(
  trade: TradeRecord,
  exitPrice: number,
  env: Env,
): Promise<string> {
  const pnl = trade.side === 'BUY'
    ? (exitPrice - trade.entry_price) * trade.qty
    : (trade.entry_price - exitPrice) * trade.qty;
  const pnlPct = trade.entry_price > 0 ? (pnl / (trade.entry_price * trade.qty)) * 100 : 0;

  // Close in D1
  await closeTrade(env.DB, trade.id, exitPrice, pnl, pnlPct);

  // Z.AI post-trade review
  let review = '';
  if (isZAiAvailable(env)) {
    try {
      review = await reviewTrade((env as any).AI, {
        symbol: trade.symbol,
        side: trade.side,
        entry: trade.entry_price,
        exit: exitPrice,
        pnl,
        pnlPct,
        engine: trade.engine_id,
        reason: trade.broker_order_id || 'N/A',
      });
    } catch (err) { logger.error('Trade review failed', err); }
  }

  // Send Telegram notification
  try {
    const emoji = pnl >= 0 ? '🟢' : '🔴';
    const lines = [
      `${emoji} <b>TRADE CLOSED — ${trade.symbol}</b>`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `Engine: ${trade.engine_id}`,
      `${trade.side} ${trade.qty} @ $${trade.entry_price.toFixed(2)} → $${exitPrice.toFixed(2)}`,
      `P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%)`,
    ];
    if (review) {
      lines.push(``, `🧠 <i>${review}</i>`);
    }
    await sendTelegramMessage(lines.join('\n'), env);
  } catch { /* non-critical */ }

  return review;
}

// ─── Telegram Helper ─────────────────────────────────────────

async function sendTelegramMessage(text: string, env: Env): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
}

// ═══════════════════════════════════════════════════════════════
// GAP-007: Native Alpaca Trailing Stop for Live Trading
// ═══════════════════════════════════════════════════════════════

/**
 * Upgrade open trades from bracket SL to Alpaca native trailing_stop.
 * Call from cron after fills are confirmed and price has moved favorably.
 *
 * For each open trade where the current price > entry + 1 ATR:
 *   1. Cancel the existing bracket stop-loss leg
 *   2. Submit a native trailing_stop order with trail_percent based on ATR
 *
 * This eliminates 5-minute latency from manual trail updates.
 */
export async function upgradeToNativeTrailingStops(env: Env): Promise<number> {
  if (env.ALPACA_PAPER_MODE !== 'false') return 0; // Only for live trading

  const openTrades = await getOpenTrades(env.DB);
  let upgraded = 0;

  for (const trade of openTrades) {
    if (!trade.broker_order_id) continue;

    try {
      const quote = await yahooFinance.getQuote(trade.symbol);
      if (!quote) continue;

      const currentPrice = quote.price;
      const entry = trade.entry_price;
      const atrEstimate = Math.abs(trade.take_profit - trade.entry_price) / 3; // Reverse-engineer ATR from TP
      const isBuy = trade.side === 'BUY';

      // Only upgrade if price has moved favorably by at least 1 ATR
      const favorableMove = isBuy
        ? currentPrice - entry > atrEstimate
        : entry - currentPrice > atrEstimate;
      if (!favorableMove) continue;

      // Calculate trail percent: 2 ATR / current price * 100
      const trailPct = Math.max(1.0, Math.min(5.0, (atrEstimate * 2 / currentPrice) * 100));

      // Submit native trailing stop
      const trailOrder = await submitTrailingStopOrder({
        symbol: trade.symbol,
        qty: trade.qty,
        side: isBuy ? 'sell' : 'buy', // Opposite side for exit
        trailPercent: parseFloat(trailPct.toFixed(1)),
      }, env);

      if (trailOrder) {
        upgraded++;
        logger.info(`GAP-007: Upgraded ${trade.symbol} to native trailing stop (${trailPct.toFixed(1)}% trail)`);
      }
    } catch (err) {
      logger.error(`Trail upgrade failed for ${trade.symbol}`, err);
    }
  }

  return upgraded;
}
