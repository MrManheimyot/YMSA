// ─── Risk Checker — deterministic risk rules ─────────────────

import type {
  RiskLimits, RiskCheckResult, RiskViolation,
  ProposedOrder, PortfolioState, Position,
} from '../types';

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxDailyDrawdownPct: 3,
  maxPositionSizePct: 10,
  maxSectorExposurePct: 25,
  maxTotalExposurePct: 80,
  minLiquidityRatio: 0.01,
  killSwitchDrawdownPct: 5,
  maxCorrelation: 0.85,
  maxOpenPositions: 20,
  dailyLossLimitUSD: 5000,
};

export function checkRisk(
  order: ProposedOrder,
  portfolio: PortfolioState,
  limits: RiskLimits = DEFAULT_RISK_LIMITS
): RiskCheckResult {
  const violations: RiskViolation[] = [];

  if (portfolio.killSwitchActive) {
    violations.push({
      rule: 'KILL_SWITCH',
      message: `Kill switch ACTIVE — all trading halted. Daily drawdown exceeded ${limits.killSwitchDrawdownPct}%`,
      currentValue: portfolio.dailyPnLPct,
      limit: -limits.killSwitchDrawdownPct,
    });
  }

  if (portfolio.dailyPnLPct <= -limits.maxDailyDrawdownPct) {
    violations.push({
      rule: 'MAX_DAILY_DRAWDOWN',
      message: `Daily drawdown ${portfolio.dailyPnLPct.toFixed(2)}% exceeds limit of -${limits.maxDailyDrawdownPct}%`,
      currentValue: portfolio.dailyPnLPct,
      limit: -limits.maxDailyDrawdownPct,
    });
  }

  if (portfolio.dailyPnL <= -limits.dailyLossLimitUSD) {
    violations.push({
      rule: 'DAILY_LOSS_LIMIT',
      message: `Daily loss $${Math.abs(portfolio.dailyPnL).toFixed(0)} exceeds limit of $${limits.dailyLossLimitUSD}`,
      currentValue: portfolio.dailyPnL,
      limit: -limits.dailyLossLimitUSD,
    });
  }

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

  if (order.action === 'BUY') {
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

  return { approved: violations.length === 0, order, violations };
}

export function shouldActivateKillSwitch(
  portfolio: PortfolioState,
  limits: RiskLimits = DEFAULT_RISK_LIMITS
): boolean {
  return portfolio.dailyPnLPct <= -limits.killSwitchDrawdownPct;
}

export function calculateExposure(portfolio: PortfolioState): number {
  const totalPositionValue = portfolio.positions.reduce((sum, pos) => {
    return sum + Math.abs(pos.quantity * pos.currentPrice);
  }, 0);
  return (totalPositionValue / portfolio.totalEquity) * 100;
}

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

export function formatRiskAlert(result: RiskCheckResult): string {
  if (result.approved) {
    return `✅ Order APPROVED: ${result.order.action} ${result.order.symbol}`;
  }
  const lines = [
    `🛡️ Order REJECTED: ${result.order.action} ${result.order.symbol}`,
    `Agent: ${result.order.agentId}`,
    ``, `Violations:`,
  ];
  for (const v of result.violations) {
    lines.push(`  ❌ [${v.rule}] ${v.message}`);
  }
  return lines.join('\n');
}

function getOrderSector(order: ProposedOrder): string {
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

export function vixRiskAdjustment(vixLevel: number): {
  positionSizeMultiplier: number;
  stopMultiplier: number;
  maxExposurePct: number;
} {
  if (vixLevel >= 35) return { positionSizeMultiplier: 0.0, stopMultiplier: 0.5, maxExposurePct: 0 };
  if (vixLevel >= 25) return { positionSizeMultiplier: 0.50, stopMultiplier: 0.75, maxExposurePct: 50 };
  if (vixLevel >= 18) return { positionSizeMultiplier: 0.75, stopMultiplier: 0.9, maxExposurePct: 70 };
  return { positionSizeMultiplier: 1.0, stopMultiplier: 1.0, maxExposurePct: 80 };
}

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
