// ─── Multi-Timeframe Analysis Engine ───────────────────────────
// Triple-Screen System: 4 timeframes with confluence scoring
// Engine 1: Target 8-12% monthly via momentum & mean reversion

import type { Env, OHLCV } from '../types';
import { getOHLCV } from '../api/yahoo-finance';
import { computeIndicators } from './indicators';

// ─── Types ───────────────────────────────────────────────────

export type TrendDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface SignalZone {
  type: 'SUPPORT' | 'RESISTANCE' | 'MID_RANGE';
  strength: number;
  rsiDivergence: boolean;
  bollingerSqueeze: boolean;
}

export interface EntryTrigger {
  type: 'BUY_TRIGGER' | 'SELL_TRIGGER' | 'NO_TRIGGER';
  stochasticCross: boolean;
  emaCrossover: boolean;
  volumeConfirmed: boolean;
  confidence: number;
}

export interface MTFSignal {
  symbol: string;
  weekly: TrendDirection;
  daily: SignalZone;
  h4: EntryTrigger;
  regime: 'TRENDING' | 'RANGING' | 'VOLATILE';
  confluence: number;       // 0-100
  suggestedAction: 'BUY' | 'SELL' | 'WAIT';
  positionSize: number;     // 0, 0.5, or 1.0
  stopLoss: number;
  takeProfit: number;
  timestamp: number;
}

export interface MeanReversionSignal {
  symbol: string;
  bollingerSqueeze: boolean;
  rsiAtBand: 'LOWER' | 'UPPER' | 'MID';
  zScore: number;
  suggestion: 'FADE_UP' | 'FADE_DOWN' | 'NO_SIGNAL';
  confidence: number;
  timestamp: number;
}

// ─── Internal Types ──────────────────────────────────────────

interface BulkResult {
  rsi?: number;
  macd?: number;
  macdSignal?: number;
  macdHist?: number;
  ema9?: number;
  ema21?: number;
  ema55?: number;
  ema200?: number;
  adx?: number;
  atr?: number;
  stochK?: number;
  stochD?: number;
  bbUpper?: number;
  bbMiddle?: number;
  bbLower?: number;
  supertrend?: number;
  close?: number;
}

// ─── Main Analysis Function ──────────────────────────────────

/**
 * Analyze symbol across 4 timeframes with confluence scoring.
 * Returns null if no actionable signal.
 */
export async function analyzeMultiTimeframe(
  symbol: string,
  env: Env
): Promise<MTFSignal | null> {
  try {
    const data: Record<string, BulkResult> = {};

    // Primary: Use Yahoo Finance OHLCV + local indicators (free, reliable)
    const [weeklyOhlcv, dailyOhlcv] = await Promise.all([
      getOHLCV(symbol, '2y', '1wk'),
      getOHLCV(symbol, '1y', '1d'),
    ]);

    if (dailyOhlcv.length < 30) return null;

    data['weekly'] = buildBulkFromOHLCV(weeklyOhlcv);
    data['daily'] = buildBulkFromOHLCV(dailyOhlcv);
    // Use daily data as 4H proxy (Yahoo free tier doesn't have 4h for stocks)
    // Use most recent 60 daily candles to approximate shorter-term behavior
    data['h4'] = buildBulkFromOHLCV(dailyOhlcv.slice(0, 60));

    // Optional: Enhance with TAAPI if available and cached
    if (env.TAAPI_API_KEY && env.YMSA_CACHE) {
      for (const tf of ['weekly', 'daily', 'h4'] as const) {
        const interval = tf === 'weekly' ? '1w' : tf === 'daily' ? '1d' : '4h';
        const cacheKey = `mtf:${symbol}:${interval}`;
        const cached = await env.YMSA_CACHE.get(cacheKey);
        if (cached) {
          const taapiData = JSON.parse(cached) as BulkResult;
          // Merge TAAPI data (stochastic, supertrend not in local calc)
          if (taapiData.stochK != null) data[tf].stochK = taapiData.stochK;
          if (taapiData.stochD != null) data[tf].stochD = taapiData.stochD;
          if (taapiData.supertrend != null) data[tf].supertrend = taapiData.supertrend;
        }
      }
    }

    // Analyze each timeframe
    const weekly = analyzeWeekly(data['weekly']);
    const daily = analyzeDaily(data['daily']);
    const h4 = analyzeH4(data['h4']);
    const regime = detectRegimeFromIndicators(data['daily']);

    // Calculate confluence
    const confluence = calcConfluence(weekly, daily, h4, regime);

    if (confluence < 65) return null;

    const action: 'BUY' | 'SELL' | 'WAIT' =
      confluence >= 70
        ? weekly === 'BULLISH' && h4.type === 'BUY_TRIGGER' ? 'BUY'
          : weekly === 'BEARISH' && h4.type === 'SELL_TRIGGER' ? 'SELL'
            : 'WAIT'
        : 'WAIT';

    if (action === 'WAIT') return null;

    const atr = data['h4']?.atr ?? data['daily']?.atr ?? 0;
    const price = data['daily']?.close ?? 0;

    return {
      symbol,
      weekly,
      daily,
      h4,
      regime,
      confluence,
      suggestedAction: action,
      positionSize: confluence >= 85 ? 1.0 : 0.5,
      stopLoss: action === 'BUY' ? price - atr * 2 : price + atr * 2,
      takeProfit: action === 'BUY' ? price + atr * 3 : price - atr * 3,
      timestamp: Date.now(),
    };
  } catch (err) {
    console.error(`[MTF] Error analyzing ${symbol}:`, err);
    return null;
  }
}

