// ─── Finnhub API Client ──────────────────────────────────────
// Provides: Real-time quotes, company news, earnings, filings
// Free tier: 60 req/min
// Docs: https://finnhub.io/docs/api

import type { Env, StockQuote } from '../types';

const BASE_URL = 'https://finnhub.io/api/v1';

/**
 * Fetch real-time quote from Finnhub
 */
export async function getQuote(symbol: string, env: Env): Promise<StockQuote | null> {
  try {
    const res = await fetch(
      `${BASE_URL}/quote?symbol=${symbol}&token=${env.FINNHUB_API_KEY}`
    );
    const data = await res.json() as Record<string, number>;

    if (!data || data.c === 0) return null;

    return {
      symbol,
      price: data.c,           // Current price
      change: data.d,           // Change
      changePercent: data.dp,   // Change percent
      volume: 0,                // Not in quote endpoint
      avgVolume: 0,
      high: data.h,             // High of today
      low: data.l,              // Low of today
      open: data.o,             // Open
      previousClose: data.pc,   // Previous close
      week52High: 0,
      week52Low: 0,
      timestamp: data.t * 1000, // Unix timestamp in ms
      source: 'finnhub',
    };
  } catch (err) {
    console.error(`[Finnhub] Quote error for ${symbol}:`, err);
    return null;
  }
}

/**
 * Fetch company news for sentiment analysis
 */
export async function getCompanyNews(
  symbol: string,
  env: Env,
  daysBack: number = 3
): Promise<CompanyNews[]> {
  const to = new Date().toISOString().split('T')[0];
  const from = new Date(Date.now() - daysBack * 86400000).toISOString().split('T')[0];

  try {
    const res = await fetch(
      `${BASE_URL}/company-news?symbol=${symbol}&from=${from}&to=${to}&token=${env.FINNHUB_API_KEY}`
    );
    const data = await res.json() as any[];

    return data.slice(0, 10).map((item: any) => ({
      headline: item.headline,
      summary: item.summary,
      source: item.source,
      url: item.url,
      datetime: item.datetime * 1000,
      category: item.category,
      sentiment: null, // To be analyzed by AI
    }));
  } catch (err) {
    console.error(`[Finnhub] News error for ${symbol}:`, err);
    return [];
  }
}

/**
 * Fetch earnings calendar
 */
export async function getEarningsCalendar(
  env: Env,
  daysAhead: number = 7
): Promise<EarningsEvent[]> {
  const from = new Date().toISOString().split('T')[0];
  const to = new Date(Date.now() + daysAhead * 86400000).toISOString().split('T')[0];

  try {
    const res = await fetch(
      `${BASE_URL}/calendar/earnings?from=${from}&to=${to}&token=${env.FINNHUB_API_KEY}`
    );
    const data = await res.json() as Record<string, any>;

    return (data.earningsCalendar || []).map((item: any) => ({
      symbol: item.symbol,
      date: item.date,
      hour: item.hour, // 'bmo' (before market open) or 'amc' (after market close)
      epsEstimate: item.epsEstimate,
      epsActual: item.epsActual,
      revenueEstimate: item.revenueEstimate,
      revenueActual: item.revenueActual,
    }));
  } catch (err) {
    console.error(`[Finnhub] Earnings calendar error:`, err);
    return [];
  }
}

/**
 * Fetch basic company profile
 */
export async function getCompanyProfile(
  symbol: string,
  env: Env
): Promise<CompanyProfile | null> {
  try {
    const res = await fetch(
      `${BASE_URL}/stock/profile2?symbol=${symbol}&token=${env.FINNHUB_API_KEY}`
    );
    const data = await res.json() as any;

    if (!data || !data.ticker) return null;

    return {
      symbol: data.ticker,
      name: data.name,
      sector: data.finnhubIndustry,
      marketCap: data.marketCapitalization * 1e6, // Finnhub returns in millions
      exchange: data.exchange,
      logo: data.logo,
      weburl: data.weburl,
      ipo: data.ipo,
    };
  } catch (err) {
    console.error(`[Finnhub] Profile error for ${symbol}:`, err);
    return null;
  }
}

/**
 * Fetch market-wide news (general financial news)
 */
export async function getMarketNews(env: Env, category: string = 'general'): Promise<CompanyNews[]> {
  try {
    const res = await fetch(
      `${BASE_URL}/news?category=${category}&token=${env.FINNHUB_API_KEY}`
    );
    const data = await res.json() as any[];

    return data.slice(0, 15).map((item: any) => ({
      headline: item.headline,
      summary: item.summary,
      source: item.source,
      url: item.url,
      datetime: item.datetime * 1000,
      category: item.category,
      sentiment: null,
    }));
  } catch (err) {
    console.error(`[Finnhub] Market news error:`, err);
    return [];
  }
}

