// ─── CoinGecko API Client ─────────────────────────────────────
// Free crypto market data: prices, market cap, volume, trending
// Rate limit: 10-50 req/min (free tier)
// Docs: https://docs.coingecko.com/reference/introduction

import type { CryptoMetrics } from '../agents/types';

const BASE_URL = 'https://api.coingecko.com/api/v3';

/**
 * Fetch crypto price data for multiple coins
 */
export async function getCryptoPrices(
  coinIds: string[] = ['bitcoin', 'ethereum', 'solana', 'cardano', 'polkadot']
): Promise<CryptoMetrics[]> {
  const ids = coinIds.join(',');
  const params = new URLSearchParams({
    ids,
    vs_currencies: 'usd',
    include_24hr_vol: 'true',
    include_24hr_change: 'true',
    include_market_cap: 'true',
  });

  try {
    const res = await fetch(`${BASE_URL}/simple/price?${params}`);
    const data = await res.json() as Record<string, any>;

    return coinIds.map((id) => {
      const coin = data[id];
      if (!coin) return null;

      return {
        symbol: id.toUpperCase(),
        price: coin.usd || 0,
        volume24h: coin.usd_24h_vol || 0,
        marketCap: coin.usd_market_cap || 0,
        circulatingSupply: 0,
        priceChange24h: coin.usd_24h_change || 0,
        priceChange7d: 0,
      };
    }).filter((m): m is CryptoMetrics => m !== null);
  } catch (err) {
    console.error('[CoinGecko] Price error:', err);
    return [];
  }
}

/**
 * Fetch detailed coin data with market info
 */
export async function getCoinDetail(coinId: string): Promise<CryptoMetrics | null> {
  try {
    const res = await fetch(
      `${BASE_URL}/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`
    );

    if (!res.ok) return null;
    const data = await res.json() as any;

    return {
      symbol: data.symbol?.toUpperCase() || coinId.toUpperCase(),
      price: data.market_data?.current_price?.usd || 0,
      volume24h: data.market_data?.total_volume?.usd || 0,
      marketCap: data.market_data?.market_cap?.usd || 0,
      circulatingSupply: data.market_data?.circulating_supply || 0,
      priceChange24h: data.market_data?.price_change_percentage_24h || 0,
      priceChange7d: data.market_data?.price_change_percentage_7d || 0,
    };
  } catch (err) {
    console.error(`[CoinGecko] Detail error for ${coinId}:`, err);
    return null;
  }
}

/**
 * Fetch trending coins (what's hot right now)
 */
export async function getTrendingCoins(): Promise<TrendingCoin[]> {
  try {
    const res = await fetch(`${BASE_URL}/search/trending`);
    const data = await res.json() as any;

    return (data.coins || []).map((item: any) => ({
      id: item.item.id,
      symbol: item.item.symbol,
      name: item.item.name,
      marketCapRank: item.item.market_cap_rank,
      priceBtc: item.item.price_btc,
    }));
  } catch (err) {
    console.error('[CoinGecko] Trending error:', err);
    return [];
  }
}

/**
 * Fetch global crypto market overview
 */
export async function getGlobalMarket(): Promise<GlobalCryptoMarket | null> {
  try {
    const res = await fetch(`${BASE_URL}/global`);
    const data = await res.json() as any;
    const d = data.data;

    if (!d) return null;

    return {
      totalMarketCap: d.total_market_cap?.usd || 0,
      totalVolume24h: d.total_volume?.usd || 0,
      btcDominance: d.market_cap_percentage?.btc || 0,
      ethDominance: d.market_cap_percentage?.eth || 0,
      activeCryptocurrencies: d.active_cryptocurrencies || 0,
      marketCapChange24h: d.market_cap_change_percentage_24h_usd || 0,
    };
  } catch (err) {
    console.error('[CoinGecko] Global market error:', err);
    return null;
  }
}

// ─── Local Types ─────────────────────────────────────────────

export interface TrendingCoin {
  id: string;
  symbol: string;
  name: string;
  marketCapRank: number;
  priceBtc: number;
}

export interface GlobalCryptoMarket {
  totalMarketCap: number;
  totalVolume24h: number;
  btcDominance: number;
  ethDominance: number;
  activeCryptocurrencies: number;
  marketCapChange24h: number;
}
