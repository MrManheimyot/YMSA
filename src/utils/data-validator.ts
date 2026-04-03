// ─── Cross-Validation Layer ──────────────────────────────────
// Validates ALL incoming data before it enters the signal pipeline.
// Three layers:
//   1. Structural validation — types, ranges, required fields
//   2. Cross-source validation — compare multi-source data for agreement
//   3. Temporal validation — staleness, market-hours, anomaly detection
//
// Every validator returns a ValidationResult that gates downstream processing.

import type { StockQuote, TechnicalIndicator, IndicatorType } from '../types';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type ValidationSeverity = 'PASS' | 'WARN' | 'FAIL';

export interface ValidationIssue {
  field: string;
  message: string;
  severity: ValidationSeverity;
  value?: unknown;
}

export interface ValidationResult {
  valid: boolean;          // true if no FAIL-level issues
  score: number;           // 0-100 data quality score
  issues: ValidationIssue[];
  source?: string;
  symbol?: string;
  timestamp: number;
}

export interface CrossValidationResult {
  symbol: string;
  primarySource: string;
  agreementScore: number;   // 0-100 — how well sources agree
  priceDeviation: number;   // % deviation between sources
  validSources: number;
  totalSources: number;
  bestQuote: StockQuote | null;
  issues: ValidationIssue[];
}

export interface IndicatorConsistencyResult {
  symbol: string;
  score: number;            // 0-100
  issues: ValidationIssue[];
  missingCritical: IndicatorType[];
  availableIndicators: IndicatorType[];
}

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

/** Maximum allowed quote staleness (15 minutes during market hours) */
const MAX_QUOTE_AGE_MS = 15 * 60 * 1000;

/** Maximum allowed quote staleness after hours (4 hours) */
const MAX_AFTER_HOURS_AGE_MS = 4 * 60 * 60 * 1000;

/** Maximum acceptable price deviation between sources (1%) */
const MAX_PRICE_DEVIATION_PCT = 1.0;

/** Warning threshold for price deviation (0.3%) */
const WARN_PRICE_DEVIATION_PCT = 0.3;

/** Minimum required indicators for a valid signal */
const REQUIRED_INDICATORS: IndicatorType[] = ['RSI', 'ATR', 'MACD'];

/** Highly desirable indicators (warn if missing) */
const DESIRABLE_INDICATORS: IndicatorType[] = ['EMA_50', 'EMA_200', 'ADX', 'SMA_50', 'SMA_200'];

/** Price sanity bounds */
const MIN_STOCK_PRICE = 0.01;
const MAX_STOCK_PRICE = 999_999;

/** Volume sanity bounds */
const MIN_VOLUME = 0;
const MAX_VOLUME = 50_000_000_000; // 50B shares (catches obviously wrong data)

/** RSI valid range */
const RSI_MIN = 0;
const RSI_MAX = 100;

/** ATR must be positive and less than 50% of price */
const ATR_MAX_PCT_OF_PRICE = 0.50;

// ═══════════════════════════════════════════════════════════════
// 1. Structural Validation — Quote Data
// ═══════════════════════════════════════════════════════════════

