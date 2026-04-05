// ─── Merge + Message Planning ─────────────────────────────────

import type { EngineOutput, MergedTrade, MessagePlan } from './types';
import {
  getCycleOutputs, getCycleRegime, getCycleContext,
  getCycleIndicators, wasSentRecently, canSendTradeAlert,
} from './cycle-state';
import { getConfig } from '../db/queries';

// ═══════════════════════════════════════════════════════════════
// Step 2: Merge engine outputs by symbol
// ═══════════════════════════════════════════════════════════════

export function mergeBySymbol(outputs: EngineOutput[]): MergedTrade[] {
  const regime = getCycleRegime();
  const mergeMinEngines = getConfig('merge_min_engines');
  const expressLaneMinConf = getConfig('express_lane_min_confidence');
  const expressLaneMinRR = getConfig('express_lane_min_rr');

  const bySymbol = new Map<string, EngineOutput[]>();
  for (const o of outputs) {
    if (o.direction === 'HOLD' || o.direction === 'NEUTRAL') continue;
    (bySymbol.get(o.symbol) ?? (bySymbol.set(o.symbol, []), bySymbol.get(o.symbol)!)).push(o);
  }

  const merged: MergedTrade[] = [];
  for (const [symbol, outs] of bySymbol) {
    const buyOuts = outs.filter(o => o.direction === 'BUY');
    const sellOuts = outs.filter(o => o.direction === 'SELL');
    const conflicting = buyOuts.length > 0 && sellOuts.length > 0;

    const buyWeight = buyOuts.reduce((s, o) => s + o.confidence, 0);
    const sellWeight = sellOuts.reduce((s, o) => s + o.confidence, 0);
    const dir = buyWeight >= sellWeight ? 'BUY' as const : 'SELL' as const;
    const aligned = dir === 'BUY' ? buyOuts : sellOuts;

    // Quality Gate: Require ≥ mergeMinEngines to agree, unless express lane qualifies
    if (aligned.length < mergeMinEngines) {
      // Express Lane: high-confidence single-engine signal can bypass merge gate
      const best = aligned.sort((a, b) => b.confidence - a.confidence)[0];
      if (!best) continue;

      const hasEntry = best.entry && best.entry > 0;
      const hasSL = best.stopLoss && best.stopLoss > 0;
      const hasTP = best.tp1 && best.tp1 > 0;
      const rr = hasEntry && hasSL && hasTP
        ? Math.abs(best.tp1! - best.entry!) / Math.abs(best.entry! - best.stopLoss!)
        : 0;

      // Express lane criteria: confidence ≥ 95, R:R ≥ 3.0, regime-aligned, not conflicting, VIX < 20
      const isRegimeAligned = !regime || (
        (dir === 'BUY' && regime.regime !== 'TRENDING_DOWN') ||
        (dir === 'SELL' && regime.regime !== 'TRENDING_UP')
      );
      const isLowVix = !regime || regime.vix < 20;
      const adxValue = regime?.adx ?? 0;
      const hasStrongTrend = adxValue > 25;

      if (
        best.confidence >= expressLaneMinConf &&
        best.confidence >= 95 &&
        rr >= expressLaneMinRR &&
        rr >= 3.0 &&
        isRegimeAligned &&
        isLowVix &&
        hasStrongTrend &&
        !conflicting
      ) {
        // Express lane approved — pass through with -5 confidence penalty
        merged.push({
          symbol,
          direction: dir,
          confidence: Math.max(0, best.confidence - 5),
          entry: best.entry ?? 0,
          stopLoss: best.stopLoss ?? 0,
          tp1: best.tp1 ?? 0,
          tp2: best.tp2 ?? 0,
          engines: [best.engine],
          reasons: [best.reason],
          signals: best.signals.slice(0, 6),
          conflicting: false,
        });
        continue;
      }
      continue;
    }

    const best = aligned.sort((a, b) => b.confidence - a.confidence)[0];

    const baseConf = best.confidence;
    const agreementBonus = Math.min(15, (aligned.length - 1) * 5);
    const conflictPenalty = conflicting ? 25 : 0;
    const finalConf = Math.min(100, Math.max(0, baseConf + agreementBonus - conflictPenalty));

    // Regime Confidence Modifier
    let regimeModifier = 0;
    if (regime) {
      const isTrendAligned =
        (dir === 'BUY' && regime.regime === 'TRENDING_UP') ||
        (dir === 'SELL' && regime.regime === 'TRENDING_DOWN');
      const isCounterTrend =
        (dir === 'BUY' && regime.regime === 'TRENDING_DOWN') ||
        (dir === 'SELL' && regime.regime === 'TRENDING_UP');

      if (isTrendAligned) regimeModifier = +10;
      else if (isCounterTrend) regimeModifier = -15;
      if (regime.vix >= 30) regimeModifier -= 10;
    }

    const regimeAdjConf = Math.min(100, Math.max(0, finalConf + regimeModifier));

    merged.push({
      symbol,
      direction: dir,
      confidence: regimeAdjConf,
      entry: best.entry ?? 0,
      stopLoss: best.stopLoss ?? 0,
      tp1: best.tp1 ?? 0,
      tp2: best.tp2 ?? 0,
      engines: aligned.map(o => o.engine),
      reasons: aligned.map(o => o.reason),
      signals: aligned.flatMap(o => o.signals).slice(0, 6),
      conflicting,
    });
  }

  return merged.sort((a, b) => b.confidence - a.confidence);
}

