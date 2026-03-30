// ─── Statistical Arbitrage / Pairs Trading ────────────────────
// Agent 2: Identifies broken correlations and mean-reversion opportunities
// Uses medium-timeframe statistical gaps (NOT HFT)

import type { PairCorrelation } from './types';

/**
 * Calculate Pearson correlation between two price series
 */
export function calculateCorrelation(pricesA: number[], pricesB: number[]): number {
  const n = Math.min(pricesA.length, pricesB.length);
  if (n < 10) return 0;

  const a = pricesA.slice(0, n);
  const b = pricesB.slice(0, n);

  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;

  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const diffA = a[i] - meanA;
    const diffB = b[i] - meanB;
    cov += diffA * diffB;
    varA += diffA * diffA;
    varB += diffB * diffB;
  }

  const denom = Math.sqrt(varA * varB);
  return denom === 0 ? 0 : cov / denom;
}

/**
 * Calculate spread z-score for a pair
 * Z-score > 2 → pair is diverged, expect mean-reversion
 */
export function calculateZScore(
  pricesA: number[],
  pricesB: number[],
  lookback: number = 60
): { zScore: number; spreadMean: number; spreadStd: number; halfLife: number } {
  const n = Math.min(pricesA.length, pricesB.length, lookback);
  if (n < 20) return { zScore: 0, spreadMean: 0, spreadStd: 0, halfLife: Infinity };

  // Calculate log price ratio as the spread
  const spreads: number[] = [];
  for (let i = 0; i < n; i++) {
    if (pricesB[i] > 0) {
      spreads.push(Math.log(pricesA[i] / pricesB[i]));
    }
  }

  if (spreads.length < 20) return { zScore: 0, spreadMean: 0, spreadStd: 0, halfLife: Infinity };

  const spreadMean = spreads.reduce((s, v) => s + v, 0) / spreads.length;
  const spreadStd = Math.sqrt(
    spreads.reduce((s, v) => s + (v - spreadMean) ** 2, 0) / (spreads.length - 1)
  );

  const currentSpread = spreads[0]; // Most recent
  const zScore = spreadStd === 0 ? 0 : (currentSpread - spreadMean) / spreadStd;

  // Estimate half-life of mean reversion (simplified OLS)
  const halfLife = estimateHalfLife(spreads);

  return { zScore, spreadMean, spreadStd, halfLife };
}

/**
 * Estimate mean-reversion half-life using OLS regression
 * Spread(t) - Spread(t-1) = theta * Spread(t-1) + epsilon
 * Half-life = -ln(2) / theta
 */
function estimateHalfLife(spreads: number[]): number {
  if (spreads.length < 10) return Infinity;

  // y = spread[t] - spread[t-1], x = spread[t-1]
  const y: number[] = [];
  const x: number[] = [];
  for (let i = 0; i < spreads.length - 1; i++) {
    y.push(spreads[i] - spreads[i + 1]); // Note: spreads[0] is most recent
    x.push(spreads[i + 1]);
  }

  // Simple OLS: theta = sum(x*y) / sum(x*x)
  let sumXY = 0, sumXX = 0;
  for (let i = 0; i < x.length; i++) {
    sumXY += x[i] * y[i];
    sumXX += x[i] * x[i];
  }

  const theta = sumXX === 0 ? 0 : sumXY / sumXX;
  if (theta >= 0) return Infinity; // Not mean-reverting

  return -Math.log(2) / theta;
}

/**
 * Analyze a pair of stocks for trading opportunity
 */
export function analyzePair(
  symbolA: string,
  symbolB: string,
  pricesA: number[],
  pricesB: number[],
  lookbackDays: number = 60
): PairCorrelation {
  const correlation = calculateCorrelation(pricesA, pricesB);
  const { zScore, spreadMean, spreadStd, halfLife } = calculateZScore(pricesA, pricesB, lookbackDays);

  // Simplified cointegration p-value proxy
  // In production, use Augmented Dickey-Fuller test
  const cointegrationPValue = estimateCointegration(pricesA, pricesB);

  return {
    symbolA,
    symbolB,
    correlation,
    cointegrationPValue,
    halfLife,
    currentZScore: zScore,
    spreadMean,
    spreadStd,
    lookbackDays,
  };
}