export function validateQuote(quote: StockQuote | null | undefined, source?: string): ValidationResult {
  const issues: ValidationIssue[] = [];
  const ts = Date.now();

  if (!quote) {
    return { valid: false, score: 0, issues: [{ field: 'quote', message: 'Quote is null/undefined', severity: 'FAIL' }], source, timestamp: ts };
  }

  // Symbol
  if (!quote.symbol || typeof quote.symbol !== 'string' || quote.symbol.length === 0) {
    issues.push({ field: 'symbol', message: 'Missing or empty symbol', severity: 'FAIL', value: quote.symbol });
  }

  // Price
  if (typeof quote.price !== 'number' || isNaN(quote.price)) {
    issues.push({ field: 'price', message: 'Price is NaN or not a number', severity: 'FAIL', value: quote.price });
  } else if (quote.price < MIN_STOCK_PRICE) {
    issues.push({ field: 'price', message: `Price ${quote.price} below minimum ${MIN_STOCK_PRICE}`, severity: 'FAIL', value: quote.price });
  } else if (quote.price > MAX_STOCK_PRICE) {
    issues.push({ field: 'price', message: `Price ${quote.price} above maximum ${MAX_STOCK_PRICE}`, severity: 'FAIL', value: quote.price });
  }

  // Volume
  if (typeof quote.volume !== 'number' || isNaN(quote.volume)) {
    issues.push({ field: 'volume', message: 'Volume is NaN', severity: 'WARN', value: quote.volume });
  } else if (quote.volume < MIN_VOLUME) {
    issues.push({ field: 'volume', message: `Volume ${quote.volume} is negative`, severity: 'FAIL', value: quote.volume });
  } else if (quote.volume > MAX_VOLUME) {
    issues.push({ field: 'volume', message: `Volume ${quote.volume} exceeds sanity max`, severity: 'WARN', value: quote.volume });
  } else if (quote.volume === 0) {
    issues.push({ field: 'volume', message: 'Volume is 0 — may indicate no trading / stale data', severity: 'WARN', value: 0 });
  }

  // Average Volume
  if (typeof quote.avgVolume !== 'number' || isNaN(quote.avgVolume) || quote.avgVolume <= 0) {
    issues.push({ field: 'avgVolume', message: 'avgVolume missing/zero — volume ratio unreliable', severity: 'WARN', value: quote.avgVolume });
  }

  // 52-week range
  if (quote.week52High > 0 && quote.week52Low > 0) {
    if (quote.week52Low > quote.week52High) {
      issues.push({ field: 'week52Range', message: '52W low > 52W high — data corrupted', severity: 'FAIL', value: `${quote.week52Low} > ${quote.week52High}` });
    }
    if (quote.price > 0 && (quote.price > quote.week52High * 1.15 || quote.price < quote.week52Low * 0.85)) {
      issues.push({ field: 'week52Range', message: 'Price 15%+ outside 52W range — stale 52W data or extreme move', severity: 'WARN', value: { price: quote.price, high: quote.week52High, low: quote.week52Low } });
    }
  } else {
    issues.push({ field: 'week52Range', message: '52W high/low missing — 52W signals unreliable', severity: 'WARN', value: { high: quote.week52High, low: quote.week52Low } });
  }

  // Change/ChangePercent consistency
  if (quote.previousClose && quote.previousClose > 0 && quote.price > 0) {
    const expectedChange = quote.price - quote.previousClose;
    const expectedPct = (expectedChange / quote.previousClose) * 100;
    if (Math.abs(expectedPct - quote.changePercent) > 1.0) {
      issues.push({ field: 'changePercent', message: `changePercent ${quote.changePercent.toFixed(2)}% doesn't match computed ${expectedPct.toFixed(2)}%`, severity: 'WARN', value: { reported: quote.changePercent, computed: expectedPct } });
    }
  }

  // Staleness
  if (quote.timestamp > 0) {
    const age = ts - quote.timestamp;
    const maxAge = isMarketHours() ? MAX_QUOTE_AGE_MS : MAX_AFTER_HOURS_AGE_MS;
    if (age > maxAge) {
      issues.push({ field: 'timestamp', message: `Quote is ${Math.round(age / 60000)}min old (max: ${Math.round(maxAge / 60000)}min)`, severity: 'WARN', value: { age, maxAge } });
    }
    if (age < 0) {
      issues.push({ field: 'timestamp', message: 'Quote timestamp is in the future', severity: 'FAIL', value: quote.timestamp });
    }
  } else {
    issues.push({ field: 'timestamp', message: 'Missing timestamp', severity: 'WARN' });
  }

  const failCount = issues.filter(i => i.severity === 'FAIL').length;
  const warnCount = issues.filter(i => i.severity === 'WARN').length;
  const score = Math.max(0, 100 - failCount * 30 - warnCount * 10);

  return {
    valid: failCount === 0,
    score,
    issues,
    source: source ?? quote.source,
    symbol: quote.symbol,
    timestamp: ts,
  };
}

