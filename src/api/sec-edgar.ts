// ─── SEC EDGAR Enhanced API Client ───────────────────────────
// Free, no auth (just requires identifying User-Agent).
// ATOM feeds for real-time 8-K/10-K notifications.
// XBRL API for machine-readable financial statements.
// Full-text search via EDGAR search API.

import { createLogger } from '../utils/logger';

const logger = createLogger('EDGAR');

const EDGAR_BASE = 'https://efts.sec.gov/LATEST';
const FILINGS_BASE = 'https://www.sec.gov/cgi-bin/browse-edgar';
const DATA_BASE = 'https://data.sec.gov';

const SEC_HEADERS = {
  'User-Agent': 'YMSA/3.3 (ymsa-trading@example.com)',
  'Accept': 'application/json',
};

// ─── Types ───────────────────────────────────────────────────

export interface EDGARFiling {
  title: string;
  link: string;
  type: string;       // 8-K, 10-K, 10-Q, 13F, etc.
  filed: string;
  cik: string;
  company: string;
}

export interface EDGARSearchResult {
  title: string;
  link: string;
  type: string;
  filed: string;
  company: string;
  snippet: string;
}

export interface CompanyFinancials {
  cik: string;
  company: string;
  facts: Record<string, number | string>;
}

// ─── CIK Lookup Cache ───────────────────────────────────────

const cikCache = new Map<string, string>();

/**
 * Resolve a ticker symbol to SEC CIK number.
 */
