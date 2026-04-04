// ─── Engine Adapters — convert engine-specific outputs to EngineOutput ──

import type { Signal, StockQuote, TechnicalIndicator, FibonacciResult } from '../types';
import type { SmartMoneyAnalysis } from '../analysis/smart-money';
import type { MTFSignal } from '../analysis/multi-timeframe';
import { insertSignal, generateId } from '../db/queries';
import type { EngineOutput } from './types';
import { pushEngineOutput, getCycleIndicators } from './cycle-state';

// ═══════════════════════════════════════════════════════════════
// pushAndRecordSignal — push + D1 insert
// ═══════════════════════════════════════════════════════════════

export async function pushAndRecordSignal(output: EngineOutput, db: D1Database | null): Promise<void> {
  pushEngineOutput(output); // applies regime adjustment + pushes to cycleOutputs
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

// ═══════════════════════════════════════════════════════════════
// Smart Money adapter
// ═══════════════════════════════════════════════════════════════

export function pushSmartMoney(
  smc: SmartMoneyAnalysis,
  quote: StockQuote,
  atr: number | null,
  indicators?: TechnicalIndicator[],
): void {
  if (smc.score < 65) return;

  if (indicators && indicators.length > 0) {
    getCycleIndicators().set(smc.symbol, indicators);
  }
  const dir: 'BUY' | 'SELL' = smc.overallBias === 'BULLISH' ? 'BUY' : 'SELL';
  const effectiveATR = atr && atr > 0 ? atr : quote.price * 0.02;
  const zone = smc.signals.sort((a, b) => b.strength - a.strength)[0]?.zone;

  let sl: number;
  if (dir === 'BUY') {
    sl = zone && zone.low < quote.price ? zone.low - effectiveATR * 0.25 : quote.price - effectiveATR * 2;
    sl = Math.max(sl, quote.price * 0.92);
  } else {
    sl = zone && zone.high > quote.price ? zone.high + effectiveATR * 0.25 : quote.price + effectiveATR * 2;
    sl = Math.min(sl, quote.price * 1.08);
  }

  const tp1 = dir === 'BUY' ? quote.price + effectiveATR * 3 : quote.price - effectiveATR * 3;
  const tp2 = dir === 'BUY' ? quote.price + effectiveATR * 5 : quote.price - effectiveATR * 5;

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

// ═══════════════════════════════════════════════════════════════
// MTF Momentum adapter
// ═══════════════════════════════════════════════════════════════

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
    entry: mtf.takeProfit ? undefined : undefined,
    stopLoss: mtf.stopLoss,
    tp1: mtf.takeProfit,
    reason: `Multi-Timeframe confluence at ${mtf.confluence}% across W/D/4H. Suggested: ${dir} ${mtf.positionSize === 1 ? 'full' : 'half'} size.`,
    signals,
  });
}

// ═══════════════════════════════════════════════════════════════
// Technical adapter
// ═══════════════════════════════════════════════════════════════

export function pushTechnical(
  signals: Signal[],
  quote: StockQuote,
  indicators: TechnicalIndicator[],
  _fibonacci: FibonacciResult | null,
): void {
  if (signals.length === 0) return;

  getCycleIndicators().set(quote.symbol, indicators);

  let buyScore = 0, sellScore = 0;
  const w: Record<string, number> = { CRITICAL: 3, IMPORTANT: 2, INFO: 1 };
  for (const s of signals) {
    const weight = w[s.priority] || 1;
    if (['RSI_OVERSOLD', 'GOLDEN_CROSS', 'MACD_BULLISH_CROSS', '52W_LOW_PROXIMITY', 'FIBONACCI_LEVEL_HIT'].includes(s.type)) buyScore += weight;
    if (['RSI_OVERBOUGHT', 'DEATH_CROSS', 'MACD_BEARISH_CROSS', '52W_HIGH_PROXIMITY', '52W_BREAKOUT'].includes(s.type)) sellScore += weight;
  }
  const dir: 'BUY' | 'SELL' = buyScore >= sellScore ? 'BUY' : 'SELL';

  let conf = 0;
  const cw: Record<string, number> = { CRITICAL: 25, IMPORTANT: 15, INFO: 5 };
  for (const s of signals) conf += cw[s.priority] || 5;
  const rsi = indicators.find(i => i.indicator === 'RSI');
  if (rsi && (rsi.value < 25 || rsi.value > 75)) conf += 10;
  conf = Math.min(100, conf);

  if (conf < 55) return;

  const atr = indicators.find(i => i.indicator === 'ATR')?.value ?? quote.price * 0.02;

  pushEngineOutput({
    engine: 'Technical',
    symbol: quote.symbol,
    direction: dir,
    confidence: conf,
    entry: quote.price,
    stopLoss: dir === 'BUY' ? Math.max(quote.price - atr * 2, quote.price * 0.92) : Math.min(quote.price + atr * 2, quote.price * 1.08),
    tp1: dir === 'BUY' ? quote.price + atr * 4 : quote.price - atr * 4,
    tp2: dir === 'BUY' ? quote.price + atr * 6 : quote.price - atr * 6,
    reason: signals.slice(0, 2).map(s => s.description).join('. ') + '.',
    signals: signals.map(s => `${s.title} (${s.priority})`).slice(0, 4),
  });
}

// ═══════════════════════════════════════════════════════════════
// Stat Arb adapter
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// Crypto DeFi adapter
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// Event Driven adapter
// ═══════════════════════════════════════════════════════════════

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
    stopLoss: quote ? (direction === 'BUY' ? quote.price - atr * 2 : quote.price + atr * 2) : undefined,
    tp1: quote ? (direction === 'BUY' ? quote.price + atr * 4.5 : quote.price - atr * 4.5) : undefined,
    reason,
    signals,
  }, db || null);
}

// ═══════════════════════════════════════════════════════════════
// Options adapter
// ═══════════════════════════════════════════════════════════════

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
    tp1: direction === 'BUY' ? quote.price + atr * 3.5 : quote.price - atr * 3.5,
    tp2: direction === 'BUY' ? quote.price + atr * 5 : quote.price - atr * 5,
    reason: `${signalType}: ${symbol} showing options-grade setup with ${confidence}% confidence.`,
    signals: [
      `Signal: ${signalType}`,
      ...indicators.filter(i => ['RSI', 'ATR', 'BB_WIDTH'].includes(i.indicator)).map(i => `${i.indicator}: ${i.value.toFixed(2)}`),
    ].slice(0, 4),
  }, db || null);
}
