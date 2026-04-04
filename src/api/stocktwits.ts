// ─── StockTwits Sentiment API ────────────────────────────────
// No auth required. Social sentiment + trending data.
// Rate limit: 200 req/hr
// Docs: https://api.stocktwits.com/developers/docs

import { createLogger } from '../utils/logger';

const logger = createLogger('StockTwits');

const BASE_URL = 'https://api.stocktwits.com/api/2';

const ST_HEADERS = {
  'User-Agent': 'YMSA/3.3',
  'Accept': 'application/json',
};

// ─── Types ───────────────────────────────────────────────────

export interface StockTwitsSentiment {
  symbol: string;
  bullish: number;
  bearish: number;
  total: number;
  sentimentScore: number;   // -100 to +100 normalized
  watchlistCount: number;
}

export interface TrendingSymbol {
  symbol: string;
  title: string;
  watchlistCount: number;
}

export interface StockTwitsMessage {
  id: number;
  body: string;
  sentiment: 'Bullish' | 'Bearish' | null;
  createdAt: string;
  user: string;
  likes: number;
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Fetch sentiment breakdown for a symbol.
 * Returns bullish/bearish counts and normalized score.
 */
export async function getSymbolSentiment(symbol: string): Promise<StockTwitsSentiment | null> {
  try {
    const res = await fetch(
      `${BASE_URL}/streams/symbol/${symbol}.json`,
      { headers: ST_HEADERS, signal: AbortSignal.timeout(8000) }
    );

    if (!res.ok) return null;
    const data = await res.json() as any;

    const messages: any[] = data?.messages || [];
    let bullish = 0;
    let bearish = 0;
    for (const msg of messages) {
      if (msg.entities?.sentiment?.basic === 'Bullish') bullish++;
      else if (msg.entities?.sentiment?.basic === 'Bearish') bearish++;
    }

    const total = bullish + bearish;
    const sentimentScore = total > 0 ? Math.round(((bullish - bearish) / total) * 100) : 0;

    return {
      symbol,
      bullish,
      bearish,
      total: messages.length,
      sentimentScore,
      watchlistCount: data?.symbol?.watchlist_count || 0,
    };
  } catch (err) {
    logger.error(`StockTwits sentiment error for ${symbol}`, err);
    return null;
  }
}

/**
 * Fetch trending symbols on StockTwits.
 */
export async function getTrendingSymbols(): Promise<TrendingSymbol[]> {
  try {
    const res = await fetch(
      `${BASE_URL}/trending/symbols.json`,
      { headers: ST_HEADERS, signal: AbortSignal.timeout(8000) }
    );

    if (!res.ok) return [];
    const data = await res.json() as any;

    return (data?.symbols || []).map((s: any) => ({
      symbol: s.symbol,
      title: s.title || s.symbol,
      watchlistCount: s.watchlist_count || 0,
    }));
  } catch (err) {
    logger.error('StockTwits trending error', err);
    return [];
  }
}

/**
 * Get recent messages for a symbol with sentiment tags.
 */
export async function getSymbolMessages(symbol: string, limit: number = 20): Promise<StockTwitsMessage[]> {
  try {
    const res = await fetch(
      `${BASE_URL}/streams/symbol/${symbol}.json?limit=${limit}`,
      { headers: ST_HEADERS, signal: AbortSignal.timeout(8000) }
    );

    if (!res.ok) return [];
    const data = await res.json() as any;

    return (data?.messages || []).map((msg: any) => ({
      id: msg.id,
      body: msg.body,
      sentiment: msg.entities?.sentiment?.basic || null,
      createdAt: msg.created_at,
      user: msg.user?.username || '',
      likes: msg.likes?.total || 0,
    }));
  } catch (err) {
    logger.error(`StockTwits messages error for ${symbol}`, err);
    return [];
  }
}

/**
 * Batch sentiment for multiple symbols (conservative: 200 req/hr budget).
 * Limits to 10 symbols per batch to stay within rate limits.
 */
export async function batchSentiment(symbols: string[]): Promise<Map<string, StockTwitsSentiment>> {
  const limited = symbols.slice(0, 10);
  const results = new Map<string, StockTwitsSentiment>();

  const settled = await Promise.allSettled(
    limited.map(s => getSymbolSentiment(s))
  );

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status === 'fulfilled' && result.value) {
      results.set(limited[i], result.value);
    }
  }

  return results;
}
