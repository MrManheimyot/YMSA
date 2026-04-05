// ─── Russell 1000 Universe Scanner ──────────────────────────
// Batch-scans the full R1K universe via TradingView bulk API.
// Designed for Cloudflare Workers: respects CPU time + subrequest limits.
//
// Strategy:
//   Pre-market (08:00 ET): Full R1K scan → score → promote top 150
//   Hourly (market hours): Re-scan top 300 movers → re-promote
//   Each TV API call: ~100 symbols (conservative for reliability)
//
// Rate budget: ~10 TV API calls per full scan (1000 / 100 per batch)
// CPU budget: ~5-8s for full scan (network-bound, not CPU-bound)

import type { Env } from '../types';
import { createLogger } from '../utils/logger';
import { getRussell1000, getBatches } from '../universe/russell1000';
import { scanSymbolsBulk, type TVScanResult } from '../api/tradingview';
import { insertCandidatesBatch, promoteTopCandidates, getCandidateStats, cleanOldCandidates } from '../db/queries/candidate-queries';
import { sendTelegramMessage } from '../alert-router';

const logger = createLogger('R1K-Scanner');

// ─── Configuration ──────────────────────────────────────────

/** Symbols per TV API batch request */
const BATCH_SIZE = 100;

/** Max candidates to promote to full engine pipeline */
const PROMOTION_LIMIT = 150;

/** Minimum score to be considered for promotion (0-100) */
const MIN_PROMOTION_SCORE = 35;

/** Delay between TV API batches (ms) — respect rate limit */
const BATCH_DELAY_MS = 200;

// ─── Main Entry Point ───────────────────────────────────────

export interface R1KScanResult {
  totalUniverse: number;
  scanned: number;
  stored: number;
  promoted: number;
  errors: number;
  batchCount: number;
  elapsed: number;
  sectorCoverage: Record<string, number>;
}

/**
 * Full Russell 1000 universe scan.
 * Called from pre-market cron (08:00 ET) and can be triggered manually.
 *
 * Flow:
 *   1. Load R1K universe (KV override or static list)
 *   2. Batch scan via TV scanner API (~10 batches × 100 symbols)
 *   3. Score each symbol and store as candidate in D1
 *   4. Promote top 150 to engine pipeline
 *   5. Clean stale data (7+ days)
 *   6. Report results via Telegram
 */
export async function scanRussell1000(env: Env): Promise<R1KScanResult> {
  const start = Date.now();

  if (!env.DB) {
    logger.error('R1K scan requires D1 database');
    return { totalUniverse: 0, scanned: 0, stored: 0, promoted: 0, errors: 0, batchCount: 0, elapsed: 0, sectorCoverage: {} };
  }

  // Phase 1: Load universe
  const universe = await getRussell1000(env.YMSA_CACHE);
  const batches = getBatches(universe, BATCH_SIZE);
  logger.info(`R1K scan starting: ${universe.length} symbols in ${batches.length} batches`);

  // Phase 2: Batch scan via TV
  let scanned = 0;
  let stored = 0;
  let errors = 0;
  const sectorHits: Record<string, number> = {};

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      const results = await scanSymbolsBulk(batch);
      scanned += results.length;

      if (results.length > 0) {
        // Convert TV results to candidates with scoring
        const candidates = results.map(r => ({
          symbol: r.symbol,
          source: 'R1K_UNIVERSE',
          direction: deriveR1KDirection(r),
          price: r.close,
          changePct: r.changePercent,
          volume: r.volume,
          volumeRatio: r.relativeVolume,
          rsi: r.rsi,
          marketCap: r.marketCap,
          sector: r.sector,
          reason: formatR1KReason(r),
        }));

        await insertCandidatesBatch(env.DB, candidates);
        stored += candidates.length;

        // Track sector coverage
        for (const r of results) {
          const sec = r.sector || 'Unknown';
          sectorHits[sec] = (sectorHits[sec] || 0) + 1;
        }
      }

      logger.info(`R1K batch ${i + 1}/${batches.length}: ${results.length}/${batch.length} symbols scanned`);
    } catch (err) {
      errors++;
      logger.error(`R1K batch ${i + 1} error`, err);
    }

    // Rate limit: small delay between batches (except last)
    if (i < batches.length - 1 && BATCH_DELAY_MS > 0) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  // Phase 3: Promote top candidates
  const promoted = await promoteTopCandidates(env.DB, PROMOTION_LIMIT);

  // Phase 4: Clean stale data
  await cleanOldCandidates(env.DB, 7);

  const elapsed = (Date.now() - start) / 1000;

  const result: R1KScanResult = {
    totalUniverse: universe.length,
    scanned,
    stored,
    promoted: promoted.length,
    errors,
    batchCount: batches.length,
    elapsed,
    sectorCoverage: sectorHits,
  };

  logger.info(`R1K scan complete: ${result.scanned}/${result.totalUniverse} scanned, ${result.promoted} promoted`);
  return result;
}

/**
 * Quick R1K re-scan — re-scans top movers from today's candidates.
 * Called hourly during market hours. Lighter than full scan.
 * Only re-scans symbols that already have high scores or are promoted.
 */