// ═══════════════════════════════════════════════════════════════
// 2. Structural Validation — Indicators
// ═══════════════════════════════════════════════════════════════

export function validateIndicators(indicators: TechnicalIndicator[], symbol: string): IndicatorConsistencyResult {
  const issues: ValidationIssue[] = [];
  const available = new Set<IndicatorType>();

  for (const ind of indicators) {
    available.add(ind.indicator);

    // NaN check
    if (isNaN(ind.value)) {
      issues.push({ field: ind.indicator, message: `${ind.indicator} value is NaN`, severity: 'FAIL', value: ind.value });
      continue;
    }

    // RSI range
    if (ind.indicator === 'RSI') {
      if (ind.value < RSI_MIN || ind.value > RSI_MAX) {
        issues.push({ field: 'RSI', message: `RSI ${ind.value} outside valid range [0, 100]`, severity: 'FAIL', value: ind.value });
      }
    }

    // ADX range (0-100)
    if (ind.indicator === 'ADX') {
      if (ind.value < 0 || ind.value > 100) {
        issues.push({ field: 'ADX', message: `ADX ${ind.value} outside valid range [0, 100]`, severity: 'FAIL', value: ind.value });
      }
    }

    // ATR must be positive
    if (ind.indicator === 'ATR') {
      if (ind.value <= 0) {
        issues.push({ field: 'ATR', message: `ATR ${ind.value} must be positive`, severity: 'FAIL', value: ind.value });
      }
    }

    // EMA/SMA must be positive (prices can't be negative)
    if (ind.indicator.startsWith('EMA_') || ind.indicator.startsWith('SMA_')) {
      if (ind.value <= 0) {
        issues.push({ field: ind.indicator, message: `${ind.indicator} ${ind.value} must be positive`, severity: 'WARN', value: ind.value });
      }
    }
  }

  // Check required indicators
  const missingCritical: IndicatorType[] = [];
  for (const req of REQUIRED_INDICATORS) {
    if (!available.has(req)) {
      missingCritical.push(req);
      issues.push({ field: req, message: `Required indicator ${req} missing — signals may be unreliable`, severity: 'FAIL' });
    }
  }

  // Check desirable indicators
  for (const des of DESIRABLE_INDICATORS) {
    if (!available.has(des)) {
      issues.push({ field: des, message: `Desirable indicator ${des} missing — reduced analysis quality`, severity: 'WARN' });
    }
  }

  // Cross-check: EMA50 vs EMA200 consistency with price
  const ema50 = indicators.find(i => i.indicator === 'EMA_50');
  const ema200 = indicators.find(i => i.indicator === 'EMA_200');
  if (ema50 && ema200 && ema50.value > 0 && ema200.value > 0) {
    const spreadPct = Math.abs(ema50.value - ema200.value) / ema200.value * 100;
    if (spreadPct > 30) {
      issues.push({ field: 'EMA_SPREAD', message: `EMA50/EMA200 spread ${spreadPct.toFixed(1)}% is unusually wide — check data quality`, severity: 'WARN', value: spreadPct });
    }
  }

  // Cross-check: MACD consistency
  const macd = indicators.find(i => i.indicator === 'MACD');
  const macdSignal = indicators.find(i => i.indicator === 'MACD_SIGNAL');
  const macdHist = indicators.find(i => i.indicator === 'MACD_HISTOGRAM');
  if (macd && macdSignal && macdHist) {
    const expectedHist = macd.value - macdSignal.value;
    if (Math.abs(expectedHist - macdHist.value) > 0.01) {
      issues.push({ field: 'MACD_CONSISTENCY', message: `MACD histogram ${macdHist.value.toFixed(4)} doesn't match MACD-Signal (${expectedHist.toFixed(4)})`, severity: 'WARN', value: { macd: macd.value, signal: macdSignal.value, hist: macdHist.value } });
    }
  }

  // ATR vs price sanity
  const atr = indicators.find(i => i.indicator === 'ATR');
  if (atr && atr.value > 0) {
    // We need price context — check against EMA50 as proxy
    const priceProxy = ema50?.value ?? indicators.find(i => i.indicator === 'SMA_50')?.value;
    if (priceProxy && priceProxy > 0) {
      const atrPct = atr.value / priceProxy;
      if (atrPct > ATR_MAX_PCT_OF_PRICE) {
        issues.push({ field: 'ATR', message: `ATR is ${(atrPct * 100).toFixed(1)}% of price — abnormally volatile`, severity: 'WARN', value: { atr: atr.value, priceProxy } });
      }
    }
  }

  const failCount = issues.filter(i => i.severity === 'FAIL').length;
  const warnCount = issues.filter(i => i.severity === 'WARN').length;
  const score = Math.max(0, 100 - failCount * 25 - warnCount * 8);

  return {
    symbol,
    score,
    issues,
    missingCritical,
    availableIndicators: [...available],
  };
}

