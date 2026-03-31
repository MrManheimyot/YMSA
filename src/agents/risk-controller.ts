// ─── Risk Controller ──────────────────────────────────────────
// DETERMINISTIC hard-coded rules — NOT AI.
// This module is the iron law. No agent can override it.
// All orders pass through here before execution.

import type {
  RiskLimits,
  RiskCheckResult,
  RiskViolation,
  ProposedOrder,
  PortfolioState,
  Position,
} from './types';
import { getKillSwitchState, upsertKillSwitchState } from '../db/queries';

/**
 * Default risk limits — conservative starting point
 * Adjust these parameters periodically based on VIX / ATR
 */
export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxDailyDrawdownPct: 3,          // Max 3% portfolio loss per day
  maxPositionSizePct: 10,          // Max 10% of portfolio in single position
  maxSectorExposurePct: 25,        // Max 25% of portfolio in one sector
  maxTotalExposurePct: 80,         // Max 80% invested (20% always cash)
  minLiquidityRatio: 0.01,         // Position < 1% of daily volume
  killSwitchDrawdownPct: 5,        // 5% daily loss → HALT ALL trading 24h
  maxCorrelation: 0.85,            // No two positions with r > 0.85
  maxOpenPositions: 20,            // Max 20 open positions
  dailyLossLimitUSD: 5000,         // Absolute $ loss limit per day
};

/**
 * Check a proposed order against all risk rules.
 * Returns approved=true only if ALL rules pass.
 * This function is DETERMINISTIC — no AI, no exceptions.
 */
export function checkRisk(
  order: ProposedOrder,
  portfolio: PortfolioState,
  limits: RiskLimits = DEFAULT_RISK_LIMITS
): RiskCheckResult {
  const violations: RiskViolation[] = [];

  // ─── Rule 1: Kill Switch ─────────────────────────────
  if (portfolio.killSwitchActive) {
    violations.push({
      rule: 'KILL_SWITCH',
      message: `Kill switch ACTIVE — all trading halted. Daily drawdown exceeded ${limits.killSwitchDrawdownPct}%`,
      currentValue: portfolio.dailyPnLPct,
      limit: -limits.killSwitchDrawdownPct,
    });
  }

  // ─── Rule 2: Daily Drawdown ──────────────────────────
  if (portfolio.dailyPnLPct <= -limits.maxDailyDrawdownPct) {
    violations.push({
      rule: 'MAX_DAILY_DRAWDOWN',
      message: `Daily drawdown ${portfolio.dailyPnLPct.toFixed(2)}% exceeds limit of -${limits.maxDailyDrawdownPct}%`,
      currentValue: portfolio.dailyPnLPct,
      limit: -limits.maxDailyDrawdownPct,
    });
  }

  // ─── Rule 3: Daily Loss Limit (absolute $) ───────────
  if (portfolio.dailyPnL <= -limits.dailyLossLimitUSD) {
    violations.push({
      rule: 'DAILY_LOSS_LIMIT',
      message: `Daily loss $${Math.abs(portfolio.dailyPnL).toFixed(0)} exceeds limit of $${limits.dailyLossLimitUSD}`,
      currentValue: portfolio.dailyPnL,
      limit: -limits.dailyLossLimitUSD,
    });
  }

  // ─── Rule 4: Position Size ───────────────────────────
  const orderValue = order.quantity * (order.limitPrice || 0);
  const positionPct = (orderValue / portfolio.totalEquity) * 100;
  if (positionPct > limits.maxPositionSizePct && order.action === 'BUY') {
    violations.push({
      rule: 'MAX_POSITION_SIZE',
      message: `Position size ${positionPct.toFixed(1)}% exceeds limit of ${limits.maxPositionSizePct}%`,
      currentValue: positionPct,
      limit: limits.maxPositionSizePct,
    });
  }

  // ─── Rule 5: Total Exposure ──────────────────────────
  if (
    portfolio.totalExposurePct >= limits.maxTotalExposurePct &&
    (order.action === 'BUY' || order.action === 'SHORT')
  ) {
    violations.push({
      rule: 'MAX_TOTAL_EXPOSURE',
      message: `Total exposure ${portfolio.totalExposurePct.toFixed(1)}% at max (${limits.maxTotalExposurePct}%). No new positions.`,
      currentValue: portfolio.totalExposurePct,
      limit: limits.maxTotalExposurePct,
    });
  }

  // ─── Rule 6: Sector Exposure ─────────────────────────
  if (order.action === 'BUY') {
    // Check if this sector is already maxed
    const sector = getOrderSector(order);
    const currentSectorExposure = portfolio.sectorExposure[sector] || 0;
    if (currentSectorExposure >= limits.maxSectorExposurePct) {
      violations.push({
        rule: 'MAX_SECTOR_EXPOSURE',
        message: `Sector "${sector}" exposure at ${currentSectorExposure.toFixed(1)}% — max is ${limits.maxSectorExposurePct}%`,
        currentValue: currentSectorExposure,
        limit: limits.maxSectorExposurePct,
      });
    }
  }

  // ─── Rule 7: Max Open Positions ──────────────────────
  if (
    portfolio.positions.length >= limits.maxOpenPositions &&
    (order.action === 'BUY' || order.action === 'SHORT')
  ) {
    violations.push({
      rule: 'MAX_OPEN_POSITIONS',
      message: `${portfolio.positions.length} open positions — max is ${limits.maxOpenPositions}`,
      currentValue: portfolio.positions.length,
      limit: limits.maxOpenPositions,
    });
  }

  return {
    approved: violations.length === 0,
    order,
    violations,
  };
}

