// ─── TradingView Scanner API ─────────────────────────────────
// Hidden API: No auth required. Bulk market scanning.
// Discovered via Playwright MCP browser reverse-engineering.
// Rate limit: ~60 req/min (conservative estimate)

import { createLogger } from '../utils/logger';

const logger = createLogger('TradingView');

const BASE_URL = 'https://scanner.tradingview.com';
const NEWS_URL = 'https://news-mediator.tradingview.com/public/news-flow/v2/news';

const TV_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Origin': 'https://www.tradingview.com',
  'Content-Type': 'application/json',
};

// ─── Types ───────────────────────────────────────────────────

export interface TVScanResult {
  symbol: string;
  exchange: string;
  close: number;
  change: number;
  changePercent: number;
  volume: number;
  relativeVolume: number;
  marketCap: number;
  peRatio: number;
  week52High: number;
  week52Low: number;
  rsi: number;
  ema20: number;
  ema50: number;
  ema200: number;
  averageVolume: number;
  sector: string;
  recommendation: string;
}

export interface TVNewsItem {
  title: string;
  source: string;
  published: string;
  link: string;
  symbols: string[];
}

// ─── Scanner API ─────────────────────────────────────────────

/**
 * Bulk scan US market using TradingView's internal scanner.
 * Returns up to `limit` results matching the filter.
 * No auth required — this is a public hidden endpoint.
 */
