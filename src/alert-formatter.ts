// ─── Alert Formatter ──────────────────────────────────────────
// Formats all signals into clear, actionable trading alerts.
// Every alert includes: Action, Reason, Signals, Trade Setup,
// Confidence, and Market Context.

import type { Signal, StockQuote, TechnicalIndicator, FibonacciResult } from './types';
import type { SmartMoneyAnalysis, SmartMoneySignal } from './analysis/smart-money';
import type { MTFSignal } from './analysis/multi-timeframe';
import type { MarketRegime } from './analysis/regime';

// ─── Shared State: Regime + Dedup ────────────────────────────

let currentRegime: MarketRegime | null = null;
const recentAlerts = new Map<string, number>(); // key → timestamp
const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours — max once per day per stock

export function setCurrentRegime(regime: MarketRegime): void {
  currentRegime = regime;
}

/**
 * Returns true if this alert should be suppressed (duplicate).
 * Key is based on symbol + action + source engine.
 */
export function isDuplicate(key: string): boolean {
  const now = Date.now();
  // Purge stale entries
  for (const [k, ts] of recentAlerts) {
    if (now - ts > DEDUP_WINDOW_MS) recentAlerts.delete(k);
  }
  if (recentAlerts.has(key)) return true;
  recentAlerts.set(key, now);
  return false;
}

// ─── Trade Level Calculation ─────────────────────────────────

interface TradeLevels {
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
}

function calcTradeLevels(
  price: number,
  direction: 'BUY' | 'SELL',
  atr: number | null,
  zone?: { high: number; low: number }
): TradeLevels {
  // Default ATR estimate: 2% of price
  const effectiveATR = atr && atr > 0 ? atr : price * 0.02;

  if (direction === 'BUY') {
    // Only anchor SL to zone if the zone is below price (demand zone)
    const useZone = zone && zone.low < price;
    const sl = useZone ? zone!.low - effectiveATR * 0.25 : price - effectiveATR * 2;
    return {
      entry: price,
      stopLoss: Math.max(sl, price * 0.92), // max 8% loss
      tp1: price + effectiveATR * 2,
      tp2: price + effectiveATR * 3.5,
    };
  }
  // SELL — only anchor SL to zone if zone is above price (supply zone)
  const useZone = zone && zone.high > price;
  const sl = useZone ? zone!.high + effectiveATR * 0.25 : price + effectiveATR * 2;
  return {
    entry: price,
    stopLoss: Math.min(sl, price * 1.08),
    tp1: price - effectiveATR * 2,
    tp2: price - effectiveATR * 3.5,
  };
}

function confidenceLabel(c: number): string {
  if (c >= 80) return 'High';
  if (c >= 50) return 'Medium';
  return 'Low';
}

function regimeContext(direction: 'BUY' | 'SELL'): string {
  if (!currentRegime) return 'Regime data unavailable.';
  const r = currentRegime;
  const regimeLabel = r.regime.replace('_', ' ').toLowerCase();

  const bullishRegimes = ['TRENDING_UP'];
  const bearishRegimes = ['TRENDING_DOWN'];
  const isTrendAligned =
    (direction === 'BUY' && bullishRegimes.includes(r.regime)) ||
    (direction === 'SELL' && bearishRegimes.includes(r.regime));

  const alignment = isTrendAligned ? 'Trend-aligned trade' : 'Counter-trend trade';
  const sizing = isTrendAligned ? '' : ' — consider reduced position size.';
  const vixNote = r.vix >= 25 ? ` VIX elevated at ${r.vix.toFixed(0)}.` : '';

  return `${alignment} — market is ${regimeLabel} (conf ${r.confidence}%).${vixNote}${sizing}`;
}

function riskReward(entry: number, sl: number, tp: number): string {
  const risk = Math.abs(entry - sl);
  const reward = Math.abs(tp - entry);
  return risk > 0 ? (reward / risk).toFixed(1) : '—';
}

// ─── 1. Technical Signal Alert ──────────────────────────────

/**
 * Format a technical signal alert (RSI, MACD, EMA, Fib, Volume, 52W).
 */
