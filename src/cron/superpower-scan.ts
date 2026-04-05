// ─── Superpower Data Scan ────────────────────────────────────
// Cron module for the Superpower Data Layer:
// 1) RSS Aggregator: 25+ free RSS feeds
// 2) TradingView Scanner: hidden bulk API (no auth)
// 3) CNBC Quotes: hidden real-time quotes (no auth)
// 4) StockTwits Sentiment: social signal layer
// 5) SEC EDGAR: 8-K filings + insider activity
//
// Cron schedule: hourly scans (integrated into FULL_SCAN_HOURLY)
// Budget: ~1,120 extra requests/day (well within CF 100K limit)

import type { Env } from '../types';
import { createLogger } from '../utils/logger';
import { getWatchlist } from './market-scans';

const logger = createLogger('SuperpowerScan');

// ── Hidden API clients ──
import * as tradingview from '../api/tradingview';
// cnbc quotes used on-demand via direct import, not in scheduled scan
import * as stocktwits from '../api/stocktwits';
import * as secEdgar from '../api/sec-edgar';
import { fetchRSSFeeds, fetchYahooSymbolNews, storeRSSItems, type RSSItem } from '../scrapers/rss-aggregator';

// ── DB layer ──
import { insertTVScannerSnapshot, insertSocialSentiment, updateFeedHealth } from '../db/queries';
import { insertCandidatesBatch } from '../db/queries/candidate-queries';
import { pushEventDriven, addContext } from '../broker-manager';
import { scoreNewsSentiment, isZAiAvailable } from '../ai/z-engine';

// ─── Main Entry Point ────────────────────────────────────────

/**
 * Run the full superpower data scan.
 * Called from runFullScan() during hourly cron.
 * Safe: all errors caught per-subsystem — never crashes caller.
 */
export async function runSuperpowerScan(env: Env): Promise<void> {
  const start = Date.now();

  const results = await Promise.allSettled([
    runRSSIngestion(env),
    runTVScannerCapture(env),
    runSocialSentimentCapture(env),
    runSECFilingsMonitor(env),
  ]);

  const durations = results.map((r, i) => {
    const names = ['RSS', 'TV', 'Social', 'SEC'];
    const status = r.status === 'fulfilled' ? '✓' : '✗';
    return `${names[i]}:${status}`;
  });

  logger.info(`Superpower scan complete (${Date.now() - start}ms): ${durations.join(' ')}`);
}

/**
 * Lighter version for 15-min quick scans (RSS only).
 */
export async function runSuperpowerQuick(env: Env): Promise<void> {
  await runRSSIngestion(env, 1); // Tier 1 feeds only
}

// ─── Sub-Scans ───────────────────────────────────────────────

/**
 * 1) RSS Feed Ingestion — fetches 25+ feeds, deduplicates, stores to D1.
 *    If Z.AI available, runs sentiment analysis on new items.
 */
async function runRSSIngestion(env: Env, maxTier?: 1 | 2 | 3): Promise<void> {
  try {
    // Fetch general RSS feeds
    const generalItems = await fetchRSSFeeds(maxTier);

    // Fetch Yahoo per-symbol news for top holdings
    const watchlist = getWatchlist(env).slice(0, 20);
    const yahooItems = await fetchYahooSymbolNews(watchlist);

    const allItems = [...generalItems, ...yahooItems];

    if (env.DB && allItems.length > 0) {
      const inserted = await storeRSSItems(allItems, env.DB);
      logger.info(`RSS: ${allItems.length} items fetched, ${inserted} new stored`);

      // Update feed health tracking
      const sourceCounts = new Map<string, number>();
      for (const item of allItems) {
        sourceCounts.set(item.source, (sourceCounts.get(item.source) || 0) + 1);
      }
      for (const [source, count] of sourceCounts) {
        await updateFeedHealth(env.DB, source, true, count);
      }

      // Z.AI sentiment analysis on new items with symbols
      if (isZAiAvailable(env) && inserted > 0) {
        await analyzeRSSSentiment(env, allItems.filter(i => i.symbols.length > 0).slice(0, 15));
      }
    }
  } catch (err) {
    logger.error('RSS ingestion error', err);
  }
}

/**
 * 2) TradingView Scanner — captures market snapshots via hidden bulk API.
 *    v3.5: Expanded to 6 scan passes × 50 results. ALL discoveries stored
 *    as candidates in scan_candidates table. Signal generation for ANY
 *    qualifying symbol (watchlist gate removed).
 */
