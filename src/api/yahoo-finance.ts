// ─── Yahoo Finance Client (Unofficial v8 API) ────────────────
// FREE — No API key required
// Endpoint: query1.finance.yahoo.com/v8/finance/chart/{symbol}
// Covers: Real-time quotes, OHLCV history, 52-week range, commodities
// Rate limit: ~2000 req/hr
//
// v3.7.1: Pre-fetch quote cache via TV bulk scan eliminates ~800 Yahoo calls/cycle.
//         OHLCV unification fetches 2y:1d once, slices for shorter ranges.

import type { StockQuote, OHLCV } from '../types';

const BASE_URL = 'https://query1.finance.yahoo.com/v8/finance';

// ─── In-memory OHLCV cache (lives for one cron invocation) ──
const ohlcvCache = new Map<string, { data: OHLCV[]; ts: number }>();
const OHLCV_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Quote cache — populated by TV bulk scan at cycle start ──
const quoteCache = new Map<string, { quote: StockQuote; ts: number }>();
const QUOTE_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

/**
 * Pre-populate quote cache from TV bulk scan results.
 * Called once at the start of each scan cycle.
 * Eliminates ~800 individual Yahoo getQuote calls per cycle.
 */
export function preloadQuoteCache(tvResults: Array<{
  symbol: string;
  close: number;
  change: number;
  changePercent: number;
  volume: number;
  averageVolume: number;
  week52High: number;
  week52Low: number;
  marketCap: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  relativeVolume: number;
  sector: string;
}>): number {
  const now = Date.now();
  let loaded = 0;
  for (const r of tvResults) {
    if (!r.symbol || r.close <= 0) continue;
    quoteCache.set(r.symbol, {
      quote: {
        symbol: r.symbol,
        price: r.close,
        change: r.change,
        changePercent: r.changePercent,
        volume: r.volume,
        avgVolume: r.averageVolume || r.volume,
        week52High: r.week52High,
        week52Low: r.week52Low,
        marketCap: r.marketCap,
        timestamp: now,
        source: 'tradingview' as any,
      },
      ts: now,
    });
    loaded++;
  }
  return loaded;
}

/**
 * Clear the quote cache (called at end of cycle or manually).
 */
export function clearQuoteCache(): void {
  quoteCache.clear();
}

// Optional KV store for cross-invocation caching
let _kvCache: KVNamespace | null = null;

export function setKVCache(kv: KVNamespace): void {
  _kvCache = kv;
}

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
 * Fetch real-time quote from Yahoo Finance (FREE, no key).
 * v3.7.1: Checks TV pre-fetch cache first — hit rate ~95% during scan cycles.
 */
export async function getQuote(symbol: string): Promise<StockQuote | null> {
  // Check TV pre-fetch cache (populated at cycle start by preloadQuoteCache)
  const cached = quoteCache.get(symbol);
  if (cached && Date.now() - cached.ts < QUOTE_CACHE_TTL_MS) {
    return cached.quote;
  }

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
 * v3.7.1: Range unification — for daily interval, fetches 2y once and slices
 * locally for shorter ranges (3mo, 6mo, 1y). Eliminates ~400 duplicate calls/cycle.
 *
 * @param range - 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, max
 * @param interval - 1m, 5m, 15m, 1h, 1d, 1wk, 1mo
 */
export async function getOHLCV(
  symbol: string,
  range: string = '6mo',
  interval: string = '1d'
): Promise<OHLCV[]> {
  const cacheKey = `ohlcv:${symbol}:${range}:${interval}`;

  // Check in-memory cache
  const memCached = ohlcvCache.get(cacheKey);
  if (memCached && Date.now() - memCached.ts < OHLCV_CACHE_TTL_MS) {
    return memCached.data;
  }

  // Range unification: for daily interval, try slicing from 2y cache
  if (interval === '1d' && range !== '2y' && range !== '5y' && range !== 'max') {
    const parentKey = `ohlcv:${symbol}:2y:1d`;
    const parentCached = ohlcvCache.get(parentKey);
    if (parentCached && Date.now() - parentCached.ts < OHLCV_CACHE_TTL_MS) {
      const sliced = sliceOHLCVByRange(parentCached.data, range);
      if (sliced.length > 0) {
        ohlcvCache.set(cacheKey, { data: sliced, ts: Date.now() });
        return sliced;
      }
    }
  }

  // Check KV cache (GAP-023: all intervals, TTL varies by interval)
  if (_kvCache) {
    try {
      const kvData = await _kvCache.get(cacheKey, 'json');
      if (kvData) {
        const parsed = kvData as OHLCV[];
        ohlcvCache.set(cacheKey, { data: parsed, ts: Date.now() });
        return parsed;
      }
    } catch { /* KV miss — fetch from API */ }
  }

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

    // Cache the result
    if (candles.length > 0) {
      ohlcvCache.set(cacheKey, { data: candles, ts: Date.now() });
      // GAP-023: Write to KV for all intervals with appropriate TTLs
      if (_kvCache) {
        const kvTtl = interval === '1d' ? 900           // 15 min for daily
          : interval === '5m' ? 120                     // 2 min for 5-min bars
          : interval === '15m' ? 300                    // 5 min for 15-min bars
          : interval === '1h' ? 600                     // 10 min for hourly
          : 900;                                        // 15 min default
        _kvCache.put(cacheKey, JSON.stringify(candles), { expirationTtl: kvTtl }).catch(() => {});
      }
    }

    return candles; // Most recent first
  } catch (err) {
    console.error(`[Yahoo] OHLCV error for ${symbol}:`, err);
    return [];
  }
}

