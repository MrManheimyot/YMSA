// ─── Flush Cycle — orchestrate merge → validate → reliability → Z.AI → send ──

import type { Env } from '../types';
import type { MergedTrade, MessagePlan } from './types';
import type { MergedTradeInfo } from '../ai/z-engine';
import { synthesizeSignal, validateTradeSetup, isZAiAvailable, recordZAiCall, recordValidationResult } from '../ai/z-engine';
import { insertTelegramAlert, updateTelegramAlertGateStatus, generateId } from '../db/queries';
import { validateTradeParams, validateSignalConsistency, buildDataQualityReport } from '../utils/data-validator';
import {
  getCycleOutputs, getCycleRegime, getCycleIndicators, getCycleVolumeRatios, getCycleSignalScores,
  isCyclePending, wasSentRecently, markSent,
  canSendTradeAlert, recordTradeAlert, resetCycle,
} from './cycle-state';
import { mergeBySymbol, planTradeAlert, planMarketContext, planNoSignalsMessage } from './merge-and-plan';
import { sendTelegramMessageEx } from './telegram';
import { correlationCheck } from '../agents/risk-controller/risk-checker';
import { assessReliability, formatForZAi, indicatorsToObservation, engineOutputToObservation } from '../agents/reliability';
import type { SourceObservation } from '../agents/reliability';
import { createLogger } from '../utils/logger';

const logger = createLogger('FlushCycle');

/** Insert a REJECTED alert to D1 for audit trail — ensures rejected signals don't contaminate simulator */
async function logRejectedAlert(
  env: Env,
  trade: MergedTrade,
  regime: { regime: string; confidence: number } | null,
  rejectReason: string,
): Promise<void> {
  if (!env.DB) return;
  try {
    const id = generateId('tga');
    await insertTelegramAlert(env.DB, {
      id,
      symbol: trade.symbol,
      action: trade.direction as 'BUY' | 'SELL',
      engine_id: trade.engines.join('+'),
      entry_price: trade.entry,
      stop_loss: trade.stopLoss,
      take_profit_1: trade.tp1,
      take_profit_2: trade.tp2,
      confidence: trade.confidence,
      alert_text: '',
      regime: regime?.regime || null,
      metadata: JSON.stringify({ engines: trade.engines, reasons: trade.reasons, signals: trade.signals }),
      sent_at: Date.now(),
      gate_status: 'REJECTED',
    });
    await updateTelegramAlertGateStatus(env.DB, id, 'REJECTED', undefined, rejectReason);
  } catch (err) {
    logger.error(`Failed to log rejected alert for ${trade.symbol}:`, err);
  }
}

// ─── Dynamic Correlation Matrix — computed from real OHLCV data ───
import { getOHLCV } from '../api/yahoo-finance';

/** KV-cached correlation matrix, refreshed once per cron cycle */
let _correlationCache: Record<string, Record<string, number>> | null = null;
let _correlationCacheTs = 0;
const CORR_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

/** Compute Pearson correlation from two arrays of daily returns */
function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 20) return 0; // insufficient data
  const meanA = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const meanB = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const dA = a[i] - meanA;
    const dB = b[i] - meanB;
    num += dA * dB;
    denA += dA * dA;
    denB += dB * dB;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

/** Convert OHLCV prices to daily returns */
function toReturns(closes: number[]): number[] {
  const ret: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) ret.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  return ret;
}