async function runTVScannerCapture(env: Env): Promise<void> {
  try {
    const scans: Array<{ type: 'top_gainers' | 'top_losers' | 'high_volume' | 'oversold' | 'overbought'; limit: number; source: string }> = [
      { type: 'top_gainers', limit: 200, source: 'TV_GAINER' },
      { type: 'top_losers', limit: 200, source: 'TV_LOSER' },
      { type: 'high_volume', limit: 200, source: 'TV_VOLUME' },
      { type: 'oversold', limit: 200, source: 'TV_OVERSOLD' },
      { type: 'overbought', limit: 200, source: 'TV_OVERBOUGHT' },
    ];

    for (const scan of scans) {
      const results = await tradingview.scanMarket(scan.type, scan.limit);
      if (results.length === 0) continue;

      // Store snapshots to tv_scanner_snapshots (existing behavior)
      if (env.DB) {
        for (const r of results) {
          const id = `tv_${scan.type}_${r.symbol}_${Date.now()}`;
          await insertTVScannerSnapshot(
            env.DB, id, scan.type, r.symbol, r.close, r.changePercent,
            r.volume, r.relativeVolume, r.rsi, r.marketCap, r.sector, r.recommendation
          );
        }

        // v3.5: Store ALL results as candidates for universe pipeline
        const candidates = results.map(r => ({
          symbol: r.symbol,
          source: scan.source,
          direction: scan.type === 'top_gainers' || scan.type === 'oversold' ? 'BUY' as const
            : scan.type === 'top_losers' || scan.type === 'overbought' ? 'SELL' as const
            : (r.changePercent > 0 ? 'BUY' as const : 'SELL' as const),
          price: r.close,
          changePct: r.changePercent,
          volume: r.volume,
          volumeRatio: r.relativeVolume,
          rsi: r.rsi,
          marketCap: r.marketCap,
          sector: r.sector,
          reason: `TV ${scan.type}: ${r.changePercent > 0 ? '+' : ''}${r.changePercent.toFixed(1)}%, RSI ${r.rsi?.toFixed(0) ?? '?'}, RelVol ${r.relativeVolume?.toFixed(1) ?? '?'}x`,
        }));
        await insertCandidatesBatch(env.DB, candidates);
      }

      // v3.5: Generate signals from ANY qualifying symbol (watchlist gate removed)
      for (const r of results) {
        // Oversold with high relative volume = potential reversal
        if (scan.type === 'oversold' && r.rsi < 25 && r.relativeVolume > 2) {
          await pushEventDriven(
            r.symbol, 'TV_OVERSOLD_VOLUME', 'BUY',
            Math.min(80, 55 + (30 - r.rsi) + r.relativeVolume * 3),
            `TradingView Scanner: ${r.symbol} RSI ${r.rsi.toFixed(0)} with ${r.relativeVolume.toFixed(1)}x relative volume`,
            [`RSI: ${r.rsi.toFixed(1)}`, `RelVol: ${r.relativeVolume.toFixed(1)}x`, `Sector: ${r.sector}`],
            undefined, env.DB,
          );
        }

        // Top gainer with high volume = momentum
        if (scan.type === 'top_gainers' && r.changePercent > 5 && r.relativeVolume > 3) {
          await pushEventDriven(
            r.symbol, 'TV_VOLUME_BREAKOUT', 'BUY',
            Math.min(80, 55 + r.changePercent * 2),
            `TradingView Scanner: ${r.symbol} +${r.changePercent.toFixed(1)}% on ${r.relativeVolume.toFixed(1)}x volume`,
            [`Change: +${r.changePercent.toFixed(1)}%`, `RelVol: ${r.relativeVolume.toFixed(1)}x`],
            undefined, env.DB,
          );
        }
      }

      logger.info(`TV Scanner ${scan.type}: ${results.length} results → candidates stored`);
    }
  } catch (err) {
    logger.error('TV Scanner capture error', err);
  }
}

/**
 * 3) Social Sentiment — StockTwits trending + per-symbol sentiment.
 *    Stores to D1 for historical tracking. Generates signals on extremes.
 */