// ═══════════════════════════════════════════════════════════════
// 3. Cross-Source Price Validation
// ═══════════════════════════════════════════════════════════════

export function crossValidateQuotes(quotes: Array<{ quote: StockQuote; source: string }>): CrossValidationResult {
  const validQuotes = quotes.filter(q => q.quote && q.quote.price > 0);
  const symbol = validQuotes[0]?.quote?.symbol ?? 'UNKNOWN';

  if (validQuotes.length === 0) {
    return {
      symbol,
      primarySource: 'none',
      agreementScore: 0,
      priceDeviation: 100,
      validSources: 0,
      totalSources: quotes.length,
      bestQuote: null,
      issues: [{ field: 'sources', message: 'No valid quotes from any source', severity: 'FAIL' }],
    };
  }

  if (validQuotes.length === 1) {
    return {
      symbol,
      primarySource: validQuotes[0].source,
      agreementScore: 50, // Single source = medium confidence
      priceDeviation: 0,
      validSources: 1,
      totalSources: quotes.length,
      bestQuote: validQuotes[0].quote,
      issues: [{ field: 'sources', message: 'Only one source available — cannot cross-validate', severity: 'WARN' }],
    };
  }

  // Calculate mean price
  const prices = validQuotes.map(q => q.quote.price);
  const meanPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

  // Calculate max deviation from mean
  const deviations = prices.map(p => Math.abs(p - meanPrice) / meanPrice * 100);
  const maxDeviation = Math.max(...deviations);

  const issues: ValidationIssue[] = [];

  if (maxDeviation > MAX_PRICE_DEVIATION_PCT) {
    issues.push({ field: 'price', message: `Price deviation ${maxDeviation.toFixed(2)}% across sources exceeds ${MAX_PRICE_DEVIATION_PCT}% threshold`, severity: 'FAIL', value: { prices: validQuotes.map(q => ({ source: q.source, price: q.quote.price })) } });
  } else if (maxDeviation > WARN_PRICE_DEVIATION_PCT) {
    issues.push({ field: 'price', message: `Price deviation ${maxDeviation.toFixed(2)}% across sources`, severity: 'WARN', value: { prices: validQuotes.map(q => ({ source: q.source, price: q.quote.price })) } });
  }

  // Pick best quote: prefer the freshest data
  const sorted = [...validQuotes].sort((a, b) => b.quote.timestamp - a.quote.timestamp);
  const bestQuote = sorted[0].quote;

  // Agreement score: 100 for perfect match, decays with deviation
  const agreementScore = Math.max(0, Math.round(100 - maxDeviation * 50));

  return {
    symbol,
    primarySource: sorted[0].source,
    agreementScore,
    priceDeviation: maxDeviation,
    validSources: validQuotes.length,
    totalSources: quotes.length,
    bestQuote,
    issues,
  };
}

// ═══════════════════════════════════════════════════════════════
// 4. Signal Integrity Validation
// ═══════════════════════════════════════════════════════════════