/**
 * Simplified cointegration test proxy
 * Returns p-value estimate (< 0.05 = likely cointegrated)
 */
function estimateCointegration(pricesA: number[], pricesB: number[]): number {
  const n = Math.min(pricesA.length, pricesB.length);
  if (n < 30) return 1.0; // Not enough data

  // Calculate residuals from linear regression
  const meanA = pricesA.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const meanB = pricesB.slice(0, n).reduce((s, v) => s + v, 0) / n;

  let sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumXY += (pricesB[i] - meanB) * (pricesA[i] - meanA);
    sumXX += (pricesB[i] - meanB) ** 2;
  }
  const beta = sumXX === 0 ? 1 : sumXY / sumXX;
  const alpha = meanA - beta * meanB;

  // Residuals
  const residuals: number[] = [];
  for (let i = 0; i < n; i++) {
    residuals.push(pricesA[i] - alpha - beta * pricesB[i]);
  }

  // Check stationarity via variance ratio
  const halfN = Math.floor(n / 2);
  const var1 = variance(residuals.slice(0, halfN));
  const var2 = variance(residuals.slice(halfN));

  // If variance ratio is near 1, residuals are stationary → cointegrated
  const vr = var2 === 0 ? 1 : var1 / var2;
  const pValue = Math.abs(vr - 1); // Rough proxy: closer to 0 = more cointegrated

  return Math.min(1, pValue);
}

function variance(arr: number[]): number {
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1);
}

/**
 * Scan all pairs from a list of symbols and find trading opportunities
 */
export function scanPairs(
  symbols: string[],
  priceData: Record<string, number[]>,
  lookbackDays: number = 60
): PairCorrelation[] {
  const pairs: PairCorrelation[] = [];

  for (let i = 0; i < symbols.length; i++) {
    for (let j = i + 1; j < symbols.length; j++) {
      const a = priceData[symbols[i]];
      const b = priceData[symbols[j]];

      if (!a || !b) continue;

      const result = analyzePair(symbols[i], symbols[j], a, b, lookbackDays);
      pairs.push(result);
    }
  }

  return pairs;
}

/**
 * Filter pairs for actionable trading signals
 * Z-score > 2 with good cointegration = entry opportunity
 */
export function findTradablePairs(pairs: PairCorrelation[]): PairCorrelation[] {
  return pairs.filter((pair) => {
    return (
      pair.correlation > 0.7 &&
      pair.cointegrationPValue < 0.1 &&
      Math.abs(pair.currentZScore) > 1.5 &&
      pair.halfLife > 1 && pair.halfLife < 30 // Mean-reverts within 1-30 days
    );
  });
}

/**
 * Format pair for alert
 */
export function formatPairAlert(pair: PairCorrelation): string {
  const direction = pair.currentZScore > 0
    ? `Long ${pair.symbolB} / Short ${pair.symbolA}`
    : `Long ${pair.symbolA} / Short ${pair.symbolB}`;

  return [
    `🔄 <b>Pairs Trade Signal</b>`,
    `${pair.symbolA} ↔ ${pair.symbolB}`,
    ``,
    `📊 Z-Score: ${pair.currentZScore.toFixed(2)} (${Math.abs(pair.currentZScore) > 2 ? '🔴 Strong' : '🟡 Moderate'})`,
    `📈 Correlation: ${pair.correlation.toFixed(3)}`,
    `📉 Half-life: ${pair.halfLife.toFixed(1)} days`,
    ``,
    `🎯 Direction: ${direction}`,
  ].join('\n');
}
