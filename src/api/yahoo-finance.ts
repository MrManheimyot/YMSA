// ─── Yahoo Finance Client (Unofficial v8 API) ────────────────
// FREE — No API key required
// Endpoint: query1.finance.yahoo.com/v8/finance/chart/{symbol}
// Covers: Real-time quotes, OHLCV history, 52-week range, commodities
// Rate limit: ~2000 req/hr

import type { StockQuote, OHLCV } from '../types';

const BASE_URL = 'https://query1.finance.yahoo.com/v8/finance';

// Commodity symbol mapping for Yahoo Finance
export const COMMODITY_SYMBOLS: Record<string, string> = {
  GOLD: 'GC=F',
  SILVER: 'SI=F',
  OIL_WTI: 'CL=F',
  OIL_BRENT: 'BZ=F',
  NATURAL_GAS: 'NG=F',
  COPPER: 'HG=F',
  PLATINUM: 'PL=F',
  CORN: 'ZC=F',
  WHEAT: 'ZW=F',
  SOYBEAN: 'ZS=F',
  COCOA: 'CC=F',
  COFFEE: 'KC=F',
  SUGAR: 'SB=F',
  COTTON: 'CT=F',
};

// Index symbol mapping
export const INDEX_SYMBOLS: Record<string, string> = {
  SP500: '^GSPC',
  NASDAQ: '^IXIC',
  DOW: '^DJI',
  RUSSELL2000: '^RUT',
  VIX: '^VIX',
  FTSE100: '^FTSE',
  DAX: '^GDAXI',
  NIKKEI: '^N225',
  USD_INDEX: 'DX-Y.NYB',
  BTC_USD: 'BTC-USD',
  ETH_USD: 'ETH-USD',
};

/**
 * Fetch real-time quote from Yahoo Finance (FREE, no key)
 */
export async function getQuote(symbol: string): Promise<StockQuote | null> {
  try {
    const res = await fetch(
      `${BASE_URL}/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
      {
        headers: {
          'User-Agent': 'YMSA-Financial-Bot/1.0',
          'Accept': 'application/json',
        },
      }
    );

    if (!res.ok) {
      console.error(`[Yahoo] Quote failed for ${symbol}: ${res.status}`);
      return null;
    }

    const data = await res.json() as any;
    const result = data?.chart?.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    const quotes = result.indicators?.quote?.[0];
    const volumes = quotes?.volume || [];

    const currentPrice = meta.regularMarketPrice || 0;
    const previousClose = meta.chartPreviousClose || meta.previousClose || 0;
    const change = currentPrice - previousClose;
    const changePct = previousClose ? (change / previousClose) * 100 : 0;

    // Calculate average volume from last 5 days
    const validVolumes = volumes.filter((v: any) => v != null && v > 0);
    const avgVolume = validVolumes.length > 0
      ? validVolumes.reduce((s: number, v: number) => s + v, 0) / validVolumes.length
      : 0;

    return {
      symbol: meta.symbol || symbol,
      price: currentPrice,
      change: Math.round(change * 100) / 100,
      changePercent: Math.round(changePct * 100) / 100,
      volume: meta.regularMarketVolume || (validVolumes.length > 0 ? validVolumes[validVolumes.length - 1] : 0),
      avgVolume: Math.round(avgVolume),
      week52High: meta.fiftyTwoWeekHigh || 0,
      week52Low: meta.fiftyTwoWeekLow || 0,
      marketCap: 0, // Not in chart endpoint
      timestamp: Date.now(),
    };
  } catch (err) {
    console.error(`[Yahoo] Quote error for ${symbol}:`, err);
    return null;
  }
}

/**
 * Fetch multiple quotes in parallel (FREE)
 */
export async function getMultipleQuotes(symbols: string[]): Promise<StockQuote[]> {
  const results = await Promise.all(symbols.map((s) => getQuote(s)));
  return results.filter((q): q is StockQuote => q !== null);
}

/**
 * Fetch OHLCV history from Yahoo Finance (FREE, no key)
 *
 * @param range - 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, max
 * @param interval - 1m, 5m, 15m, 1h, 1d, 1wk, 1mo
 */
export async function getOHLCV(
  symbol: string,
  range: string = '6mo',
  interval: string = '1d'
): Promise<OHLCV[]> {
  try {
    const res = await fetch(
      `${BASE_URL}/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`,
      {
        headers: {
          'User-Agent': 'YMSA-Financial-Bot/1.0',
          'Accept': 'application/json',
        },
      }
    );

    if (!res.ok) return [];

    const data = await res.json() as any;
    const result = data?.chart?.result?.[0];
    if (!result) return [];

    const timestamps = result.timestamp || [];
    const quotes = result.indicators?.quote?.[0] || {};

    const candles: OHLCV[] = [];
    for (let i = timestamps.length - 1; i >= 0; i--) {
      const open = quotes.open?.[i];
      const high = quotes.high?.[i];
      const low = quotes.low?.[i];
      const close = quotes.close?.[i];
      const volume = quotes.volume?.[i];

      if (open == null || high == null || low == null || close == null) continue;

      candles.push({
        timestamp: timestamps[i] * 1000,
        open,
        high,
        low,
        close,
        volume: volume || 0,
      });
    }

    return candles; // Most recent first
  } catch (err) {
    console.error(`[Yahoo] OHLCV error for ${symbol}:`, err);
    return [];
  }
}

/**
 * Fetch commodity prices (FREE — uses Yahoo Finance futures symbols)
 */
export async function getCommodityPrices(): Promise<StockQuote[]> {
  const symbols = Object.values(COMMODITY_SYMBOLS).slice(0, 8); // Top 8 commodities
  return getMultipleQuotes(symbols);
}

/**
 * Fetch market index data (FREE)
 */
export async function getMarketIndices(): Promise<StockQuote[]> {
  const symbols = [
    INDEX_SYMBOLS.SP500,
    INDEX_SYMBOLS.NASDAQ,
    INDEX_SYMBOLS.DOW,
    INDEX_SYMBOLS.VIX,
    INDEX_SYMBOLS.BTC_USD,
  ];
  return getMultipleQuotes(symbols);
}

/**
 * Fetch quote with 52-week analysis
 */
export async function getQuoteWith52WeekAnalysis(symbol: string): Promise<{
  quote: StockQuote;
  position52w: number;     // 0-1, where in the 52-week range
  nearHigh: boolean;       // within 5% of 52w high
  nearLow: boolean;        // within 5% of 52w low
  atNewHigh: boolean;
  atNewLow: boolean;
} | null> {
  const quote = await getQuote(symbol);
  if (!quote || quote.week52High === 0) return null;

  const range = quote.week52High - quote.week52Low;
  const position = range > 0 ? (quote.price - quote.week52Low) / range : 0.5;

  return {
    quote,
    position52w: Math.round(position * 1000) / 1000,
    nearHigh: position >= 0.95,
    nearLow: position <= 0.05,
    atNewHigh: quote.price >= quote.week52High,
    atNewLow: quote.price <= quote.week52Low,
  };
}