/**
 * Build BulkResult from OHLCV candles using local indicator computation.
 * Eliminates dependency on TAAPI API for core functionality.
 */
function buildBulkFromOHLCV(candles: OHLCV[]): BulkResult {
  if (candles.length < 30) return {};
  const indicators = computeIndicators('_', candles);
  const ind = (name: string) => indicators.find(i => i.indicator === name)?.value;

  // Chronological order for BB calculation
  const chronological = [...candles].reverse();
  const prices = chronological.map(c => c.close);

  // Bollinger Bands (20-period)
  let bbUpper: number | undefined, bbMiddle: number | undefined, bbLower: number | undefined;
  if (prices.length >= 20) {
    const slice = prices.slice(prices.length - 20);
    const mean = slice.reduce((s, p) => s + p, 0) / 20;
    const variance = slice.reduce((s, p) => s + (p - mean) ** 2, 0) / 20;
    const stdDev = Math.sqrt(variance);
    bbMiddle = mean;
    bbUpper = mean + 2 * stdDev;
    bbLower = mean - 2 * stdDev;
  }

  // EMA 9, 21, 55 (local calc)
  const ema9 = calcLocalEMA(prices, 9);
  const ema21 = calcLocalEMA(prices, 21);
  const ema55 = calcLocalEMA(prices, 55);

  return {
    rsi: ind('RSI'),
    macd: ind('MACD'),
    macdSignal: ind('MACD_SIGNAL'),
    macdHist: ind('MACD_HISTOGRAM'),
    ema9: ema9 ?? undefined,
    ema21: ema21 ?? undefined,
    ema55: ema55 ?? undefined,
    ema200: ind('EMA_200') ?? ind('SMA_200'),
    adx: calcLocalADX(chronological),
    atr: ind('ATR'),
    bbUpper,
    bbMiddle,
    bbLower,
    close: candles[0]?.close, // Most recent (Yahoo Finance default order)
  };
}

function calcLocalEMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((s, p) => s + p, 0) / period;
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calcLocalADX(candles: OHLCV[], period: number = 14): number | undefined {
  if (candles.length < period * 2) return undefined;
  let plusDMSum = 0, minusDMSum = 0, trSum = 0;
  for (let i = 1; i <= period; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;
    const tr = Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
    plusDMSum += plusDM; minusDMSum += minusDM; trSum += tr;
  }
  const dxValues: number[] = [];
  for (let i = period + 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;
    const tr = Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close));
    plusDMSum = plusDMSum - plusDMSum / period + plusDM;
    minusDMSum = minusDMSum - minusDMSum / period + minusDM;
    trSum = trSum - trSum / period + tr;
    const plusDI = trSum > 0 ? (plusDMSum / trSum) * 100 : 0;
    const minusDI = trSum > 0 ? (minusDMSum / trSum) * 100 : 0;
    const diSum = plusDI + minusDI;
    if (diSum > 0) dxValues.push(Math.abs(plusDI - minusDI) / diSum * 100);
  }
  if (dxValues.length < period) return undefined;
  let adx = dxValues.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < dxValues.length; i++) adx = (adx * (period - 1) + dxValues[i]) / period;
  return adx;
}

/**
 * Mean reversion detector for when ADX < 20 (range-bound)
 */