export async function scanMarket(
  filter: 'top_gainers' | 'top_losers' | 'high_volume' | 'oversold' | 'overbought' | 'all',
  limit: number = 100
): Promise<TVScanResult[]> {
  const body = buildScanBody(filter, limit);

  try {
    const res = await fetch(`${BASE_URL}/america/scan`, {
      method: 'POST',
      headers: TV_HEADERS,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      logger.error(`TV Scanner HTTP ${res.status}`);
      return [];
    }

    const data = await res.json() as { data?: Array<{ s: string; d: number[] }> };
    if (!data.data) return [];

    return data.data.map(row => parseScanRow(row));
  } catch (err) {
    logger.error('TV Scanner error', err);
    return [];
  }
}

/**
 * Get real-time quote + technicals for a single symbol.
 */
export async function getSymbolData(symbol: string): Promise<TVScanResult | null> {
  const body = {
    symbols: { tickers: [`NASDAQ:${symbol}`, `NYSE:${symbol}`, `AMEX:${symbol}`] },
    columns: SCAN_COLUMNS,
  };

  try {
    const res = await fetch(`${BASE_URL}/america/scan`, {
      method: 'POST',
      headers: TV_HEADERS,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const data = await res.json() as { data?: Array<{ s: string; d: number[] }> };
    if (!data.data?.length) return null;

    return parseScanRow(data.data[0]);
  } catch {
    return null;
  }
}

/**
 * Bulk scan specific symbols — query up to 500 tickers per request.
 * Uses TradingView's `symbols.tickers` mode (no filter, just data fetch).
 * Returns quote + full technicals (RSI, EMA, volume, market cap, sector).
 */
export async function scanSymbolsBulk(symbols: string[]): Promise<TVScanResult[]> {
  if (symbols.length === 0) return [];

  // Build ticker list with exchange prefixes (TV will match the correct one)
  const tickers = symbols.flatMap(s => [`NASDAQ:${s}`, `NYSE:${s}`, `AMEX:${s}`]);

  const body = {
    symbols: { tickers },
    columns: SCAN_COLUMNS,
  };

  try {
    const res = await fetch(`${BASE_URL}/america/scan`, {
      method: 'POST',
      headers: TV_HEADERS,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      logger.error(`TV Bulk scan HTTP ${res.status} for ${symbols.length} symbols`);
      return [];
    }

    const data = await res.json() as { data?: Array<{ s: string; d: number[] }> };
    if (!data.data) return [];

    // De-duplicate: same symbol from multiple exchanges → keep first (highest volume)
    const seen = new Set<string>();
    const results: TVScanResult[] = [];
    for (const row of data.data) {
      const parsed = parseScanRow(row);
      if (!seen.has(parsed.symbol)) {
        seen.add(parsed.symbol);
        results.push(parsed);
      }
    }

    return results;
  } catch (err) {
    logger.error(`TV Bulk scan error for ${symbols.length} symbols`, err);
    return [];
  }
}

/**
 * Fetch per-symbol news from TradingView's news mediator.
 * No auth required.
 */
export async function getSymbolNews(symbol: string, limit: number = 10): Promise<TVNewsItem[]> {
  try {
    const res = await fetch(
      `${NEWS_URL}?filter=lang:en&filter=symbol:NASDAQ:${symbol}&limit=${limit}`,
      { headers: TV_HEADERS, signal: AbortSignal.timeout(8000) }
    );

    if (!res.ok) return [];
    const data = await res.json() as { items?: Array<{ title: string; source: { name: string }; published: string; storyPath: string; relatedSymbols?: Array<{ symbol: string }> }> };

    return (data.items || []).map(item => ({
      title: item.title,
      source: item.source?.name || 'TradingView',
      published: item.published,
      link: `https://www.tradingview.com/news/${item.storyPath}`,
      symbols: (item.relatedSymbols || []).map(s => s.symbol.split(':').pop() || ''),
    }));
  } catch (err) {
    logger.error(`TV News error for ${symbol}`, err);
    return [];
  }
}

/**
 * Get trending / most active symbols from TradingView.
 */
export async function getMostActive(limit: number = 30): Promise<TVScanResult[]> {
  return scanMarket('high_volume', limit);
}

// ─── Internal ────────────────────────────────────────────────

const SCAN_COLUMNS = [
  'close', 'change', 'change_abs', 'volume', 'relative_volume_10d_calc',
  'market_cap_basic', 'price_earnings_ttm', 'High.All', 'Low.All',
  'RSI', 'EMA20', 'EMA50', 'EMA200', 'average_volume_10d_calc',
  'sector', 'Recommend.All',
];

function buildScanBody(filter: string, limit: number): object {
  const base = {
    columns: SCAN_COLUMNS,
    sort: { sortBy: 'volume', sortOrder: 'desc' } as { sortBy: string; sortOrder: string },
    range: [0, limit],
    markets: ['america'],
    options: { lang: 'en' },
    filter2: {
      operator: 'and',
      operands: [
        { operation: { operator: 'greater', operand: ['market_cap_basic', 1e9] } },
        { operation: { operator: 'in_range', operand: ['close', 5, 10000] } },
      ] as object[],
    },
  };

  switch (filter) {
    case 'top_gainers':
      base.sort = { sortBy: 'change', sortOrder: 'desc' };
      base.filter2.operands.push({ operation: { operator: 'greater', operand: ['change', 3] } });
      break;
    case 'top_losers':
      base.sort = { sortBy: 'change', sortOrder: 'asc' };
      base.filter2.operands.push({ operation: { operator: 'less', operand: ['change', -3] } });
      break;
    case 'high_volume':
      base.filter2.operands.push({ operation: { operator: 'greater', operand: ['relative_volume_10d_calc', 2] } });
      break;
    case 'oversold':
      base.sort = { sortBy: 'RSI', sortOrder: 'asc' };
      base.filter2.operands.push({ operation: { operator: 'less', operand: ['RSI', 30] } });
      break;
    case 'overbought':
      base.sort = { sortBy: 'RSI', sortOrder: 'desc' };
      base.filter2.operands.push({ operation: { operator: 'greater', operand: ['RSI', 70] } });
      break;
    // 'all' — no extra filters
  }

  return base;
}

function parseScanRow(row: { s: string; d: any[] }): TVScanResult {
  const [exchange, ticker] = row.s.split(':');
  return {
    symbol: ticker || row.s,
    exchange: exchange || '',
    close: row.d[0] ?? 0,
    changePercent: row.d[1] ?? 0,
    change: row.d[2] ?? 0,
    volume: row.d[3] ?? 0,
    relativeVolume: row.d[4] ?? 0,
    marketCap: row.d[5] ?? 0,
    peRatio: row.d[6] ?? 0,
    week52High: row.d[7] ?? 0,
    week52Low: row.d[8] ?? 0,
    rsi: row.d[9] ?? 0,
    ema20: row.d[10] ?? 0,
    ema50: row.d[11] ?? 0,
    ema200: row.d[12] ?? 0,
    averageVolume: row.d[13] ?? 0,
    sector: String(row.d[14] ?? ''),
    recommendation: String(row.d[15] ?? ''),
  };
}
