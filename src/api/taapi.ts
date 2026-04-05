// ─── TAAPI.IO API Client ─────────────────────────────────────
// Provides: 200+ technical indicators with real-time data
// Free tier: 1 req/15sec — use bulk endpoint (20 calcs/request) to minimize calls
// Docs: https://taapi.io/documentation/stocks/

import type { Env, TechnicalIndicator, Timeframe } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('TAAPI');

const BASE_URL = 'https://api.taapi.io';

// ─── Rate Limiter ────────────────────────────────────────────
// Free tier: 1 request per 15 seconds
const RATE_LIMIT_MS = 15_500;
let lastRequestTime = 0;

async function rateLimitedWait(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS && lastRequestTime > 0) {
    const waitMs = RATE_LIMIT_MS - elapsed;
    logger.info(`Rate limit: waiting ${(waitMs / 1000).toFixed(1)}s`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  lastRequestTime = Date.now();
}

/**
 * Generic indicator fetch from TAAPI.IO (rate-limited)
 * Uses type=stocks for US equities (no exchange param needed)
 */
async function fetchIndicator(
  indicator: string,
  symbol: string,
  env: Env,
  interval: string = '1d',
  params: Record<string, string> = {}
): Promise<Record<string, number> | null> {
  await rateLimitedWait();

  const queryParams = new URLSearchParams({
    secret: env.TAAPI_API_KEY,
    type: 'stocks',
    symbol,
    interval,
    ...params,
  });

  try {
    const res = await fetch(`${BASE_URL}/${indicator}?${queryParams}`);
    if (res.status === 429) {
      console.warn(`[TAAPI] Rate limited on ${indicator}/${symbol} — will retry next cycle`);
      return null;
    }
    if (!res.ok) {
      console.error(`[TAAPI] ${indicator} error: ${res.status} ${res.statusText}`);
      return null;
    }
    return await res.json() as Record<string, number>;
  } catch (err) {
    console.error(`[TAAPI] ${indicator} error for ${symbol}:`, err);
    return null;
  }
}

/**
 * Fetch RSI(14) — Relative Strength Index
 */
export async function getRSI(
  symbol: string,
  env: Env,
  interval: string = '1d',
  period: number = 14
): Promise<TechnicalIndicator | null> {
  const data = await fetchIndicator('rsi', symbol, env, interval, {
    period: period.toString(),
  });

  if (!data || data.value === undefined) return null;

  return {
    symbol,
    indicator: 'RSI',
    value: data.value,
    timestamp: Date.now(),
    timeframe: mapInterval(interval),
  };
}

/**
 * Fetch MACD (12, 26, 9 default)
 */
export async function getMACD(
  symbol: string,
  env: Env,
  interval: string = '1d'
): Promise<TechnicalIndicator[] | null> {
  const data = await fetchIndicator('macd', symbol, env, interval);

  if (!data) return null;

  return [
    {
      symbol,
      indicator: 'MACD',
      value: data.valueMACD ?? 0,
      timestamp: Date.now(),
      timeframe: mapInterval(interval),
    },
    {
      symbol,
      indicator: 'MACD_SIGNAL',
      value: data.valueMACDSignal ?? 0,
      signal: data.valueMACDSignal ?? 0,
      timestamp: Date.now(),
      timeframe: mapInterval(interval),
    },
    {
      symbol,
      indicator: 'MACD_HISTOGRAM',
      value: data.valueMACDHist ?? 0,
      histogram: data.valueMACDHist ?? 0,
      timestamp: Date.now(),
      timeframe: mapInterval(interval),
    },
  ];
}

/**
 * Fetch EMA (Exponential Moving Average)
 */
export async function getEMA(
  symbol: string,
  period: number,
  env: Env,
  interval: string = '1d'
): Promise<TechnicalIndicator | null> {
  const data = await fetchIndicator('ema', symbol, env, interval, {
    period: period.toString(),
  });

  if (!data || data.value === undefined) return null;

  return {
    symbol,
    indicator: period === 50 ? 'EMA_50' : 'EMA_200',
    value: data.value,
    timestamp: Date.now(),
    timeframe: mapInterval(interval),
  };
}

/**
 * Fetch Bollinger Bands
 */
export async function getBollingerBands(
  symbol: string,
  env: Env,
  interval: string = '1d',
  period: number = 20
): Promise<TechnicalIndicator[] | null> {
  const data = await fetchIndicator('bbands', symbol, env, interval, {
    period: period.toString(),
  });

  if (!data) return null;

  return [
    {
      symbol,
      indicator: 'BOLLINGER_UPPER',
      value: data.valueUpperBand ?? 0,
      timestamp: Date.now(),
      timeframe: mapInterval(interval),
    },
    {
      symbol,
      indicator: 'BOLLINGER_MIDDLE',
      value: data.valueMiddleBand ?? 0,
      timestamp: Date.now(),
      timeframe: mapInterval(interval),
    },
    {
      symbol,
      indicator: 'BOLLINGER_LOWER',
      value: data.valueLowerBand ?? 0,
      timestamp: Date.now(),
      timeframe: mapInterval(interval),
    },
  ];
}

/**
 * Fetch ATR (Average True Range)
 */
export async function getATR(
  symbol: string,
  env: Env,
  interval: string = '1d',
  period: number = 14
): Promise<TechnicalIndicator | null> {
  const data = await fetchIndicator('atr', symbol, env, interval, {
    period: period.toString(),
  });

  if (!data || data.value === undefined) return null;

  return {
    symbol,
    indicator: 'ATR',
    value: data.value,
    timestamp: Date.now(),
    timeframe: mapInterval(interval),
  };
}

/**
 * Bulk fetch — get multiple indicators in ONE request using TAAPI bulk API
 * POST /bulk allows up to 20 indicator calculations per request (even free tier)
 * This uses 1 API call instead of 4, dramatically reducing rate limit impact
 */
export async function getBulkIndicators(
  symbol: string,
  env: Env,
  interval: string = '1d'
): Promise<TechnicalIndicator[]> {
  await rateLimitedWait();

  const body = {
    secret: env.TAAPI_API_KEY,
    construct: {
      type: 'stocks',
      symbol,
      interval,
      indicators: [
        { id: 'rsi', indicator: 'rsi', period: 14 },
        { id: 'macd', indicator: 'macd' },
        { id: 'ema50', indicator: 'ema', period: 50 },
        { id: 'ema200', indicator: 'ema', period: 200 },
      ],
    },
  };

  try {
    const res = await fetch(`${BASE_URL}/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.status === 429) {
      console.warn(`[TAAPI] Bulk rate limited for ${symbol}`);
      return [];
    }
    if (!res.ok) {
      console.error(`[TAAPI] Bulk error: ${res.status} ${res.statusText}`);
      return [];
    }

    const json = await res.json() as { data: Array<{ id: string; result: Record<string, number>; errors: string[] }> };
    const indicators: TechnicalIndicator[] = [];
    const tf = mapInterval(interval);

    for (const item of json.data) {
      if (item.errors?.length > 0) continue;

      if (item.id === 'rsi' && item.result?.value !== undefined) {
        indicators.push({ symbol, indicator: 'RSI', value: item.result.value, timestamp: Date.now(), timeframe: tf });
      } else if (item.id === 'macd') {
        if (item.result?.valueMACD !== undefined) {
          indicators.push({ symbol, indicator: 'MACD', value: item.result.valueMACD, timestamp: Date.now(), timeframe: tf });
          indicators.push({ symbol, indicator: 'MACD_SIGNAL', value: item.result.valueMACDSignal ?? 0, signal: item.result.valueMACDSignal ?? 0, timestamp: Date.now(), timeframe: tf });
          indicators.push({ symbol, indicator: 'MACD_HISTOGRAM', value: item.result.valueMACDHist ?? 0, histogram: item.result.valueMACDHist ?? 0, timestamp: Date.now(), timeframe: tf });
        }
      } else if (item.id === 'ema50' && item.result?.value !== undefined) {
        indicators.push({ symbol, indicator: 'EMA_50', value: item.result.value, timestamp: Date.now(), timeframe: tf });
      } else if (item.id === 'ema200' && item.result?.value !== undefined) {
        indicators.push({ symbol, indicator: 'EMA_200', value: item.result.value, timestamp: Date.now(), timeframe: tf });
      }
    }

    logger.info(`Bulk ${symbol}: ${indicators.length} indicators in 1 request`);
    return indicators;
  } catch (err) {
    logger.error(`Bulk error for ${symbol}:`, err);
    return [];
  }
}

/**
 * Map TAAPI interval strings to our Timeframe type
 */
function mapInterval(interval: string): Timeframe {
  const map: Record<string, Timeframe> = {
    '1m': '1min',
    '5m': '5min',
    '15m': '15min',
    '1h': '1h',
    '4h': '4h',
    '1d': 'daily',
    '1w': 'weekly',
  };
  return map[interval] || 'daily';
}
