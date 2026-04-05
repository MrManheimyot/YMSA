// ─── Pre-Market Scan — Universe Discovery & Candidate Promotion ─────────
// Cron: 12:00 UTC (14:00 IST / 08:00 ET) — 2.5 hours before market open
//
// Pipeline:
// 1) TradingView bulk scanner — 6 filter passes × 200 results = ~800-1000 unique symbols
// 2) FinViz fetch-based screens — oversold + 52W highs
// 3) Score & rank all candidates from last 24h
// 4) Promote top 50 to full pipeline
// 5) Send Telegram pre-market prep summary

import type { Env } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('PreMarket');

import * as tradingview from '../api/tradingview';
import { fetchOversoldStocks, fetch52WeekHighs } from '../scrapers/finviz';
import { sendTelegramMessage } from '../alert-router';
import { insertCandidatesBatch, promoteTopCandidates, getCandidateStats, cleanOldCandidates } from '../db/queries/candidate-queries';

// ─── Main Entry Point ────────────────────────────────────────

/**
 * Pre-market preparation — discovers, ranks, and promotes candidates.
 * Runs at 12:00 UTC (08:00 ET), 2.5 hours before US market open.
 */
export async function runPreMarketScan(env: Env): Promise<void> {
  const start = Date.now();
  if (!env.DB) {
    logger.error('Pre-market scan requires D1 database');
    return;
  }

  // Phase 1: Universe discovery — broad market scanning
  const [tvCount, finvizCount] = await Promise.all([
    discoverViaTradingView(env),
    discoverViaFinViz(env),
  ]);

  // Phase 2: Promote top candidates (150 = enough for multi-engine coverage)
  const promoted = await promoteTopCandidates(env.DB, 150);

  // Phase 3: Clean old data (7+ days)
  const cleaned = await cleanOldCandidates(env.DB, 7);

  // Phase 4: Generate stats & send Telegram summary
  const stats = await getCandidateStats(env.DB);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  const lines = [
    '<b>🔭 PRE-MARKET UNIVERSE SCAN</b>',
    `<i>${new Date().toISOString().split('T')[0]} — ${elapsed}s</i>`,
    '',
    `<b>Discovery:</b>`,
    `  📊 TradingView: ${tvCount} symbols across 6 scans`,
    `  📋 FinViz: ${finvizCount} symbols (oversold + 52W highs)`,
    `  🔢 Total unique: ${stats.total} candidates`,
    '',
    `<b>Sources:</b>`,
    ...Object.entries(stats.bySources).map(([src, cnt]) => `  • ${src}: ${cnt}`),
    '',
    `<b>Promoted to Pipeline:</b> ${promoted.length} symbols`,
    promoted.length > 0 ? `  ${promoted.slice(0, 20).join(', ')}${promoted.length > 20 ? ` +${promoted.length - 20} more` : ''}` : '  (none)',
    '',
    `<b>Top Scorers:</b>`,
    ...stats.topScorers.slice(0, 5).map((t, i) => `  ${i + 1}. ${t.symbol} — score ${t.score} (${t.source})`),
  ];

  if (cleaned > 0) {
    lines.push('', `🧹 Cleaned ${cleaned} old candidate records`);
  }

  await sendTelegramMessage(lines.join('\n'), env);
  logger.info(`Pre-market scan complete: ${stats.total} discovered, ${promoted.length} promoted (${elapsed}s)`);
}

// ─── Discovery Sub-Scans ────────────────────────────────────

/**
 * Run 6 TradingView scanner passes to discover candidates from the entire US market.
 */
async function discoverViaTradingView(env: Env): Promise<number> {
  const scans: Array<{
    type: 'top_gainers' | 'top_losers' | 'high_volume' | 'oversold' | 'overbought' | 'all';
    limit: number;
    source: string;
  }> = [
    { type: 'top_gainers', limit: 200, source: 'TV_GAINER' },
    { type: 'top_losers', limit: 200, source: 'TV_LOSER' },
    { type: 'high_volume', limit: 200, source: 'TV_VOLUME' },
    { type: 'oversold', limit: 200, source: 'TV_OVERSOLD' },
    { type: 'overbought', limit: 200, source: 'TV_OVERBOUGHT' },
    { type: 'all', limit: 200, source: 'TV_ALL' },
  ];

  let totalSymbols = 0;

  for (const scan of scans) {
    try {
      const results = await tradingview.scanMarket(scan.type, scan.limit);
      if (results.length === 0) continue;

      const candidates = results.map(r => ({
        symbol: r.symbol,
        source: scan.source,
        direction: deriveDirection(scan.type, r.changePercent),
        price: r.close,
        changePct: r.changePercent,
        volume: r.volume,
        volumeRatio: r.relativeVolume,
        rsi: r.rsi,
        marketCap: r.marketCap,
        sector: r.sector,
        reason: `TV ${scan.type}: ${r.changePercent > 0 ? '+' : ''}${r.changePercent.toFixed(1)}%, RSI ${r.rsi?.toFixed(0) ?? '?'}, RelVol ${r.relativeVolume?.toFixed(1) ?? '?'}x`,
      }));

      await insertCandidatesBatch(env.DB!, candidates);
      totalSymbols += candidates.length;
      logger.info(`TV ${scan.type}: ${results.length} candidates stored`);
    } catch (err) {
      logger.error(`TV ${scan.type} discovery error`, err);
    }
  }

  return totalSymbols;
}

/**
 * Run FinViz fetch-based screens (oversold + 52W highs).
 */
async function discoverViaFinViz(env: Env): Promise<number> {
  let totalSymbols = 0;

  try {
    const oversold = await fetchOversoldStocks();
    if (oversold.length > 0) {
      const candidates = oversold.map(r => ({
        symbol: r.ticker,
        source: 'FINVIZ_OVERSOLD',
        direction: 'BUY' as const,
        price: r.price,
        changePct: r.change,
        reason: `FinViz oversold: ${r.change > 0 ? '+' : ''}${r.change.toFixed(1)}%`,
      }));
      await insertCandidatesBatch(env.DB!, candidates);
      totalSymbols += candidates.length;
    }
  } catch (err) {
    logger.error('FinViz oversold discovery error', err);
  }

  try {
    const highs = await fetch52WeekHighs();
    if (highs.length > 0) {
      const candidates = highs.map(r => ({
        symbol: r.ticker,
        source: 'FINVIZ_52HIGH',
        direction: 'BUY' as const,
        price: r.price,
        changePct: r.change,
        reason: `FinViz 52W high: $${r.price.toFixed(2)}, ${r.change > 0 ? '+' : ''}${r.change.toFixed(1)}%`,
      }));
      await insertCandidatesBatch(env.DB!, candidates);
      totalSymbols += candidates.length;
    }
  } catch (err) {
    logger.error('FinViz 52W high discovery error', err);
  }

  return totalSymbols;
}

// ─── Helpers ─────────────────────────────────────────────────

function deriveDirection(
  scanType: string,
  changePct: number,
): 'BUY' | 'SELL' | null {
  switch (scanType) {
    case 'top_gainers': return 'BUY';
    case 'top_losers': return 'SELL';
    case 'oversold': return 'BUY';
    case 'overbought': return 'SELL';
    default: return changePct > 0 ? 'BUY' : changePct < 0 ? 'SELL' : null;
  }
}