/** Build correlation matrix dynamically from 90-day OHLCV data */
async function buildCorrelationMatrix(symbols: string[]): Promise<Record<string, Record<string, number>>> {
  const matrix: Record<string, Record<string, number>> = {};
  // Fetch 90-day closes for each symbol
  const returnsMap = new Map<string, number[]>();
  await Promise.all(symbols.map(async (sym) => {
    try {
      const ohlcv = await getOHLCV(sym, '6mo', '1d');
      const closes = ohlcv.slice(-90).map(c => c.close);
      if (closes.length >= 20) returnsMap.set(sym, toReturns(closes));
    } catch { /* skip symbol if data unavailable */ }
  }));
  // Compute pairwise correlations
  const syms = [...returnsMap.keys()];
  for (let i = 0; i < syms.length; i++) {
    const a = syms[i];
    matrix[a] = matrix[a] || {};
    for (let j = i + 1; j < syms.length; j++) {
      const b = syms[j];
      const corr = pearsonCorrelation(returnsMap.get(a)!, returnsMap.get(b)!);
      matrix[a][b] = parseFloat(corr.toFixed(3));
      matrix[b] = matrix[b] || {};
      matrix[b][a] = parseFloat(corr.toFixed(3));
    }
  }
  return matrix;
}

/** Get or refresh the correlation matrix (cached per cycle) */
async function getCorrelationMatrix(approvedSymbols: string[], newSymbol: string): Promise<Record<string, Record<string, number>>> {
  if (_correlationCache && Date.now() - _correlationCacheTs < CORR_CACHE_TTL) return _correlationCache;
  const symbols = [...new Set([...approvedSymbols, newSymbol])];
  if (symbols.length < 2) return {};
  try {
    _correlationCache = await buildCorrelationMatrix(symbols);
    _correlationCacheTs = Date.now();
    return _correlationCache;
  } catch (err) {
    logger.warn('Correlation matrix build failed, using empty matrix', { error: err });
    return {};
  }
}

