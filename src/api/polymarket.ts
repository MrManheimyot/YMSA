// ─── Polymarket API Client ────────────────────────────────────
// Prediction market data: events, outcomes, probabilities
// Gamma API (public, no auth) for market discovery
// CLOB API (auth required) for orderbook + trading
// Docs: https://docs.polymarket.com

import type { PredictionMarket, PredictionOutcome } from '../agents/types';

const GAMMA_API = 'https://gamma-api.polymarket.com';

/**
 * Fetch active prediction markets
 */
export async function getActiveMarkets(
  limit: number = 20,
  category?: string
): Promise<PredictionMarket[]> {
  const params = new URLSearchParams({
    limit: limit.toString(),
    active: 'true',
    closed: 'false',
    order: 'volume',
    ascending: 'false',
  });

  if (category) params.set('tag', category);

  try {
    const res = await fetch(`${GAMMA_API}/markets?${params}`);
    if (!res.ok) return [];
    const data = await res.json() as any[];

    return data.map((market: any) => ({
      id: market.id || market.condition_id,
      question: market.question || market.title || '',
      category: market.group_item_title || market.category || '',
      endDate: market.end_date_iso || '',
      outcomes: parseOutcomes(market),
      volume: parseFloat(market.volume || '0'),
      liquidity: parseFloat(market.liquidity || '0'),
      createdAt: market.created_at || '',
    }));
  } catch (err) {
    console.error('[Polymarket] Active markets error:', err);
    return [];
  }
}

/**
 * Fetch top markets by volume
 */
export async function getTopMarkets(limit: number = 10): Promise<PredictionMarket[]> {
  return getActiveMarkets(limit);
}

/**
 * Search markets by keyword
 */
export async function searchMarkets(query: string, limit: number = 10): Promise<PredictionMarket[]> {
  try {
    const res = await fetch(
      `${GAMMA_API}/markets?limit=${limit}&active=true&closed=false&_q=${encodeURIComponent(query)}`
    );
    if (!res.ok) return [];
    const data = await res.json() as any[];

    return data.map((market: any) => ({
      id: market.id || market.condition_id,
      question: market.question || market.title || '',
      category: market.group_item_title || market.category || '',
      endDate: market.end_date_iso || '',
      outcomes: parseOutcomes(market),
      volume: parseFloat(market.volume || '0'),
      liquidity: parseFloat(market.liquidity || '0'),
      createdAt: market.created_at || '',
    }));
  } catch (err) {
    console.error('[Polymarket] Search error:', err);
    return [];
  }
}

/**
 * Fetch a single market by ID
 */
export async function getMarket(marketId: string): Promise<PredictionMarket | null> {
  try {
    const res = await fetch(`${GAMMA_API}/markets/${marketId}`);
    if (!res.ok) return null;
    const market = await res.json() as any;

    return {
      id: market.id || market.condition_id,
      question: market.question || market.title || '',
      category: market.group_item_title || market.category || '',
      endDate: market.end_date_iso || '',
      outcomes: parseOutcomes(market),
      volume: parseFloat(market.volume || '0'),
      liquidity: parseFloat(market.liquidity || '0'),
      createdAt: market.created_at || '',
    };
  } catch (err) {
    console.error(`[Polymarket] Market ${marketId} error:`, err);
    return null;
  }
}

/**
 * Get markets by category for scanning
 */
export async function getMarketsByCategory(
  category: 'politics' | 'crypto' | 'sports' | 'science' | 'finance' | 'pop-culture',
  limit: number = 10
): Promise<PredictionMarket[]> {
  return getActiveMarkets(limit, category);
}

/**
 * Identify potential value bets — markets where probability
 * may be mispriced based on volume and liquidity analysis
 */
export function findValueBets(
  markets: PredictionMarket[],
  minVolume: number = 10000,
  probabilityRange: [number, number] = [0.2, 0.8]
): PredictionMarket[] {
  return markets.filter((market) => {
    if (market.volume < minVolume) return false;

    return market.outcomes.some(
      (o) => o.price >= probabilityRange[0] && o.price <= probabilityRange[1]
    );
  });
}

/**
 * Format market for alert display
 */
export function formatMarketAlert(market: PredictionMarket): string {
  const lines = [
    `🎯 <b>${market.question}</b>`,
    `📂 ${market.category}`,
    ``,
  ];

  for (const outcome of market.outcomes) {
    const pct = (outcome.price * 100).toFixed(1);
    const bar = '█'.repeat(Math.round(outcome.price * 10)) + '░'.repeat(10 - Math.round(outcome.price * 10));
    lines.push(`  ${bar} ${outcome.name}: ${pct}%`);
  }

  lines.push(``);
  lines.push(`💰 Volume: $${formatNumber(market.volume)} | Liquidity: $${formatNumber(market.liquidity)}`);

  return lines.join('\n');
}

// ─── Helpers ─────────────────────────────────────────────────

function parseOutcomes(market: any): PredictionOutcome[] {
  // Polymarket Gamma API returns outcomes in various formats
  if (market.outcomes && Array.isArray(market.outcomes)) {
    const prices = market.outcomePrices
      ? JSON.parse(market.outcomePrices)
      : [];

    return market.outcomes.map((name: string, i: number) => ({
      name,
      price: prices[i] ? parseFloat(prices[i]) : 0.5,
      volume: 0,
    }));
  }

  // Binary market fallback
  const yesPrice = parseFloat(market.yes_price || market.bestAsk || '0.5');
  return [
    { name: 'Yes', price: yesPrice, volume: 0 },
    { name: 'No', price: 1 - yesPrice, volume: 0 },
  ];
}

function formatNumber(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}
