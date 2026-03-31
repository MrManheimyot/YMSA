// ─── Local Technical Indicator Calculator ────────────────────
// Computes RSI, MACD, EMA from Yahoo Finance OHLCV data.
// Used as primary source since TAAPI free tier doesn't support stocks.

import type { OHLCV, TechnicalIndicator, Timeframe } from '../types';

/**
 * Compute RSI(14), MACD(12,26,9), EMA50, EMA200 from OHLCV candles.
 * Expects candles sorted most-recent-first (Yahoo Finance default).
 */
export function computeIndicators(
  symbol: string,
  candles: OHLCV[],
  timeframe: Timeframe = 'daily'
): TechnicalIndicator[] {
  if (candles.length < 30) return [];

  // Reverse to chronological order (oldest first) for calculations
  const prices = [...candles].reverse().map((c) => c.close);
  const now = Date.now();
  const indicators: TechnicalIndicator[] = [];

  // RSI(14)
  const rsi = calcRSI(prices, 14);
  if (rsi !== null) {
    indicators.push({ symbol, indicator: 'RSI', value: rsi, timestamp: now, timeframe });
  }

  // EMA 50
  const ema50 = calcEMA(prices, 50);
  if (ema50 !== null) {
    indicators.push({ symbol, indicator: 'EMA_50', value: ema50, timestamp: now, timeframe });
  }

  // EMA 200
  const ema200 = calcEMA(prices, 200);
  if (ema200 !== null) {
    indicators.push({ symbol, indicator: 'EMA_200', value: ema200, timestamp: now, timeframe });
  }

  // MACD(12, 26, 9)
  const macd = calcMACD(prices, 12, 26, 9);
  if (macd) {
    indicators.push({ symbol, indicator: 'MACD', value: macd.macd, timestamp: now, timeframe });
    indicators.push({ symbol, indicator: 'MACD_SIGNAL', value: macd.signal, signal: macd.signal, timestamp: now, timeframe });
    indicators.push({ symbol, indicator: 'MACD_HISTOGRAM', value: macd.histogram, histogram: macd.histogram, timestamp: now, timeframe });
  }

  return indicators;
}

/** Calculate RSI using Wilder's smoothing method */
function calcRSI(prices: number[], period: number): number | null {
  if (prices.length < period + 1) return null;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Smooth with Wilder's method
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + (change > 0 ? change : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (change < 0 ? Math.abs(change) : 0)) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Calculate EMA - returns the latest value */
function calcEMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;

  const k = 2 / (period + 1);
  // Seed with SMA
  let ema = 0;
  for (let i = 0; i < period; i++) ema += prices[i];
  ema /= period;

  // Apply EMA formula
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

/** Calculate MACD(fast, slow, signal) */
function calcMACD(
  prices: number[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number
): { macd: number; signal: number; histogram: number } | null {
  if (prices.length < slowPeriod + signalPeriod) return null;

  // Build full EMA series for fast and slow
  const fastK = 2 / (fastPeriod + 1);
  const slowK = 2 / (slowPeriod + 1);

  // Seed fast EMA
  let fastEma = 0;
  for (let i = 0; i < fastPeriod; i++) fastEma += prices[i];
  fastEma /= fastPeriod;

  // Seed slow EMA
  let slowEma = 0;
  for (let i = 0; i < slowPeriod; i++) slowEma += prices[i];
  slowEma /= slowPeriod;

  // Build MACD line from slowPeriod onward
  const macdLine: number[] = [];
  for (let i = slowPeriod; i < prices.length; i++) {
    fastEma = prices[i] * fastK + fastEma * (1 - fastK);
    slowEma = prices[i] * slowK + slowEma * (1 - slowK);
    macdLine.push(fastEma - slowEma);
  }

  if (macdLine.length < signalPeriod) return null;

  // Signal line (EMA of MACD line)
  const sigK = 2 / (signalPeriod + 1);
  let sigEma = 0;
  for (let i = 0; i < signalPeriod; i++) sigEma += macdLine[i];
  sigEma /= signalPeriod;

  for (let i = signalPeriod; i < macdLine.length; i++) {
    sigEma = macdLine[i] * sigK + sigEma * (1 - sigK);
  }

  const latestMacd = macdLine[macdLine.length - 1];
  return { macd: latestMacd, signal: sigEma, histogram: latestMacd - sigEma };
}