/**
 * Pre-fetch 2y daily OHLCV for a batch of symbols.
 * Call this at cycle start — subsequent getOHLCV calls for 1d/3mo/6mo/1y/2y
 * will slice from cache instead of making new requests.
 * Returns count of symbols successfully cached.
 */
export async function prefetchOHLCV(symbols: string[], concurrency: number = 8): Promise<number> {
  let cached = 0;
  // Process in parallel batches
  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency);
    await Promise.allSettled(
      batch.map(async (symbol) => {
        const key = `ohlcv:${symbol}:2y:1d`;
        if (ohlcvCache.has(key)) return; // Already cached
        const data = await getOHLCV(symbol, '2y', '1d');
        if (data.length > 0) cached++;
      })
    );
  }
  return cached;
}

// ─── OHLCV Range Slicing ────────────────────────────────────

function sliceOHLCVByRange(data: OHLCV[], range: string): OHLCV[] {
  const now = Date.now();
  const rangeMs: Record<string, number> = {
    '1d': 1 * 24 * 3600 * 1000,
    '5d': 5 * 24 * 3600 * 1000,
    '1mo': 30 * 24 * 3600 * 1000,
    '3mo': 90 * 24 * 3600 * 1000,
    '6mo': 180 * 24 * 3600 * 1000,
    '1y': 365 * 24 * 3600 * 1000,
  };
  const ms = rangeMs[range];
  if (!ms) return data; // Unknown range, return all
  const cutoff = now - ms;
  return data.filter(c => c.timestamp >= cutoff);
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

/**
 * Screen for unusual movers — large-cap stocks with big daily moves and extreme volume.
 * Scans a broad universe and returns stocks matching criteria.
 */
export async function screenUnusualMovers(
  minChangePct: number = 10,
  minVolumeRatio: number = 2.0,
  limit: number = 6,
): Promise<StockQuote[]> {
  // Russell 1000 proxy: broad universe of large/mid-cap stocks
  const universe = [
    // Mega-cap tech + growth
    'AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','NFLX','AMD','AVGO',
    'CRM','INTC','QCOM','PANW','SNOW','CRWD','PLTR','COIN','SMCI','ARM',
    // Large-cap value
    'BRK-B','UNH','JNJ','JPM','XOM','CVX','V','MA','PG','HD',
    'LLY','WMT','BAC','GS','BA','CAT','GE','DE','RTX','LMT',
    // High-beta / volatile names
    'RIVN','LCID','ENPH','MELI','DASH','UBER','ABNB','SHOP','NET','DDOG',
    'MRNA','GME','AMC','SOFI','HOOD','MARA','RIOT',
  ];

  const results: StockQuote[] = [];

  // Fetch all in 2 batches (batch size ~30)
  for (let i = 0; i < universe.length; i += 30) {
    const batch = universe.slice(i, i + 30);
    const quotes = await getMultipleQuotes(batch);
    for (const q of quotes) {
      if (
        Math.abs(q.changePercent) >= minChangePct &&
        q.avgVolume > 0 &&
        q.volume / q.avgVolume >= minVolumeRatio
      ) {
        results.push(q);
      }
    }
  }

  // Sort by absolute change descending
  return results
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .slice(0, limit);
}
