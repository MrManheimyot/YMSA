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
