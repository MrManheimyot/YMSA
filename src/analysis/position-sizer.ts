// ─── Kelly Criterion Position Sizer ─────────────────────────
// Optimal position sizing using Kelly fraction with ATR-based stops
// Replaces fixed 5% sizing with mathematically optimal allocation

// ─── Types ───────────────────────────────────────────────────

export interface PositionSizeParams {
  equity: number;            // total portfolio equity
  entryPrice: number;
  atr: number;               // current ATR for stop calculation
  winRate: number;           // historical win rate (0-1)
  avgWinPct: number;         // average winning trade %
  avgLossPct: number;        // average losing trade % (positive number)
  riskPerTrade?: number;     // max risk per trade as fraction (default 0.02 = 2%)
  maxPositionPct?: number;   // max position as % of equity (default 0.10 = 10%)
  atrStopMultiplier?: number; // ATR multiplier for stop (default 2.0)
}

export interface PositionSize {
  shares: number;
  dollarAmount: number;
  stopLoss: number;
  takeProfit: number;
  riskAmount: number;        // $ at risk per trade
  rewardRiskRatio: number;
  kellyFraction: number;     // the raw kelly fraction used
  positionPct: number;       // % of equity this trade represents
}

// ─── Kelly Criterion Functions ───────────────────────────────

/**
 * Full Kelly fraction: f* = (p*b - q) / b
 * where p = win rate, q = loss rate, b = avg_win/avg_loss
 */
export function calculateKellyFraction(
  winRate: number,
  avgWin: number,
  avgLoss: number
): number {
  if (avgLoss <= 0 || winRate <= 0 || winRate >= 1) return 0;
  const b = avgWin / avgLoss;
  const q = 1 - winRate;
  const kelly = (winRate * b - q) / b;
  return Math.max(0, Math.min(1, kelly));
}

/**
 * Half Kelly: safer allocation (industry standard)
 */
export function calculateHalfKelly(
  winRate: number,
  avgWin: number,
  avgLoss: number
): number {
  return calculateKellyFraction(winRate, avgWin, avgLoss) / 2;
}

/**
 * Quarter Kelly: ultra-conservative
 */
export function calculateQuarterKelly(
  winRate: number,
  avgWin: number,
  avgLoss: number
): number {
  return calculateKellyFraction(winRate, avgWin, avgLoss) / 4;
}

// ─── Position Sizing ─────────────────────────────────────────

/**
 * Calculate exact position size with ATR-based stops and Kelly sizing.
 */
export function calculatePositionSize(params: PositionSizeParams): PositionSize {
  const {
    equity,
    entryPrice,
    atr,
    winRate,
    avgWinPct,
    avgLossPct,
    riskPerTrade = 0.02,
    maxPositionPct = 0.10,
    atrStopMultiplier = 2.0,
  } = params;

  // Calculate Kelly fraction (use half-Kelly for safety)
  const kellyFraction = calculateHalfKelly(winRate, avgWinPct, avgLossPct);

  // Position size from Kelly (capped at maxPositionPct)
  const kellyDollar = equity * Math.min(kellyFraction, maxPositionPct);

  // Position size from risk-per-trade (alternative sizing)
  const stopDistance = atr * atrStopMultiplier;
  const riskDollar = equity * riskPerTrade;
  const sharesFromRisk = stopDistance > 0 ? Math.floor(riskDollar / stopDistance) : 0;
  const riskDollarAmount = sharesFromRisk * entryPrice;

  // Use the SMALLER of Kelly and risk-based sizing (conservative)
  const dollarAmount = Math.min(kellyDollar, riskDollarAmount, equity * maxPositionPct);
  const shares = entryPrice > 0 ? Math.floor(dollarAmount / entryPrice) : 0;
  const actualDollar = shares * entryPrice;

  const stopLoss = entryPrice - stopDistance;
  const takeProfit = entryPrice + stopDistance * 1.5; // 1.5:1 R:R minimum
  const riskAmount = shares * stopDistance;
  const rewardAmount = shares * (takeProfit - entryPrice);
  const rewardRiskRatio = riskAmount > 0 ? rewardAmount / riskAmount : 0;

  return {
    shares,
    dollarAmount: actualDollar,
    stopLoss,
    takeProfit,
    riskAmount,
    rewardRiskRatio,
    kellyFraction,
    positionPct: equity > 0 ? (actualDollar / equity) * 100 : 0,
  };
}

// ─── ATR Stop Calculation ────────────────────────────────────

/**
 * Calculate dynamic stop loss and take profit from ATR.
 * Swing trade: 2x ATR stop, 3x ATR target
 * Scalp: 1.5x ATR stop, 2x ATR target
 * Position trade: 3x ATR stop, 4.5x ATR target
 */
export function calculateATRStop(
  entryPrice: number,
  atr: number,
  multiplier: number = 2.0,
  direction: 'LONG' | 'SHORT' = 'LONG'
): { stopLoss: number; takeProfit: number } {
  if (direction === 'LONG') {
    return {
      stopLoss: entryPrice - atr * multiplier,
      takeProfit: entryPrice + atr * multiplier * 1.5,
    };
  }
  return {
    stopLoss: entryPrice + atr * multiplier,
    takeProfit: entryPrice - atr * multiplier * 1.5,
  };
}

/**
 * Format position size alert for Telegram
 */
export function formatPositionAlert(size: PositionSize, symbol: string): string {
  return [
    `📐 <b>Position Size — ${symbol}</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `📊 Shares: ${size.shares}`,
    `💰 Amount: $${size.dollarAmount.toFixed(0)} (${size.positionPct.toFixed(1)}% of equity)`,
    `🛑 Stop Loss: $${size.stopLoss.toFixed(2)}`,
    `🎯 Take Profit: $${size.takeProfit.toFixed(2)}`,
    `⚠️ Risk: $${size.riskAmount.toFixed(0)}`,
    `📈 R:R Ratio: 1:${size.rewardRiskRatio.toFixed(1)}`,
    `🔢 Kelly: ${(size.kellyFraction * 100).toFixed(1)}% (half)`,
  ].join('\n');
}
