// ─── TAAPI.IO API Client ─────────────────────────────────────
// Provides: 200+ technical indicators with real-time data
// Free tier: 1 req/15sec | Pro: unlimited
// Docs: https://taapi.io/documentation/

import type { Env, TechnicalIndicator, Timeframe } from '../types';

const BASE_URL = 'https://api.taapi.io';

// ─── Rate Limiter ────────────────────────────────────────────
// Free tier: 1 request per 15 seconds. We queue all calls and
// enforce a minimum 15.5s gap between requests.
const RATE_LIMIT_MS = 15_500; // 15.5s to be safe
let lastRequestTime = 0;

async function rateLimitedWait(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS && lastRequestTime > 0) {
    const waitMs = RATE_LIMIT_MS - elapsed;
    console.log(`[TAAPI] Rate limit: waiting ${(waitMs / 1000).toFixed(1)}s`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  lastRequestTime = Date.now();
}

/**
 * Generic indicator fetch from TAAPI.IO (rate-limited)
 */
async function fetchIndicator(
  indicator: string,
  symbol: string,
  env: Env,
  interval: string = '1d',
  params: Record<string, string> = {}
): Promise<Record<string, number> | null> {
  // Wait for rate limit before making request
  await rateLimitedWait();

  const queryParams = new URLSearchParams({
    secret: env.TAAPI_API_KEY,
    exchange: 'stocks',
    symbol: `${symbol}/USD`,
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
 * Bulk fetch — get multiple indicators sequentially (respects rate limit)
 * On free tier, this takes ~60s per symbol (4 indicators × 15s each)
 */
export async function getBulkIndicators(
  symbol: string,
  env: Env,
  interval: string = '1d'
): Promise<TechnicalIndicator[]> {
  const indicators: TechnicalIndicator[] = [];

  // Sequential — rate limiter enforces 15s gap between each call
  const rsi = await getRSI(symbol, env, interval);
  if (rsi) indicators.push(rsi);

  const macd = await getMACD(symbol, env, interval);
  if (macd) indicators.push(...macd);

  const ema50 = await getEMA(symbol, 50, env, interval);
  if (ema50) indicators.push(ema50);

  const ema200 = await getEMA(symbol, 200, env, interval);
  if (ema200) indicators.push(ema200);

  return indicators;
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
