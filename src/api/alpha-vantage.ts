// ─── Alpha Vantage API Client ─────────────────────────────────
// Provides: 50+ technical indicators, OHLCV data, fundamental data
// Free tier: 25 req/day | Premium: 75 req/min
// Docs: https://www.alphavantage.co/documentation/

import type { Env, StockQuote, TechnicalIndicator, OHLCV, Timeframe } from '../types';

const BASE_URL = 'https://www.alphavantage.co/query';

/**
 * Fetch real-time quote for a symbol
 */
export async function getQuote(symbol: string, env: Env): Promise<StockQuote | null> {
  const params = new URLSearchParams({
    function: 'GLOBAL_QUOTE',
    symbol,
    apikey: env.ALPHA_VANTAGE_API_KEY,
  });

  try {
    const res = await fetch(`${BASE_URL}?${params}`);
    const data = await res.json() as Record<string, any>;
    const q = data['Global Quote'];

    if (!q || !q['05. price']) return null;

    return {
      symbol,
      price: parseFloat(q['05. price']),
      change: parseFloat(q['09. change']),
      changePercent: parseFloat(q['10. change percent']?.replace('%', '') || '0'),
      volume: parseInt(q['06. volume'], 10),
      avgVolume: 0, // Not provided by this endpoint
      high: parseFloat(q['03. high']),
      low: parseFloat(q['04. low']),
      open: parseFloat(q['02. open']),
      previousClose: parseFloat(q['08. previous close']),
      week52High: 0, // Fetched separately
      week52Low: 0,
      timestamp: Date.now(),
      source: 'alpha_vantage',
    };
  } catch (err) {
    console.error(`[AlphaVantage] Quote error for ${symbol}:`, err);
    return null;
  }
}

/**
 * Fetch EMA (Exponential Moving Average) values
 */
export async function getEMA(
  symbol: string,
  period: number,
  env: Env,
  interval: string = 'daily'
): Promise<TechnicalIndicator | null> {
  const params = new URLSearchParams({
    function: 'EMA',
    symbol,
    interval,
    time_period: period.toString(),
    series_type: 'close',
    apikey: env.ALPHA_VANTAGE_API_KEY,
  });

  try {
    const res = await fetch(`${BASE_URL}?${params}`);
    const data = await res.json() as Record<string, any>;
    const metaKey = 'Technical Analysis: EMA';
    const analysis = data[metaKey];

    if (!analysis) return null;

    const latestDate = Object.keys(analysis)[0];
    const value = parseFloat(analysis[latestDate]['EMA']);

    return {
      symbol,
      indicator: period === 50 ? 'EMA_50' : 'EMA_200',
      value,
      timestamp: new Date(latestDate).getTime(),
      timeframe: interval as Timeframe,
    };
  } catch (err) {
    console.error(`[AlphaVantage] EMA error for ${symbol}:`, err);
    return null;
  }
}

/**
 * Fetch RSI (Relative Strength Index)
 */
export async function getRSI(
  symbol: string,
  env: Env,
  period: number = 14,
  interval: string = 'daily'
): Promise<TechnicalIndicator | null> {
  const params = new URLSearchParams({
    function: 'RSI',
    symbol,
    interval,
    time_period: period.toString(),
    series_type: 'close',
    apikey: env.ALPHA_VANTAGE_API_KEY,
  });

  try {
    const res = await fetch(`${BASE_URL}?${params}`);
    const data = await res.json() as Record<string, any>;
    const analysis = data['Technical Analysis: RSI'];

    if (!analysis) return null;

    const latestDate = Object.keys(analysis)[0];
    const value = parseFloat(analysis[latestDate]['RSI']);

    return {
      symbol,
      indicator: 'RSI',
      value,
      timestamp: new Date(latestDate).getTime(),
      timeframe: interval as Timeframe,
    };
  } catch (err) {
    console.error(`[AlphaVantage] RSI error for ${symbol}:`, err);
    return null;
  }
}

