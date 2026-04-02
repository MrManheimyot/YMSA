// ─── Smart Broker Manager ─────────────────────────────────────
// Central intelligence layer. Reads ALL engines/agents first,
// then decides what to send and how.
//
// Design principles (Telegram best practices):
//   1. Max 4096 chars per message — target ~800 for mobile readability
//   2. One clear action per trade alert
//   3. Batch context into combined messages (no 5 separate regime/indices msgs)
//   4. CRITICAL risk → immediate with sound
//   5. Trade alerts → max 3 per cycle, highest confidence first
//   6. Info/recap → silent, batched into digest
//   7. Cross-engine dedup: same symbol from multiple engines → merge
//   8. Conflict detection: engines disagree → flag or suppress

import type { Env, Signal, StockQuote, TechnicalIndicator, FibonacciResult } from './types';
import type { SmartMoneyAnalysis } from './analysis/smart-money';
import type { MTFSignal } from './analysis/multi-timeframe';
import type { MarketRegime } from './analysis/regime';
import { synthesizeSignal, isZAiAvailable } from './ai/z-engine';
import type { MergedTradeInfo } from './ai/z-engine';
import { insertTelegramAlert, insertSignal, generateId } from './db/queries';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface EngineOutput {
  engine: string;
  symbol: string;
  direction: 'BUY' | 'SELL' | 'HOLD' | 'NEUTRAL';
  confidence: number;       // 0–100
  entry?: number;
  stopLoss?: number;
  tp1?: number;
  tp2?: number;
  reason: string;           // 1-2 sentence explanation
  signals: string[];        // supporting bullet points
  meta?: Record<string, unknown>;
}

interface MessagePlan {
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  text: string;
  silent: boolean;          // disable_notification
}

interface MergedTrade {
  symbol: string;
  direction: 'BUY' | 'SELL';
  confidence: number;
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  engines: string[];
  reasons: string[];
  signals: string[];
  conflicting: boolean;
}

// ═══════════════════════════════════════════════════════════════
// State — per-cycle accumulator
// ═══════════════════════════════════════════════════════════════

let cycleOutputs: EngineOutput[] = [];
let cycleRegime: MarketRegime | null = null;
let cycleContext: string[] = [];   // market commentary lines
let cyclePending = false;
let cycleIndicators: Map<string, TechnicalIndicator[]> = new Map(); // symbol → indicators

// Hourly alert budget
const alertHistory: number[] = [];
const MAX_TRADE_ALERTS_PER_HOUR = 3;

function canSendTradeAlert(): boolean {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  // Purge old
  while (alertHistory.length > 0 && alertHistory[0] < oneHourAgo) alertHistory.shift();
  return alertHistory.length < MAX_TRADE_ALERTS_PER_HOUR;
}

function recordTradeAlert(): void {
  alertHistory.push(Date.now());
}

// Cross-cycle dedup (24 hour window — max once per day per stock)
const sentKeys = new Map<string, number>();
const DEDUP_MS = 24 * 60 * 60 * 1000;

function wasSentRecently(key: string): boolean {
  const now = Date.now();
  for (const [k, ts] of sentKeys) {
    if (now - ts > DEDUP_MS) sentKeys.delete(k);
  }
  return sentKeys.has(key);
}

function markSent(key: string): void {
  sentKeys.set(key, Date.now());
}

// ═══════════════════════════════════════════════════════════════
// Step 1: Collect — engines push their output here
// ═══════════════════════════════════════════════════════════════

export function beginCycle(): void {
  cycleOutputs = [];
  cycleContext = [];
  cycleRegime = null;
  cycleIndicators = new Map();
  cyclePending = true;
}

export function setRegime(regime: MarketRegime): void {
  cycleRegime = regime;
}

export function addContext(line: string): void {
  cycleContext.push(line);
}

export function pushEngineOutput(output: EngineOutput): void {
  cycleOutputs.push(output);
}

/**
 * Push engine output AND immediately record to D1 signals table.
 * Use for engines that don't call executeBatch (stat-arb, crypto, options, event-driven).
 */
