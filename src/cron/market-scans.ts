// ─── Market Scans — Full, Quick, Technical, Opening Range, Quick Pulse ──
// Core scan orchestrators that drive the signal pipeline

import type { Env } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('MarketScan');
import * as yahooFinance from '../api/yahoo-finance';
import { computeIndicators } from '../analysis/indicators';
import { calculateFibonacci } from '../analysis/fibonacci';
import { detectSignals } from '../analysis/signals';
import { analyzeMultiTimeframe } from '../analysis/multi-timeframe';
import { analyzeSmartMoney } from '../analysis/smart-money';
import { detectRegime, formatRegimeAlert } from '../analysis/regime';
import { setCurrentRegime } from '../alert-formatter';
import { beginCycle, flushCycle, setRegime, addContext, pushSmartMoney, pushMTF, pushTechnical } from '../broker-manager';
import { executeBatch, formatBatchResults, type ExecutableSignal } from '../execution/engine';
import { sendExecutionAlert } from '../broker-manager';
import { recordEnginePerformance } from '../execution/portfolio';
import { validateQuote, validateIndicators, validateEnvThresholds } from '../utils/data-validator';
import { detectDataAnomalies, isZAiAvailable } from '../ai/z-engine';
import { createSimulatedTrades, resolveSimulatedTrades, syncMissingOutcomes } from '../execution/simulator';
import { getOpenTrades } from '../db/queries';
import { closeTradeWithReview } from '../execution/engine';
import { runRegimeScan } from './engine-scans';
import { runMTFScan, runSmartMoneyScan, runOptionsScan, runEventDrivenScan } from './engine-scans';
import { runCryptoWhaleScan, runPolymarketScan, runCommodityScan, runPairsScan, runScraperScan } from './engine-scans';
import { runSuperpowerScan, runSuperpowerQuick } from './superpower-scan';
import { getPromotedCandidates, markCandidatesEvaluated, promoteTopCandidates } from '../db/queries/candidate-queries';
import { rescanR1KMovers } from './r1k-scanner';

export function getWatchlist(env: Env): string[] {
  return env.DEFAULT_WATCHLIST.split(',').map((s) => s.trim());
}

export function getCryptoWatchlist(env: Env): string[] {
  return (env.CRYPTO_WATCHLIST || 'bitcoin,ethereum,solana').split(',').map((s) => s.trim());
}

