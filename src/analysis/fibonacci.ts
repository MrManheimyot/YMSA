// ─── Fibonacci Retracement Calculator ─────────────────────────
// Auto-detects swing high/low and calculates Fibonacci levels
// Supports: 23.6%, 38.2%, 50%, 61.8%, 78.6% + Extensions

import type { OHLCV, FibonacciResult, FibLevel } from '../types';

const DEFAULT_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
const DEFAULT_EXTENSIONS = [1.272, 1.618, 2.618];

const LEVEL_LABELS: Record<number, string> = {
  0: '0%',
  0.236: '23.6%',
  0.382: '38.2%',
  0.5: '50%',
  0.618: '61.8% (Golden)',
  0.786: '78.6%',
  1.0: '100%',
  1.272: '127.2% Ext',
  1.618: '161.8% Ext',
  2.618: '261.8% Ext',
};

/**
 * Calculate Fibonacci retracement levels from OHLCV data
 * 
 * @param candles - OHLCV price data (most recent first)
 * @param currentPrice - Current market price
 * @param lookbackPeriod - Number of candles to find swing points (default: 50)
 * @param levels - Custom Fibonacci ratios (default: standard levels)
 * @param extensions - Custom extension ratios
 */
export function calculateFibonacci(
  symbol: string,
  candles: OHLCV[],
  currentPrice: number,
  lookbackPeriod: number = 50,
  levels: number[] = DEFAULT_LEVELS,
  extensions: number[] = DEFAULT_EXTENSIONS
): FibonacciResult | null {
  if (candles.length < lookbackPeriod) {
    console.warn(`[Fibonacci] Not enough data for ${symbol}: ${candles.length} < ${lookbackPeriod}`);
    return null;
  }

  // Use the most recent N candles
  const recentCandles = candles.slice(0, lookbackPeriod);

  // Find swing high and swing low
  const { swingHigh, swingLow, direction } = findSwingPoints(recentCandles);

  if (swingHigh === swingLow) return null;

  // Calculate retracement levels
  const range = swingHigh - swingLow;
  const fibLevels = levels.map((ratio) => calculateLevel(ratio, swingHigh, swingLow, range, direction, currentPrice));
  const fibExtensions = extensions.map((ratio) => calculateLevel(ratio, swingHigh, swingLow, range, direction, currentPrice));

  // Find nearest level to current price
  const allLevels = [...fibLevels, ...fibExtensions];
  const nearestLevel = allLevels.reduce<FibLevel | null>((nearest, level) => {
    if (!nearest) return level;
    return Math.abs(level.distancePercent) < Math.abs(nearest.distancePercent) ? level : nearest;
  }, null);

  return {
    symbol,
    swingHigh,
    swingLow,
    direction,
    levels: fibLevels,
    extensions: fibExtensions,
    currentPrice,
    nearestLevel,
    timestamp: Date.now(),
  };
}

/**
 * Find swing high and swing low in the given candles
 * Also determines the trend direction
 */
function findSwingPoints(candles: OHLCV[]): {
  swingHigh: number;
  swingLow: number;
  direction: 'uptrend' | 'downtrend';
} {
  let swingHigh = -Infinity;
  let swingHighIndex = 0;
  let swingLow = Infinity;
  let swingLowIndex = 0;

  for (let i = 0; i < candles.length; i++) {
    if (candles[i].high > swingHigh) {
      swingHigh = candles[i].high;
      swingHighIndex = i;
    }
    if (candles[i].low < swingLow) {
      swingLow = candles[i].low;
      swingLowIndex = i;
    }
  }

  // If swing high occurred more recently than swing low → uptrend
  // (candles are most-recent-first, so lower index = more recent)
  const direction: 'uptrend' | 'downtrend' =
    swingHighIndex < swingLowIndex ? 'uptrend' : 'downtrend';

  return { swingHigh, swingLow, direction };
}

/**
 * Calculate a single Fibonacci level price
 */
function calculateLevel(
  ratio: number,
  swingHigh: number,
  swingLow: number,
  range: number,
  direction: 'uptrend' | 'downtrend',
  currentPrice: number
): FibLevel {
  let price: number;

  if (direction === 'uptrend') {
    // In uptrend, retracement goes down from high
    price = swingHigh - range * ratio;
  } else {
    // In downtrend, retracement goes up from low
    price = swingLow + range * ratio;
  }

  const distancePercent = ((currentPrice - price) / price) * 100;

  return {
    ratio,
    label: LEVEL_LABELS[ratio] || `${(ratio * 100).toFixed(1)}%`,
    price: Math.round(price * 100) / 100,
    distancePercent: Math.round(distancePercent * 100) / 100,
  };
}

/**
 * Check if price is near any Fibonacci level (within threshold)
 */
export function checkFibonacciProximity(
  fib: FibonacciResult,
  thresholdPercent: number = 1.0
): FibLevel[] {
  const allLevels = [...fib.levels, ...fib.extensions];
  return allLevels.filter(
    (level) => Math.abs(level.distancePercent) <= thresholdPercent
  );
}

/**
 * Format Fibonacci result as a readable string for alerts
 */
export function formatFibonacciAlert(fib: FibonacciResult): string {
  const direction = fib.direction === 'uptrend' ? '📈 Uptrend' : '📉 Downtrend';
  const lines = [
    `📐 Fibonacci Retracement — ${fib.symbol}`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `${direction} | Swing: $${fib.swingLow.toFixed(2)} → $${fib.swingHigh.toFixed(2)}`,
    `💰 Current: $${fib.currentPrice.toFixed(2)}`,
    ``,
    `Retracement Levels:`,
  ];

  for (const level of fib.levels) {
    const marker =
      Math.abs(level.distancePercent) < 1 ? '🎯' :
      level.distancePercent > 0 ? '⬆️' : '⬇️';
    lines.push(
      `  ${marker} ${level.label}: $${level.price.toFixed(2)} (${level.distancePercent > 0 ? '+' : ''}${level.distancePercent.toFixed(1)}%)`
    );
  }

  if (fib.extensions.length > 0) {
    lines.push(``, `Extension Levels:`);
    for (const ext of fib.extensions) {
      lines.push(`  📌 ${ext.label}: $${ext.price.toFixed(2)}`);
    }
  }

  if (fib.nearestLevel) {
    lines.push(
      ``,
      `🎯 Nearest: ${fib.nearestLevel.label} at $${fib.nearestLevel.price.toFixed(2)} (${Math.abs(fib.nearestLevel.distancePercent).toFixed(1)}% away)`
    );
  }

  return lines.join('\n');
}