export interface SignalValidation {
  valid: boolean;
  score: number;
  direction: 'BUY' | 'SELL' | 'MIXED';
  bullishCount: number;
  bearishCount: number;
  conflictLevel: 'NONE' | 'MINOR' | 'MAJOR';
  issues: ValidationIssue[];
}

export function validateSignalConsistency(
  signals: Array<{ direction: 'BUY' | 'SELL'; confidence: number; engine: string }>,
  regime?: { regime: string; confidence: number } | null,
): SignalValidation {
  const issues: ValidationIssue[] = [];

  if (signals.length === 0) {
    return { valid: false, score: 0, direction: 'MIXED', bullishCount: 0, bearishCount: 0, conflictLevel: 'NONE', issues: [{ field: 'signals', message: 'No signals to validate', severity: 'FAIL' }] };
  }

  const bullish = signals.filter(s => s.direction === 'BUY');
  const bearish = signals.filter(s => s.direction === 'SELL');

  // Determine consensus direction
  const bullWeight = bullish.reduce((s, x) => s + x.confidence, 0);
  const bearWeight = bearish.reduce((s, x) => s + x.confidence, 0);
  const direction = bullish.length > 0 && bearish.length === 0 ? 'BUY' as const
    : bearish.length > 0 && bullish.length === 0 ? 'SELL' as const
    : 'MIXED' as const;

  // Conflict detection
  let conflictLevel: 'NONE' | 'MINOR' | 'MAJOR' = 'NONE';
  if (bullish.length > 0 && bearish.length > 0) {
    const conflictRatio = Math.min(bullWeight, bearWeight) / Math.max(bullWeight, bearWeight);
    if (conflictRatio > 0.6) {
      conflictLevel = 'MAJOR';
      issues.push({ field: 'direction', message: `Major engine conflict: ${bullish.length} BUY vs ${bearish.length} SELL with similar confidence`, severity: 'FAIL' });
    } else {
      conflictLevel = 'MINOR';
      issues.push({ field: 'direction', message: `Minor engine conflict: ${bullish.length} BUY vs ${bearish.length} SELL`, severity: 'WARN' });
    }
  }

  // Confidence outlier detection
  const confs = signals.map(s => s.confidence);
  const avgConf = confs.reduce((a, b) => a + b, 0) / confs.length;
  const maxConf = Math.max(...confs);
  const minConf = Math.min(...confs);
  if (maxConf - minConf > 40) {
    issues.push({ field: 'confidence', message: `Wide confidence spread: ${minConf}-${maxConf} (avg ${avgConf.toFixed(0)})`, severity: 'WARN', value: { min: minConf, max: maxConf, avg: avgConf } });
  }

  // Regime alignment check
  if (regime && regime.confidence >= 50) {
    const consensusDir = bullWeight >= bearWeight ? 'BUY' : 'SELL';
    const isAligned =
      (consensusDir === 'BUY' && regime.regime === 'TRENDING_UP') ||
      (consensusDir === 'SELL' && regime.regime === 'TRENDING_DOWN');
    const isCounter =
      (consensusDir === 'BUY' && regime.regime === 'TRENDING_DOWN') ||
      (consensusDir === 'SELL' && regime.regime === 'TRENDING_UP');

    if (isCounter && regime.confidence >= 70) {
      issues.push({ field: 'regime', message: `Signal is COUNTER-TREND in ${regime.regime} with ${regime.confidence}% regime confidence`, severity: 'FAIL' });
    } else if (isCounter) {
      issues.push({ field: 'regime', message: `Signal is counter-trend in ${regime.regime} (regime conf ${regime.confidence}%)`, severity: 'WARN' });
    } else if (isAligned) {
      // Bonus — no issue, just track
    }
  }

  const failCount = issues.filter(i => i.severity === 'FAIL').length;
  const warnCount = issues.filter(i => i.severity === 'WARN').length;
  const score = Math.max(0, 100 - failCount * 30 - warnCount * 10);

  return {
    valid: failCount === 0,
    score,
    direction,
    bullishCount: bullish.length,
    bearishCount: bearish.length,
    conflictLevel,
    issues,
  };
}