export async function rescanR1KMovers(env: Env): Promise<R1KScanResult> {
  const start = Date.now();

  if (!env.DB) {
    return { totalUniverse: 0, scanned: 0, stored: 0, promoted: 0, errors: 0, batchCount: 0, elapsed: 0, sectorCoverage: {} };
  }

  // Get today's top 300 candidates by score (includes previously promoted)
  const date = new Date().toISOString().split('T')[0];
  const topRows = await env.DB.prepare(
    `SELECT DISTINCT symbol FROM scan_candidates
     WHERE scan_date = ? AND (promoted = 1 OR score >= ?)
     ORDER BY score DESC LIMIT 300`
  ).bind(date, MIN_PROMOTION_SCORE).all();

  const symbols = ((topRows.results || []) as any[]).map(r => r.symbol as string);
  if (symbols.length === 0) {
    logger.info('R1K re-scan: no candidates to re-scan');
    return { totalUniverse: 0, scanned: 0, stored: 0, promoted: 0, errors: 0, batchCount: 0, elapsed: 0, sectorCoverage: {} };
  }

  const batches = getBatches(symbols, BATCH_SIZE);
  let scanned = 0;
  let stored = 0;
  let errors = 0;
  const sectorHits: Record<string, number> = {};

  for (let i = 0; i < batches.length; i++) {
    try {
      const results = await scanSymbolsBulk(batches[i]);
      scanned += results.length;

      if (results.length > 0) {
        const candidates = results.map(r => ({
          symbol: r.symbol,
          source: 'R1K_RESCAN',
          direction: deriveR1KDirection(r),
          price: r.close,
          changePct: r.changePercent,
          volume: r.volume,
          volumeRatio: r.relativeVolume,
          rsi: r.rsi,
          marketCap: r.marketCap,
          sector: r.sector,
          reason: formatR1KReason(r),
        }));

        await insertCandidatesBatch(env.DB, candidates);
        stored += candidates.length;

        for (const r of results) {
          const sec = r.sector || 'Unknown';
          sectorHits[sec] = (sectorHits[sec] || 0) + 1;
        }
      }
    } catch (err) {
      errors++;
      logger.error(`R1K re-scan batch ${i + 1} error`, err);
    }

    if (i < batches.length - 1) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }

  // Re-promote with fresh scores
  const promoted = await promoteTopCandidates(env.DB, PROMOTION_LIMIT);

  const elapsed = (Date.now() - start) / 1000;
  return { totalUniverse: symbols.length, scanned, stored, promoted: promoted.length, errors, batchCount: batches.length, elapsed, sectorCoverage: sectorHits };
}

/**
 * Send R1K scan Telegram summary.
 */
export async function sendR1KReport(result: R1KScanResult, stats: Awaited<ReturnType<typeof getCandidateStats>>, env: Env): Promise<void> {
  const sectors = Object.entries(result.sectorCoverage)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 11);

  const lines = [
    '<b>🏛️ RUSSELL 1000 UNIVERSE SCAN</b>',
    `<i>${new Date().toISOString().split('T')[0]} — ${result.elapsed.toFixed(1)}s</i>`,
    '',
    `<b>Coverage:</b>`,
    `  📊 Universe: ${result.totalUniverse} symbols (R1K)`,
    `  ✅ Scanned: ${result.scanned} (${((result.scanned / Math.max(result.totalUniverse, 1)) * 100).toFixed(0)}%)`,
    `  💾 Stored: ${result.stored} candidates`,
    `  🚀 Promoted: ${result.promoted} → engine pipeline`,
    result.errors > 0 ? `  ⚠️ Errors: ${result.errors} batches` : '',
    '',
    `<b>Sector Coverage:</b>`,
    ...sectors.map(([sec, cnt]) => `  • ${sec}: ${cnt}`),
    '',
    `<b>Pipeline:</b>`,
    `  Total discovered: ${stats.total}`,
    `  Promoted: ${stats.promoted}`,
    `  Evaluated: ${stats.evaluated}`,
    `  Rate: ${stats.total > 0 ? ((stats.evaluated / stats.total) * 100).toFixed(0) : 0}%`,
  ];

  if (stats.topScorers.length > 0) {
    lines.push('', '<b>Top Scorers:</b>');
    lines.push(...stats.topScorers.slice(0, 5).map((t, i) =>
      `  ${i + 1}. ${t.symbol} — score ${t.score} (${t.source})`
    ));
  }

  await sendTelegramMessage(lines.filter(Boolean).join('\n'), env);
}

// ─── Helpers ────────────────────────────────────────────────

function deriveR1KDirection(r: TVScanResult): 'BUY' | 'SELL' | null {
  if (r.rsi && r.rsi < 30 && r.changePercent < -2) return 'BUY';  // Oversold bounce
  if (r.rsi && r.rsi > 70 && r.changePercent > 3) return 'BUY';   // Strong momentum
  if (r.changePercent > 2 && r.relativeVolume > 1.5) return 'BUY'; // Volume breakout
  if (r.changePercent < -5) return 'SELL'; // Breakdown
  return null;
}

function formatR1KReason(r: TVScanResult): string {
  const parts: string[] = [];
  parts.push(`R1K ${r.changePercent > 0 ? '+' : ''}${r.changePercent.toFixed(1)}%`);
  if (r.rsi) parts.push(`RSI ${r.rsi.toFixed(0)}`);
  if (r.relativeVolume > 1.5) parts.push(`RelVol ${r.relativeVolume.toFixed(1)}x`);
  if (r.marketCap > 1e11) parts.push('MegaCap');
  else if (r.marketCap > 1e10) parts.push('LargeCap');
  return parts.join(', ');
}
