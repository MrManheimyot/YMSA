// ─── Engine-Specific Scans ────────────────────────────────────
// Individual scan functions for each trading engine

import type { Env } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('EngineScan');
import * as yahooFinance from '../api/yahoo-finance';
import * as coingecko from '../api/coingecko';
import * as dexscreener from '../api/dexscreener';
import * as polymarket from '../api/polymarket';
import * as fred from '../api/fred';
import * as finnhub from '../api/finnhub';
import { computeIndicators } from '../analysis/indicators';
import { analyzeMultiTimeframe } from '../analysis/multi-timeframe';
import { analyzeSmartMoney } from '../analysis/smart-money';
import { detectRegime, getEngineAdjustments, formatRegimeAlert } from '../analysis/regime';
import { setCurrentRegime } from '../alert-formatter';
import { sendTelegramMessage } from '../alert-router';
import { setRegime, addContext, pushSmartMoney, pushMTF, pushStatArb, pushCryptoDefi, pushEventDriven, pushOptions, sendExecutionAlert } from '../broker-manager';
import { executeBatch, formatBatchResults, type ExecutableSignal } from '../execution/engine';
import { scanPairs, findTradablePairs } from '../agents/pairs-trading';
import { scrapeOversoldStocks, scrape52WeekHighs, formatFinvizAlert, fetchOversoldStocks, fetch52WeekHighs } from '../scrapers/finviz';
import { scrapeMarketOverview, formatMarketOverview } from '../scrapers/google-finance';
import { fetchGoogleAlerts, storeNewsAlerts, formatNewsDigest } from '../api/google-alerts';
import { scoreNewsSentiment, isZAiAvailable } from '../ai/z-engine';
import { getWatchlist, getPromotedWatchlist } from './market-scans';

export async function runRegimeScan(env: Env): Promise<void> {
  try {
    const regime = await detectRegime(env);
    if (regime) {
      setCurrentRegime(regime);
      setRegime(regime);
      addContext(formatRegimeAlert(regime));
      const adjustments = getEngineAdjustments(regime);
      logger.info(`Regime: ${regime.regime}`, { adjustments });
    }
  } catch (err) {
    logger.error('Regime scan error', err);
  }
}

export async function runMTFScan(env: Env): Promise<void> {
  const tier1 = (env.TIER1_WATCHLIST || env.DEFAULT_WATCHLIST).split(',').map((s) => s.trim());
  const promoted = await getPromotedWatchlist(env);
  const allSymbols = [...new Set([...tier1, ...promoted])];
  const signals: ExecutableSignal[] = [];

  for (const symbol of allSymbols) {
    try {
      const mtf = await analyzeMultiTimeframe(symbol, env);
      if (mtf && mtf.confluence >= 65) {
        pushMTF(mtf);
        if (mtf.confluence >= 70) {
          const quote = await yahooFinance.getQuote(symbol);
          if (quote) {
            signals.push({
              engineId: 'MTF_MOMENTUM', symbol,
              direction: mtf.suggestedAction === 'WAIT' ? 'BUY' : mtf.suggestedAction,
              strength: mtf.confluence,
              signalType: mtf.suggestedAction === 'BUY' ? 'MTF_CONFLUENCE_BUY' : 'MTF_CONFLUENCE_SELL',
              entryPrice: quote.price, atr: quote.price * 0.02,
            });
          }
        }
      }
    } catch (err) {
      logger.error(`MTF ${symbol} error`, err);
    }
  }

  if (signals.length > 0) {
    const results = await executeBatch(signals, env);
    await sendExecutionAlert(formatBatchResults(results), env);
  }
  logger.info(`MTF scan: ${signals.length} executable signals from ${allSymbols.length} symbols (${tier1.length} tier1 + ${promoted.length} promoted)`);
}