// ═══════════════════════════════════════════════════════════════
// 5. Trade Parameter Validation
// ═══════════════════════════════════════════════════════════════

export interface TradeValidation {
  valid: boolean;
  score: number;
  riskReward: number;
  issues: ValidationIssue[];
}

export function validateTradeParams(params: {
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2?: number;
  direction: 'BUY' | 'SELL';
  confidence: number;
  atr?: number;
}): TradeValidation {
  const issues: ValidationIssue[] = [];
  const { entry, stopLoss, tp1, tp2, direction, confidence, atr } = params;

  // Basic price sanity
  if (entry <= 0 || isNaN(entry)) {
    issues.push({ field: 'entry', message: 'Invalid entry price', severity: 'FAIL', value: entry });
  }
  if (stopLoss <= 0 || isNaN(stopLoss)) {
    issues.push({ field: 'stopLoss', message: 'Invalid stop loss', severity: 'FAIL', value: stopLoss });
  }
  if (tp1 <= 0 || isNaN(tp1)) {
    issues.push({ field: 'tp1', message: 'Invalid take profit', severity: 'FAIL', value: tp1 });
  }

  // Direction consistency
  if (direction === 'BUY') {
    if (stopLoss >= entry) {
      issues.push({ field: 'stopLoss', message: `BUY stop loss ${stopLoss} >= entry ${entry}`, severity: 'FAIL' });
    }
    if (tp1 <= entry) {
      issues.push({ field: 'tp1', message: `BUY take profit ${tp1} <= entry ${entry}`, severity: 'FAIL' });
    }
    if (tp2 !== undefined && tp2 <= tp1) {
      issues.push({ field: 'tp2', message: `TP2 ${tp2} <= TP1 ${tp1}`, severity: 'WARN' });
    }
  } else {
    if (stopLoss <= entry) {
      issues.push({ field: 'stopLoss', message: `SELL stop loss ${stopLoss} <= entry ${entry}`, severity: 'FAIL' });
    }
    if (tp1 >= entry) {
      issues.push({ field: 'tp1', message: `SELL take profit ${tp1} >= entry ${entry}`, severity: 'FAIL' });
    }
    if (tp2 !== undefined && tp2 >= tp1) {
      issues.push({ field: 'tp2', message: `TP2 ${tp2} >= TP1 ${tp1}`, severity: 'WARN' });
    }
  }

  // Risk:Reward
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(tp1 - entry);
  const rr = risk > 0 ? reward / risk : 0;

  if (rr < 2.0) {
    issues.push({ field: 'riskReward', message: `R:R ${rr.toFixed(2)} below 2.0 minimum`, severity: 'FAIL', value: rr });
  } else if (rr < 2.5) {
    issues.push({ field: 'riskReward', message: `R:R ${rr.toFixed(2)} is marginal (target 2.5+)`, severity: 'WARN', value: rr });
  }

  // Stop loss distance vs ATR
  if (atr && atr > 0 && risk > 0) {
    const slAtrMultiple = risk / atr;
    if (slAtrMultiple > 4) {
      issues.push({ field: 'stopDistance', message: `Stop ${slAtrMultiple.toFixed(1)}x ATR is very wide — may not hit SL before expiry`, severity: 'WARN', value: slAtrMultiple });
    }
    if (slAtrMultiple < 0.5) {
      issues.push({ field: 'stopDistance', message: `Stop ${slAtrMultiple.toFixed(1)}x ATR is very tight — may trigger on noise`, severity: 'WARN', value: slAtrMultiple });
    }
  }

  // Confidence gating
  if (confidence < 85) {
    issues.push({ field: 'confidence', message: `Confidence ${confidence} below 85 threshold`, severity: 'FAIL', value: confidence });
  }

  // Sanity: trade levels shouldn't be wildly far from entry
  if (entry > 0) {
    const slPct = Math.abs(entry - stopLoss) / entry * 100;
    const tpPct = Math.abs(tp1 - entry) / entry * 100;
    if (slPct > 15) {
      issues.push({ field: 'stopLoss', message: `Stop loss ${slPct.toFixed(1)}% from entry — unusually wide`, severity: 'WARN', value: slPct });
    }
    if (tpPct > 30) {
      issues.push({ field: 'tp1', message: `Take profit ${tpPct.toFixed(1)}% from entry — unusually wide`, severity: 'WARN', value: tpPct });
    }
  }

  const failCount = issues.filter(i => i.severity === 'FAIL').length;
  const warnCount = issues.filter(i => i.severity === 'WARN').length;
  const score = Math.max(0, 100 - failCount * 25 - warnCount * 10);

  return { valid: failCount === 0, score, riskReward: rr, issues };
}

