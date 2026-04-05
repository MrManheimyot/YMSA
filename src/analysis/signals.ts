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

  // ─── ATR Volatility Filter: skip dangerously volatile stocks (ATR > 5% of price) ──
  const atrInd = indicators.find((i) => i.indicator === 'ATR');
  if (atrInd && quote.price > 0 && (atrInd.value / quote.price) > 0.05) {
    return signals; // too volatile — skip all signals
  }

  // ─── Price Momentum Filter: require ≥ 0.5% absolute move for directional signals ──
  const hasSufficientMomentum = Math.abs(quote.changePercent) >= 0.5;

  // ─── Candle Body Filter: require body > 50% of range (conviction check) ──
  // Uses quote open/close/high/low if available
  let hasStrongCandle = true;
  if (quote.open && quote.open > 0 && quote.price > 0) {
    const candleBody = Math.abs(quote.price - quote.open);
    const candleRange = (quote.high && quote.low)
      ? quote.high - quote.low
      : Math.abs(quote.price - quote.open) * 2; // fallback
    if (candleRange > 0) {
      hasStrongCandle = candleBody / candleRange >= 0.5;
    }
  }

  // ─── Quality Gate: ADX + Trend Context ─────────────────
  const adx = indicators.find((i) => i.indicator === 'ADX');
  const ema200 = indicators.find((i) => i.indicator === 'EMA_200');
  const ema50 = indicators.find((i) => i.indicator === 'EMA_50');
  const adxValue = adx?.value ?? 0;
  const priceAboveEma200 = ema200 ? quote.price > ema200.value : true;
  const ema50AboveEma200 = ema50 && ema200 ? ema50.value > ema200.value : true;

  // ─── RSI Signals (with anti-trap: no BUY if price < EMA200 & RSI < 40) ──
  // Directional signals require momentum + candle body conviction
  const canFireDirectional = hasSufficientMomentum && hasStrongCandle;
  const rsi = indicators.find((i) => i.indicator === 'RSI');
  if (rsi) {
    if (rsi.value <= rsiOversold) {
      // Anti-Trap: Block RSI oversold BUY in confirmed downtrend (only when EMA data available)
      const isFallingKnife = ema200 && ema50 && !priceAboveEma200 && !ema50AboveEma200 && rsi.value < 40;
      if (!isFallingKnife && canFireDirectional) {
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
      }
    } else if (rsi.value >= rsiOverbought) {
      // Anti-Trap: Block RSI overbought SELL in confirmed strong uptrend
      // Only apply when EMA data is actually available
      const isTrendPush = ema200 && ema50 && priceAboveEma200 && ema50AboveEma200 && rsi.value < 80;
      if (!isTrendPush && canFireDirectional) {
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
  }

  // ─── EMA Crossover Signals (ADX-gated: require ADX > 20) ──
  if (ema50 && ema200) {
    const prevEma50 = previousIndicators?.find((i) => i.indicator === 'EMA_50');
    const prevEma200 = previousIndicators?.find((i) => i.indicator === 'EMA_200');
    const hasTrend = adxValue > 20; // Only fire crosses in trending markets

    // Golden Cross: EMA50 crosses above EMA200
    if (hasTrend && canFireDirectional && ema50.value > ema200.value && prevEma50 && prevEma200 && prevEma50.value <= prevEma200.value) {
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
    if (hasTrend && canFireDirectional && ema50.value < ema200.value && prevEma50 && prevEma200 && prevEma50.value >= prevEma200.value) {
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

  // ─── MACD Signals (with histogram confirmation) ─────────
  const macd = indicators.find((i) => i.indicator === 'MACD');
  const macdSignal = indicators.find((i) => i.indicator === 'MACD_SIGNAL');
  const macdHist = indicators.find((i) => i.indicator === 'MACD_HISTOGRAM');

  if (macd && macdSignal) {
    const prevMacd = previousIndicators?.find((i) => i.indicator === 'MACD');
    const prevMacdSignal = previousIndicators?.find((i) => i.indicator === 'MACD_SIGNAL');
    const histPositive = macdHist ? macdHist.value > 0 : true;
    const histNegative = macdHist ? macdHist.value < 0 : true;

    // Bullish MACD crossover — require histogram > 0 (confirmation)
    if (
      canFireDirectional &&
      macd.value > macdSignal.value &&
      histPositive &&
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

    // Bearish MACD crossover — require histogram < 0 (confirmation)
    if (
      canFireDirectional &&
      macd.value < macdSignal.value &&
      histNegative &&
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

  // ─── 52-Week High/Low Signals (tightened proximity: max 2%) ──
  if (quote.week52High > 0 && quote.week52Low > 0) {
    const range52w = quote.week52High - quote.week52Low;
    const positionIn52w = (quote.price - quote.week52Low) / range52w;
    const tight52w = Math.min(proximity52w, 0.02); // Cap at 2%

    // Near 52-week high
    if (positionIn52w >= 1 - tight52w) {
      signals.push({
        type: quote.price >= quote.week52High ? '52W_BREAKOUT' : '52W_HIGH_PROXIMITY',
        priority: quote.price >= quote.week52High ? 'CRITICAL' : 'IMPORTANT',
        symbol: quote.symbol,
        title: quote.price >= quote.week52High
          ? `🚀 New 52-Week High!`
          : `Near 52-Week High (${(positionIn52w * 100).toFixed(1)}%)`,
        description: `Price: $${quote.price.toFixed(2)} | 52W High: $${quote.week52High.toFixed(2)} | 52W Low: $${quote.week52Low.toFixed(2)}`,
        value: positionIn52w,
        threshold: 1 - tight52w,
        timestamp: Date.now(),
      });
    }

    // Near 52-week low
    if (positionIn52w <= tight52w) {
      signals.push({
        type: quote.price <= quote.week52Low ? '52W_BREAKDOWN' : '52W_LOW_PROXIMITY',
        priority: quote.price <= quote.week52Low ? 'CRITICAL' : 'IMPORTANT',
        symbol: quote.symbol,
        title: quote.price <= quote.week52Low
          ? `⚠️ New 52-Week Low!`
          : `Near 52-Week Low (${(positionIn52w * 100).toFixed(1)}%)`,
        description: `Price: $${quote.price.toFixed(2)} | 52W High: $${quote.week52High.toFixed(2)} | 52W Low: $${quote.week52Low.toFixed(2)}`,
        value: positionIn52w,
        threshold: tight52w,
        timestamp: Date.now(),
      });
    }
  }

  // ─── Volume Spike Signal (tightened: require 2.0x minimum) ──
  if (quote.volume > 0 && quote.avgVolume > 0) {
    const volumeRatio = quote.volume / quote.avgVolume;
    const minVolMultiplier = Math.max(volumeMultiplier, 2.0); // Floor at 2.0x
    if (volumeRatio >= minVolMultiplier) {
      signals.push({
        type: 'VOLUME_SPIKE',
        priority: volumeRatio >= 3 ? 'CRITICAL' : 'IMPORTANT',
        symbol: quote.symbol,
        title: `Volume Spike: ${volumeRatio.toFixed(1)}x average`,
        description: `Volume: ${formatNumber(quote.volume)} vs Avg: ${formatNumber(quote.avgVolume)}`,
        value: volumeRatio,
        threshold: minVolMultiplier,
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