export async function runSmartMoneyScan(env: Env): Promise<void> {
  const tier1 = (env.TIER1_WATCHLIST || env.DEFAULT_WATCHLIST).split(',').map((s) => s.trim());
  const promoted = await getPromotedWatchlist(env);
  const allSymbols = [...new Set([...tier1, ...promoted])];
  const signals: ExecutableSignal[] = [];

  for (const symbol of allSymbols) {
    try {
      const ohlcv = await yahooFinance.getOHLCV(symbol, '3mo', '1d');
      if (ohlcv.length < 20) continue;

      const candles = ohlcv.map((c) => ({ open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, timestamp: c.timestamp }));
      const quote = await yahooFinance.getQuote(symbol);
      if (!quote) continue;

      const smc = analyzeSmartMoney(symbol, candles, quote.price);
      if (smc.score >= 60) {
        const indicators = computeIndicators(symbol, ohlcv);
        const atr = indicators.find((i) => i.indicator === 'ATR')?.value ?? null;
        pushSmartMoney(smc, quote, atr, indicators);

        if (smc.score >= 75 && smc.overallBias !== 'NEUTRAL') {
          signals.push({
            engineId: 'SMART_MONEY', symbol,
            direction: smc.overallBias === 'BULLISH' ? 'BUY' : 'SELL',
            strength: smc.score,
            signalType: smc.signals[0]?.type === 'ORDER_BLOCK' ? 'ORDER_BLOCK' : smc.signals[0]?.type === 'FVG' ? 'FAIR_VALUE_GAP' : 'LIQUIDITY_SWEEP',
            entryPrice: quote.price, atr: quote.price * 0.02,
          });
        }
      }
    } catch (err) {
      logger.error(`SMC ${symbol} error`, err);
    }
  }

  if (signals.length > 0) {
    const results = await executeBatch(signals, env);
    await sendExecutionAlert(formatBatchResults(results), env);
  }
  logger.info(`Smart Money scan: ${signals.length} executable signals from ${allSymbols.length} symbols (${tier1.length} tier1 + ${promoted.length} promoted)`);
}

export async function runCryptoWhaleScan(env: Env): Promise<void> {
  try {
    const ethPairs = await dexscreener.searchPairs('WETH');
    const solPairs = await dexscreener.searchPairs('SOL');
    const allPairs = [...ethPairs, ...solPairs];

    const whaleSignals = dexscreener.detectWhaleActivity(allPairs);
    if (whaleSignals.length > 0) {
      for (const signal of whaleSignals.slice(0, 5)) {
        await pushCryptoDefi({
          symbol: signal.pair, type: signal.type,
          volume: signal.volume24h, priceChange: signal.priceChange24h, liquidity: signal.liquidity,
        }, Math.min(90, 50 + (signal.volume24h / 1e6) * 5), env.DB);
      }
    } else {
      const movers = allPairs
        .filter((p) => p.volume24h > 100_000 && Math.abs(p.priceChange24h) > 5)
        .sort((a, b) => b.volume24h - a.volume24h)
        .slice(0, 3);
      for (const p of movers) {
        await pushCryptoDefi({
          symbol: `${p.baseTokenSymbol}/${p.quoteTokenSymbol}`,
          type: p.priceChange24h > 0 ? 'DEX_MOVER_UP' : 'DEX_MOVER_DOWN',
          volume: p.volume24h, priceChange: p.priceChange24h, liquidity: p.liquidity,
        }, Math.min(80, 50 + Math.abs(p.priceChange24h) * 1.5), env.DB);
      }
    }

    const trending = await coingecko.getTrendingCoins();
    if (trending.length > 0) {
      for (const coin of trending.slice(0, 3)) {
        await pushCryptoDefi({
          symbol: coin.symbol.toUpperCase(), type: 'TRENDING',
          volume: 0, priceChange: 0, liquidity: 0,
        }, 55, env.DB);
      }
    }
  } catch (err) {
    logger.error('Crypto scan error', err);
  }
}

export async function runPolymarketScan(env: Env): Promise<void> {
  try {
    const markets = await polymarket.getActiveMarkets(20);
    const valueBets = polymarket.findValueBets(markets, 10000, [0.15, 0.85]);

    if (valueBets.length > 0) {
      for (const market of valueBets.slice(0, 3)) {
        const topOutcome = market.outcomes[0];
        const direction: 'BUY' | 'SELL' = topOutcome && topOutcome.price > 0.5 ? 'BUY' : 'SELL';
        const conf = Math.min(85, 50 + (market.volume / 100000) * 5);
        await pushEventDriven(
          market.id || 'POLYMARKET', 'VALUE_BET', direction, conf,
          `Polymarket value bet: ${market.question.slice(0, 60)} | Vol: $${(market.volume / 1000).toFixed(0)}K`,
          [`Outcome: ${topOutcome?.name || '?'} (${((topOutcome?.price || 0) * 100).toFixed(0)}%)`, `Volume: $${(market.volume / 1000).toFixed(0)}K`],
          undefined, env.DB,
        );
      }
    }
  } catch (err) {
    logger.error('Polymarket scan error', err);
  }
}