// ═══════════════════════════════════════════════════════════════
// 6. Environment Variable Validation
// ═══════════════════════════════════════════════════════════════

export function validateEnvThresholds(env: Record<string, string | undefined>): ValidationResult {
  const issues: ValidationIssue[] = [];
  const ts = Date.now();

  const numericEnvVars: Array<{ key: string; min: number; max: number; label: string }> = [
    { key: 'RSI_OVERBOUGHT', min: 50, max: 100, label: 'RSI Overbought' },
    { key: 'RSI_OVERSOLD', min: 0, max: 50, label: 'RSI Oversold' },
    { key: 'EMA_FAST', min: 1, max: 100, label: 'EMA Fast Period' },
    { key: 'EMA_SLOW', min: 10, max: 500, label: 'EMA Slow Period' },
    { key: 'ALERT_PROXIMITY_52W', min: 0.1, max: 20, label: 'Alert Proximity 52W %' },
    { key: 'VOLUME_SPIKE_MULTIPLIER', min: 1, max: 50, label: 'Volume Spike Multiplier' },
  ];

  for (const { key, min, max, label } of numericEnvVars) {
    const raw = env[key];
    if (!raw || raw === '') {
      issues.push({ field: key, message: `${label} (${key}) is not set — using NaN, signals will be suppressed`, severity: 'FAIL' });
      continue;
    }
    const val = parseFloat(raw);
    if (isNaN(val)) {
      issues.push({ field: key, message: `${label} (${key}) = "${raw}" is not a valid number`, severity: 'FAIL', value: raw });
    } else if (val < min || val > max) {
      issues.push({ field: key, message: `${label} (${key}) = ${val} outside expected range [${min}, ${max}]`, severity: 'WARN', value: val });
    }
  }

  // Cross-check: EMA_FAST < EMA_SLOW
  const fast = parseFloat(env['EMA_FAST'] || '');
  const slow = parseFloat(env['EMA_SLOW'] || '');
  if (!isNaN(fast) && !isNaN(slow) && fast >= slow) {
    issues.push({ field: 'EMA_PERIODS', message: `EMA_FAST (${fast}) >= EMA_SLOW (${slow})`, severity: 'FAIL' });
  }

  // Cross-check: RSI_OVERSOLD < RSI_OVERBOUGHT
  const oversold = parseFloat(env['RSI_OVERSOLD'] || '');
  const overbought = parseFloat(env['RSI_OVERBOUGHT'] || '');
  if (!isNaN(oversold) && !isNaN(overbought) && oversold >= overbought) {
    issues.push({ field: 'RSI_THRESHOLDS', message: `RSI_OVERSOLD (${oversold}) >= RSI_OVERBOUGHT (${overbought})`, severity: 'FAIL' });
  }

  const failCount = issues.filter(i => i.severity === 'FAIL').length;
  const warnCount = issues.filter(i => i.severity === 'WARN').length;
  const score = Math.max(0, 100 - failCount * 30 - warnCount * 10);

  return { valid: failCount === 0, score, issues, timestamp: ts };
}

// ═══════════════════════════════════════════════════════════════
// 7. Aggregate Validation Report
// ═══════════════════════════════════════════════════════════════

