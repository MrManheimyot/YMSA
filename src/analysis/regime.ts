// ─── Market Regime Detector ──────────────────────────────────
// Detects current market condition to guide strategy selection
// Powers multi-engine orchestration and dynamic weight adjustment

import type { Env } from '../types';
import type { EngineId, RegimeType } from '../agents/types';

// ─── Types ───────────────────────────────────────────────────

export interface MarketRegime {
  regime: RegimeType;
  confidence: number;       // 0-100
  vix: number;
  adx: number;
  emaGap: number;           // EMA50-EMA200 gap percentage
  bollingerWidth: number;   // percentage
  suggestedEngines: EngineId[];
  timestamp: number;
}

export interface EngineWeightAdjustments {
  MTF_MOMENTUM: number;
  SMART_MONEY: number;
  STAT_ARB: number;
  OPTIONS: number;
  CRYPTO_DEFI: number;
  EVENT_DRIVEN: number;
}

// ─── Main Detection Function ─────────────────────────────────

/**
 * Detect current market regime by analyzing SPY indicators via TAAPI.
 */
export async function detectRegime(env: Env): Promise<MarketRegime> {
  try {
    const data = await fetchSPYData(env);

    const ema50 = data.ema50 ?? 0;
    const ema200 = data.ema200 ?? 0;
    const adx = data.adx ?? 20;
    const bbUpper = data.bbUpper ?? 0;
    const bbLower = data.bbLower ?? 0;
    const bbMid = data.bbMid ?? 0;
    const atr = data.atr ?? 0;
    const close = data.close ?? 0;
    const vix = data.vix ?? 20;

    const emaGap = ema200 > 0 ? ((ema50 - ema200) / ema200) * 100 : 0;
    const bollingerWidth = bbMid > 0 ? ((bbUpper - bbLower) / bbMid) * 100 : 3;
    const atrPct = close > 0 ? (atr / close) * 100 : 1;

    let regime: RegimeType;
    let confidence: number;

    if (vix > 30 || atrPct > 3) {
      regime = 'VOLATILE';
      confidence = Math.min(95, 50 + (vix - 20) * 2);
    } else if (adx > 25) {
      if (close > ema200 && ema50 > ema200) {
        regime = 'TRENDING_UP';
        confidence = Math.min(95, 50 + adx);
      } else if (close < ema200 && ema50 < ema200) {
        regime = 'TRENDING_DOWN';
        confidence = Math.min(95, 50 + adx);
      } else {
        regime = 'RANGING';
        confidence = 45;
      }
    } else if (adx < 20 && bollingerWidth < 3) {
      regime = 'RANGING';
      confidence = Math.min(85, 60 + (20 - adx) * 2);
    } else {
      regime = close > ema50 ? 'TRENDING_UP' : 'TRENDING_DOWN';
      confidence = 40;
    }

    const suggestedEngines = getEnginesForRegime(regime, vix);

    // Store in D1 for tracking
    if (env.DB) {
      await env.DB.prepare(
        `INSERT INTO regime_history (regime, vix, adx, spy_ema50_200_gap, detected_at) VALUES (?, ?, ?, ?, ?)`
      ).bind(regime, vix, adx, emaGap, Date.now()).run().catch(() => {});
    }

    return { regime, confidence, vix, adx, emaGap, bollingerWidth, suggestedEngines, timestamp: Date.now() };
  } catch (err) {
    console.error('[REGIME] Detection error:', err);
    return {
      regime: 'RANGING', confidence: 30, vix: 20, adx: 15,
      emaGap: 0, bollingerWidth: 3, suggestedEngines: ['STAT_ARB', 'OPTIONS'],
      timestamp: Date.now(),
    };
  }
}

/**
 * Get engine weight adjustments based on regime.
 * Returns multipliers (0.5-2.0) for each engine.
 */
export function getEngineAdjustments(regime: MarketRegime): EngineWeightAdjustments {
  switch (regime.regime) {
    case 'TRENDING_UP':
      return {
        MTF_MOMENTUM: 1.5,
        SMART_MONEY: 1.3,
        STAT_ARB: 0.7,
        OPTIONS: 0.8,
        CRYPTO_DEFI: 1.4,
        EVENT_DRIVEN: 1.0,
      };
    case 'TRENDING_DOWN':
      return {
        MTF_MOMENTUM: 1.3,
        SMART_MONEY: 1.2,
        STAT_ARB: 1.0,
        OPTIONS: 1.2,
        CRYPTO_DEFI: 0.7,
        EVENT_DRIVEN: 1.0,
      };
    case 'RANGING':
      return {
        MTF_MOMENTUM: 0.7,
        SMART_MONEY: 1.0,
        STAT_ARB: 1.6,
        OPTIONS: 1.5,
        CRYPTO_DEFI: 0.8,
        EVENT_DRIVEN: 1.0,
      };
    case 'VOLATILE':
      return {
        MTF_MOMENTUM: 0.5,
        SMART_MONEY: 0.7,
        STAT_ARB: 1.3,
        OPTIONS: 1.8,
        CRYPTO_DEFI: 1.2,
        EVENT_DRIVEN: 1.5,
      };
  }
}