export async function getCIK(ticker: string): Promise<string | null> {
  if (cikCache.has(ticker)) return cikCache.get(ticker)!;

  try {
    const res = await fetch(`${DATA_BASE}/submissions/CIK${ticker.toUpperCase()}.json`, {
      headers: SEC_HEADERS,
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      // Try company tickers lookup
      const tickerRes = await fetch('https://www.sec.gov/files/company_tickers.json', {
        headers: SEC_HEADERS,
        signal: AbortSignal.timeout(8000),
      });
      if (!tickerRes.ok) return null;
      const tickers = await tickerRes.json() as Record<string, { cik_str: number; ticker: string }>;
      for (const entry of Object.values(tickers)) {
        if (entry.ticker === ticker.toUpperCase()) {
          const cik = String(entry.cik_str).padStart(10, '0');
          cikCache.set(ticker, cik);
          return cik;
        }
      }
      return null;
    }

    const data = await res.json() as { cik?: string };
    const cik = String(data.cik || '').padStart(10, '0');
    cikCache.set(ticker, cik);
    return cik;
  } catch {
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Fetch recent 8-K filings via ATOM feed (real-time material events).
 * 8-K = material events: earnings, M&A, leadership changes, defaults, etc.
 */
export async function getRecent8K(ticker: string, limit: number = 5): Promise<EDGARFiling[]> {
  const cik = await getCIK(ticker);
  if (!cik) return [];

  try {
    const res = await fetch(
      `${FILINGS_BASE}?action=getcompany&CIK=${cik}&type=8-K&dateb=&owner=include&count=${limit}&search_text=&action=getcompany&output=atom`,
      { headers: { ...SEC_HEADERS, 'Accept': 'application/atom+xml' }, signal: AbortSignal.timeout(10000) }
    );

    if (!res.ok) return [];
    const xml = await res.text();
    return parseEdgarAtom(xml, ticker);
  } catch (err) {
    logger.error(`EDGAR 8-K error for ${ticker}`, err);
    return [];
  }
}

/**
 * Full-text search across all EDGAR filings.
 * Powered by Elasticsearch under the hood. Very powerful.
 */
export async function searchFilings(
  query: string,
  filingType?: string,
  limit: number = 10
): Promise<EDGARSearchResult[]> {
  try {
    const params = new URLSearchParams({
      q: query,
      dateRange: 'custom',
      startdt: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0],
      enddt: new Date().toISOString().split('T')[0],
      ...(filingType ? { forms: filingType } : {}),
    });

    const res = await fetch(`${EDGAR_BASE}/search-index?${params}`, {
      headers: SEC_HEADERS,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return [];
    const data = await res.json() as { hits?: { hits?: Array<{ _source: any }> } };

    return (data.hits?.hits || []).slice(0, limit).map(hit => ({
      title: hit._source.file_description || hit._source.display_names?.join(', ') || '',
      link: `https://www.sec.gov/Archives/edgar/data/${hit._source.entity_id}/${hit._source.file_num}`,
      type: hit._source.form_type || '',
      filed: hit._source.file_date || '',
      company: hit._source.display_names?.[0] || '',
      snippet: hit._source.file_description || '',
    }));
  } catch (err) {
    logger.error('EDGAR search error', err);
    return [];
  }
}

/**
 * Fetch XBRL financial data for a company.
 * Returns standardized financial metrics.
 */
export async function getCompanyFacts(ticker: string): Promise<CompanyFinancials | null> {
  const cik = await getCIK(ticker);
  if (!cik) return null;

  try {
    const res = await fetch(
      `${DATA_BASE}/api/xbrl/companyfacts/CIK${cik}.json`,
      { headers: SEC_HEADERS, signal: AbortSignal.timeout(10000) }
    );

    if (!res.ok) return null;
    const data = await res.json() as any;

    const facts: Record<string, number | string> = {};
    const usgaap = data?.facts?.['us-gaap'] || {};

    // Extract key financial metrics (latest value from each)
    const targets = [
      'Revenues', 'NetIncomeLoss', 'EarningsPerShareBasic', 'EarningsPerShareDiluted',
      'Assets', 'Liabilities', 'StockholdersEquity', 'OperatingIncomeLoss',
      'CashAndCashEquivalentsAtCarryingValue', 'LongTermDebt',
    ];

    for (const key of targets) {
      const fact = usgaap[key];
      if (fact?.units?.USD) {
        const values = fact.units.USD;
        const latest = values[values.length - 1];
        if (latest) facts[key] = latest.val;
      } else if (fact?.units?.['USD/shares']) {
        const values = fact.units['USD/shares'];
        const latest = values[values.length - 1];
        if (latest) facts[key] = latest.val;
      }
    }

    return {
      cik,
      company: data?.entityName || ticker,
      facts,
    };
  } catch (err) {
    logger.error(`EDGAR XBRL error for ${ticker}`, err);
    return null;
  }
}

/**
 * Monitor insider transactions via Form 4 filings.
 * Returns recent insider buy/sell activity.
 */
export async function getInsiderFilings(ticker: string, limit: number = 10): Promise<EDGARFiling[]> {
  const cik = await getCIK(ticker);
  if (!cik) return [];

  try {
    const res = await fetch(
      `${FILINGS_BASE}?action=getcompany&CIK=${cik}&type=4&dateb=&owner=only&count=${limit}&action=getcompany&output=atom`,
      { headers: { ...SEC_HEADERS, 'Accept': 'application/atom+xml' }, signal: AbortSignal.timeout(10000) }
    );

    if (!res.ok) return [];
    const xml = await res.text();
    return parseEdgarAtom(xml, ticker);
  } catch (err) {
    logger.error(`EDGAR insider error for ${ticker}`, err);
    return [];
  }
}

// ─── Internal ────────────────────────────────────────────────

function parseEdgarAtom(xml: string, ticker: string): EDGARFiling[] {
  const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];
  return entries.map(entry => {
    const title = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]?.trim() || '';
    const link = entry.match(/<link[^>]*href="([^"]*?)"/)?.[1] || '';
    const updated = entry.match(/<updated>(.*?)<\/updated>/)?.[1] || '';
    const summary = entry.match(/<summary[^>]*>([\s\S]*?)<\/summary>/)?.[1]?.trim() || '';

    // Extract filing type from title (e.g., "8-K - Apple Inc")
    const typeMatch = title.match(/^([\w-]+)/);

    return {
      title: title.replace(/<[^>]*>/g, ''),
      link,
      type: typeMatch?.[1] || '',
      filed: updated,
      cik: '',
      company: summary.replace(/<[^>]*>/g, '') || ticker,
    };
  }).filter(f => f.title && f.link);
}
