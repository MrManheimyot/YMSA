// ─── Flush Cycle — orchestrate merge → validate → reliability → Z.AI → send ──

import type { Env } from '../types';
import type { MergedTrade, MessagePlan } from './types';
import type { MergedTradeInfo } from '../ai/z-engine';
import { synthesizeSignal, validateTradeSetup, isZAiAvailable, recordZAiCall, recordValidationResult } from '../ai/z-engine';
import { insertTelegramAlert, generateId } from '../db/queries';
import { validateTradeParams, validateSignalConsistency, buildDataQualityReport } from '../utils/data-validator';
import {
  getCycleOutputs, getCycleRegime, getCycleIndicators,
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

// Sector-level correlation matrix — hardcoded for top symbols.
// Values represent approximate 90-day rolling correlations.
const CORRELATION_MATRIX: Record<string, Record<string, number>> = {
  AAPL: { MSFT: 0.82, GOOGL: 0.78, META: 0.75, AMZN: 0.72, NVDA: 0.70, AMD: 0.65, AVGO: 0.65 },
  MSFT: { GOOGL: 0.80, META: 0.72, AMZN: 0.75, NVDA: 0.68, CRM: 0.70 },
  NVDA: { AMD: 0.90, AVGO: 0.85, INTC: 0.70, QCOM: 0.72 },
  AMD: { AVGO: 0.80, INTC: 0.75, QCOM: 0.72 },
  JPM: { GS: 0.88, V: 0.65 },
  XOM: { CVX: 0.92, COP: 0.88 },
  CVX: { COP: 0.90 },
  UNH: { JNJ: 0.60, PFE: 0.55 },
  NKE: { SBUX: 0.50, MCD: 0.55 },
  SPY: { QQQ: 0.92 },
};

export async function flushCycle(env: Env): Promise<number> {
  if (!isCyclePending()) return 0;

  const messages: MessagePlan[] = [];
  const outputs = getCycleOutputs();
  const regime = getCycleRegime();

  // 1. Merge engine outputs per symbol → trade alerts
  const trades = mergeBySymbol(outputs);

  // 1b. Log ALL qualifying merged trades to D1 for win/loss tracking
  const loggedTradeIds = new Map<string, string>();
  if (env.DB && trades.length > 0) {
    for (const t of trades) {
      if (t.confidence < 55) continue;
      if (t.conflicting && t.confidence < 70) continue;
      const key = `${t.symbol}:${t.direction}`;
      if (wasSentRecently(key)) continue;
      try {
        const tgaId = generateId('tga');
        await insertTelegramAlert(env.DB, {
          id: tgaId,
          symbol: t.symbol,
          action: t.direction as 'BUY' | 'SELL',
          engine_id: t.engines.join('+'),
          entry_price: t.entry,
          stop_loss: t.stopLoss,
          take_profit_1: t.tp1,
          take_profit_2: t.tp2,
          confidence: t.confidence,
          alert_text: '',
          regime: regime?.regime || null,
          metadata: JSON.stringify({ engines: t.engines, reasons: t.reasons, signals: t.signals }),
          sent_at: Date.now(),
        });
        loggedTradeIds.set(key, tgaId);
        markSent(key);
      } catch (err) {
        console.error(`[Broker] Alert D1 insert failed for ${t.symbol}:`, err);
      }
    }
  }

  // Individual trade alerts — one per stock
  const approvedSymbols: string[] = [];
  for (const trade of trades) {
    // Gap 3 Fix: No tracking = no send
    if (env.DB) {
      const key = `${trade.symbol}:${trade.direction}`;
      if (!loggedTradeIds.has(key)) {
        logger.info(`Skipping ${trade.symbol} ${trade.direction} — not tracked in D1`);
        continue;
      }
    }

    // GAP-015: Correlation check — block highly-correlated duplicate exposure
    const corrResult = correlationCheck(trade.symbol, approvedSymbols, CORRELATION_MATRIX);
    if (!corrResult.approved) {
      logger.warn(`${trade.symbol} BLOCKED by correlation check: ${corrResult.violations.join(', ')}`);
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
    const adjustedConfidence = Math.round(trade.confidence * reliabilityVerdict.confidenceMultiplier);
    if (adjustedConfidence !== trade.confidence) {
      logger.info(`Reliability adjusted ${trade.symbol} confidence: ${trade.confidence} → ${adjustedConfidence} (${reliabilityVerdict.trustTier}, multiplier ${reliabilityVerdict.confidenceMultiplier.toFixed(2)}x)`);
      trade.confidence = Math.max(0, Math.min(100, adjustedConfidence));
    }

    // Block trades with UNTRUSTED reliability
    if (reliabilityVerdict.trustTier === 'UNTRUSTED') {
      logger.warn(`${trade.symbol} ${trade.direction} BLOCKED by Reliability Agent (trust: ${reliabilityVerdict.trustScore}/100 UNTRUSTED)`);
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
          continue;
        }

        aiReasoning = await synthesizeSignal((env as any).AI, tradeInfo, regime) || undefined;
        if (zValidation.verdict === 'APPROVE') {
          logger.info(`Z.AI APPROVED ${trade.symbol} ${trade.direction} (conf: ${zValidation.confidence}, trust: ${reliabilityVerdict.trustScore}): ${zValidation.reason}`);
        }
      } catch (err) { logger.error('Z.AI validation failed:', err); }
    }

    const plan = planTradeAlert(trade, aiReasoning);
    if (plan) {
      markSent(`${trade.symbol}:${trade.direction}`);
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
          } catch {}
        }
      }
    } catch (err) {
      console.error('[Broker] Send failed:', err);
    }
  }

  resetCycle();
  return sent;
}
