// ─── Cron Handler (Barrel) ─────────────────────────────────────
// Dispatches cron events to focused handler modules
// Split per CTO rules: each file < 500 lines, single responsibility

import type { Env, CronJobType } from './types';
import { createLogger } from './utils/logger';

const logger = createLogger('Cron');
import { sendTelegramMessage } from './alert-router';
import { loadPersistedBudgets } from './agents/risk-controller';
import { loadConfig } from './db/queries';
import { loadFeedbackFromD1 } from './ai/feedback';
import { loadSourceAccuracy } from './agents/reliability';
import { setKVCache } from './api/yahoo-finance';
import { persistHealthStats } from './ai/z-engine';
import { setEngineStatsKV, loadEngineStatsFromKV, persistEngineStatsToKV } from './execution/engine';
import { runMorningBriefing } from './cron/morning-briefing';
import { runFullScan, runQuickScan, runOpeningRangeBreak, runQuickPulse } from './cron/market-scans';
import { runEveningSummary, runDailySummary, runAfterHoursScan, runWeeklyReview, runMiddayRebalance, runMonthlyPerformance } from './cron/summaries';
import { runOvernightSetup, runMLRetrain } from './cron/overnight';
import { runPreMarketScan } from './cron/premarket-scan';

export { runMorningBriefing } from './cron/morning-briefing';
export { runFullScan, runQuickScan, runStockTechnicalScan, runOpeningRangeBreak, runQuickPulse, getWatchlist, getCryptoWatchlist, getTier2Watchlist, getPromotedWatchlist } from './cron/market-scans';
export { runRegimeScan, runMTFScan, runSmartMoneyScan, runCryptoWhaleScan, runPolymarketScan, runCommodityScan, runPairsScan, runOptionsScan, runEventDrivenScan, runScraperScan } from './cron/engine-scans';
export { runEveningSummary, runDailySummary, runAfterHoursScan, runWeeklyReview, runMiddayRebalance, runMonthlyPerformance } from './cron/summaries';
export { runOvernightSetup, runMLRetrain } from './cron/overnight';
export { runPreMarketScan } from './cron/premarket-scan';
export { scanRussell1000, rescanR1KMovers, sendR1KReport } from './cron/r1k-scanner';
export { runSuperpowerScan, runSuperpowerQuick } from './cron/superpower-scan';

/**
 * Main cron event handler — routes to appropriate job type
 */
export async function handleCronEvent(cron: string, env: Env): Promise<void> {
  const jobType = identifyCronJob(cron);
  logger.info(`Running job: ${jobType}`, { cron });

  await loadPersistedBudgets(env.DB);

  // Boot config table + Z.AI feedback loop (safe no-ops if DB missing)
  if (env.DB) {
    await loadConfig(env.DB).catch(e => logger.error('loadConfig failed', e));
    await loadFeedbackFromD1(env.DB).catch(e => logger.error('loadFeedback failed', e));
    await loadSourceAccuracy(env.DB).catch(e => logger.error('loadSourceAccuracy failed', e));
  }

  // Initialize OHLCV KV cache + engine stats KV
  if (env.YMSA_CACHE) {
    setKVCache(env.YMSA_CACHE);
    setEngineStatsKV(env.YMSA_CACHE);
    await loadEngineStatsFromKV().catch(e => logger.error('loadEngineStats failed', e));
  }

  try {
    switch (jobType) {
      case 'MORNING_BRIEFING':      await runMorningBriefing(env); break;
      case 'PREMARKET_SCAN':        await runPreMarketScan(env); break;
      case 'MARKET_OPEN_SCAN':      await runFullScan(env, 'Market Open'); break;
      case 'OPENING_RANGE_BREAK':   await runOpeningRangeBreak(env); break;
      case 'QUICK_PULSE_5MIN':      await runQuickPulse(env); break;
      case 'QUICK_SCAN_15MIN':      await runQuickScan(env); break;
      case 'FULL_SCAN_HOURLY':      await runFullScan(env, 'Hourly'); break;
      case 'MIDDAY_REBALANCE':      await runMiddayRebalance(env); break;
      case 'EVENING_SUMMARY':       await runEveningSummary(env); break;
      case 'OVERNIGHT_SETUP':       await runOvernightSetup(env); break;
      case 'DAILY_SUMMARY':         await runDailySummary(env); break;
      case 'AFTER_HOURS_SCAN':      await runAfterHoursScan(env); break;
      case 'WEEKLY_REVIEW':         await runWeeklyReview(env); break;
      case 'ML_RETRAIN':            await runMLRetrain(env); break;
      case 'MONTHLY_PERFORMANCE':   await runMonthlyPerformance(env); break;
    }
  } catch (err) {
    logger.error(`Job ${jobType} failed`, err);
    await sendTelegramMessage(`⚠️ YMSA Cron Error: ${jobType}\n${err}`, env);
  }

  // GAP-004: Persist Z.AI health stats to D1 after every cron cycle
  if (env.DB) {
    await persistHealthStats(env.DB).catch(e => logger.error('persistHealthStats failed', e));
  }

  // GAP-018: Persist engine stats to KV after every cron cycle
  if (env.YMSA_CACHE) {
    await persistEngineStatsToKV().catch(e => logger.error('persistEngineStats failed', e));
  }
}

function identifyCronJob(cron: string): CronJobType {
  if (cron === '0 5 * * 1-5') return 'MORNING_BRIEFING';
  if (cron === '0 12 * * 1-5') return 'PREMARKET_SCAN';
  if (cron === '30 14 * * 1-5') return 'MARKET_OPEN_SCAN';
  if (cron === '45 14 * * 1-5') return 'OPENING_RANGE_BREAK';
  if (cron.startsWith('*/5')) return 'QUICK_PULSE_5MIN';
  if (cron.startsWith('*/15')) return 'QUICK_SCAN_15MIN';
  if (cron === '0 18 * * 1-5') return 'MIDDAY_REBALANCE';
  if (cron === '0 15 * * 1-5') return 'EVENING_SUMMARY';
  if (cron === '0 21 * * 1-5') return 'DAILY_SUMMARY';
  if (cron === '30 21 * * 1-5') return 'OVERNIGHT_SETUP';
  if (cron === '30 22 * * 1-5') return 'AFTER_HOURS_SCAN';
  if (cron === '0 7 * * SUN' || cron === '0 7 * * 0') return 'WEEKLY_REVIEW';
  if (cron === '0 3 * * SAT' || cron === '0 3 * * 6') return 'ML_RETRAIN';
  if (cron === '0 0 1 * *') return 'MONTHLY_PERFORMANCE';
  return 'FULL_SCAN_HOURLY';
}