export function detectMeanReversion(
  symbol: string,
  data: BulkResult
): MeanReversionSignal | null {
  const adx = data.adx ?? 25;
  if (adx >= 20) return null;

  const rsi = data.rsi ?? 50;
  const bbUpper = data.bbUpper ?? 0;
  const bbLower = data.bbLower ?? 0;
  const bbMid = data.bbMiddle ?? 0;
  const close = data.close ?? 0;

  const bbWidth = bbMid > 0 ? ((bbUpper - bbLower) / bbMid) * 100 : 5;
  const bollingerSqueeze = bbWidth < 2;

  const rsiAtBand: 'LOWER' | 'UPPER' | 'MID' =
    rsi < 30 ? 'LOWER' : rsi > 70 ? 'UPPER' : 'MID';

  const zScore = bbMid > 0 && bbUpper > bbLower
    ? (close - bbMid) / ((bbUpper - bbLower) / 4) // approx 2 std devs
    : 0;

  let suggestion: 'FADE_UP' | 'FADE_DOWN' | 'NO_SIGNAL' = 'NO_SIGNAL';
  let confidence = 0;

  if (Math.abs(zScore) > 2.0) {
    suggestion = zScore > 0 ? 'FADE_DOWN' : 'FADE_UP';
    confidence = 70 + (bollingerSqueeze ? 15 : 0);
  } else if (rsiAtBand !== 'MID' && bollingerSqueeze) {
    suggestion = rsiAtBand === 'LOWER' ? 'FADE_UP' : 'FADE_DOWN';
    confidence = 60;
  }

  if (suggestion === 'NO_SIGNAL') return null;

  return {
    symbol,
    bollingerSqueeze,
    rsiAtBand,
    zScore,
    suggestion,
    confidence: Math.min(100, confidence),
    timestamp: Date.now(),
  };
}

/**
 * Format MTF signal for Telegram
 */
