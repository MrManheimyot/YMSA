// ─── Signal Detector ──────────────────────────────────────────
// Analyzes technical indicators and generates trading signals
// Matches all your manual analysis: RSI, EMA, MACD, 52W, Fibonacci

import type {
  Env,
  StockQuote,
  TechnicalIndicator,
  Signal,
  AlertPriority,
  FibonacciResult,
} from '../types';
import { checkFibonacciProximity } from './fibonacci';

/**
 * Run all signal detection on a stock's data
 */
export function detectSignals(
  quote: StockQuote,
  indicators: TechnicalIndicator[],
  fibonacci: FibonacciResult | null,
  env: Env,
  previousIndicators?: TechnicalIndicator[]
): Signal[] {
  const signals: Signal[] = [];

  const rsiOverbought = parseFloat(env.RSI_OVERBOUGHT);
  const rsiOversold = parseFloat(env.RSI_OVERSOLD);
  const proximity52w = parseFloat(env.ALERT_PROXIMITY_52W);
  const volumeMultiplier = parseFloat(env.VOLUME_SPIKE_MULTIPLIER);

  // ─── RSI Signals ───────────────────────────────────────
  const rsi = indicators.find((i) => i.indicator === 'RSI');
  if (rsi) {
    if (rsi.value <= rsiOversold) {
      signals.push({
        type: 'RSI_OVERSOLD',
        priority: rsi.value <= 25 ? 'CRITICAL' : 'IMPORTANT',
        symbol: quote.symbol,
        title: `RSI Oversold: ${rsi.value.toFixed(1)}`,
        description: `RSI(14) dropped to ${rsi.value.toFixed(1)} — potential buying opportunity`,
        value: rsi.value,
        threshold: rsiOversold,
        timestamp: Date.now(),
      });
    } else if (rsi.value >= rsiOverbought) {
      signals.push({
        type: 'RSI_OVERBOUGHT',
        priority: rsi.value >= 75 ? 'CRITICAL' : 'IMPORTANT',
        symbol: quote.symbol,
        title: `RSI Overbought: ${rsi.value.toFixed(1)}`,
        description: `RSI(14) reached ${rsi.value.toFixed(1)} — consider taking profits`,
        value: rsi.value,
        threshold: rsiOverbought,
        timestamp: Date.now(),
      });
    }
  }

  // ─── EMA Crossover Signals ─────────────────────────────
  const ema50 = indicators.find((i) => i.indicator === 'EMA_50');
  const ema200 = indicators.find((i) => i.indicator === 'EMA_200');
  if (ema50 && ema200) {
    const prevEma50 = previousIndicators?.find((i) => i.indicator === 'EMA_50');
    const prevEma200 = previousIndicators?.find((i) => i.indicator === 'EMA_200');

    // Golden Cross: EMA50 crosses above EMA200
    if (ema50.value > ema200.value && prevEma50 && prevEma200 && prevEma50.value <= prevEma200.value) {
      signals.push({
        type: 'GOLDEN_CROSS',
        priority: 'CRITICAL',
        symbol: quote.symbol,
        title: `⭐ Golden Cross Detected!`,
        description: `EMA(50): $${ema50.value.toFixed(2)} crossed above EMA(200): $${ema200.value.toFixed(2)} — Bullish signal`,
        value: ema50.value,
        threshold: ema200.value,
        timestamp: Date.now(),
      });
    }

    // Death Cross: EMA50 crosses below EMA200
    if (ema50.value < ema200.value && prevEma50 && prevEma200 && prevEma50.value >= prevEma200.value) {
      signals.push({
        type: 'DEATH_CROSS',
        priority: 'CRITICAL',
        symbol: quote.symbol,
        title: `💀 Death Cross Detected!`,
        description: `EMA(50): $${ema50.value.toFixed(2)} crossed below EMA(200): $${ema200.value.toFixed(2)} — Bearish signal`,
        value: ema50.value,
        threshold: ema200.value,
        timestamp: Date.now(),
      });
    }

    // EMA proximity alert (about to cross)
    const emaGap = Math.abs(ema50.value - ema200.value);
    const emaGapPercent = (emaGap / ema200.value) * 100;
    if (emaGapPercent < 0.5 && emaGapPercent > 0) {
      signals.push({
        type: 'EMA_CROSSOVER',
        priority: 'IMPORTANT',
        symbol: quote.symbol,
        title: `EMA(50/200) Convergence — ${emaGapPercent.toFixed(2)}% gap`,
        description: `EMA(50): $${ema50.value.toFixed(2)} | EMA(200): $${ema200.value.toFixed(2)} — Potential crossover imminent`,
        value: emaGapPercent,
        threshold: 0.5,
        timestamp: Date.now(),
      });
    }
  }

  // ─── MACD Signals ──────────────────────────────────────
  const macd = indicators.find((i) => i.indicator === 'MACD');
  const macdSignal = indicators.find((i) => i.indicator === 'MACD_SIGNAL');

  if (macd && macdSignal) {
    const prevMacd = previousIndicators?.find((i) => i.indicator === 'MACD');
    const prevMacdSignal = previousIndicators?.find((i) => i.indicator === 'MACD_SIGNAL');

    // Bullish MACD crossover
    if (
      macd.value > macdSignal.value &&
      prevMacd && prevMacdSignal &&
      prevMacd.value <= prevMacdSignal.value
    ) {
      signals.push({
        type: 'MACD_BULLISH_CROSS',
        priority: 'IMPORTANT',
        symbol: quote.symbol,
        title: `MACD Bullish Crossover`,
        description: `MACD (${macd.value.toFixed(3)}) crossed above signal (${macdSignal.value.toFixed(3)})`,
        value: macd.value,
        threshold: macdSignal.value,
        timestamp: Date.now(),
      });
    }

    // Bearish MACD crossover
    if (
      macd.value < macdSignal.value &&
      prevMacd && prevMacdSignal &&
      prevMacd.value >= prevMacdSignal.value
    ) {
      signals.push({
        type: 'MACD_BEARISH_CROSS',
        priority: 'IMPORTANT',
        symbol: quote.symbol,
        title: `MACD Bearish Crossover`,
        description: `MACD (${macd.value.toFixed(3)}) crossed below signal (${macdSignal.value.toFixed(3)})`,
        value: macd.value,
        threshold: macdSignal.value,
        timestamp: Date.now(),
      });
    }
  }

  // ─── 52-Week High/Low Signals ──────────────────────────
  if (quote.week52High > 0 && quote.week52Low > 0) {
    const range52w = quote.week52High - quote.week52Low;
    const positionIn52w = (quote.price - quote.week52Low) / range52w;

    // Near 52-week high
    if (positionIn52w >= 1 - proximity52w) {
      signals.push({
        type: quote.price >= quote.week52High ? '52W_BREAKOUT' : '52W_HIGH_PROXIMITY',
        priority: quote.price >= quote.week52High ? 'CRITICAL' : 'IMPORTANT',
        symbol: quote.symbol,
        title: quote.price >= quote.week52High
          ? `🚀 New 52-Week High!`
          : `Near 52-Week High (${(positionIn52w * 100).toFixed(1)}%)`,
        description: `Price: $${quote.price.toFixed(2)} | 52W High: $${quote.week52High.toFixed(2)} | 52W Low: $${quote.week52Low.toFixed(2)}`,
        value: positionIn52w,
        threshold: 1 - proximity52w,
        timestamp: Date.now(),
      });
    }

    // Near 52-week low
    if (positionIn52w <= proximity52w) {
      signals.push({
        type: quote.price <= quote.week52Low ? '52W_BREAKDOWN' : '52W_LOW_PROXIMITY',
        priority: quote.price <= quote.week52Low ? 'CRITICAL' : 'IMPORTANT',
        symbol: quote.symbol,
        title: quote.price <= quote.week52Low
          ? `⚠️ New 52-Week Low!`
          : `Near 52-Week Low (${(positionIn52w * 100).toFixed(1)}%)`,
        description: `Price: $${quote.price.toFixed(2)} | 52W High: $${quote.week52High.toFixed(2)} | 52W Low: $${quote.week52Low.toFixed(2)}`,
        value: positionIn52w,
        threshold: proximity52w,
        timestamp: Date.now(),
      });
    }
  }

  // ─── Volume Spike Signal ───────────────────────────────
  if (quote.volume > 0 && quote.avgVolume > 0) {
    const volumeRatio = quote.volume / quote.avgVolume;
    if (volumeRatio >= volumeMultiplier) {
      signals.push({
        type: 'VOLUME_SPIKE',
        priority: volumeRatio >= 3 ? 'CRITICAL' : 'IMPORTANT',
        symbol: quote.symbol,
        title: `Volume Spike: ${volumeRatio.toFixed(1)}x average`,
        description: `Volume: ${formatNumber(quote.volume)} vs Avg: ${formatNumber(quote.avgVolume)}`,
        value: volumeRatio,
        threshold: volumeMultiplier,
        timestamp: Date.now(),
      });
    }
  }

  // ─── Fibonacci Level Signals ───────────────────────────
  if (fibonacci) {
    const nearLevels = checkFibonacciProximity(fibonacci, 1.0);
    for (const level of nearLevels) {
      signals.push({
        type: 'FIBONACCI_LEVEL_HIT',
        priority: level.ratio === 0.618 || level.ratio === 0.5 ? 'IMPORTANT' : 'INFO',
        symbol: quote.symbol,
        title: `Fibonacci ${level.label} Hit`,
        description: `Price near ${level.label} level at $${level.price.toFixed(2)} (${Math.abs(level.distancePercent).toFixed(1)}% away)`,
        value: level.price,
        threshold: level.distancePercent,
        timestamp: Date.now(),
      });
    }
  }

  return signals;
}

/**
 * Calculate a composite signal score (0-100)
 * Higher = stronger combined signal
 */
export function calculateSignalScore(signals: Signal[]): number {
  if (signals.length === 0) return 0;

  let score = 0;
  const weights: Record<AlertPriority, number> = {
    CRITICAL: 30,
    IMPORTANT: 15,
    INFO: 5,
  };

  for (const signal of signals) {
    score += weights[signal.priority];
  }

  return Math.min(100, score);
}

function formatNumber(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toString();
}