async function runSocialSentimentCapture(env: Env): Promise<void> {
  try {
    // Get trending symbols from StockTwits
    const trending = await stocktwits.getTrendingSymbols();
    if (trending.length > 0) {
      addContext(`📊 StockTwits Trending: ${trending.slice(0, 10).map(t => t.symbol).join(', ')}`);
    }

    // Get sentiment for watchlist symbols
    const watchlist = getWatchlist(env).slice(0, 10);
    const sentimentMap = await stocktwits.batchSentiment(watchlist);

    if (env.DB) {
      for (const [symbol, sentiment] of sentimentMap) {
        const id = `st_${symbol}_${Date.now()}`;
        await insertSocialSentiment(
          env.DB, id, symbol, 'stocktwits',
          sentiment.bullish, sentiment.bearish, sentiment.total,
          sentiment.sentimentScore, sentiment.watchlistCount
        );

        // Extreme sentiment divergence = contrarian signal
        if (Math.abs(sentiment.sentimentScore) > 80 && sentiment.total >= 10) {
          const isCrowdBullish = sentiment.sentimentScore > 80;
          await pushEventDriven(
            symbol,
            isCrowdBullish ? 'SOCIAL_EXTREME_BULLISH' : 'SOCIAL_EXTREME_BEARISH',
            isCrowdBullish ? 'SELL' : 'BUY', // contrarian
            60,
            `StockTwits extreme sentiment: ${symbol} ${sentiment.sentimentScore > 0 ? '+' : ''}${sentiment.sentimentScore} (${sentiment.total} msgs)`,
            [
              `Sentiment: ${sentiment.sentimentScore > 0 ? '+' : ''}${sentiment.sentimentScore}`,
              `Bullish: ${sentiment.bullish} / Bearish: ${sentiment.bearish}`,
              `Watchlist: ${sentiment.watchlistCount.toLocaleString()}`,
            ],
            undefined, env.DB,
          );
        }
      }
    }

    logger.info(`Social sentiment: ${sentimentMap.size} symbols analyzed, ${trending.length} trending`);
  } catch (err) {
    logger.error('Social sentiment error', err);
  }
}

/**
 * 4) SEC EDGAR Monitor — 8-K filings for material events.
 *    Checks top holdings for new filings in the last few hours.
 */
async function runSECFilingsMonitor(env: Env): Promise<void> {
  try {
    const watchlist = getWatchlist(env).slice(0, 15); // Conservative: 15 symbols max

    for (const symbol of watchlist) {
      const filings = await secEdgar.getRecent8K(symbol, 3);
      if (filings.length === 0) continue;

      // Check for filings in the last 24 hours
      const recent = filings.filter(f => {
        const filedDate = new Date(f.filed);
        return Date.now() - filedDate.getTime() < 24 * 3600000;
      });

      if (recent.length > 0) {
        const filing = recent[0];
        await pushEventDriven(
          symbol, 'SEC_8K_FILING', 'BUY', 55, // Neutral direction — needs Z.AI to classify
          `SEC 8-K Filed: ${symbol} — ${filing.title.slice(0, 100)}`,
          [`Type: ${filing.type}`, `Filed: ${filing.filed}`, `Link: ${filing.link}`],
          undefined, env.DB,
        );

        logger.info(`SEC EDGAR: new 8-K for ${symbol}: ${filing.title.slice(0, 60)}`);
      }
    }
  } catch (err) {
    logger.error('SEC EDGAR monitor error', err);
  }
}

// ─── Z.AI News Sentiment ────────────────────────────────────

async function analyzeRSSSentiment(env: Env, items: RSSItem[]): Promise<void> {
  try {
    const headlines = items.map(i => i.title);
    const sentiment = await scoreNewsSentiment((env as any).AI, headlines);

    const watchlist = new Set(getWatchlist(env));

    for (let i = 0; i < sentiment.length; i++) {
      const s = sentiment[i];
      const item = items[i];
      if (!item) continue;

      // Check if any extracted symbol is on our watchlist
      const matchedSymbol = item.symbols.find(sym => watchlist.has(sym));
      if (matchedSymbol && s.confidence >= 70) {
        await pushEventDriven(
          matchedSymbol,
          `RSS_${s.sentiment}`,
          s.sentiment === 'BULLISH' ? 'BUY' : 'SELL',
          s.confidence,
          `${item.source} RSS: ${item.title.slice(0, 80)}`,
          [`Source: ${item.source}`, `Sentiment: ${s.sentiment} (${s.confidence}%)`],
          undefined, env.DB,
        );
      }
    }
  } catch (err) {
    logger.error('RSS sentiment analysis error', err);
  }
}