export async function runCommodityScan(env: Env): Promise<void> {
  try {
    const [commodities, yieldCurve] = await Promise.all([
      yahooFinance.getCommodityPrices(),
      fred.checkYieldCurve(env.FRED_API_KEY),
      fred.getCommodityPrices(env.FRED_API_KEY),
    ]);

    if (yieldCurve && yieldCurve.inverted) {
      await pushEventDriven(
        'MACRO', 'YIELD_CURVE_INVERSION', 'SELL', 75,
        `Yield curve inverted: spread ${yieldCurve.spread.toFixed(2)}%. ${yieldCurve.signal}`,
        [`Spread: ${yieldCurve.spread.toFixed(2)}%`, yieldCurve.signal],
        undefined, env.DB,
      );
    }

    if (commodities && commodities.length > 0) {
      for (const c of commodities) {
        if (Math.abs(c.changePercent) >= 3) {
          const direction: 'BUY' | 'SELL' = c.changePercent > 0 ? 'BUY' : 'SELL';
          const conf = Math.min(85, 55 + Math.abs(c.changePercent) * 3);
          const name = c.symbol === 'GC=F' ? 'Gold' : c.symbol === 'SI=F' ? 'Silver' : c.symbol === 'CL=F' ? 'Oil (WTI)' : c.symbol === 'BZ=F' ? 'Oil (Brent)' : c.symbol === 'NG=F' ? 'Natural Gas' : c.symbol === 'HG=F' ? 'Copper' : c.symbol === 'PL=F' ? 'Platinum' : c.symbol;
          await pushEventDriven(
            c.symbol, 'COMMODITY_MOVE', direction, conf,
            `${name} ${direction === 'BUY' ? 'surging' : 'plunging'} ${c.changePercent > 0 ? '+' : ''}${c.changePercent.toFixed(1)}% — $${c.price.toFixed(2)}`,
            [`Price: $${c.price.toFixed(2)}`, `Change: ${c.changePercent > 0 ? '+' : ''}${c.changePercent.toFixed(1)}%`, `Volume: ${c.volume.toLocaleString()}`],
            undefined, env.DB,
          );
        }
      }
    }
  } catch (err) {
    logger.error('Commodity scan error', err);
  }
}

export async function runPairsScan(env: Env): Promise<void> {
  try {
    const watchlist = getWatchlist(env);
    const promoted = await getPromotedWatchlist(env);
    // Pairs trading works better with a focused set — use top 30 promoted
    const allSymbols = [...new Set([...watchlist, ...promoted.slice(0, 30)])];
    if (allSymbols.length < 2) return;

    const priceData: Record<string, number[]> = {};
    for (const symbol of allSymbols) {
      const ohlcv = await yahooFinance.getOHLCV(symbol, '3mo', '1d');
      if (ohlcv.length > 0) {
        priceData[symbol] = ohlcv.map((c) => c.close);
      }
    }

    const allPairs = scanPairs(Object.keys(priceData), priceData);
    const tradable = findTradablePairs(allPairs);

    if (tradable.length > 0) {
      for (const pair of tradable.slice(0, 5)) {
        const quoteA = await yahooFinance.getQuote(pair.symbolA);
        const quoteB = await yahooFinance.getQuote(pair.symbolB);
        if (quoteA && quoteB) {
          const direction = pair.currentZScore > 0 ? 'LONG_B_SHORT_A' : 'LONG_A_SHORT_B';
          await pushStatArb(
            { symbolA: pair.symbolA, symbolB: pair.symbolB, zScore: pair.currentZScore, direction, halfLife: pair.halfLife, correlation: pair.correlation },
            { a: quoteA, b: quoteB },
            env.DB,
          );
        }
      }
    }
    logger.info(`Pairs scan: ${allPairs.length} pairs analyzed from ${allSymbols.length} symbols, ${tradable.length} tradable`);
  } catch (err) {
    logger.error('Pairs scan error', err);
  }
}