// ═══════════════════════════════════════════════════════════════
// Step 3: Plan messages
// ═══════════════════════════════════════════════════════════════

export function planTradeAlert(trade: MergedTrade, aiReasoning?: string): MessagePlan | null {
  const regime = getCycleRegime();
  const key = `${trade.symbol}:${trade.direction}`;
  if (wasSentRecently(key)) return null;
  if (!canSendTradeAlert()) return null;

  // Quality Gate 1: Regime-adaptive confidence threshold
  const baseGate = getConfig('confidence_gate');
  let adaptiveGate = baseGate;
  if (regime) {
    const vixCalm = getConfig('vix_calm_threshold');
    const vixNormal = getConfig('vix_normal_threshold');
    const vixVolatile = getConfig('vix_volatile_threshold');
    if (regime.vix < vixCalm) adaptiveGate = baseGate - 7;        // calm: relax
    else if (regime.vix < vixNormal) adaptiveGate = baseGate - 2;  // normal: slight relax
    else if (regime.vix < vixVolatile) adaptiveGate = baseGate + 3; // volatile: tighten
    else adaptiveGate = baseGate + 8;                              // crisis: very tight
  }
  if (trade.confidence < adaptiveGate) return null;

  // Quality Gate 2: R:R ≥ 2.0
  const risk = Math.abs(trade.entry - trade.stopLoss);
  if (risk > 0) {
    const rr1 = Math.abs(trade.tp1 - trade.entry) / risk;
    if (rr1 < 2.0) return null;
  }

  // Quality Gate 3: Block hard counter-trend trades
  if (regime) {
    const isHardCounter =
      (trade.direction === 'BUY' && regime.regime === 'TRENDING_DOWN' && regime.confidence >= 70) ||
      (trade.direction === 'SELL' && regime.regime === 'TRENDING_UP' && regime.confidence >= 70);
    if (isHardCounter) return null;
    if (regime.vix >= 35) return null;
  }

  const rr1 = risk > 0 ? (Math.abs(trade.tp1 - trade.entry) / risk).toFixed(1) : '—';
  const rr2 = risk > 0 ? (Math.abs(trade.tp2 - trade.entry) / risk).toFixed(1) : '—';
  const confLabel = trade.confidence >= 85 ? 'High' : trade.confidence >= 70 ? 'Medium' : 'Low';
  const emoji = trade.direction === 'BUY' ? '🟢' : '🔴';

  // Regime context
  let regimeNote = '';
  if (regime) {
    const regimeLabel = regime.regime.replace('_', ' ').toLowerCase();
    const isTrendAligned =
      (trade.direction === 'BUY' && regime.regime === 'TRENDING_UP') ||
      (trade.direction === 'SELL' && regime.regime === 'TRENDING_DOWN');
    regimeNote = isTrendAligned
      ? `Trend-aligned (${regimeLabel}).`
      : `⚠️ Counter-trend (${regimeLabel}) — reduce size.`;
    if (regime.vix >= 25) regimeNote += ` VIX ${regime.vix.toFixed(0)}.`;
  }

  // Technical Backing — RSI, MACD, SMA 50, SMA 200
  const indicators = getCycleIndicators().get(trade.symbol) || [];
  const rsi = indicators.find(i => i.indicator === 'RSI');
  const macd = indicators.find(i => i.indicator === 'MACD');
  const macdSig = indicators.find(i => i.indicator === 'MACD_SIGNAL');
  const sma50 = indicators.find(i => i.indicator === 'SMA_50');
  const sma200 = indicators.find(i => i.indicator === 'SMA_200');

  const techLines: string[] = [];
  if (rsi) techLines.push(`RSI(14): ${rsi.value.toFixed(1)}`);
  if (macd && macdSig) {
    const cross = macd.value > macdSig.value ? 'Bullish' : 'Bearish';
    techLines.push(`MACD: ${macd.value.toFixed(3)} (${cross})`);
  }
  if (sma50) techLines.push(`SMA 50: $${sma50.value.toFixed(2)}`);
  if (sma200) techLines.push(`SMA 200: $${sma200.value.toFixed(2)}`);

  const lines = [
    `${emoji} <b>TRADE ALERT — ${trade.direction} ${trade.symbol}</b>`,
    ``,
    `<b>Signals Triggered:</b>`,
    ...trade.signals.slice(0, 5).map(s => `• ${s}`),
    ...(trade.engines.length > 1 ? [`• Models: ${trade.engines.join(' + ')} (${trade.engines.length} agree)`] : []),
    ...(trade.conflicting ? [`• ⚠️ Conflicting signals from other engines`] : []),
    ``,
    ...(trade.reasons.length > 0 ? [
      `<b>Reason:</b> ${trade.reasons[0]}`,
      ...(trade.reasons.length > 1 ? trade.reasons.slice(1, 3).map(r => `  + ${r}`) : []),
    ] : []),
    ...(aiReasoning ? [`🧠 <i>${aiReasoning}</i>`] : []),
    ``,
    ...(techLines.length > 0 ? [
      `<b>Technical Backing:</b>`,
      ...techLines.map(t => `• ${t}`),
      ``,
    ] : []),
    `<b>Trade Setup:</b>`,
    `  Entry: $${trade.entry.toFixed(2)}`,
    `  Stop Loss: $${trade.stopLoss.toFixed(2)}`,
    `  Take Profit:`,
    `    TP1: $${trade.tp1.toFixed(2)} (R:R 1:${rr1})`,
    `    TP2: $${trade.tp2.toFixed(2)} (R:R 1:${rr2})`,
    ``,
    `<b>Confidence:</b> ${trade.confidence}/100 (${confLabel})`,
    ``,
    `<b>Market Context:</b>`,
    ...(regimeNote ? [regimeNote] : ['Regime data unavailable.']),
    ``,
    `🔗 <a href="https://tradingview.com/symbols/${trade.symbol}">Chart</a>` +
    ` · <a href="https://finance.yahoo.com/quote/${trade.symbol}">Yahoo</a>`,
    `⏰ ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`,
  ];

  return {
    priority: trade.confidence >= 80 ? 'HIGH' : 'MEDIUM',
    text: lines.join('\n'),
    silent: false,
  };
}