/**
 * Check if kill switch should activate based on daily PnL
 */
export function shouldActivateKillSwitch(
  portfolio: PortfolioState,
  limits: RiskLimits = DEFAULT_RISK_LIMITS
): boolean {
  return portfolio.dailyPnLPct <= -limits.killSwitchDrawdownPct;
}

/**
 * Calculate total portfolio exposure percentage
 */
export function calculateExposure(portfolio: PortfolioState): number {
  const totalPositionValue = portfolio.positions.reduce((sum, pos) => {
    return sum + Math.abs(pos.quantity * pos.currentPrice);
  }, 0);
  return (totalPositionValue / portfolio.totalEquity) * 100;
}

/**
 * Calculate sector exposure map
 */
export function calculateSectorExposure(
  positions: Position[],
  totalEquity: number
): Record<string, number> {
  const sectorMap: Record<string, number> = {};

  for (const pos of positions) {
    const sector = pos.sector || 'Unknown';
    const posValue = Math.abs(pos.quantity * pos.currentPrice);
    const pct = (posValue / totalEquity) * 100;
    sectorMap[sector] = (sectorMap[sector] || 0) + pct;
  }

  return sectorMap;
}

/**
 * Format risk check result for alert
 */
export function formatRiskAlert(result: RiskCheckResult): string {
  if (result.approved) {
    return `✅ Order APPROVED: ${result.order.action} ${result.order.symbol}`;
  }

  const lines = [
    `🛡️ Order REJECTED: ${result.order.action} ${result.order.symbol}`,
    `Agent: ${result.order.agentId}`,
    ``,
    `Violations:`,
  ];

  for (const v of result.violations) {
    lines.push(`  ❌ [${v.rule}] ${v.message}`);
  }

  return lines.join('\n');
}

/**
 * Derive sector from order metadata
 */
function getOrderSector(order: ProposedOrder): string {
  // Simple mapping — in production, lookup from company profile cache
  const techSymbols = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'META', 'AMD', 'AVGO', 'CRM', 'ORCL', 'ADBE'];
  const consumerSymbols = ['AMZN', 'TSLA', 'NKE', 'SBUX', 'MCD'];
  const financeSymbols = ['JPM', 'BAC', 'GS', 'MS', 'V', 'MA'];
  const healthSymbols = ['JNJ', 'UNH', 'PFE', 'ABBV', 'MRK'];
  const energySymbols = ['XOM', 'CVX', 'COP', 'SLB'];

  if (order.arena === 'crypto') return 'Crypto';
  if (order.arena === 'prediction_markets') return 'Prediction Markets';
  if (order.arena === 'commodities') return 'Commodities';

  if (techSymbols.includes(order.symbol)) return 'Technology';
  if (consumerSymbols.includes(order.symbol)) return 'Consumer';
  if (financeSymbols.includes(order.symbol)) return 'Finance';
  if (healthSymbols.includes(order.symbol)) return 'Healthcare';
  if (energySymbols.includes(order.symbol)) return 'Energy';

  return 'Other';
}

// ═══════════════════════════════════════════════════════════════
// v3: ENGINE-LEVEL RISK MANAGEMENT
// Per-engine budgets, VIX-based adjustments, tiered kill switch
// ═══════════════════════════════════════════════════════════════

/**
 * Engine-level capital budgets (% of total equity)
 */
export const ENGINE_BUDGETS: Record<string, number> = {
  MTF_MOMENTUM: 0.30,
  SMART_MONEY: 0.20,
  STAT_ARB: 0.20,
  OPTIONS: 0.10,
  CRYPTO_DEFI: 0.10,
  EVENT_DRIVEN: 0.10,
};

/**
 * Tiered kill switch thresholds
 * -3% → reduce all positions 50%
 * -5% → close all positions
 * -10% → halt trading for 7 days
 */
export interface TieredKillSwitch {
  level: 'NONE' | 'REDUCE' | 'CLOSE_ALL' | 'HALT';
  action: string;
  threshold: number;
}

export function evaluateKillSwitch(dailyPnlPct: number): TieredKillSwitch {
  if (dailyPnlPct <= -10) {
    return { level: 'HALT', action: 'HALT all trading for 7 days', threshold: -10 };
  }
  if (dailyPnlPct <= -5) {
    return { level: 'CLOSE_ALL', action: 'CLOSE all open positions immediately', threshold: -5 };
  }
  if (dailyPnlPct <= -3) {
    return { level: 'REDUCE', action: 'REDUCE all positions by 50%', threshold: -3 };
  }
  return { level: 'NONE', action: 'Normal operations', threshold: 0 };
}