/**
 * Fetch MACD (Moving Average Convergence Divergence)
 */
export async function getMACD(
  symbol: string,
  env: Env,
  interval: string = 'daily'
): Promise<TechnicalIndicator[] | null> {
  const params = new URLSearchParams({
    function: 'MACD',
    symbol,
    interval,
    series_type: 'close',
    apikey: env.ALPHA_VANTAGE_API_KEY,
  });

  try {
    const res = await fetch(`${BASE_URL}?${params}`);
    const data = await res.json() as Record<string, any>;
    const analysis = data['Technical Analysis: MACD'];

    if (!analysis) return null;

    const latestDate = Object.keys(analysis)[0];
    const entry = analysis[latestDate];

    return [
      {
        symbol,
        indicator: 'MACD',
        value: parseFloat(entry['MACD']),
        timestamp: new Date(latestDate).getTime(),
        timeframe: interval as Timeframe,
      },
      {
        symbol,
        indicator: 'MACD_SIGNAL',
        value: parseFloat(entry['MACD_Signal']),
        signal: parseFloat(entry['MACD_Signal']),
        timestamp: new Date(latestDate).getTime(),
        timeframe: interval as Timeframe,
      },
      {
        symbol,
        indicator: 'MACD_HISTOGRAM',
        value: parseFloat(entry['MACD_Hist']),
        histogram: parseFloat(entry['MACD_Hist']),
        timestamp: new Date(latestDate).getTime(),
        timeframe: interval as Timeframe,
      },
    ];
  } catch (err) {
    console.error(`[AlphaVantage] MACD error for ${symbol}:`, err);
    return null;
  }
}

/**
 * Fetch daily OHLCV data for Fibonacci calculation
 */
export async function getDailyOHLCV(
  symbol: string,
  env: Env,
  outputSize: 'compact' | 'full' = 'compact'
): Promise<OHLCV[]> {
  const params = new URLSearchParams({
    function: 'TIME_SERIES_DAILY',
    symbol,
    outputsize: outputSize,
    apikey: env.ALPHA_VANTAGE_API_KEY,
  });

  try {
    const res = await fetch(`${BASE_URL}?${params}`);
    const data = await res.json() as Record<string, any>;
    const timeSeries = data['Time Series (Daily)'];

    if (!timeSeries) return [];

    return Object.entries(timeSeries).map(([date, values]: [string, any]) => ({
      timestamp: new Date(date).getTime(),
      open: parseFloat(values['1. open']),
      high: parseFloat(values['2. high']),
      low: parseFloat(values['3. low']),
      close: parseFloat(values['4. close']),
      volume: parseInt(values['5. volume'], 10),
    }));
  } catch (err) {
    console.error(`[AlphaVantage] OHLCV error for ${symbol}:`, err);
    return [];
  }
}

/**
 * Fetch weekly OHLCV data
 */
export async function getWeeklyOHLCV(symbol: string, env: Env): Promise<OHLCV[]> {
  const params = new URLSearchParams({
    function: 'TIME_SERIES_WEEKLY',
    symbol,
    apikey: env.ALPHA_VANTAGE_API_KEY,
  });

  try {
    const res = await fetch(`${BASE_URL}?${params}`);
    const data = await res.json() as Record<string, any>;
    const timeSeries = data['Weekly Time Series'];

    if (!timeSeries) return [];

    return Object.entries(timeSeries).map(([date, values]: [string, any]) => ({
      timestamp: new Date(date).getTime(),
      open: parseFloat(values['1. open']),
      high: parseFloat(values['2. high']),
      low: parseFloat(values['3. low']),
      close: parseFloat(values['4. close']),
      volume: parseInt(values['5. volume'], 10),
    }));
  } catch (err) {
    console.error(`[AlphaVantage] Weekly OHLCV error for ${symbol}:`, err);
    return [];
  }
}
