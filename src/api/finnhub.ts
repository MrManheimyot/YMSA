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