// ─── Local Types ─────────────────────────────────────────────

export interface CompanyNews {
  headline: string;
  summary: string;
  source: string;
  url: string;
  datetime: number;
  category: string;
  sentiment: number | null;
}

export interface EarningsEvent {
  symbol: string;
  date: string;
  hour: string;
  epsEstimate: number | null;
  epsActual: number | null;
  revenueEstimate: number | null;
  revenueActual: number | null;
}

export interface CompanyProfile {
  symbol: string;
  name: string;
  sector: string;
  marketCap: number;
  exchange: string;
  logo: string;
  weburl: string;
  ipo: string;
}

// ═══════════════════════════════════════════════════════════════
// GAP-025: Insider Transaction Data
// CEO/CFO buying clusters correlate with 7-13% outperformance
// ═══════════════════════════════════════════════════════════════

export interface InsiderTransaction {
  symbol: string;
  name: string;
  share: number;           // shares transacted
  change: number;          // net change in holdings
  transactionDate: string;
  transactionCode: string; // P=purchase, S=sale, A=award, M=exercise
  transactionPrice: number;
  filingDate: string;
}

export interface InsiderSignal {
  symbol: string;
  clusterBuying: boolean;      // Multiple insiders buying in 30 days
  netBuyingShares: number;     // Net insider buying (buys - sells)
  totalTransactions: number;
  recentBuyers: string[];      // Names of recent buyers
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;          // 0-100
}

/**
 * Fetch insider transactions for a symbol from Finnhub.
 * Endpoint: /stock/insider-transactions?symbol=AAPL
 */
export async function getInsiderTransactions(
  symbol: string,
  env: Env,
): Promise<InsiderTransaction[]> {
  try {
    const res = await fetch(
      `${BASE_URL}/stock/insider-transactions?symbol=${encodeURIComponent(symbol)}&token=${env.FINNHUB_API_KEY}`
    );
    if (!res.ok) return [];
    const data = await res.json() as { data?: any[] };
    if (!data.data || !Array.isArray(data.data)) return [];

    return data.data.slice(0, 30).map((item: any) => ({
      symbol: item.symbol || symbol,
      name: item.name || '',
      share: item.share || 0,
      change: item.change || 0,
      transactionDate: item.transactionDate || '',
      transactionCode: item.transactionCode || '',
      transactionPrice: item.transactionPrice || 0,
      filingDate: item.filingDate || '',
    }));
  } catch (err) {
    console.error(`[Finnhub] Insider transactions error for ${symbol}:`, err);
    return [];
  }
}

/**
 * Analyze insider transaction patterns for a symbol.
 * Detects cluster buying (multiple insiders buying within 30 days).
 */
export function analyzeInsiderActivity(transactions: InsiderTransaction[]): InsiderSignal | null {
  if (transactions.length === 0) return null;

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = transactions.filter(t => {
    const txDate = new Date(t.transactionDate).getTime();
    return txDate >= thirtyDaysAgo;
  });

  if (recent.length === 0) return null;

  const buys = recent.filter(t => t.transactionCode === 'P');
  const sells = recent.filter(t => t.transactionCode === 'S');
  const netBuying = buys.reduce((s, t) => s + t.share, 0) - sells.reduce((s, t) => s + t.share, 0);
  const uniqueBuyers = [...new Set(buys.map(t => t.name))];
  const clusterBuying = uniqueBuyers.length >= 2;

  let signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let confidence = 50;

  if (clusterBuying && netBuying > 0) {
    signal = 'BULLISH';
    confidence = Math.min(95, 65 + uniqueBuyers.length * 10);
  } else if (buys.length > sells.length * 2 && netBuying > 0) {
    signal = 'BULLISH';
    confidence = 60;
  } else if (sells.length > buys.length * 3) {
    signal = 'BEARISH';
    confidence = 60;
  }

  return {
    symbol: transactions[0]?.symbol || '',
    clusterBuying,
    netBuyingShares: netBuying,
    totalTransactions: recent.length,
    recentBuyers: uniqueBuyers,
    signal,
    confidence,
  };
}

/**
 * Fetch insider data for multiple symbols and filter for actionable signals.
 */
export async function scanInsiderActivity(
  symbols: string[],
  env: Env,
): Promise<InsiderSignal[]> {
  const signals: InsiderSignal[] = [];
  for (const symbol of symbols) {
    const txns = await getInsiderTransactions(symbol, env);
    const analysis = analyzeInsiderActivity(txns);
    if (analysis && analysis.signal !== 'NEUTRAL' && analysis.confidence >= 60) {
      signals.push(analysis);
    }
  }
  return signals;
}