export function planMarketContext(): MessagePlan | null {
  const regime = getCycleRegime();
  const context = getCycleContext();
  if (context.length === 0 && !regime) return null;

  const lines: string[] = ['📊 <b>Market Context</b>', ''];

  if (regime) {
    const r = regime;
    const emoji = r.regime === 'TRENDING_UP' ? '📈' : r.regime === 'TRENDING_DOWN' ? '📉' : r.regime === 'VOLATILE' ? '⚡' : '↔️';
    lines.push(`${emoji} Regime: <b>${r.regime.replace('_', ' ')}</b> (${r.confidence}%)`);
    lines.push(`VIX: ${r.vix.toFixed(1)} | ADX: ${r.adx?.toFixed(0) || '?'}`);
    lines.push('');
  }

  if (context.length > 0) {
    for (const c of context.slice(0, 8)) lines.push(`• ${c}`);
  }

  if (lines.length <= 3) return null;

  return {
    priority: 'LOW',
    text: lines.join('\n'),
    silent: true,
  };
}

export function planNoSignalsMessage(): MessagePlan | null {
  if (wasSentRecently('NO_SIGNALS')) return null;
  if (getCycleOutputs().length > 0) return null;

  return {
    priority: 'LOW',
    text: '✅ <b>Scan Complete</b> — No actionable signals this cycle.',
    silent: true,
  };
}