export async function pushAndRecordSignal(output: EngineOutput, db: D1Database | null): Promise<void> {
  cycleOutputs.push(output);
  if (!db || output.direction === 'HOLD' || output.direction === 'NEUTRAL') return;
  try {
    const engineKey = output.engine.toUpperCase().replace(/\s+/g, '_');
    await insertSignal(db, {
      id: generateId('sig'),
      engine_id: engineKey,
      signal_type: output.reason.split(':')[0].trim().substring(0, 50),
      symbol: output.symbol,
      direction: output.direction as 'BUY' | 'SELL',
      strength: output.confidence,
      metadata: JSON.stringify({ reason: output.reason, signals: output.signals }),
      created_at: Date.now(),
      acted_on: 0,
    });
  } catch (err) {
    console.error(`[Broker] Inline signal insert failed for ${output.symbol}:`, err);
  }
}

/**
 * Convenience: build an EngineOutput from Smart Money analysis
 */
export function pushSmartMoney(
  smc: SmartMoneyAnalysis,
  quote: StockQuote,
  atr: number | null,
  indicators?: TechnicalIndicator[],
): void {
  if (smc.score < 50) return;

  // Store indicators for this symbol if provided
  if (indicators && indicators.length > 0) {
    cycleIndicators.set(smc.symbol, indicators);
  }
  const dir: 'BUY' | 'SELL' = smc.overallBias === 'BULLISH' ? 'BUY' : 'SELL';
  const effectiveATR = atr && atr > 0 ? atr : quote.price * 0.02;
  const zone = smc.signals.sort((a, b) => b.strength - a.strength)[0]?.zone;

  // Only use zone for SL if it's on the correct side
  let sl: number;
  if (dir === 'BUY') {
    sl = zone && zone.low < quote.price ? zone.low - effectiveATR * 0.25 : quote.price - effectiveATR * 2;
    sl = Math.max(sl, quote.price * 0.92);
  } else {
    sl = zone && zone.high > quote.price ? zone.high + effectiveATR * 0.25 : quote.price + effectiveATR * 2;
    sl = Math.min(sl, quote.price * 1.08);
  }

  const tp1 = dir === 'BUY' ? quote.price + effectiveATR * 2 : quote.price - effectiveATR * 2;
  const tp2 = dir === 'BUY' ? quote.price + effectiveATR * 3.5 : quote.price - effectiveATR * 3.5;

  const modelNames: Record<string, string> = {
    ORDER_BLOCK: 'Order Block', FVG: 'Fair Value Gap',
    LIQUIDITY_SWEEP: 'Liquidity Sweep', BOS: 'Break of Structure',
    INSIDER_BUY: 'Insider Activity',
  };

  const topSignals = smc.signals.sort((a, b) => b.strength - a.strength).slice(0, 3);
  const models = [...new Set(topSignals.map(s => modelNames[s.type] || s.type))];

  pushEngineOutput({
    engine: 'Smart Money',
    symbol: smc.symbol,
    direction: dir,
    confidence: smc.score,
    entry: quote.price,
    stopLoss: sl,
    tp1, tp2,
    reason: `Institutional ${dir === 'BUY' ? 'buying' : 'selling'} detected via ${models.join(' + ')}. ${smc.signals.length} confluent signals.`,
    signals: smc.signals
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 4)
      .map(s => `${modelNames[s.type] || s.type} (str ${Math.round(s.strength)}, ${s.age}d, ${s.direction})`),
  });
}

/**
 * Convenience: build an EngineOutput from MTF signal
 */
export function pushMTF(mtf: MTFSignal): void {
  if (mtf.confluence < 65) return;
  const dir = mtf.suggestedAction === 'BUY' ? 'BUY' as const : mtf.suggestedAction === 'SELL' ? 'SELL' as const : 'HOLD' as const;
  if (dir === 'HOLD') return;

  const signals: string[] = [];
  if (mtf.weekly) signals.push(`W: ${mtf.weekly}`);
  if (mtf.daily) signals.push(`D: ${mtf.daily.type}, div ${mtf.daily.rsiDivergence ? 'Y' : 'N'}`);
  if (mtf.h4) signals.push(`4H: ${mtf.h4.type}, conf ${mtf.h4.confidence}`);

  pushEngineOutput({
    engine: 'MTF Momentum',
    symbol: mtf.symbol,
    direction: dir,
    confidence: mtf.confluence,
    entry: mtf.takeProfit ? undefined : undefined, // price not stored in MTF
    stopLoss: mtf.stopLoss,
    tp1: mtf.takeProfit,
    reason: `Multi-Timeframe confluence at ${mtf.confluence}% across W/D/4H. Suggested: ${dir} ${mtf.positionSize === 1 ? 'full' : 'half'} size.`,
    signals,
  });
}