export function getTier2Watchlist(env: Env): string[] {
  return (env.TIER2_WATCHLIST || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * v3.5: Get promoted candidates from D1 scan_candidates table.
 * These are high-scoring stocks discovered via TradingView/FinViz pre-market scans.
 * Excludes symbols already in Tier 1 or Tier 2 to avoid duplicate processing.
 */
export async function getPromotedWatchlist(env: Env): Promise<string[]> {
  if (!env.DB) return [];
  try {
    const promoted = await getPromotedCandidates(env.DB);
    const existing = new Set([...getWatchlist(env), ...getTier2Watchlist(env)]);
    return promoted.filter(s => !existing.has(s));
  } catch {
    return [];
  }
}

export async function runQuickScan(env: Env): Promise<void> {
  beginCycle();
  const watchlist = getWatchlist(env);

  for (const symbol of watchlist) {
    const [quote, ohlcv] = await Promise.all([
      yahooFinance.getQuote(symbol),
      yahooFinance.getOHLCV(symbol, '2y', '1d'),
    ]);
    if (!quote) continue;

    const indicators = computeIndicators(symbol, ohlcv);
    const signals = detectSignals(quote, indicators, null, env);
    const criticalSignals = signals.filter((s) => s.priority === 'CRITICAL' || s.priority === 'IMPORTANT');

    if (criticalSignals.length > 0) {
      pushTechnical(criticalSignals, quote, indicators, null);
    }
  }

  await runSuperpowerQuick(env);
  await flushCycle(env);
}

export async function runFullScan(env: Env, label: string): Promise<void> {
  beginCycle();
  await runRegimeScan(env);

  // Phase 1: R1K re-scan top movers + superpower discovery
  await rescanR1KMovers(env).catch(e => logger.warn('R1K re-scan failed', e));
  await runSuperpowerScan(env);
  await runScraperScan(env);

  // Phase 2: Re-promote — ensure hourly discoveries get promoted for engine scans
  if (env.DB) {
    try {
      const freshPromoted = await promoteTopCandidates(env.DB, 150);
      if (freshPromoted.length > 0) {
        logger.info(`Hourly re-promotion: ${freshPromoted.length} candidates promoted`);
      }
    } catch (e) { logger.warn('Hourly re-promotion failed'); }
  }

  // Phase 3: Technical scans (Tier 1 + Tier 2 + Promoted)
  await runStockTechnicalScan(env, label);
  await runTier2TechnicalScan(env);
  await runPromotedCandidateScan(env);  // v3.5: Universe expansion

  // Phase 4: Multi-engine scans — ALL now include promoted candidates
  await runMTFScan(env);
  await runSmartMoneyScan(env);
  await runPairsScan(env);
  await runCryptoWhaleScan(env);
  await runPolymarketScan(env);
  await runCommodityScan(env);
  await runOptionsScan(env);
  await runEventDrivenScan(env);

  const sent = await flushCycle(env);

  try {
    if (env.DB) {
      const today = new Date().toISOString().split('T')[0];
      const todayStart = new Date(today).getTime();
      const rows = await env.DB.prepare(
        `SELECT engine_id, COUNT(*) as cnt FROM signals WHERE created_at >= ? GROUP BY engine_id`,
      ).bind(todayStart).all();
      const counts: Record<string, number> = {};
      for (const r of (rows.results || []) as any[]) {
        counts[r.engine_id] = r.cnt;
      }
      const engines = ['MTF_MOMENTUM', 'SMART_MONEY', 'STAT_ARB', 'OPTIONS', 'CRYPTO_DEFI', 'EVENT_DRIVEN'];
      for (const engine of engines) {
        await recordEnginePerformance(engine, counts[engine] || 0, 0, 0, 1.0, env);
      }
    }
  } catch (e) {
    logger.warn('Engine stats update failed');
  }

  logger.info(`${label}: Full scan complete`, { messagesSent: sent });

  try {
    await createSimulatedTrades(env);
    await resolveSimulatedTrades(env);
    await syncMissingOutcomes(env);
  } catch (e) {
    logger.error('Post-scan cycle error', e);
  }
}

export async function runStockTechnicalScan(env: Env, label: string): Promise<void> {
  const watchlist = getWatchlist(env);
  let totalSignals = 0;

  const envValidation = validateEnvThresholds(env as unknown as Record<string, string | undefined>);
  if (!envValidation.valid) {
    console.warn(`[Validator] Env threshold issues (${envValidation.issues.length}): ${envValidation.issues.map((i) => i.message).join('; ')}`);
  }

  for (const symbol of watchlist) {
    const [quote, ohlcv] = await Promise.all([
      yahooFinance.getQuote(symbol),
      yahooFinance.getOHLCV(symbol, '2y', '1d'),
    ]);
    if (!quote) continue;

    const quoteValidation = validateQuote(quote, 'yahoo_finance');
    if (!quoteValidation.valid) {
      console.warn(`[Validator] ${symbol} quote FAILED validation: ${quoteValidation.issues.filter((i) => i.severity === 'FAIL').map((i) => i.message).join('; ')}`);
      continue;
    }
    if (quoteValidation.score < 70) {
      console.warn(`[Validator] ${symbol} quote quality low (${quoteValidation.score}/100): ${quoteValidation.issues.map((i) => i.message).join('; ')}`);
    }

    const indicators = computeIndicators(symbol, ohlcv);
    const indicatorValidation = validateIndicators(indicators, symbol);
    if (indicatorValidation.missingCritical.length > 0) {
      console.warn(`[Validator] ${symbol} missing critical indicators: ${indicatorValidation.missingCritical.join(', ')} — signals degraded`);
    }

    if (isZAiAvailable(env) && Math.random() < 0.15) {
      try {
        const rsi = indicators.find((i) => i.indicator === 'RSI');
        const macd = indicators.find((i) => i.indicator === 'MACD');
        const atr = indicators.find((i) => i.indicator === 'ATR');
        const ema50 = indicators.find((i) => i.indicator === 'EMA_50');
        const ema200 = indicators.find((i) => i.indicator === 'EMA_200');
        const anomalies = await detectDataAnomalies((env as any).AI, symbol, {
          price: quote.price, volume: quote.volume, avgVolume: quote.avgVolume,
          rsi: rsi?.value, macd: macd?.value, atr: atr?.value,
          ema50: ema50?.value, ema200: ema200?.value, changePercent: quote.changePercent,
        });
        if (anomalies.length > 0) {
          console.warn(`[Z.AI] ${symbol} anomalies detected: ${anomalies.map((a) => `${a.type}: ${a.detail}`).join('; ')}`);
        }
      } catch { /* best-effort */ }
    }

    const fibonacci = ohlcv.length > 0 ? calculateFibonacci(symbol, ohlcv, quote.price) : null;
    const signals = detectSignals(quote, indicators, fibonacci, env);

    const importantSignals = signals.filter((s) => s.priority === 'CRITICAL' || s.priority === 'IMPORTANT');
    if (importantSignals.length > 0) {
      pushTechnical(importantSignals, quote, indicators, fibonacci);
      totalSignals += importantSignals.length;
    }
  }

  for (const symbol of watchlist) {
    const analysis = await yahooFinance.getQuoteWith52WeekAnalysis(symbol);
    if (!analysis) continue;
    if (analysis.nearHigh || analysis.nearLow || analysis.atNewHigh || analysis.atNewLow) {
      const label52 = analysis.atNewHigh
        ? `🚀 ${symbol} NEW 52W HIGH $${analysis.quote.price.toFixed(2)}`
        : analysis.atNewLow
          ? `⚠️ ${symbol} NEW 52W LOW $${analysis.quote.price.toFixed(2)}`
          : analysis.nearHigh
            ? `📈 ${symbol} near 52W high (${(analysis.position52w * 100).toFixed(0)}%)`
            : `📉 ${symbol} near 52W low (${(analysis.position52w * 100).toFixed(0)}%)`;
      addContext(label52);
    }
  }

  if (totalSignals > 0) {
    logger.info(`${label}: ${totalSignals} technical signals pushed to broker`);
  }
}

/**
 * Tier 2 rotation scan — Healthcare, Energy, Consumer, Industrial, SaaS stocks.
 * Runs as part of hourly full scan to expand coverage beyond Tier 1.
 * Lighter-weight: skips 52-week analysis and anomaly detection.
 */
async function runTier2TechnicalScan(env: Env): Promise<void> {
  const tier2 = getTier2Watchlist(env);
  if (tier2.length === 0) return;
  let count = 0;

  for (const symbol of tier2) {
    try {
      const [quote, ohlcv] = await Promise.all([
        yahooFinance.getQuote(symbol),
        yahooFinance.getOHLCV(symbol, '2y', '1d'),
      ]);
      if (!quote) continue;

      const quoteVal = validateQuote(quote, 'yahoo_finance');
      if (!quoteVal.valid) continue;

      const indicators = computeIndicators(symbol, ohlcv);
      const fibonacci = ohlcv.length > 0 ? calculateFibonacci(symbol, ohlcv, quote.price) : null;
      const signals = detectSignals(quote, indicators, fibonacci, env);

      const important = signals.filter((s) => s.priority === 'CRITICAL' || s.priority === 'IMPORTANT');
      if (important.length > 0) {
        pushTechnical(important, quote, indicators, fibonacci);
        count += important.length;
      }
    } catch (err) {
      logger.error(`Tier2 ${symbol} error`, err);
    }
  }

  if (count > 0) {
    logger.info(`Tier2: ${count} signals from ${tier2.length} stocks`);
  }
}

/**
 * v3.5 Universe Expansion: Promoted Candidate Scan.
 * Scans stocks promoted by the pre-market pipeline (scan_candidates table).
 * Same analysis as Tier 2 (lighter-weight, no anomaly detection).
 * After evaluation, marks candidates as evaluated in D1.
 */
async function runPromotedCandidateScan(env: Env): Promise<void> {
  const promoted = await getPromotedWatchlist(env);
  if (promoted.length === 0) return;
  let count = 0;

  logger.info(`Scanning ${promoted.length} promoted candidates`);

  for (const symbol of promoted) {
    try {
      const [quote, ohlcv] = await Promise.all([
        yahooFinance.getQuote(symbol),
        yahooFinance.getOHLCV(symbol, '2y', '1d'),
      ]);
      if (!quote) continue;

      const quoteVal = validateQuote(quote, 'yahoo_finance');
      if (!quoteVal.valid) continue;

      const indicators = computeIndicators(symbol, ohlcv);
      const fibonacci = ohlcv.length > 0 ? calculateFibonacci(symbol, ohlcv, quote.price) : null;
      const signals = detectSignals(quote, indicators, fibonacci, env);

      const important = signals.filter((s) => s.priority === 'CRITICAL' || s.priority === 'IMPORTANT');
      if (important.length > 0) {
        pushTechnical(important, quote, indicators, fibonacci);
        count += important.length;
      }
    } catch (err) {
      logger.error(`Promoted ${symbol} error`, err);
    }
  }

  // Mark all promoted symbols as evaluated
  if (env.DB && promoted.length > 0) {
    await markCandidatesEvaluated(env.DB, promoted).catch(e =>
      logger.error('Failed to mark candidates evaluated', e)
    );
  }

  if (count > 0) {
    logger.info(`Promoted: ${count} signals from ${promoted.length} candidates`);
  }
}

export async function runOpeningRangeBreak(env: Env): Promise<void> {
  beginCycle();
  const tier1 = (env.TIER1_WATCHLIST || env.DEFAULT_WATCHLIST).split(',').map((s) => s.trim());
  const promoted = await getPromotedWatchlist(env);
  // ORB is time-critical at market open — limit to top 30 promoted by score
  const allSymbols = [...new Set([...tier1, ...promoted.slice(0, 30)])];
  const signals: ExecutableSignal[] = [];

  const regime = await detectRegime(env);
  if (regime) {
    setCurrentRegime(regime);
    setRegime(regime);
    addContext(formatRegimeAlert(regime));
  }

  for (const symbol of allSymbols) {
    try {
      const mtf = await analyzeMultiTimeframe(symbol, env);
      if (mtf && mtf.confluence >= 70) {
        pushMTF(mtf);
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
    } catch (err) {
      logger.error(`ORB ${symbol} error`, err);
    }
  }

  if (signals.length > 0) {
    const results = await executeBatch(signals, env);
    await sendExecutionAlert(formatBatchResults(results), env);
  }

  const sent = await flushCycle(env);
  logger.info(`Opening Range Break: ${signals.length} signals, Broker sent ${sent} messages`);
}

export async function runQuickPulse(env: Env): Promise<void> {
  beginCycle();
  const watchlist = getWatchlist(env);

  // ── GAP-027: Intraday SL/TP resolution — check open trades against 5-min prices ──
  try {
    const openTrades = await getOpenTrades(env.DB);
    for (const trade of openTrades) {
      const quote = await yahooFinance.getQuote(trade.symbol);
      if (!quote || quote.price <= 0) continue;

      const price = quote.price;
      const isBuy = trade.side === 'BUY';

      // Check stop-loss hit
      const slHit = isBuy ? price <= trade.stop_loss : price >= trade.stop_loss;
      if (slHit) {
        logger.info(`SL hit: ${trade.symbol} @ $${price.toFixed(2)}`, { sl: trade.stop_loss });
        await closeTradeWithReview(trade, trade.stop_loss, env);
        continue;
      }

      // Check take-profit hit
      const tpHit = isBuy ? price >= trade.take_profit : price <= trade.take_profit;
      if (tpHit) {
        logger.info(`TP hit: ${trade.symbol} @ $${price.toFixed(2)}`, { tp: trade.take_profit });
        await closeTradeWithReview(trade, trade.take_profit, env);
        continue;
      }
    }
  } catch (err) {
    logger.error('SL/TP resolution error', err);
  }

  // ── Smart Money quick pulse scan ──
  for (const symbol of watchlist) {
    try {
      const ohlcv = await yahooFinance.getOHLCV(symbol, '1mo', '1d');
      if (ohlcv.length < 20) continue;

      const candles = ohlcv.map((c) => ({ open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, timestamp: c.timestamp }));
      const quote = await yahooFinance.getQuote(symbol);
      if (!quote) continue;
      const smc = analyzeSmartMoney(symbol, candles, quote.price);

      if (smc.score >= 70) {
        const indicators = computeIndicators(symbol, ohlcv);
        const atr = indicators.find((i) => i.indicator === 'ATR')?.value ?? null;
        pushSmartMoney(smc, quote, atr, indicators);
      }
    } catch (err) {
      logger.error(`Pulse ${symbol} error`, err);
    }
  }

  await flushCycle(env);
}
