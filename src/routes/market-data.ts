// ─── Market Data Routes ──────────────────────────────────────

import type { Env } from '../types';
import * as yahooFinance from '../api/yahoo-finance';
import * as coingecko from '../api/coingecko';
import * as dexscreener from '../api/dexscreener';
import * as polymarket from '../api/polymarket';
import * as fred from '../api/fred';
import { calculateFibonacci, formatFibonacciAlert } from '../analysis/fibonacci';
import { detectSignals, calculateSignalScore } from '../analysis/signals';
import { computeIndicators } from '../analysis/indicators';
import { jsonResponse } from './helpers';

export async function handleMarketDataRoutes(
  path: string, url: URL, _request: Request, env: Env, _corsHeaders: Record<string, string>
): Promise<Response | null> {
  // ─── Stock Quote (Yahoo Finance — FREE) ────────
  if (path === '/api/quote') {
    const symbol = url.searchParams.get('symbol');
    if (!symbol) return jsonResponse({ error: 'Missing ?symbol= parameter' }, 400);
    const quote = await yahooFinance.getQuote(symbol.toUpperCase());
    if (!quote) return jsonResponse({ error: `No data for ${symbol}` }, 404);
    return jsonResponse(quote);
  }

  // ─── Full Technical Analysis ───────────────────
  if (path === '/api/analysis') {
    const symbol = url.searchParams.get('symbol');
    if (!symbol) return jsonResponse({ error: 'Missing ?symbol= parameter' }, 400);
    const sym = symbol.toUpperCase();

    const [quote, ohlcv] = await Promise.all([
      yahooFinance.getQuote(sym),
      yahooFinance.getOHLCV(sym, '2y', '1d'),
    ]);

    if (!quote) return jsonResponse({ error: `No data for ${sym}` }, 404);

    const indicators = computeIndicators(sym, ohlcv);
    const fibonacci = ohlcv.length > 0 ? calculateFibonacci(sym, ohlcv, quote.price) : null;
    const signals = detectSignals(quote, indicators, fibonacci, env);
    const score = calculateSignalScore(signals);
    const w52 = await yahooFinance.getQuoteWith52WeekAnalysis(sym);

    return jsonResponse({
      symbol: sym, quote, indicators, fibonacci, signals, score,
      week52: w52 ? { position: w52.position52w, nearHigh: w52.nearHigh, nearLow: w52.nearLow } : null,
      timestamp: new Date().toISOString(),
    });
  }

  // ─── Fibonacci ─────────────────────────────────
  if (path === '/api/fibonacci') {
    const symbol = url.searchParams.get('symbol');
    if (!symbol) return jsonResponse({ error: 'Missing ?symbol= parameter' }, 400);
    const sym = symbol.toUpperCase();
    const [quote, ohlcv] = await Promise.all([
      yahooFinance.getQuote(sym),
      yahooFinance.getOHLCV(sym, '6mo', '1d'),
    ]);
    if (!quote || ohlcv.length === 0) return jsonResponse({ error: `Insufficient data for ${sym}` }, 404);
    const fibonacci = calculateFibonacci(sym, ohlcv, quote.price);
    return jsonResponse({ symbol: sym, currentPrice: quote.price, fibonacci, formatted: fibonacci ? formatFibonacciAlert(fibonacci) : null });
  }

  // ─── Watchlist Scan ────────────────────────────
  if (path === '/api/scan') {
    const watchlist = env.DEFAULT_WATCHLIST.split(',').map((s) => s.trim());
    const scanOne = async (symbol: string) => {
      try {
        const [quote, ohlcv] = await Promise.all([
          yahooFinance.getQuote(symbol),
          yahooFinance.getOHLCV(symbol, '2y', '1d'),
        ]);
        if (!quote) return null;
        const indicators = computeIndicators(symbol, ohlcv);
        const signals = detectSignals(quote, indicators, null, env);
        const score = calculateSignalScore(signals);
        return { symbol, price: quote.price, changePercent: quote.changePercent, signalCount: signals.length, score, topSignals: signals.slice(0, 3).map((s) => s.title) };
      } catch { return null; }
    };
    const settled = await Promise.all(watchlist.map(scanOne));
    const results = settled.filter(Boolean).sort((a, b) => b!.score - a!.score);
    return jsonResponse({ watchlist: results, timestamp: new Date().toISOString() });
  }

  // ─── Crypto Dashboard ──────────────────────────
  if (path === '/api/crypto') {
    const cryptoList = (env.CRYPTO_WATCHLIST || 'bitcoin,ethereum,solana').split(',');
    const [prices, global, trending] = await Promise.all([
      coingecko.getCryptoPrices(cryptoList),
      coingecko.getGlobalMarket(),
      coingecko.getTrendingCoins(),
    ]);
    const ethPairs = await dexscreener.searchPairs('WETH');
    const whaleSignals = dexscreener.detectWhaleActivity(ethPairs);
    return jsonResponse({ prices, global, trending: trending.slice(0, 5), whaleSignals: whaleSignals.slice(0, 5) });
  }

  // ─── Prediction Markets ────────────────────────
  if (path === '/api/polymarket') {
    const markets = await polymarket.getActiveMarkets(20);
    const valueBets = polymarket.findValueBets(markets, 10000, [0.15, 0.85]);
    return jsonResponse({ markets: markets.slice(0, 10), valueBets });
  }

  // ─── Commodities + Macro ───────────────────────
  if (path === '/api/commodities') {
    const [commodities, yieldCurve, macro] = await Promise.all([
      yahooFinance.getCommodityPrices(),
      fred.checkYieldCurve(env.FRED_API_KEY),
      fred.getMacroDashboard(env.FRED_API_KEY),
    ]);
    return jsonResponse({ commodities, yieldCurve, macro });
  }

  // ─── Market Indices ────────────────────────────
  if (path === '/api/indices') {
    const indices = await yahooFinance.getMarketIndices();
    return jsonResponse({ indices, timestamp: new Date().toISOString() });
  }

  return null;
}