/**
 * Convenience: build an EngineOutput from technical signals
 */
export function pushTechnical(
  signals: Signal[],
  quote: StockQuote,
  indicators: TechnicalIndicator[],
  _fibonacci: FibonacciResult | null,
): void {
  if (signals.length === 0) return;

  // Store indicators for this symbol (used in planTradeAlert)
  cycleIndicators.set(quote.symbol, indicators);

  // Derive direction
  let buyScore = 0, sellScore = 0;
  const w: Record<string, number> = { CRITICAL: 3, IMPORTANT: 2, INFO: 1 };
  for (const s of signals) {
    const weight = w[s.priority] || 1;
    if (['RSI_OVERSOLD', 'GOLDEN_CROSS', 'MACD_BULLISH_CROSS', '52W_LOW_PROXIMITY', 'FIBONACCI_LEVEL_HIT'].includes(s.type)) buyScore += weight;
    if (['RSI_OVERBOUGHT', 'DEATH_CROSS', 'MACD_BEARISH_CROSS', '52W_HIGH_PROXIMITY', '52W_BREAKOUT'].includes(s.type)) sellScore += weight;
  }
  const dir: 'BUY' | 'SELL' = buyScore >= sellScore ? 'BUY' : 'SELL';

  // Confidence
  let conf = 0;
  const cw: Record<string, number> = { CRITICAL: 25, IMPORTANT: 15, INFO: 5 };
  for (const s of signals) conf += cw[s.priority] || 5;
  const rsi = indicators.find(i => i.indicator === 'RSI');
  if (rsi && (rsi.value < 25 || rsi.value > 75)) conf += 10;
  conf = Math.min(100, conf);

  if (conf < 40) return; // too weak

  const atr = indicators.find(i => i.indicator === 'ATR')?.value ?? quote.price * 0.02;

  pushEngineOutput({
    engine: 'Technical',
    symbol: quote.symbol,
    direction: dir,
    confidence: conf,
    entry: quote.price,
    stopLoss: dir === 'BUY' ? Math.max(quote.price - atr * 2, quote.price * 0.92) : Math.min(quote.price + atr * 2, quote.price * 1.08),
    tp1: dir === 'BUY' ? quote.price + atr * 2 : quote.price - atr * 2,
    tp2: dir === 'BUY' ? quote.price + atr * 3.5 : quote.price - atr * 3.5,
    reason: signals.slice(0, 2).map(s => s.description).join('. ') + '.',
    signals: signals.map(s => `${s.title} (${s.priority})`).slice(0, 4),
  });
}

/**
 * Push a pairs/stat-arb signal through broker manager
 */
export async function pushStatArb(
  pair: { symbolA: string; symbolB: string; zScore: number; direction: string; halfLife: number; correlation: number },
  quotes: { a: StockQuote; b: StockQuote },
  db?: D1Database | null,
): Promise<void> {
  const dir: 'BUY' | 'SELL' = pair.direction === 'LONG_A_SHORT_B' ? 'BUY' : 'SELL';
  const zsAbs = Math.abs(pair.zScore);
  const conf = Math.min(95, 50 + zsAbs * 15 + (pair.correlation > 0.8 ? 10 : 0));
  if (conf < 55) return;

  const entryA = quotes.a.price;
  const atr = entryA * 0.02;

  await pushAndRecordSignal({
    engine: 'Stat Arb',
    symbol: pair.symbolA,
    direction: dir,
    confidence: conf,
    entry: entryA,
    stopLoss: dir === 'BUY' ? entryA - atr * 2 : entryA + atr * 2,
    tp1: dir === 'BUY' ? entryA + atr * 1.5 : entryA - atr * 1.5,
    tp2: dir === 'BUY' ? entryA + atr * 3 : entryA - atr * 3,
    reason: `Pairs divergence: ${pair.symbolA}/${pair.symbolB} z-score ${pair.zScore.toFixed(2)} | Corr: ${pair.correlation.toFixed(2)} | Half-life: ${pair.halfLife.toFixed(0)}d.`,
    signals: [
      `Z-Score: ${pair.zScore.toFixed(2)} (${zsAbs > 2 ? 'extreme' : 'notable'})`,
      `Pair: ${pair.direction.replace(/_/g, ' ')}`,
      `Half-Life: ${pair.halfLife.toFixed(0)} days`,
      `Correlation: ${pair.correlation.toFixed(2)}`,
    ],
  }, db || null);
}