export async function flushCycle(env: Env): Promise<number> {
  if (!isCyclePending()) return 0;

  const messages: MessagePlan[] = [];
  const outputs = getCycleOutputs();
  const regime = getCycleRegime();

  // 1. Merge engine outputs per symbol → trade alerts
  const trades = mergeBySymbol(outputs);

  // Track logged alert IDs for Telegram text update after send
  const loggedTradeIds = new Map<string, string>();

  // Individual trade alerts — one per stock (gates → D1 insert → Telegram)
  const approvedSymbols: string[] = [];
  const volumeRatios = getCycleVolumeRatios();
  const signalScores = getCycleSignalScores();
  for (const trade of trades) {
    // Pre-filter: minimum confidence and dedup
    if (trade.confidence < 55) continue;
    if (trade.conflicting && trade.confidence < 70) continue;
    const key = `${trade.symbol}:${trade.direction}`;
    if (wasSentRecently(key)) continue;

    // Volume hard gate: require ≥ 2.0x avg volume for trade alerts
    const volRatio = volumeRatios.get(trade.symbol) ?? 0;
    if (volRatio < 2.0) {
      logger.warn(`${trade.symbol} BLOCKED by volume gate — ratio ${volRatio.toFixed(1)}x (need ≥2.0x)`);
      await logRejectedAlert(env, trade, regime, `Volume gate: ${volRatio.toFixed(1)}x < 2.0x required`);
      continue;
    }

    // Signal score gate: require score ≥ 65 for trade alerts
    const sigScore = signalScores.get(trade.symbol) ?? 0;
    if (sigScore < 65) {
      logger.warn(`${trade.symbol} BLOCKED by signal score gate — score ${sigScore} (need ≥65)`);
      await logRejectedAlert(env, trade, regime, `Signal score gate: ${sigScore} < 65 required`);
      continue;
    }

    // GAP-015: Correlation check — block highly-correlated duplicate exposure (dynamic)
    const corrMatrix = await getCorrelationMatrix(approvedSymbols, trade.symbol);
    const corrResult = correlationCheck(trade.symbol, approvedSymbols, corrMatrix);
    if (!corrResult.approved) {
      logger.warn(`${trade.symbol} BLOCKED by correlation check: ${corrResult.violations.join(', ')}`);
      await logRejectedAlert(env, trade, regime, `Correlation: ${corrResult.violations.join(', ')}`);
      continue;
    }

    // Cross-Validation Layer: Validate trade parameters
    const tradeValidation = validateTradeParams({
      entry: trade.entry,
      stopLoss: trade.stopLoss,
      tp1: trade.tp1,
      tp2: trade.tp2,
      direction: trade.direction,
      confidence: trade.confidence,
      atr: getCycleIndicators().get(trade.symbol)?.find(i => i.indicator === 'ATR')?.value,
    });

    // Cross-Validation Layer: Signal consistency check
    const signalInputs = outputs
      .filter(o => o.symbol === trade.symbol && (o.direction === 'BUY' || o.direction === 'SELL'))
      .map(o => ({ direction: o.direction as 'BUY' | 'SELL', confidence: o.confidence, engine: o.engine }));
    const signalValidation = validateSignalConsistency(
      signalInputs,
      regime ? { regime: regime.regime, confidence: regime.confidence } : null,
    );

    const qualityReport = buildDataQualityReport({
      signals: signalValidation,
      trade: tradeValidation,
    });

    if (!qualityReport.passedGate) {
      logger.warn(`${trade.symbol} ${trade.direction} BLOCKED by data quality gate (score: ${qualityReport.overallScore}/100, fails: ${qualityReport.failCount})`);
      await logRejectedAlert(env, trade, regime, `Quality gate: score ${qualityReport.overallScore}/100`);
      continue;
    }

    // ─── Information Reliability Agent: Assess source trust ───
    const observations: SourceObservation[] = [];
    // Collect engine outputs as directional observations
    for (const o of outputs.filter(o => o.symbol === trade.symbol)) {
      observations.push(engineOutputToObservation(o.symbol, o.direction as 'BUY' | 'SELL' | 'HOLD' | 'NEUTRAL', o.confidence, o.engine));
    }
    // Collect indicators as observation
    const tradeIndicators = getCycleIndicators().get(trade.symbol);
    if (tradeIndicators && tradeIndicators.length > 0) {
      observations.push(indicatorsToObservation(trade.symbol, tradeIndicators));
    }
    const reliabilityVerdict = assessReliability(trade.symbol, observations);
    const reliabilityContext = formatForZAi(reliabilityVerdict);

    // Apply reliability confidence multiplier
    const originalConfidence = trade.confidence;
    const adjustedConfidence = Math.round(trade.confidence * reliabilityVerdict.confidenceMultiplier);
    if (adjustedConfidence !== trade.confidence) {
      logger.info(`Reliability adjusted ${trade.symbol} confidence: ${trade.confidence} → ${adjustedConfidence} (${reliabilityVerdict.trustTier}, multiplier ${reliabilityVerdict.confidenceMultiplier.toFixed(2)}x)`);
      trade.confidence = Math.max(0, Math.min(100, adjustedConfidence));
    }

    // Block trades with UNTRUSTED reliability
    if (reliabilityVerdict.trustTier === 'UNTRUSTED') {
      logger.warn(`${trade.symbol} ${trade.direction} BLOCKED by Reliability Agent (trust: ${reliabilityVerdict.trustScore}/100 UNTRUSTED)`);
      await logRejectedAlert(env, trade, regime, `IRA UNTRUSTED: trust ${reliabilityVerdict.trustScore}/100`);
      continue;
    }

    // Z.AI: Validate trade setup before sending (now with reliability context)
    let aiReasoning: string | undefined;
    if (isZAiAvailable(env)) {
      try {
        const tradeInfo: MergedTradeInfo = {
          symbol: trade.symbol,
          direction: trade.direction,
          confidence: trade.confidence,
          engines: trade.engines,
          reasons: trade.reasons,
          entry: trade.entry,
          stopLoss: trade.stopLoss,
          tp1: trade.tp1,
          conflicting: trade.conflicting,
        };

        const zValidation = await validateTradeSetup(
          (env as any).AI,
          tradeInfo,
          regime,
          {
            overallScore: qualityReport.overallScore,
            failCount: qualityReport.failCount,
            issues: qualityReport.issues.map(i => `${i.field}: ${i.message}`),
          },
          reliabilityContext,
        );

        recordZAiCall(zValidation.verdict !== 'UNAVAILABLE', zValidation.reason?.length || 0);
        recordValidationResult(zValidation.verdict);

        if (zValidation.verdict === 'REJECT') {
          logger.info(`Z.AI REJECTED ${trade.symbol} ${trade.direction}: ${zValidation.reason} (conf: ${zValidation.confidence})`);
          await logRejectedAlert(env, trade, regime, `Z.AI REJECT: ${zValidation.reason}`);
          continue;
        }

        aiReasoning = await synthesizeSignal((env as any).AI, tradeInfo, regime) || undefined;
        if (zValidation.verdict === 'APPROVE') {
          logger.info(`Z.AI APPROVED ${trade.symbol} ${trade.direction} (conf: ${zValidation.confidence}, trust: ${reliabilityVerdict.trustScore}): ${zValidation.reason}`);
        }
      } catch (err) { logger.error('Z.AI validation failed:', err); }
    }

    // ─── ALL GATES PASSED — Insert APPROVED alert to D1 ───
    const tgaId = generateId('tga');
    if (env.DB) {
      try {
        await insertTelegramAlert(env.DB, {
          id: tgaId,
          symbol: trade.symbol,
          action: trade.direction as 'BUY' | 'SELL',
          engine_id: trade.engines.join('+'),
          entry_price: trade.entry,
          stop_loss: trade.stopLoss,
          take_profit_1: trade.tp1,
          take_profit_2: trade.tp2,
          confidence: trade.confidence, // post-IRA adjusted
          alert_text: '',
          regime: regime?.regime || null,
          metadata: JSON.stringify({ engines: trade.engines, reasons: trade.reasons, signals: trade.signals, originalConfidence, trustTier: reliabilityVerdict.trustTier, trustScore: reliabilityVerdict.trustScore }),
          sent_at: Date.now(),
          gate_status: 'APPROVED',
        });
        loggedTradeIds.set(key, tgaId);
        markSent(key);
      } catch (err) {
        console.error(`[Broker] Alert D1 insert failed for ${trade.symbol}:`, err);
        continue; // No tracking = no send
      }
    }

    const plan = planTradeAlert(trade, aiReasoning);
    if (plan) {
      recordTradeAlert();
      approvedSymbols.push(trade.symbol);
      (plan as any)._trade = trade;
      messages.push(plan);
    }
    if (!canSendTradeAlert()) break;
  }

  // 2. Market context
  if (messages.length === 0 || (regime && wasSentRecently('REGIME_CHANGE') === false)) {
    const ctx = planMarketContext();
    if (ctx) messages.push(ctx);
  }

  // 3. "Nothing happening" fallback
  if (messages.length === 0) {
    const empty = planNoSignalsMessage();
    if (empty) {
      markSent('NO_SIGNALS');
      messages.push(empty);
    }
  }

  // 4. Send in priority order
  messages.sort((a, b) => {
    const ord = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return ord[a.priority] - ord[b.priority];
  });

  let sent = 0;
  for (const msg of messages) {
    try {
      await sendTelegramMessageEx(msg.text, env, msg.silent);
      sent++;
      const trade = (msg as any)._trade as MergedTrade | undefined;
      const batchTrades = (msg as any)._batchTrades as MergedTrade[] | undefined;
      const tradesToUpdate = trade ? [trade] : batchTrades ? batchTrades : [];
      for (const t of tradesToUpdate) {
        const key = `${t.symbol}:${t.direction}`;
        const tgaId = loggedTradeIds.get(key);
        if (tgaId && env.DB) {
          try {
            await env.DB.prepare(`UPDATE telegram_alerts SET alert_text = ? WHERE id = ?`).bind(msg.text, tgaId).run();
          } catch (err) {
            logger.error(`Failed to update alert_text for ${t.symbol} (id: ${tgaId}):`, err);
          }
        }
      }
    } catch (err) {
      console.error('[Broker] Send failed:', err);
    }
  }

  resetCycle();
  return sent;
}