export function formatMTFAlert(signal: MTFSignal): string {
  const emoji = signal.suggestedAction === 'BUY' ? '🟢' : '🔴';
  const size = signal.positionSize === 1 ? 'FULL' : 'HALF';
  return [
    `${emoji} <b>MTF Signal — ${signal.symbol}</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `🎯 Action: <b>${signal.suggestedAction}</b> (${size} position)`,
    `📊 Confluence: <b>${signal.confluence}/100</b>`,
    `📅 Weekly: ${signal.weekly}`,
    `📆 Daily: ${signal.daily.type} (str: ${signal.daily.strength})`,
    `⏰ 4H: ${signal.h4.type} (conf: ${signal.h4.confidence}%)`,
    `🌡️ Regime: ${signal.regime}`,
    `🛑 Stop: $${signal.stopLoss.toFixed(2)}`,
    `💰 Target: $${signal.takeProfit.toFixed(2)}`,
    `⏲️ ${new Date(signal.timestamp).toISOString()}`,
  ].join('\n');
}

// ─── Internal Helpers (TAAPI — kept for optional cache warming) ──

export async function fetchBulkMTF(
  symbol: string,
  interval: string,
  apiKey: string
): Promise<BulkResult> {
  const body = {
    secret: apiKey,
    construct: {
      type: 'stocks',
      symbol,
      interval,
      indicators: [
        { id: 'rsi', indicator: 'rsi', period: 14 },
        { id: 'macd', indicator: 'macd' },
        { id: 'ema9', indicator: 'ema', period: 9 },
        { id: 'ema21', indicator: 'ema', period: 21 },
        { id: 'ema55', indicator: 'ema', period: 55 },
        { id: 'ema200', indicator: 'ema', period: 200 },
        { id: 'adx', indicator: 'adx' },
        { id: 'atr', indicator: 'atr', period: 14 },
        { id: 'stoch', indicator: 'stoch' },
        { id: 'bbands', indicator: 'bbands', period: 20 },
        { id: 'supertrend', indicator: 'supertrend' },
      ],
    },
  };

  const res = await fetch('https://api.taapi.io/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    console.error(`[MTF] TAAPI bulk error ${res.status} for ${symbol}/${interval}`);
    return {};
  }

  const json = await res.json() as { data: Array<{ id: string; result: Record<string, number>; errors?: string[] }> };
  const result: BulkResult = {};

  for (const item of json.data || []) {
    if (item.errors?.length) continue;
    const r = item.result;
    switch (item.id) {
      case 'rsi': result.rsi = r.value; break;
      case 'macd':
        result.macd = r.valueMACD;
        result.macdSignal = r.valueMACDSignal;
        result.macdHist = r.valueMACDHist;
        break;
      case 'ema9': result.ema9 = r.value; break;
      case 'ema21': result.ema21 = r.value; break;
      case 'ema55': result.ema55 = r.value; break;
      case 'ema200': result.ema200 = r.value; break;
      case 'adx': result.adx = r.value; break;
      case 'atr': result.atr = r.value; break;
      case 'stoch':
        result.stochK = r.valueFastK;
        result.stochD = r.valueFastD;
        break;
      case 'bbands':
        result.bbUpper = r.valueUpperBand;
        result.bbMiddle = r.valueMiddleBand;
        result.bbLower = r.valueLowerBand;
        break;
      case 'supertrend': result.supertrend = r.value; break;
    }
  }

  return result;
}

function analyzeWeekly(data: BulkResult): TrendDirection {
  const ema21 = data.ema21 ?? 0;
  const ema55 = data.ema55 ?? 0;
  const macdHist = data.macdHist ?? 0;
  const adx = data.adx ?? 0;

  let bull = 0, bear = 0;

  if (ema21 > ema55) bull++; else bear++;
  if (macdHist > 0) bull++; else bear++;
  if (adx > 25) {
    if (macdHist > 0) bull += 2; else bear += 2;
  }

  return bull > bear ? 'BULLISH' : bear > bull ? 'BEARISH' : 'NEUTRAL';
}

function analyzeDaily(data: BulkResult): SignalZone {
  const rsi = data.rsi ?? 50;
  const bbUpper = data.bbUpper ?? 0;
  const bbLower = data.bbLower ?? 0;
  const bbMid = data.bbMiddle ?? 0;

  const type: SignalZone['type'] =
    rsi < 40 ? 'SUPPORT' : rsi > 60 ? 'RESISTANCE' : 'MID_RANGE';

  const bbWidth = bbMid > 0 ? ((bbUpper - bbLower) / bbMid) * 100 : 5;
  const bollingerSqueeze = bbWidth < 2;
  const rsiDivergence = rsi < 30 || rsi > 70;
  const strength = Math.round(
    (type !== 'MID_RANGE' ? 50 : 30) +
    (rsiDivergence ? 25 : 0) +
    (bollingerSqueeze ? 15 : 0)
  );

  return { type, strength: Math.min(100, strength), rsiDivergence, bollingerSqueeze };
}

function analyzeH4(data: BulkResult): EntryTrigger {
  const stochK = data.stochK ?? 50;
  const stochD = data.stochD ?? 50;
  const ema9 = data.ema9 ?? 0;
  const ema21 = data.ema21 ?? 0;

  const stochasticCross =
    (stochK > stochD && stochK < 80) || (stochK < stochD && stochK > 20);
  const emaCrossover = ema9 !== 0 && ema21 !== 0 && Math.abs(ema9 - ema21) / ema21 < 0.02;
  const volumeConfirmed = true; // TAAPI bulk doesn't return volume ratio, assume true

  const type: EntryTrigger['type'] =
    stochasticCross && ema9 > ema21 ? 'BUY_TRIGGER'
      : stochasticCross && ema9 < ema21 ? 'SELL_TRIGGER'
        : 'NO_TRIGGER';

  const confidence =
    (stochasticCross ? 35 : 0) +
    (emaCrossover ? 30 : 0) +
    (volumeConfirmed ? 20 : 0) +
    (type !== 'NO_TRIGGER' ? 15 : 0);

  return { type, stochasticCross, emaCrossover, volumeConfirmed, confidence: Math.min(100, confidence) };
}

function detectRegimeFromIndicators(data: BulkResult): 'TRENDING' | 'RANGING' | 'VOLATILE' {
  const adx = data.adx ?? 20;
  const atr = data.atr ?? 0;
  const close = data.close ?? 1;
  const atrPct = (atr / close) * 100;

  if (adx > 25) return 'TRENDING';
  if (atrPct > 3) return 'VOLATILE';
  return 'RANGING';
}

function calcConfluence(
  weekly: TrendDirection,
  daily: SignalZone,
  h4: EntryTrigger,
  regime: string
): number {
  let score = 0;

  // Weekly trend (30pts)
  if (weekly !== 'NEUTRAL') score += 30; else score += 10;

  // Daily zone (25pts)
  score += (daily.strength / 100) * 25;

  // H4 trigger (25pts)
  score += (h4.confidence / 100) * 25;

  // Regime bonus (20pts)
  if (regime === 'TRENDING') score += 20;
  else if (regime === 'VOLATILE') score += 10;
  else score += 5;

  return Math.min(100, Math.round(score));
}