/**
 * Push crypto/DeFi whale signal through broker manager
 */
export async function pushCryptoDefi(
  signal: { symbol: string; type: string; volume: number; priceChange: number; liquidity: number },
  confidence: number,
  db?: D1Database | null,
): Promise<void> {
  if (confidence < 50) return;
  const dir: 'BUY' | 'SELL' = signal.priceChange >= 0 ? 'BUY' : 'SELL';

  await pushAndRecordSignal({
    engine: 'Crypto DeFi',
    symbol: signal.symbol,
    direction: dir,
    confidence,
    reason: `${signal.type}: ${signal.symbol} with $${(signal.volume / 1e6).toFixed(1)}M volume, ${signal.priceChange >= 0 ? '+' : ''}${signal.priceChange.toFixed(1)}% move.`,
    signals: [
      `Type: ${signal.type}`,
      `Volume: $${(signal.volume / 1e6).toFixed(1)}M`,
      `Price Change: ${signal.priceChange >= 0 ? '+' : ''}${signal.priceChange.toFixed(1)}%`,
      `Liquidity: $${(signal.liquidity / 1e6).toFixed(1)}M`,
    ],
  }, db || null);
}

/**
 * Push event-driven signal (news/earnings) through broker manager
 */
export async function pushEventDriven(
  symbol: string,
  _eventType: string,
  direction: 'BUY' | 'SELL',
  confidence: number,
  reason: string,
  signals: string[],
  quote?: StockQuote,
  db?: D1Database | null,
): Promise<void> {
  if (confidence < 50) return;
  const atr = quote ? quote.price * 0.02 : 0;

  await pushAndRecordSignal({
    engine: 'Event Driven',
    symbol,
    direction,
    confidence,
    entry: quote?.price,
    stopLoss: quote ? (direction === 'BUY' ? quote.price - atr * 2.5 : quote.price + atr * 2.5) : undefined,
    tp1: quote ? (direction === 'BUY' ? quote.price + atr * 2 : quote.price - atr * 2) : undefined,
    reason,
    signals,
  }, db || null);
}

/**
 * Push options-style signal (high IV / squeeze) through broker manager
 */
export async function pushOptions(
  symbol: string,
  signalType: string,
  direction: 'BUY' | 'SELL',
  confidence: number,
  quote: StockQuote,
  indicators: TechnicalIndicator[],
  db?: D1Database | null,
): Promise<void> {
  if (confidence < 50) return;
  const atr = indicators.find(i => i.indicator === 'ATR')?.value ?? quote.price * 0.02;

  await pushAndRecordSignal({
    engine: 'Options',
    symbol,
    direction,
    confidence,
    entry: quote.price,
    stopLoss: direction === 'BUY' ? quote.price - atr * 1.5 : quote.price + atr * 1.5,
    tp1: direction === 'BUY' ? quote.price + atr * 2 : quote.price - atr * 2,
    tp2: direction === 'BUY' ? quote.price + atr * 4 : quote.price - atr * 4,
    reason: `${signalType}: ${symbol} showing options-grade setup with ${confidence}% confidence.`,
    signals: [
      `Signal: ${signalType}`,
      ...indicators.filter(i => ['RSI', 'ATR', 'BB_WIDTH'].includes(i.indicator)).map(i => `${i.indicator}: ${i.value.toFixed(2)}`),
    ].slice(0, 4),
  }, db || null);
}

// ═══════════════════════════════════════════════════════════════
// Step 2: Analyze — merge, rank, filter
// ═══════════════════════════════════════════════════════════════

