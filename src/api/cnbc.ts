// ─── CNBC Hidden API Client ──────────────────────────────────
// No auth required. Real-time quote data via hidden endpoint.
// Discovered via Playwright MCP browser reverse-engineering.

import { createLogger } from '../utils/logger';

const logger = createLogger('CNBC');

const QUOTE_URL = 'https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol';

const CNBC_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

// ─── Types ───────────────────────────────────────────────────

export interface CNBCQuote {
  symbol: string;
  name: string;
  last: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  previousClose: number;
  volume: number;
  marketCap: string;
  exchange: string;
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Fetch real-time quotes for multiple symbols via CNBC's hidden API.
 * Symbols separated by pipe character. No auth required.
 */
export async function getQuotes(symbols: string[]): Promise<CNBCQuote[]> {
  if (symbols.length === 0) return [];

  // CNBC uses pipe-separated symbols
  const symbolStr = symbols.join('|');

  try {
    const res = await fetch(
      `${QUOTE_URL}?symbols=${symbolStr}&requestMethod=itv&no498s=1&partnerId=2&fund=1&exthrs=1&output=json&events=1`,
      { headers: CNBC_HEADERS, signal: AbortSignal.timeout(8000) }
    );

    if (!res.ok) {
      logger.error(`CNBC Quote HTTP ${res.status}`);
      return [];
    }

    const data = await res.json() as any;
    const results = data?.FormattedQuoteResult?.FormattedQuote;
    if (!Array.isArray(results)) return [];

    return results.map((q: any) => ({
      symbol: q.symbol || '',
      name: q.name || '',
      last: parseFloat(q.last) || 0,
      change: parseFloat(q.change) || 0,
      changePercent: parseFloat(q.change_pct) || 0,
      open: parseFloat(q.open) || 0,
      high: parseFloat(q.high) || 0,
      low: parseFloat(q.low) || 0,
      previousClose: parseFloat(q.previous_day_closing) || 0,
      volume: parseInt(q.volume?.replace(/,/g, '')) || 0,
      marketCap: q.mktcap || '',
      exchange: q.exchange || '',
    }));
  } catch (err) {
    logger.error('CNBC Quote error', err);
    return [];
  }
}

/**
 * Get a single quote from CNBC.
 */
export async function getQuote(symbol: string): Promise<CNBCQuote | null> {
  const quotes = await getQuotes([symbol]);
  return quotes[0] || null;
}
