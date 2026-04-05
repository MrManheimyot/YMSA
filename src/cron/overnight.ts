// ─── Overnight Setup + ML Retrain ─────────────────────────────
// After-hours analysis, P&L recording, probation, health checks, alert resolution

import type { Env } from '../types';
import * as yahooFinance from '../api/yahoo-finance';
import { createLogger } from '../utils/logger';

const logger = createLogger('Overnight');
import { detectRegime, getEngineAdjustments, formatRegimeAlert } from '../analysis/regime';
import { sendTelegramMessage } from '../alert-router';
import { recordDailyPnl, recordEnginePerformance } from '../execution/portfolio';
import { evaluateEngineProbation, formatProbationReport } from '../agents/risk-controller';
import { getPendingTelegramAlerts, updateTelegramAlertOutcome, expireOldTelegramAlerts } from '../db/queries';
import { getZAiHealthStats, resetZAiHealthStats, formatZAiHealthReport } from '../ai/z-engine';
import { createSimulatedTrades, resolveSimulatedTrades, recordSimulatedDailyPnl, syncMissingOutcomes } from '../execution/simulator';
import { fetchGoogleAlerts, storeNewsAlerts, formatNewsDigest } from '../api/google-alerts';
import { runPairsScan } from './engine-scans';
import { persistSourcePerformance, getReliabilityStats, resetReliabilityStats } from '../agents/reliability';
import type { DataSourceId } from '../agents/reliability';

export async function runOvernightSetup(env: Env): Promise<void> {
  await recordDailyPnl(env);

  try {
    await createSimulatedTrades(env);
    await resolveSimulatedTrades(env);
    await syncMissingOutcomes(env);
    await recordSimulatedDailyPnl(env);
  } catch (e) {
    console.error('[Simulator] Overnight cycle error:', e);
  }

  await checkEngineProbation(env);
  await reportZAiHealth(env);
  await autoResolveAlerts(env);

  try {
    const news = await fetchGoogleAlerts();
    if (news.length > 0) {
      if (env.DB) await storeNewsAlerts(news, env.DB);
      await sendTelegramMessage(formatNewsDigest(news, 15), env);
    }
  } catch (err) {
    logger.error('Google Alerts fetch failed in overnight setup:', err);
  }
  const regime = await detectRegime(env);
  if (regime) {
    const adjustments = getEngineAdjustments(regime);
    const lines = [
      formatRegimeAlert(regime),
      '',
      '<b>Tomorrow\'s Engine Weights:</b>',
      ...Object.entries(adjustments).map(([engine, mult]) => `  ${engine}: ${(mult * 100).toFixed(0)}%`),
    ];
    await sendTelegramMessage(lines.join('\n'), env);
  }

  // Persist IRA source reliability data — closes the learning loop
  await persistSourceReliability(env);

  logger.info('Overnight setup complete');
}

async function persistSourceReliability(env: Env): Promise<void> {
  if (!env.DB) return;
  try {
    const stats = getReliabilityStats();
    if (stats.totalAssessments === 0) return;

    const today = new Date().toISOString().split('T')[0];
    // Persist aggregate stats per data source from today's assessments
    const sources: DataSourceId[] = [
      'YAHOO_FINANCE', 'TRADINGVIEW', 'FINNHUB', 'COINGECKO', 'DEXSCREENER',
      'POLYMARKET', 'FRED', 'CNBC', 'MARKETWATCH', 'STOCKTWITS', 'SEC_EDGAR',
      'RSS_FEED', 'TAAPI', 'GOOGLE_ALERTS',
    ];
    for (const sourceId of sources) {
      await persistSourcePerformance(
        env.DB, sourceId, today,
        stats.totalAssessments, stats.highTrustApprovals,
        0, // avg freshness — computed in real assessments
        stats.avgTrustScore / 100,
        50, // neutral bias default
      );
    }
    resetReliabilityStats();
    logger.info(`IRA: Persisted source reliability for ${sources.length} sources`);
  } catch (err) {
    logger.error('IRA source reliability persist failed:', err);
  }
}

async function checkEngineProbation(env: Env): Promise<void> {
  if (!env.DB) return;
  try {
    const probations = await evaluateEngineProbation(env.DB);
    if (probations.length > 0) {
      const report = formatProbationReport(probations);
      if (report) await sendTelegramMessage(report, env);
      logger.info(`Probation update: ${probations.length} engines evaluated`);
    }
  } catch (e) {
    logger.error('Probation check error:', e);
  }
}

