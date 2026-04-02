// ─── Smart Money Concepts Detection ──────────────────────────
// Engine 2: Detects institutional order blocks, fair value gaps,
// liquidity sweeps, and break of structure. Target: 6-10%/mo

import type { OHLCV } from '../types';

// ─── Types ───────────────────────────────────────────────────

export interface SmartMoneySignal {
  type: 'ORDER_BLOCK' | 'FVG' | 'LIQUIDITY_SWEEP' | 'BOS' | 'INSIDER_BUY';
  direction: 'BULLISH' | 'BEARISH';
  zone: { high: number; low: number };
  age: number;        // candles since formation
  strength: number;   // 0-100
  filled: boolean;    // has price returned to zone?
  confluence: string[];
}

export interface SmartMoneyAnalysis {
  symbol: string;
  signals: SmartMoneySignal[];
  overallBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number;      // 0-100
  timestamp: number;
}

// ─── Order Block Detection ──────────────────────────────────

/**
 * Find last opposing candle before a strong impulse move.
 * Bullish OB: last bearish candle before 3+ bullish candles moving >2%
 * Bearish OB: last bullish candle before 3+ bearish candles moving >2%
 */
export function detectOrderBlocks(candles: OHLCV[]): SmartMoneySignal[] {
  const signals: SmartMoneySignal[] = [];
  if (candles.length < 5) return signals;

  for (let i = 1; i < candles.length - 3; i++) {
    const c = candles[i];
    const isBearish = c.close < c.open;
    const isBullish = c.close > c.open;

    if (isBearish && hasImpulse(candles, i + 1, 'UP')) {
      signals.push({
        type: 'ORDER_BLOCK',
        direction: 'BULLISH',
        zone: { high: c.high, low: c.low },
        age: candles.length - 1 - i,
        strength: Math.min(100, Math.abs((c.close - c.open) / c.open) * 500),
        filled: false,
        confluence: ['impulse_follow'],
      });
    }

    if (isBullish && hasImpulse(candles, i + 1, 'DOWN')) {
      signals.push({
        type: 'ORDER_BLOCK',
        direction: 'BEARISH',
        zone: { high: c.high, low: c.low },
        age: candles.length - 1 - i,
        strength: Math.min(100, Math.abs((c.close - c.open) / c.open) * 500),
        filled: false,
        confluence: ['impulse_follow'],
      });
    }
  }

  return signals;
}

// ─── Fair Value Gap Detection ────────────────────────────────

/**
 * 3-candle pattern where price jumped leaving a gap.
 * Bullish FVG: candle1.high < candle3.low
 * Bearish FVG: candle1.low > candle3.high
 */
export function detectFairValueGaps(candles: OHLCV[]): SmartMoneySignal[] {
  const signals: SmartMoneySignal[] = [];
  if (candles.length < 3) return signals;

  for (let i = 0; i < candles.length - 2; i++) {
    const c1 = candles[i];
    const c3 = candles[i + 2];

    if (c1.high < c3.low) {
      const gapSize = ((c3.low - c1.high) / c1.high) * 100;
      signals.push({
        type: 'FVG',
        direction: 'BULLISH',
        zone: { high: c3.low, low: c1.high },
        age: candles.length - 1 - i,
        strength: Math.min(100, gapSize * 10),
        filled: false,
        confluence: ['price_gap'],
      });
    }

    if (c1.low > c3.high) {
      const gapSize = ((c1.low - c3.high) / c1.low) * 100;
      signals.push({
        type: 'FVG',
        direction: 'BEARISH',
        zone: { high: c1.low, low: c3.high },
        age: candles.length - 1 - i,
        strength: Math.min(100, gapSize * 10),
        filled: false,
        confluence: ['price_gap'],
      });
    }
  }

  return signals;
}

// ─── Liquidity Sweep Detection ──────────────────────────────

/**
 * Price pushes below recent low (grabs stops) then reverses strong.
 * Bullish sweep: Low below recent range + bullish reversal candle.
 */
export function detectLiquiditySweeps(candles: OHLCV[], lookback: number = 20): SmartMoneySignal[] {
  const signals: SmartMoneySignal[] = [];
  if (candles.length < lookback + 2) return signals;

  const recent = candles.slice(-(lookback + 1), -1);
  const avgBody = recent.reduce((s, c) => s + Math.abs(c.close - c.open), 0) / recent.length;
  const minLow = Math.min(...recent.map(c => c.low));
  const maxHigh = Math.max(...recent.map(c => c.high));

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];

  // Bullish sweep
  if (prev.low < minLow && last.close > last.open) {
    const body = Math.abs(last.close - last.open);
    if (body > avgBody * 1.5) {
      signals.push({
        type: 'LIQUIDITY_SWEEP',
        direction: 'BULLISH',
        zone: { high: minLow, low: prev.low },
        age: 0,
        strength: Math.min(100, (body / avgBody) * 30),
        filled: true,
        confluence: ['stop_hunt', 'strong_reversal'],
      });
    }
  }

  // Bearish sweep
  if (prev.high > maxHigh && last.close < last.open) {
    const body = Math.abs(last.close - last.open);
    if (body > avgBody * 1.5) {
      signals.push({
        type: 'LIQUIDITY_SWEEP',
        direction: 'BEARISH',
        zone: { high: prev.high, low: maxHigh },
        age: 0,
        strength: Math.min(100, (body / avgBody) * 30),
        filled: true,
        confluence: ['stop_hunt', 'strong_reversal'],
      });
    }
  }

  return signals;
}