function mergeBySymbol(outputs: EngineOutput[]): MergedTrade[] {
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

    // Pick majority direction, weighted by confidence
    const buyWeight = buyOuts.reduce((s, o) => s + o.confidence, 0);
    const sellWeight = sellOuts.reduce((s, o) => s + o.confidence, 0);
    const dir = buyWeight >= sellWeight ? 'BUY' as const : 'SELL' as const;
    const aligned = dir === 'BUY' ? buyOuts : sellOuts;

    // Best entry/SL/TP from highest-confidence engine
    const best = aligned.sort((a, b) => b.confidence - a.confidence)[0];

    // Confidence boost for multi-engine agreement
    const baseConf = best.confidence;
    const agreementBonus = Math.min(15, (aligned.length - 1) * 8);
    const conflictPenalty = conflicting ? 20 : 0;
    const finalConf = Math.min(100, Math.max(0, baseConf + agreementBonus - conflictPenalty));

    merged.push({
      symbol,
      direction: dir,
      confidence: finalConf,
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

  // Sort: highest confidence first
  return merged.sort((a, b) => b.confidence - a.confidence);
}

// ═══════════════════════════════════════════════════════════════
// Step 3: Plan messages
// ═══════════════════════════════════════════════════════════════

function planTradeAlert(trade: MergedTrade, aiReasoning?: string): MessagePlan | null {
  const key = `${trade.symbol}:${trade.direction}`;
  if (wasSentRecently(key)) return null;
  if (!canSendTradeAlert()) return null;

  // Only send alerts with confidence ≥80 (per chief broker policy)
  if (trade.confidence < 80) return null;

  const risk = Math.abs(trade.entry - trade.stopLoss);
  const rr1 = risk > 0 ? (Math.abs(trade.tp1 - trade.entry) / risk).toFixed(1) : '—';
  const rr2 = risk > 0 ? (Math.abs(trade.tp2 - trade.entry) / risk).toFixed(1) : '—';

  const confLabel = trade.confidence >= 80 ? 'High' : trade.confidence >= 55 ? 'Medium' : 'Low';
  const emoji = trade.direction === 'BUY' ? '🟢' : '🔴';

  // Regime context
  let regimeNote = '';
  if (cycleRegime) {
    const regimeLabel = cycleRegime.regime.replace('_', ' ').toLowerCase();
    const isTrendAligned =
      (trade.direction === 'BUY' && cycleRegime.regime === 'TRENDING_UP') ||
      (trade.direction === 'SELL' && cycleRegime.regime === 'TRENDING_DOWN');
    regimeNote = isTrendAligned
      ? `Trend-aligned (${regimeLabel}).`
      : `⚠️ Counter-trend (${regimeLabel}) — reduce size.`;
    if (cycleRegime.vix >= 25) regimeNote += ` VIX ${cycleRegime.vix.toFixed(0)}.`;
  }

  // Technical Info — RSI, MACD, SMA 50, SMA 200
  const indicators = cycleIndicators.get(trade.symbol) || [];
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

function planMarketContext(): MessagePlan | null {
  if (cycleContext.length === 0 && !cycleRegime) return null;

  const lines: string[] = ['📊 <b>Market Context</b>', ''];

  if (cycleRegime) {
    const r = cycleRegime;
    const emoji = r.regime === 'TRENDING_UP' ? '📈' : r.regime === 'TRENDING_DOWN' ? '📉' : r.regime === 'VOLATILE' ? '⚡' : '↔️';
    lines.push(`${emoji} Regime: <b>${r.regime.replace('_', ' ')}</b> (${r.confidence}%)`);
    lines.push(`VIX: ${r.vix.toFixed(1)} | ADX: ${r.adx?.toFixed(0) || '?'}`);
    lines.push('');
  }

  if (cycleContext.length > 0) {
    for (const c of cycleContext.slice(0, 8)) lines.push(`• ${c}`);
  }

  // If nothing interesting, skip
  if (lines.length <= 3) return null;

  return {
    priority: 'LOW',
    text: lines.join('\n'),
    silent: true,
  };
}

function planNoSignalsMessage(): MessagePlan | null {
  // Only send "nothing happening" once per 4 hours max
  if (wasSentRecently('NO_SIGNALS')) return null;
  if (cycleOutputs.length > 0) return null;

  markSent('NO_SIGNALS');
  return {
    priority: 'LOW',
    text: '✅ <b>Scan Complete</b> — No actionable signals this cycle.',
    silent: true,
  };
}

// ═══════════════════════════════════════════════════════════════
// Step 4: Execute — format and send
// ═══════════════════════════════════════════════════════════════

/**
 * Flush the cycle: analyze all collected outputs, plan messages,
 * send to Telegram. Returns count of messages sent.
 */
export async function flushCycle(env: Env): Promise<number> {
  if (!cyclePending) return 0;
  cyclePending = false;

  const messages: MessagePlan[] = [];

  // 1. Merge engine outputs per symbol → trade alerts
  const trades = mergeBySymbol(cycleOutputs);

  // 1b. Log ALL qualifying merged trades to D1 for win/loss tracking
  //     This ensures every recommendation appears in the P&L table,
  //     even if Telegram delivery is throttled by the alert budget.
  const loggedTradeIds = new Map<string, string>(); // symbol:dir → tga id
  if (env.DB && trades.length > 0) {
    for (const t of trades) {
      if (t.confidence < 55) continue;
      if (t.conflicting && t.confidence < 70) continue;
      const key = `${t.symbol}:${t.direction}`;
      if (wasSentRecently(key)) continue; // skip deduped trades
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
          alert_text: '', // placeholder — updated when Telegram message is composed
          regime: cycleRegime?.regime || null,
          metadata: JSON.stringify({ engines: t.engines, reasons: t.reasons, signals: t.signals }),
          sent_at: Date.now(),
        });
        loggedTradeIds.set(key, tgaId);
        markSent(key); // prevent duplicate D1 inserts across multiple flushCycle calls
      } catch (err) {
        console.error(`[Broker] Alert D1 insert failed for ${t.symbol}:`, err);
      }
    }
  }

  // Individual trade alerts — one per stock (chief broker policy: no batch grouping)
  for (const trade of trades) {
    // Z.AI: Enrich with LLM reasoning if available
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
        aiReasoning = await synthesizeSignal((env as any).AI, tradeInfo, cycleRegime) || undefined;
      } catch (err) { console.error('[Z.AI] Signal synthesis failed:', err); }
    }

    const plan = planTradeAlert(trade, aiReasoning);
    if (plan) {
      markSent(`${trade.symbol}:${trade.direction}`);
      recordTradeAlert();
      // Tag the plan with trade metadata for D1 logging
      (plan as any)._trade = trade;
      messages.push(plan);
    }
    // Budget: stop after max alerts
    if (!canSendTradeAlert()) break;
  }

  // 2. Market context (only if no trade alerts OR regime changed)
  if (messages.length === 0 || (cycleRegime && wasSentRecently('REGIME_CHANGE') === false)) {
    const ctx = planMarketContext();
    if (ctx) messages.push(ctx);
  }

  // 3. "Nothing happening" fallback
  if (messages.length === 0) {
    const empty = planNoSignalsMessage();
    if (empty) messages.push(empty);
  }

  // 4. Send in priority order
  messages.sort((a, b) => {
    const ord = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return ord[a.priority] - ord[b.priority];
  });

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
      // Update alert_text for trades already logged to D1
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

  // Reset cycle
  cycleOutputs = [];
  cycleContext = [];
  cycleRegime = null;
  cycleIndicators = new Map();

  return sent;
}

// ═══════════════════════════════════════════════════════════════
// Telegram sender with silent option
// ═══════════════════════════════════════════════════════════════

async function sendTelegramMessageEx(text: string, env: Env, silent: boolean): Promise<void> {
  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        disable_notification: silent,
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    console.error(`[Broker Telegram] ${res.status}: ${err}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// Direct sends — for CRITICAL risk alerts that bypass the cycle
// ═══════════════════════════════════════════════════════════════

export async function sendRiskAlert(text: string, env: Env): Promise<void> {
  await sendTelegramMessageEx(`🔴 <b>RISK ALERT</b>\n\n${text}`, env, false);
}

export async function sendExecutionAlert(text: string, env: Env): Promise<void> {
  if (!text) return; // skip empty summaries (no executed trades)
  await sendTelegramMessageEx(`📊 <b>DAILY SUMMARY</b>\n\n${text}`, env, false);
}