export async function runOptionsScan(env: Env): Promise<void> {
  const watchlist = getWatchlist(env);
  const promoted = await getPromotedWatchlist(env);
  const allSymbols = [...new Set([...watchlist, ...promoted])];

  for (const symbol of allSymbols) {
    try {
      const [quote, ohlcv] = await Promise.all([
        yahooFinance.getQuote(symbol),
        yahooFinance.getOHLCV(symbol, '6mo', '1d'),
      ]);
      if (!quote || ohlcv.length < 30) continue;

      const indicators = computeIndicators(symbol, ohlcv);
      const rsi = indicators.find((i) => i.indicator === 'RSI')?.value;
      const atr = indicators.find((i) => i.indicator === 'ATR')?.value;
      if (!rsi || !atr) continue;

      const relativeATR = atr / quote.price;
      const isHighVol = relativeATR > 0.025;
      const isRSIExtreme = rsi < 25 || rsi > 75;
      const isRSIOversold = rsi < 30;

      if (isHighVol && isRSIExtreme) {
        const direction: 'BUY' | 'SELL' = isRSIOversold ? 'BUY' : 'SELL';
        const conf = Math.min(90, 55 + (isRSIOversold ? (30 - rsi) * 2 : (rsi - 70) * 2) + (relativeATR > 0.04 ? 10 : 0));
        const signalType = isRSIOversold ? 'PUT_SELL_OPPORTUNITY' : 'CALL_SELL_OPPORTUNITY';
        await pushOptions(symbol, signalType, direction, conf, quote, indicators, env.DB);
      } else if (isHighVol && Math.abs(quote.changePercent) > 3) {
        const direction: 'BUY' | 'SELL' = quote.changePercent > 0 ? 'BUY' : 'SELL';
        const conf = Math.min(85, 55 + Math.abs(quote.changePercent) * 3);
        await pushOptions(symbol, 'MOMENTUM_OPTIONS', direction, conf, quote, indicators, env.DB);
      }
    } catch (err) {
      logger.error(`Options ${symbol} error`, err);
    }
  }
  logger.info(`Options scan complete: ${allSymbols.length} symbols (${watchlist.length} core + ${promoted.length} promoted)`);
}

