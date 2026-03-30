// ─── DexScreener API Client ───────────────────────────────────
// FREE — No API key, no authentication required
// Real-time DEX data across 80+ chains, 300+ DEXs
// 1-second updates, large trade detection (whale tracking)
// Docs: https://docs.dexscreener.com

import type { CryptoMetrics } from '../agents/types';

const BASE_URL = 'https://api.dexscreener.com/latest/dex';

/**
 * Search for token pairs by keyword
 */
export async function searchPairs(query: string): Promise<DexPair[]> {
  try {
    const res = await fetch(`${BASE_URL}/search?q=${encodeURIComponent(query)}`);
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (data.pairs || []).map(parsePair).slice(0, 20);
  } catch (err) {
    console.error('[DexScreener] Search error:', err);
    return [];
  }
}

/**
 * Get pairs by token address
 */
export async function getPairsByToken(
  tokenAddress: string
): Promise<DexPair[]> {
  try {
    const res = await fetch(`${BASE_URL}/tokens/${tokenAddress}`);
    if (!res.ok) return [];
    const data = await res.json() as any;
    return (data.pairs || []).map(parsePair);
  } catch (err) {
    console.error('[DexScreener] Token pairs error:', err);
    return [];
  }
}

/**
 * Get pair by chain and pair address
 */
export async function getPair(
  chain: string,
  pairAddress: string
): Promise<DexPair | null> {
  try {
    const res = await fetch(`${BASE_URL}/pairs/${chain}/${pairAddress}`);
    if (!res.ok) return null;
    const data = await res.json() as any;
    const pair = data.pairs?.[0] || data.pair;
    return pair ? parsePair(pair) : null;
  } catch (err) {
    console.error('[DexScreener] Pair error:', err);
    return null;
  }
}

/**
 * Get top trending pairs (proxy for whale interest)
 */
export async function getTopPairsByChain(
  chain: string = 'ethereum'
): Promise<DexPair[]> {
  // Search for popular tokens on the chain
  const pairs = await searchPairs(chain === 'ethereum' ? 'WETH' : 'SOL');
  return pairs
    .filter((p) => p.chainId === chain)
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, 20);
}

/**
 * Detect whale-like activity — large trades and volume spikes
 */
export function detectWhaleActivity(pairs: DexPair[]): WhaleSignal[] {
  const signals: WhaleSignal[] = [];

  for (const pair of pairs) {
    // Volume spike detection
    if (pair.volume24h > 1_000_000) { // > $1M daily volume
      if (pair.priceChange24h > 10 || pair.priceChange24h < -10) {
        signals.push({
          type: pair.priceChange24h > 0 ? 'WHALE_BUY' : 'WHALE_SELL',
          pair: `${pair.baseTokenSymbol}/${pair.quoteTokenSymbol}`,
          chain: pair.chainId,
          dex: pair.dexId,
          volume24h: pair.volume24h,
          priceChange24h: pair.priceChange24h,
          liquidity: pair.liquidity,
          timestamp: Date.now(),
        });
      }
    }

    // Liquidity change detection (large add/remove = whale)
    if (pair.liquidity > 500_000 && Math.abs(pair.priceChange24h) > 20) {
      signals.push({
        type: 'LIQUIDITY_SHIFT',
        pair: `${pair.baseTokenSymbol}/${pair.quoteTokenSymbol}`,
        chain: pair.chainId,
        dex: pair.dexId,
        volume24h: pair.volume24h,
        priceChange24h: pair.priceChange24h,
        liquidity: pair.liquidity,
        timestamp: Date.now(),
      });
    }
  }

  return signals;
}

/**
 * Convert DexScreener data to CryptoMetrics format
 */
export function toCryptoMetrics(pair: DexPair): CryptoMetrics {
  return {
    symbol: pair.baseTokenSymbol,
    price: pair.priceUsd,
    volume24h: pair.volume24h,
    marketCap: pair.fdv || 0,
    circulatingSupply: 0,
    priceChange24h: pair.priceChange24h,
    priceChange7d: 0,
  };
}

/**
 * Format whale signal for Telegram alert
 */
export function formatWhaleAlert(signal: WhaleSignal): string {
  const emoji = signal.type === 'WHALE_BUY' ? '🐳📈' :
    signal.type === 'WHALE_SELL' ? '🐳📉' : '🔄💰';

  return [
    `${emoji} <b>Whale Activity Detected</b>`,
    `Pair: ${signal.pair} on ${signal.chain}/${signal.dex}`,
    `24h Volume: $${formatNum(signal.volume24h)}`,
    `Price Change: ${signal.priceChange24h > 0 ? '+' : ''}${signal.priceChange24h.toFixed(1)}%`,
    `Liquidity: $${formatNum(signal.liquidity)}`,
  ].join('\n');
}

// ─── Types ───────────────────────────────────────────────────

export interface DexPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseTokenSymbol: string;
  baseTokenAddress: string;
  quoteTokenSymbol: string;
  priceUsd: number;
  priceChange5m: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  volume24h: number;
  liquidity: number;
  fdv: number;         // Fully diluted valuation
  txns24h: number;
}

export interface WhaleSignal {
  type: 'WHALE_BUY' | 'WHALE_SELL' | 'LIQUIDITY_SHIFT';
  pair: string;
  chain: string;
  dex: string;
  volume24h: number;
  priceChange24h: number;
  liquidity: number;
  timestamp: number;
}

// ─── Helpers ─────────────────────────────────────────────────

function parsePair(raw: any): DexPair {
  return {
    chainId: raw.chainId || '',
    dexId: raw.dexId || '',
    pairAddress: raw.pairAddress || '',
    baseTokenSymbol: raw.baseToken?.symbol || '',
    baseTokenAddress: raw.baseToken?.address || '',
    quoteTokenSymbol: raw.quoteToken?.symbol || '',
    priceUsd: parseFloat(raw.priceUsd || '0'),
    priceChange5m: raw.priceChange?.m5 || 0,
    priceChange1h: raw.priceChange?.h1 || 0,
    priceChange6h: raw.priceChange?.h6 || 0,
    priceChange24h: raw.priceChange?.h24 || 0,
    volume24h: raw.volume?.h24 || 0,
    liquidity: raw.liquidity?.usd || 0,
    fdv: raw.fdv || 0,
    txns24h: (raw.txns?.h24?.buys || 0) + (raw.txns?.h24?.sells || 0),
  };
}

function formatNum(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}