export function formatTechnicalAlert(
  signals: Signal[],
  quote: StockQuote,
  indicators: TechnicalIndicator[],
  fibonacci: FibonacciResult | null
): string {
  const action = deriveActionFromSignals(signals);
  const confidence = calcTechnicalConfidence(signals, indicators);
  const atr = indicators.find(i => i.indicator === 'ATR')?.value ?? null;
  const levels = calcTradeLevels(quote.price, action, atr);

  const dedupKey = `TECH:${quote.symbol}:${action}`;
  if (isDuplicate(dedupKey)) return '';

  const reasonParts: string[] = [];
  const signalLines: string[] = [];

  for (const sig of signals) {
    signalLines.push(`• ${sig.title} (${sig.priority})`);
    reasonParts.push(sig.description);
  }

  const rsi = indicators.find(i => i.indicator === 'RSI');
  const macd = indicators.find(i => i.indicator === 'MACD');
  const macdSig = indicators.find(i => i.indicator === 'MACD_SIGNAL');
  const sma50 = indicators.find(i => i.indicator === 'SMA_50');
  const sma200 = indicators.find(i => i.indicator === 'SMA_200');

  if (fibonacci?.nearestLevel) {
    signalLines.push(`• Fibonacci ${fibonacci.nearestLevel.label} at $${fibonacci.nearestLevel.price.toFixed(2)}`);
  }

  // Technical Info section
  const techLines: string[] = [];
  if (rsi) techLines.push(`• RSI(14): ${rsi.value.toFixed(1)}`);
  if (macd && macdSig) {
    const macdDir = macd.value > macdSig.value ? 'Bullish' : 'Bearish';
    techLines.push(`• MACD: ${macd.value.toFixed(3)} (${macdDir})`);
  }
  if (sma50) techLines.push(`• SMA 50: $${sma50.value.toFixed(2)}`);
  if (sma200) techLines.push(`• SMA 200: $${sma200.value.toFixed(2)}`);

  const reason = reasonParts.length > 0
    ? reasonParts.slice(0, 2).join('. ') + '.'
    : `Technical analysis detected ${action.toLowerCase()} signal on ${quote.symbol}.`;

  const lines = [
    `🚨 <b>TRADE ALERT — ${quote.symbol}</b>`,
    ``,
    `<b>Action: ${action}</b>`,
    ``,
    `<b>Reason:</b>`,
    reason,
    ``,
    `<b>Supporting Signals:</b>`,
    ...signalLines,
    ``,
    `<b>Technical Info:</b>`,
    ...techLines,
    ``,
    `<b>Trade Setup:</b>`,
    `Entry: $${levels.entry.toFixed(2)}`,
    `Stop Loss: $${levels.stopLoss.toFixed(2)}`,
    `Take Profit:`,
    `  TP1: $${levels.tp1.toFixed(2)} (R:R 1:${riskReward(levels.entry, levels.stopLoss, levels.tp1)})`,
    `  TP2: $${levels.tp2.toFixed(2)} (R:R 1:${riskReward(levels.entry, levels.stopLoss, levels.tp2)})`,
    ``,
    `<b>Confidence:</b> ${confidence}/100 (${confidenceLabel(confidence)})`,
    ``,
    `<b>Market Context:</b>`,
    regimeContext(action),
    ``,
    `🔗 <a href="https://tradingview.com/symbols/${quote.symbol}">TradingView</a>` +
    ` | <a href="https://finance.yahoo.com/quote/${quote.symbol}">Yahoo</a>`,
    `⏰ ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`,
  ];

  return lines.join('\n');
}

function deriveActionFromSignals(signals: Signal[]): 'BUY' | 'SELL' {
  let buyScore = 0;
  let sellScore = 0;
  const w = { CRITICAL: 3, IMPORTANT: 2, INFO: 1 } as const;

  for (const s of signals) {
    const weight = w[s.priority as keyof typeof w] || 1;
    const bullish = ['RSI_OVERSOLD', 'GOLDEN_CROSS', 'MACD_BULLISH_CROSS', '52W_LOW_PROXIMITY', 'FIBONACCI_LEVEL_HIT'].includes(s.type);
    const bearish = ['RSI_OVERBOUGHT', 'DEATH_CROSS', 'MACD_BEARISH_CROSS', '52W_HIGH_PROXIMITY', '52W_BREAKOUT'].includes(s.type);
    if (bullish) buyScore += weight;
    if (bearish) sellScore += weight;
  }

  return buyScore >= sellScore ? 'BUY' : 'SELL';
}