// ─── Break of Structure Detection ───────────────────────────

/**
 * Confirms trend change when last swing high/low is broken.
 */
export function detectBreakOfStructure(candles: OHLCV[]): SmartMoneySignal[] {
  const signals: SmartMoneySignal[] = [];
  if (candles.length < 5) return signals;

  const recent = candles.slice(-5);
  let swingHigh = recent[0].high, swingHighIdx = 0;
  let swingLow = recent[0].low, swingLowIdx = 0;

  for (let i = 1; i < recent.length; i++) {
    if (recent[i].high > swingHigh) { swingHigh = recent[i].high; swingHighIdx = i; }
    if (recent[i].low < swingLow) { swingLow = recent[i].low; swingLowIdx = i; }
  }

  const last = recent[recent.length - 1];

  // Bullish BOS
  if (swingLowIdx < swingHighIdx && last.close > last.open && last.close > swingHigh) {
    signals.push({
      type: 'BOS',
      direction: 'BULLISH',
      zone: { high: last.high, low: swingLow },
      age: 1,
      strength: Math.min(100, ((last.close - swingHigh) / swingHigh) * 1000),
      filled: true,
      confluence: ['higher_high'],
    });
  }

  // Bearish BOS
  if (swingHighIdx < swingLowIdx && last.close < last.open && last.close < swingLow) {
    signals.push({
      type: 'BOS',
      direction: 'BEARISH',
      zone: { high: swingHigh, low: last.low },
      age: 1,
      strength: Math.min(100, ((swingLow - last.close) / swingLow) * 1000),
      filled: true,
      confluence: ['lower_low'],
    });
  }

  return signals;
}

// ─── Combined Analysis ──────────────────────────────────────

/**
 * Run all smart money detectors and return combined analysis.
 */
export function analyzeSmartMoney(
  symbol: string,
  candles: OHLCV[],
  currentPrice: number
): SmartMoneyAnalysis {
  const ob = detectOrderBlocks(candles);
  const fvg = detectFairValueGaps(candles);
  const sweep = detectLiquiditySweeps(candles);
  const bos = detectBreakOfStructure(candles);

  const allSignals = [...ob, ...fvg, ...sweep, ...bos];

  // Mark zones that have been filled (price returned to zone)
  for (const sig of allSignals) {
    if (currentPrice >= sig.zone.low && currentPrice <= sig.zone.high) {
      sig.filled = true;
    }
  }

  let bullScore = 0, bearScore = 0;
  for (const s of allSignals) {
    // Age decay: zones lose 10% strength per 5 candles of age
    const ageDecay = Math.pow(0.9, s.age / 5);
    const adjustedStrength = s.strength * ageDecay;
    if (s.direction === 'BULLISH') bullScore += adjustedStrength;
    else bearScore += adjustedStrength;
  }

  const total = bullScore + bearScore;
  const normalized = total > 0 ? Math.round((bullScore / total) * 100) : 50;

  const overallBias: SmartMoneyAnalysis['overallBias'] =
    normalized > 60 ? 'BULLISH' : normalized < 40 ? 'BEARISH' : 'NEUTRAL';

  return { symbol, signals: allSignals, overallBias, score: normalized, timestamp: Date.now() };
}

/**
 * Format smart money analysis for Telegram
 */
export function formatSmartMoneyAlert(analysis: SmartMoneyAnalysis): string {
  const biasEmoji = analysis.overallBias === 'BULLISH' ? '📈' : analysis.overallBias === 'BEARISH' ? '📉' : '➡️';
  const lines = [
    `🧠 <b>Smart Money — ${analysis.symbol}</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `${biasEmoji} Bias: <b>${analysis.overallBias}</b> (Score: ${analysis.score}/100)`,
    `📊 Signals: ${analysis.signals.length} detected`,
  ];

  const byType: Record<string, SmartMoneySignal[]> = {};
  for (const s of analysis.signals) {
    (byType[s.type] ??= []).push(s);
  }

  for (const [type, sigs] of Object.entries(byType)) {
    const best = sigs.sort((a, b) => b.strength - a.strength)[0];
    lines.push(`  • ${type}: ${best.direction} str:${Math.round(best.strength)} age:${best.age}d`);
  }

  return lines.join('\n');
}

// ─── Internal Helpers ────────────────────────────────────────

function hasImpulse(candles: OHLCV[], startIdx: number, dir: 'UP' | 'DOWN'): boolean {
  let consecutive = 0;
  for (let i = startIdx; i < Math.min(startIdx + 5, candles.length); i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    if (!prev) continue;
    const pct = Math.abs((c.close - prev.close) / prev.close * 100);
    const ok = dir === 'UP' ? c.close > prev.close && pct > 0.5 : c.close < prev.close && pct > 0.5;
    if (ok) { consecutive++; if (consecutive >= 3) return true; }
    else consecutive = 0;
  }
  return false;
}