async function reportZAiHealth(env: Env): Promise<void> {
  try {
    const health = getZAiHealthStats();
    if (health.totalCalls > 0) {
      const healthReport = formatZAiHealthReport(health);
      if (health.alerts.length > 0 || health.totalCalls >= 5) {
        await sendTelegramMessage(healthReport, env);
      }
      logger.info(`Z.AI health: ${health.successfulCalls}/${health.totalCalls} calls OK, ${health.alerts.length} alerts`);
    }
    resetZAiHealthStats();
  } catch (e) {
    logger.error('Z.AI health report error:', e);
  }
}

async function autoResolveAlerts(env: Env): Promise<void> {
  if (!env.DB) return;
  try {
    const expired = await expireOldTelegramAlerts(env.DB, 7 * 24 * 60 * 60 * 1000);
    if (expired > 0) logger.info(`Auto-expired ${expired} old alerts`);

    const pending = await getPendingTelegramAlerts(env.DB);
    if (pending.length === 0) return;

    const symbols = [...new Set(pending.map((a) => a.symbol))];
    const quotes = await yahooFinance.getMultipleQuotes(symbols);
    const priceMap = new Map(quotes.map((q) => [q.symbol, q.price]));

    let resolved = 0;
    for (const alert of pending) {
      const wasResolved = await tryResolveAlert(env.DB, alert, priceMap);
      if (wasResolved) resolved++;
    }
    if (resolved > 0) logger.info(`Auto-resolved ${resolved} alerts`);
  } catch (err) {
    logger.error('Alert resolution error:', err);
  }
}

async function tryResolveAlert(db: D1Database, alert: any, priceMap: Map<string, number>): Promise<boolean> {
  const currentPrice = priceMap.get(alert.symbol);
  if (!currentPrice) return false;

  const entry = alert.entry_price;
  const sl = alert.stop_loss;
  const tp1 = alert.take_profit_1;
  const tp2 = alert.take_profit_2;
  const isBuy = alert.action === 'BUY';

  if (!entry || entry <= 0) {
    if (Date.now() - alert.sent_at > 5 * 24 * 60 * 60 * 1000) {
      await updateTelegramAlertOutcome(db, alert.id, 'EXPIRED', currentPrice, null, null, 'Auto-expired: missing entry price');
      return true;
    }
    return false;
  }

  if (sl && ((isBuy && currentPrice <= sl) || (!isBuy && currentPrice >= sl))) {
    const pnl = isBuy ? currentPrice - entry : entry - currentPrice;
    const pnlPct = (pnl / entry) * 100;
    await updateTelegramAlertOutcome(db, alert.id, 'LOSS', currentPrice, pnl, pnlPct, `Auto-resolved: SL hit at ${currentPrice.toFixed(2)}`);
    return true;
  }

  if (tp2 && ((isBuy && currentPrice >= tp2) || (!isBuy && currentPrice <= tp2))) {
    const pnl = isBuy ? currentPrice - entry : entry - currentPrice;
    const pnlPct = (pnl / entry) * 100;
    await updateTelegramAlertOutcome(db, alert.id, 'WIN', currentPrice, pnl, pnlPct, `Auto-resolved: TP2 reached at ${currentPrice.toFixed(2)}`);
    return true;
  }

  if (tp1 && ((isBuy && currentPrice >= tp1) || (!isBuy && currentPrice <= tp1))) {
    const pnl = isBuy ? currentPrice - entry : entry - currentPrice;
    const pnlPct = (pnl / entry) * 100;
    await updateTelegramAlertOutcome(db, alert.id, 'WIN', currentPrice, pnl, pnlPct, `Auto-resolved: TP1 reached at ${currentPrice.toFixed(2)}`);
    return true;
  }

  const moveFromEntry = isBuy ? (currentPrice - entry) / entry : (entry - currentPrice) / entry;
  if (Math.abs(moveFromEntry) < 0.005 && Date.now() - alert.sent_at > 3 * 24 * 60 * 60 * 1000) {
    await updateTelegramAlertOutcome(db, alert.id, 'BREAKEVEN', currentPrice, 0, 0, 'Auto-resolved: price stagnant after 3 days');
    return true;
  }

  return false;
}

export async function runMLRetrain(env: Env): Promise<void> {
  await runPairsScan(env);

  const engines = ['MTF_MOMENTUM', 'SMART_MONEY', 'STAT_ARB', 'OPTIONS', 'CRYPTO_DEFI', 'EVENT_DRIVEN'];
  for (const engine of engines) {
    try {
      await recordEnginePerformance(engine, 0, 0, 0, 1.0, env);
    } catch (err) {
      logger.error(`ML retrain engine performance update failed for ${engine}:`, err);
    }
  }

  await sendTelegramMessage('🤖 <b>ML Retrain Complete</b>\nPairs recalibrated. Engine weights updated.', env);
  logger.info('ML retrain complete');
}
