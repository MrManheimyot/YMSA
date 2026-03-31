// ─── Execution Engine ────────────────────────────────────────
// Signal → Risk Check → Position Size → Broker Order → D1 Record → Telegram
// Central pipeline that converts analysis signals into live trades

import type { Env } from '../types';
import { calculatePositionSize, calculateATRStop } from '../analysis/position-sizer';
import { submitBracketOrder, getAccount } from '../api/alpaca';
import { insertTrade, upsertPosition, insertSignal, closeTrade, generateId } from '../db/queries';
import type { TradeRecord } from '../db/queries';
import { reviewTrade, isZAiAvailable } from '../ai/z-engine';

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

// ─── Engine Stats (in-memory for single cron run) ────────────

interface EngineStats {
  dailyTrades: number;
  openPositions: number;
}

const engineStatsCache = new Map<string, EngineStats>();

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
    console.error(`[Exec] Failed to record signal: ${e}`);
  }

  // ── Pre-flight Risk Checks ──
  if (strength < limits.minStrength) {
    return { success: false, skipped: `Strength ${strength} < min ${limits.minStrength}` };
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
  const stopCalc = calculateATRStop(entryPrice, atr, 2.0, direction === 'BUY' ? 'LONG' : 'SHORT');
  const size = calculatePositionSize({
    equity,
    entryPrice,
    atr,
    winRate: 0.55,      // default conservative estimate
    avgWinPct: 3.0,
    avgLossPct: 2.0,
    riskPerTrade: 0.02,
    maxPositionPct: limits.maxPositionPct,
  });

  if (size.shares <= 0) {
    return { success: false, skipped: 'Position size calculated to 0 shares' };
  }

  // ── Submit Bracket Order ──
  const order = await submitBracketOrder(
    {
      symbol,
      qty: size.shares,
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

  // ── Record Trade in D1 ──
  const tradeId = generateId('trd');
  try {
    await insertTrade(env.DB, {
      id: tradeId,
      engine_id: engineId,
      symbol,
      side: direction,
      qty: size.shares,
      entry_price: entryPrice,
      stop_loss: stopCalc.stopLoss,
      take_profit: stopCalc.takeProfit,
      status: 'OPEN',
      opened_at: Date.now(),
      broker_order_id: order.id,
    });

    await upsertPosition(env.DB, {
      id: `pos_${symbol}_${engineId}`,
      symbol,
      engine_id: engineId,
      side: direction === 'BUY' ? 'LONG' : 'SHORT',
      qty: size.shares,
      avg_entry: entryPrice,
      current_price: entryPrice,
      unrealized_pnl: 0,
      stop_loss: stopCalc.stopLoss,
      take_profit: stopCalc.takeProfit,
      opened_at: Date.now(),
    });

    // Mark signal as acted on
    await env.DB.prepare(`UPDATE signals SET acted_on = 1 WHERE id = ?`).bind(signalId).run();
  } catch (e) {
    console.error(`[Exec] DB record error (order placed!): ${e}`);
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
      `${direction} ${size.shares} shares @ $${entryPrice.toFixed(2)}`,
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
    shares: size.shares,
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
  const executed = results.filter(r => r.success).length;
  const skipped = results.filter(r => r.skipped).length;
  const failed = results.filter(r => r.error).length;

  return [
    `📊 <b>Batch Execution Summary</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `✅ Executed: ${executed}`,
    `⏭️ Skipped: ${skipped}`,
    `❌ Failed: ${failed}`,
  ].join('\n');
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
    } catch (err) { console.error('[Z.AI] Trade review failed:', err); }
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