export async function runEventDrivenScan(env: Env): Promise<void> {
  const coreWatchlist = getWatchlist(env);
  const promoted = await getPromotedWatchlist(env);
  const allSymbols = [...new Set([...coreWatchlist, ...promoted])];

  try {
    const news = await fetchGoogleAlerts();
    if (news.length > 0) {
      if (env.DB) {
        const inserted = await storeNewsAlerts(news, env.DB);
        logger.info(`Event scan: stored ${inserted} new alerts`);
      }
      const recent = news.filter((n) => Date.now() - new Date(n.published).getTime() < 6 * 60 * 60 * 1000);

      if (isZAiAvailable(env) && recent.length > 0) {
        try {
          const headlines = recent.slice(0, 10).map((n) => n.title);
          const sentiment = await scoreNewsSentiment((env as any).AI, headlines);
          const strong = sentiment.filter((s) => s.confidence >= 70);

          for (const s of strong.slice(0, 3)) {
            const matchedSymbol = allSymbols.find((sym) =>
              s.headline.toUpperCase().includes(sym) || s.headline.toUpperCase().includes(sym.replace('.', '')),
            );
            if (matchedSymbol) {
              const quote = await yahooFinance.getQuote(matchedSymbol);
              await pushEventDriven(
                matchedSymbol, `NEWS_${s.sentiment}`, s.sentiment === 'BULLISH' ? 'BUY' : 'SELL', s.confidence,
                `Z.AI news sentiment: ${s.headline.slice(0, 80)}`,
                [`Sentiment: ${s.sentiment} (${s.confidence}%)`, `Source: Google Alerts`],
                quote || undefined, env.DB,
              );
            }
          }
        } catch (err) {
          logger.error('Z.AI sentiment error', err);
        }
      }

      if (recent.length > 0) {
        addContext(formatNewsDigest(recent, 5));
      }
    }
  } catch (err) {
    logger.error('News scan error', err);
  }

  try {
    const earnings = await finnhub.getEarningsCalendar(env, 1);
    for (const e of earnings) {
      if (allSymbols.includes(e.symbol)) {
        const quote = await yahooFinance.getQuote(e.symbol);
        if (quote && Math.abs(quote.changePercent) > 3) {
          const direction: 'BUY' | 'SELL' = quote.changePercent > 0 ? 'BUY' : 'SELL';
          const conf = Math.min(85, 55 + Math.abs(quote.changePercent) * 3);
          await pushEventDriven(
            e.symbol, 'EARNINGS_REACTION', direction, conf,
            `Earnings reaction: ${e.symbol} moved ${quote.changePercent > 0 ? '+' : ''}${quote.changePercent.toFixed(1)}% post-earnings`,
            [`Move: ${quote.changePercent > 0 ? '+' : ''}${quote.changePercent.toFixed(1)}%`, `Time: ${e.hour === 'bmo' ? 'Pre-market' : 'After-hours'}`],
            quote, env.DB,
          );
        }
      }
    }
  } catch (err) {
    logger.error('Earnings scan error', err);
  }

  // GAP-025: Insider transaction scan — detect cluster buying/selling
  // Limit insider API calls to top 30 symbols to stay within Finnhub rate limits
  try {
    const insiderSymbols = allSymbols.slice(0, 30);
    const insiderSignals = await finnhub.scanInsiderActivity(insiderSymbols, env);
    for (const sig of insiderSignals) {
      if (sig.signal === 'NEUTRAL') continue;
      const quote = await yahooFinance.getQuote(sig.symbol);
      const direction: 'BUY' | 'SELL' = sig.signal === 'BULLISH' ? 'BUY' : 'SELL';
      await pushEventDriven(
        sig.symbol,
        `INSIDER_${sig.signal}`,
        direction,
        sig.confidence,
        `Insider ${sig.clusterBuying ? 'cluster' : ''} ${sig.signal.toLowerCase()}: ${sig.recentBuyers.slice(0, 3).join(', ')}`,
        [
          `Net buying: ${sig.netBuyingShares.toLocaleString()} shares`,
          `Transactions: ${sig.totalTransactions} (30d)`,
          `Buyers: ${sig.recentBuyers.length}`,
        ],
        quote || undefined,
        env.DB,
      );
    }
  } catch (err) {
    logger.error('Insider scan error', err);
  }

  logger.info(`Event-driven scan complete: ${allSymbols.length} symbols (${coreWatchlist.length} core + ${promoted.length} promoted)`);
}

export async function runScraperScan(env: Env): Promise<void> {
  // GAP-028: Use BROWSER when available, fall back to fetch-based screener
  try {
    let oversold: import('../scrapers/finviz').FinvizResult[];
    let newHighs: import('../scrapers/finviz').FinvizResult[];

    if (env.BROWSER) {
      oversold = await scrapeOversoldStocks(env.BROWSER);
      newHighs = await scrape52WeekHighs(env.BROWSER);
    } else {
      oversold = await fetchOversoldStocks();
      newHighs = await fetch52WeekHighs();
    }

    if (oversold.length > 0) {
      const alert = formatFinvizAlert('Finviz: RSI Oversold Stocks', oversold);
      await sendTelegramMessage(alert, env);
    }
    if (newHighs.length > 0) {
      const alert = formatFinvizAlert('Finviz: New 52-Week Highs', newHighs);
      await sendTelegramMessage(alert, env);
    }
    logger.info(`Finviz (${env.BROWSER ? 'browser' : 'fetch'}): ${oversold.length} oversold, ${newHighs.length} new highs`);
  } catch (err) {
    logger.error('Finviz error', err);
  }

  try {
    const overview = await scrapeMarketOverview(env.BROWSER);
    if (overview.indices.length > 0 || overview.trending.length > 0) {
      const alert = formatMarketOverview(overview);
      await sendTelegramMessage(alert, env);
    }
    logger.info(`Google Finance: ${overview.indices.length} indices, ${overview.trending.length} trending`);
  } catch (err) {
    logger.error('Google Finance error', err);
  }
}