function calcTechnicalConfidence(signals: Signal[], indicators: TechnicalIndicator[]): number {
  let score = 0;
  const w = { CRITICAL: 25, IMPORTANT: 15, INFO: 5 } as const;
  for (const s of signals) {
    score += w[s.priority as keyof typeof w] || 5;
  }
  // Bonus for RSI extremes
  const rsi = indicators.find(i => i.indicator === 'RSI');
  if (rsi && (rsi.value < 25 || rsi.value > 75)) score += 10;
  // Bonus for EMA alignment
  const ema50 = indicators.find(i => i.indicator === 'EMA_50');
  const ema200 = indicators.find(i => i.indicator === 'EMA_200');
  if (ema50 && ema200) {
    const aligned = (ema50.value > ema200.value); // bullish structure
    if (aligned) score += 5;
  }
  return Math.min(100, score);
}

// ─── 2. Smart Money Alert ───────────────────────────────────

/**
 * Format a Smart Money alert with actionable trade recommendation.
 */
export function formatSmartMoneyTradeAlert(
  analysis: SmartMoneyAnalysis,
  quote: StockQuote,
  indicators: TechnicalIndicator[]
): string {
  const action: 'BUY' | 'SELL' = analysis.overallBias === 'BULLISH' ? 'BUY' : 'SELL';

  const dedupKey = `SMC:${analysis.symbol}:${action}`;
  if (isDuplicate(dedupKey)) return '';

  const atr = indicators.find(i => i.indicator === 'ATR')?.value ?? null;

  // Pick best zone from top signal for SL anchoring
  const topSignals = [...analysis.signals].sort((a, b) => b.strength - a.strength);
  const bestZone = topSignals[0]?.zone;
  const levels = calcTradeLevels(quote.price, action, atr, bestZone);

  // Build reason from top signal types
  const modelNames: Record<string, string> = {
    ORDER_BLOCK: 'Order Block',
    FVG: 'Fair Value Gap',
    LIQUIDITY_SWEEP: 'Liquidity Sweep',
    BOS: 'Break of Structure',
    INSIDER_BUY: 'Insider Buying',
  };

  const topModels = [...new Set(topSignals.slice(0, 3).map(s => modelNames[s.type] || s.type))];
  const biasWord = action === 'BUY' ? 'bullish' : 'bearish';

  const reason = `Smart Money model identified ${biasWord} institutional activity via ${topModels.join(' + ')}. ` +
    `Overall bias: ${analysis.overallBias} with ${analysis.signals.length} confluent signals.`;

  // Signal details (top 4)
  const signalLines: string[] = [];
  const byType: Record<string, SmartMoneySignal[]> = {};
  for (const s of analysis.signals) (byType[s.type] ??= []).push(s);
  for (const [type, sigs] of Object.entries(byType)) {
    const best = sigs.sort((a, b) => b.strength - a.strength)[0];
    signalLines.push(`• ${modelNames[type] || type} (Strength: ${Math.round(best.strength)}, Age: ${best.age}d, ${best.direction})`);
  }

  const confidence = analysis.score;

  // Technical Info
  const rsi = indicators.find(i => i.indicator === 'RSI');
  const macd = indicators.find(i => i.indicator === 'MACD');
  const macdSig = indicators.find(i => i.indicator === 'MACD_SIGNAL');
  const sma50 = indicators.find(i => i.indicator === 'SMA_50');
  const sma200 = indicators.find(i => i.indicator === 'SMA_200');
  const techLines: string[] = [];
  if (rsi) techLines.push(`• RSI(14): ${rsi.value.toFixed(1)}`);
  if (macd && macdSig) {
    const macdDir = macd.value > macdSig.value ? 'Bullish' : 'Bearish';
    techLines.push(`• MACD: ${macd.value.toFixed(3)} (${macdDir})`);
  }
  if (sma50) techLines.push(`• SMA 50: $${sma50.value.toFixed(2)}`);
  if (sma200) techLines.push(`• SMA 200: $${sma200.value.toFixed(2)}`);

  const lines = [
    `🚨 <b>TRADE ALERT — ${analysis.symbol}</b>`,
    ``,
    `<b>Action: ${action}</b>`,
    ``,
    `<b>Reason:</b>`,
    reason,
    ``,
    `<b>Supporting Signals:</b>`,
    ...signalLines.slice(0, 5),
    ``,
    `<b>Technical Info:</b>`,
    ...techLines,
    ``,
    `<b>Trade Setup:</b>`,
    `Entry: $${levels.entry.toFixed(2)}`,
    `Stop Loss: $${levels.stopLoss.toFixed(2)}`,
    `Take Profit:`,
    `  TP1: $${levels.tp1.toFixed(2)} (R:R 1:${riskReward(levels.entry, levels.stopLoss, levels.tp1)})`,
    `  TP2: $${levels.tp2.toFixed(2)} (R:R 1:${riskReward(levels.entry, levels.stopLoss, levels.tp2)})`,
    ``,
    `<b>Confidence:</b> ${confidence}/100 (${confidenceLabel(confidence)})`,
    ``,
    `<b>Market Context:</b>`,
    regimeContext(action),
    ``,
    `🔗 <a href="https://tradingview.com/symbols/${analysis.symbol}">TradingView</a>` +
    ` | <a href="https://finance.yahoo.com/quote/${analysis.symbol}">Yahoo</a>`,
    `⏰ ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`,
  ];

  return lines.join('\n');
}