/**
 * Check if an engine has exceeded its capital budget.
 */
export function checkEngineBudget(
  engineId: string,
  engineExposure: number,
  totalEquity: number
): { approved: boolean; message: string } {
  const budget = ENGINE_BUDGETS[engineId] || 0.10;
  const maxExposure = totalEquity * budget;
  if (engineExposure > maxExposure) {
    return {
      approved: false,
      message: `Engine ${engineId} exposure $${engineExposure.toFixed(0)} exceeds budget $${maxExposure.toFixed(0)} (${(budget * 100).toFixed(0)}%)`,
    };
  }
  return { approved: true, message: 'Within budget' };
}

/**
 * VIX-based risk adjustment: when VIX > 25, tighten stops and reduce position sizes.
 */
export function vixRiskAdjustment(vixLevel: number): {
  positionSizeMultiplier: number;
  stopMultiplier: number;
  maxExposurePct: number;
} {
  if (vixLevel >= 35) {
    return { positionSizeMultiplier: 0.25, stopMultiplier: 0.5, maxExposurePct: 30 };
  }
  if (vixLevel >= 25) {
    return { positionSizeMultiplier: 0.50, stopMultiplier: 0.75, maxExposurePct: 50 };
  }
  if (vixLevel >= 18) {
    return { positionSizeMultiplier: 0.75, stopMultiplier: 0.9, maxExposurePct: 70 };
  }
  return { positionSizeMultiplier: 1.0, stopMultiplier: 1.0, maxExposurePct: 80 };
}

/**
 * Correlation guard: block new positions that would create > 0.85 correlation
 * within the same engine or across engines.
 */
export function correlationCheck(
  newSymbol: string,
  existingSymbols: string[],
  correlationMatrix: Record<string, Record<string, number>>
): { approved: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const existing of existingSymbols) {
    const corr = correlationMatrix[newSymbol]?.[existing]
      ?? correlationMatrix[existing]?.[newSymbol]
      ?? 0;
    if (Math.abs(corr) > 0.85) {
      violations.push(`${newSymbol} ↔ ${existing}: correlation ${corr.toFixed(2)} exceeds 0.85`);
    }
  }
  return { approved: violations.length === 0, violations };
}

/**
 * Format v3 risk event for Telegram
 */
export function formatRiskEvent(
  eventType: string,
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
  description: string,
  action: string
): string {
  const emoji = severity === 'CRITICAL' ? '🚨' : severity === 'HIGH' ? '⚠️' : severity === 'MEDIUM' ? '🟡' : 'ℹ️';
  return [
    `${emoji} <b>Risk Event — ${severity}</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `Type: ${eventType}`,
    `${description}`,
    `Action: ${action}`,
  ].join('\n');
}

// ═══════════════════════════════════════════════════════════════
// PERSISTENT KILL SWITCH — survives Worker restarts
// ═══════════════════════════════════════════════════════════════

/**
 * Evaluate kill switch and persist state to D1.
 * Returns current tier or 'NONE'.
 */
export async function evaluateAndPersistKillSwitch(
  dailyPnlPct: number,
  db: D1Database | undefined,
): Promise<TieredKillSwitch> {
  const ks = evaluateKillSwitch(dailyPnlPct);

  if (db) {
    try {
      // Check existing state — don't downgrade from HALT
      const existing = await getKillSwitchState(db);
      if (existing && existing.tier === 'HALT' && ks.level !== 'HALT') {
        // HALT persists for 7 days
        const haltedAt = existing.activated_at || 0;
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        if (Date.now() - haltedAt < sevenDays) {
          return { level: 'HALT', action: 'HALT still active (7-day cooldown)', threshold: -10 };
        }
      }
      await upsertKillSwitchState(db, ks.level, dailyPnlPct, ks.action);
    } catch (err) {
      console.error('[RiskController] Kill switch persist failed:', err);
    }
  }

  return ks;
}

/**
 * Load kill switch state from D1 (call at start of each cron cycle).
 */
export async function loadKillSwitchState(db: D1Database | undefined): Promise<TieredKillSwitch> {
  if (!db) return { level: 'NONE', action: 'Normal operations', threshold: 0 };
  try {
    const state = await getKillSwitchState(db);
    if (!state || state.tier === 'NONE') return { level: 'NONE', action: 'Normal operations', threshold: 0 };

    // Check 7-day HALT expiry
    if (state.tier === 'HALT' && state.activated_at) {
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (Date.now() - state.activated_at >= sevenDays) {
        await upsertKillSwitchState(db, 'NONE', null, 'HALT expired after 7 days');
        return { level: 'NONE', action: 'HALT expired', threshold: 0 };
      }
    }

    return {
      level: state.tier as TieredKillSwitch['level'],
      action: state.reason || 'Kill switch active',
      threshold: state.daily_pnl_pct || 0,
    };
  } catch {
    return { level: 'NONE', action: 'Normal operations (DB unavailable)', threshold: 0 };
  }
}