/**
 * Format regime for Telegram alert
 */
export function formatRegimeAlert(regime: MarketRegime): string {
  const emoji: Record<RegimeType, string> = {
    TRENDING_UP: '🟢', TRENDING_DOWN: '🔴', RANGING: '🟡', VOLATILE: '🟣',
  };
  return [
    `${emoji[regime.regime]} <b>Regime: ${regime.regime}</b>`,
    `Confidence: ${regime.confidence}% | VIX: ${regime.vix.toFixed(1)} | ADX: ${regime.adx.toFixed(1)}`,
    `EMA Gap: ${regime.emaGap.toFixed(2)}% | BB Width: ${regime.bollingerWidth.toFixed(2)}%`,
    `Engines: ${regime.suggestedEngines.join(', ')}`,
  ].join('\n');
}

// ─── Internal ────────────────────────────────────────────────

function getEnginesForRegime(regime: RegimeType, vix: number): EngineId[] {
  switch (regime) {
    case 'TRENDING_UP':
      return ['MTF_MOMENTUM', 'SMART_MONEY', 'CRYPTO_DEFI'];
    case 'TRENDING_DOWN':
      return ['MTF_MOMENTUM', 'OPTIONS', 'STAT_ARB'];
    case 'RANGING':
      return ['STAT_ARB', 'OPTIONS', 'EVENT_DRIVEN'];
    case 'VOLATILE':
      return vix > 35
        ? ['STAT_ARB', 'OPTIONS']
        : ['OPTIONS', 'STAT_ARB', 'EVENT_DRIVEN'];
  }
}

interface SPYData {
  ema50: number; ema200: number; adx: number;
  bbUpper: number; bbLower: number; bbMid: number;
  atr: number; close: number; vix: number;
}

async function fetchSPYData(env: Env): Promise<SPYData> {
  // Check cache
  if (env.YMSA_CACHE) {
    const cached = await env.YMSA_CACHE.get('regime:spy_data');
    if (cached) return JSON.parse(cached);
  }

  const body = {
    secret: env.TAAPI_API_KEY,
    construct: {
      type: 'stocks',
      symbol: 'SPY',
      interval: '1d',
      indicators: [
        { id: 'ema50', indicator: 'ema', period: 50 },
        { id: 'ema200', indicator: 'ema', period: 200 },
        { id: 'adx', indicator: 'adx' },
        { id: 'bbands', indicator: 'bbands', period: 20 },
        { id: 'atr', indicator: 'atr', period: 14 },
      ],
    },
  };

  const res = await fetch('https://api.taapi.io/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result: SPYData = { ema50: 0, ema200: 0, adx: 20, bbUpper: 0, bbLower: 0, bbMid: 0, atr: 0, close: 0, vix: 20 };

  if (res.ok) {
    const json = await res.json() as { data: Array<{ id: string; result: Record<string, number> }> };
    for (const item of json.data || []) {
      const r = item.result;
      switch (item.id) {
        case 'ema50': result.ema50 = r.value ?? 0; result.close = r.value ?? 0; break;
        case 'ema200': result.ema200 = r.value ?? 0; break;
        case 'adx': result.adx = r.value ?? 20; break;
        case 'bbands':
          result.bbUpper = r.valueUpperBand ?? 0;
          result.bbLower = r.valueLowerBand ?? 0;
          result.bbMid = r.valueMiddleBand ?? 0;
          break;
        case 'atr': result.atr = r.value ?? 0; break;
      }
    }
  }

  // Fetch VIX from Yahoo Finance
  try {
    const vixRes = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=1d');
    if (vixRes.ok) {
      const vixJson = await vixRes.json() as any;
      const quote = vixJson?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (quote) result.vix = quote;
    }
  } catch { /* VIX fetch is best-effort */ }

  if (env.YMSA_CACHE) {
    await env.YMSA_CACHE.put('regime:spy_data', JSON.stringify(result), { expirationTtl: 300 });
  }

  return result;
}