// ─── 3. Multi-Timeframe Alert ───────────────────────────────

/**
 * Format MTF signal as actionable trade alert.
 */
export function formatMTFTradeAlert(signal: MTFSignal): string {
  if (signal.suggestedAction === 'WAIT') return '';

  const action = signal.suggestedAction;
  const dedupKey = `MTF:${signal.symbol}:${action}`;
  if (isDuplicate(dedupKey)) return '';

  const sizeLabel = signal.positionSize === 1 ? 'FULL' : 'HALF';
  const biasWord = action === 'BUY' ? 'bullish' : 'bearish';

  const reason =
    `Multi-Timeframe Momentum model shows ${biasWord} confluence across weekly (${signal.weekly}), ` +
    `daily (${signal.daily.type}, str ${signal.daily.strength}), and 4H (${signal.h4.type}, conf ${signal.h4.confidence}%) timeframes. ` +
    `Regime: ${signal.regime}. Recommended ${sizeLabel} position.`;

  const signalLines = [
    `• Weekly trend: ${signal.weekly}`,
    `• Daily zone: ${signal.daily.type} (Strength: ${signal.daily.strength})`,
    `• 4H trigger: ${signal.h4.type} (Confidence: ${signal.h4.confidence}%)`,
    signal.daily.rsiDivergence ? `• RSI Divergence detected` : null,
    signal.daily.bollingerSqueeze ? `• Bollinger Squeeze active` : null,
    signal.h4.volumeConfirmed ? `• Volume confirmed` : null,
  ].filter(Boolean) as string[];

  // MTF already provides SL/TP
  const entry = (signal.stopLoss + signal.takeProfit) / 2; // midpoint estimate
  const rr = Math.abs(signal.takeProfit - entry) / Math.abs(entry - signal.stopLoss);
  // Extend TP2 by 50%
  const tp2 = action === 'BUY'
    ? signal.takeProfit + (signal.takeProfit - entry) * 0.5
    : signal.takeProfit - (entry - signal.takeProfit) * 0.5;

  const lines = [
    `🚨 <b>TRADE ALERT — ${signal.symbol}</b>`,
    ``,
    `<b>Action: ${action} (${sizeLabel} position)</b>`,
    ``,
    `<b>Reason:</b>`,
    reason,
    ``,
    `<b>Supporting Signals:</b>`,
    ...signalLines,
    ``,
    `<b>Trade Setup:</b>`,
    `Stop Loss: $${signal.stopLoss.toFixed(2)}`,
    `Take Profit:`,
    `  TP1: $${signal.takeProfit.toFixed(2)} (R:R 1:${rr.toFixed(1)})`,
    `  TP2: $${tp2.toFixed(2)}`,
    ``,
    `<b>Confidence:</b> ${signal.confluence}/100 (${confidenceLabel(signal.confluence)})`,
    ``,
    `<b>Market Context:</b>`,
    regimeContext(action),
    ``,
    `⏰ ${new Date(signal.timestamp).toISOString().replace('T', ' ').slice(0, 19)} UTC`,
  ];

  return lines.join('\n');
}