export interface DataQualityReport {
  overallScore: number;     // Weighted average, 0-100
  quoteQuality: number;
  indicatorQuality: number;
  signalQuality: number;
  tradeQuality: number;
  crossSourceAgreement: number;
  totalIssues: number;
  failCount: number;
  warnCount: number;
  passedGate: boolean;      // true if overall score >= 60
  issues: ValidationIssue[];
  timestamp: number;
}

const MIN_DATA_QUALITY_SCORE = 60;

export function buildDataQualityReport(results: {
  quote?: ValidationResult;
  indicators?: IndicatorConsistencyResult;
  signals?: SignalValidation;
  trade?: TradeValidation;
  crossSource?: CrossValidationResult;
}): DataQualityReport {
  const allIssues: ValidationIssue[] = [];
  const scores: Array<{ score: number; weight: number }> = [];

  if (results.quote) {
    scores.push({ score: results.quote.score, weight: 3 });
    allIssues.push(...results.quote.issues);
  }
  if (results.indicators) {
    scores.push({ score: results.indicators.score, weight: 2 });
    allIssues.push(...results.indicators.issues);
  }
  if (results.signals) {
    scores.push({ score: results.signals.score, weight: 2 });
    allIssues.push(...results.signals.issues);
  }
  if (results.trade) {
    scores.push({ score: results.trade.score, weight: 3 });
    allIssues.push(...results.trade.issues);
  }
  if (results.crossSource) {
    scores.push({ score: results.crossSource.agreementScore, weight: 1 });
    allIssues.push(...results.crossSource.issues);
  }

  const totalWeight = scores.reduce((s, x) => s + x.weight, 0);
  const weightedSum = scores.reduce((s, x) => s + x.score * x.weight, 0);
  const overallScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

  const failCount = allIssues.filter(i => i.severity === 'FAIL').length;
  const warnCount = allIssues.filter(i => i.severity === 'WARN').length;

  return {
    overallScore,
    quoteQuality: results.quote?.score ?? -1,
    indicatorQuality: results.indicators?.score ?? -1,
    signalQuality: results.signals?.score ?? -1,
    tradeQuality: results.trade?.score ?? -1,
    crossSourceAgreement: results.crossSource?.agreementScore ?? -1,
    totalIssues: allIssues.length,
    failCount,
    warnCount,
    passedGate: overallScore >= MIN_DATA_QUALITY_SCORE && failCount === 0,
    issues: allIssues,
    timestamp: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function isMarketHours(): boolean {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcDay = now.getUTCDay();
  // US market hours: Mon-Fri, 13:30-20:00 UTC (9:30-16:00 ET)
  if (utcDay === 0 || utcDay === 6) return false;
  if (utcHour < 13 || utcHour >= 20) return false;
  if (utcHour === 13 && now.getUTCMinutes() < 30) return false;
  return true;
}

export function formatValidationReport(report: DataQualityReport): string {
  const status = report.passedGate ? '✅ PASSED' : '❌ BLOCKED';
  const lines = [
    `📊 <b>Data Quality: ${status}</b> (${report.overallScore}/100)`,
    '',
    `Quote: ${report.quoteQuality >= 0 ? report.quoteQuality + '/100' : 'N/A'}`,
    `Indicators: ${report.indicatorQuality >= 0 ? report.indicatorQuality + '/100' : 'N/A'}`,
    `Signals: ${report.signalQuality >= 0 ? report.signalQuality + '/100' : 'N/A'}`,
    `Trade: ${report.tradeQuality >= 0 ? report.tradeQuality + '/100' : 'N/A'}`,
    `Source Agreement: ${report.crossSourceAgreement >= 0 ? report.crossSourceAgreement + '/100' : 'N/A'}`,
  ];

  if (report.failCount > 0) {
    lines.push('');
    lines.push(`⛔ ${report.failCount} critical issue(s):`);
    for (const issue of report.issues.filter(i => i.severity === 'FAIL').slice(0, 5)) {
      lines.push(`  • ${issue.field}: ${issue.message}`);
    }
  }

  if (report.warnCount > 0) {
    lines.push(`⚠️ ${report.warnCount} warning(s)`);
  }

  return lines.join('\n');
}
