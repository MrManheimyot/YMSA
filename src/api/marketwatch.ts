// ─── MarketWatch / WSJ Hidden API Client ─────────────────────
// Hidden APIs discovered via Playwright MCP browser.
// Requires EntitlementToken (embedded in page, free).
// Provides: OHLCV timeseries, real-time headlines

import { createLogger } from '../utils/logger';

const logger = createLogger('MarketWatch');

const TIMESERIES_URL = 'https://api.wsj.net/api/michelangelo/timeseries/history';
const MW_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
};

// ─── Types ───────────────────────────────────────────────────

export interface MWCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MWQuoteSummary {
  symbol: string;
  last: number;
  change: number;
  changePercent: number;
  volume: number;
  timestamp: number;
}

// ─── Token Cache ─────────────────────────────────────────────

let cachedToken: string | null = null;
let tokenExpiry = 0;

/**
 * Extract EntitlementToken from MarketWatch page (free, embedded in HTML).
 * Cached for 30 minutes.
 */
async function getEntitlementToken(): Promise<string | null> {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  try {
    const res = await fetch('https://www.marketwatch.com/investing/stock/aapl', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;
    const html = await res.text();

    const match = html.match(/EntitlementToken['":\s]+['"]([a-zA-Z0-9=+/]+)['"]/);
    if (!match) {
      logger.error('MarketWatch EntitlementToken not found in page');
      return null;
    }

    cachedToken = match[1];
    tokenExpiry = Date.now() + 30 * 60000; // 30 min cache
    return cachedToken;
  } catch (err) {
    logger.error('MarketWatch token fetch error', err);
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Fetch OHLCV candle data from MarketWatch/WSJ hidden timeseries API.
 * Supports 1min to daily intervals.
 */
export async function getCandles(
  symbol: string,
  interval: 'PT1M' | 'PT5M' | 'PT15M' | 'PT1H' | 'P1D' = 'P1D',
  days: number = 30
): Promise<MWCandle[]> {
  const token = await getEntitlementToken();
  if (!token) return [];

  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

  try {
    const params = new URLSearchParams({
      json: JSON.stringify({
        Step: interval,
        TimeFrame: 'custom',
        StartDate: startDate,
        EndDate: endDate,
        EntitlementToken: token,
        IncludeMockTick: 'true',
        FilterNullSlots: 'true',
        FilterClosedPoints: 'true',
        IncludeClosedSlots: 'false',
        IncludeOfficialClose: 'true',
        InjectOpen: 'false',
        ShowPreMarket: 'false',
        ShowAfterHours: 'false',
        UseExtendedTimeFrame: 'true',
        WantPriorClose: 'true',
        IncludeCurrentQuotes: 'false',
        ResetTodaysAfterHoursPer498: 'false',
        Series: [{
          Key: `STOCK/US/XNAS/${symbol}`,
          Dialect: 'Charting',
          Kind: 'Ticker',
          SeriesId: 's1',
          DataTypes: ['Open', 'High', 'Low', 'Last'],
          Indicators: [{ Parameters: [], Kind: 'Volume', SeriesId: 'i1' }],
        }],
      }),
    });

    const res = await fetch(`${TIMESERIES_URL}?${params}`, {
      headers: MW_HEADERS,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      logger.error(`MarketWatch Timeseries HTTP ${res.status}`);
      return [];
    }

    const data = await res.json() as any;
    return parseTimeseriesResponse(data);
  } catch (err) {
    logger.error(`MarketWatch candles error for ${symbol}`, err);
    return [];
  }
}

/**
 * Get latest daily candle for quick price check.
 */
export async function getLatestPrice(symbol: string): Promise<MWQuoteSummary | null> {
  const candles = await getCandles(symbol, 'P1D', 2);
  if (candles.length === 0) return null;

  const latest = candles[candles.length - 1];
  const prev = candles.length > 1 ? candles[candles.length - 2] : null;

  return {
    symbol,
    last: latest.close,
    change: prev ? latest.close - prev.close : 0,
    changePercent: prev ? ((latest.close - prev.close) / prev.close) * 100 : 0,
    volume: latest.volume,
    timestamp: latest.timestamp,
  };
}

// ─── Internal ────────────────────────────────────────────────

function parseTimeseriesResponse(data: any): MWCandle[] {
  const candles: MWCandle[] = [];

  try {
    const series = data?.Series;
    if (!Array.isArray(series) || series.length === 0) return [];

    const s = series[0];
    const timestamps = s.TimeStamps || [];
    const openData = s.DataTypes?.find((dt: any) => dt.Type === 'Open')?.Values || [];
    const highData = s.DataTypes?.find((dt: any) => dt.Type === 'High')?.Values || [];
    const lowData = s.DataTypes?.find((dt: any) => dt.Type === 'Low')?.Values || [];
    const closeData = s.DataTypes?.find((dt: any) => dt.Type === 'Last')?.Values || [];
    const volIndicator = s.Indicators?.find((ind: any) => ind.Kind === 'Volume');
    const volumeData = volIndicator?.DataTypes?.[0]?.Values || [];

    for (let i = 0; i < timestamps.length; i++) {
      candles.push({
        timestamp: new Date(timestamps[i]).getTime(),
        open: openData[i] ?? 0,
        high: highData[i] ?? 0,
        low: lowData[i] ?? 0,
        close: closeData[i] ?? 0,
        volume: volumeData[i] ?? 0,
      });
    }
  } catch (err) {
    logger.error('MarketWatch parse error', err);
  }

  return candles;
}
