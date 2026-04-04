// ─── Quote & Indicator Validators ─────────────────────────────

import type { StockQuote, TechnicalIndicator, IndicatorType } from '../../types';
import type { ValidationIssue, ValidationResult, CrossValidationResult, IndicatorConsistencyResult } from './types';
import {
  MAX_QUOTE_AGE_MS, MAX_AFTER_HOURS_AGE_MS,
  MAX_PRICE_DEVIATION_PCT, WARN_PRICE_DEVIATION_PCT,
  MIN_STOCK_PRICE, MAX_STOCK_PRICE, MIN_VOLUME, MAX_VOLUME,
  RSI_MIN, RSI_MAX, ATR_MAX_PCT_OF_PRICE,
  REQUIRED_INDICATORS, DESIRABLE_INDICATORS,
  isMarketHours,
} from './types';

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

    if (isNaN(ind.value)) {
      issues.push({ field: ind.indicator, message: `${ind.indicator} value is NaN`, severity: 'FAIL', value: ind.value });
      continue;
    }

    if (ind.indicator === 'RSI') {
      if (ind.value < RSI_MIN || ind.value > RSI_MAX) {
        issues.push({ field: 'RSI', message: `RSI ${ind.value} outside valid range [0, 100]`, severity: 'FAIL', value: ind.value });
      }
    }

    if (ind.indicator === 'ADX') {
      if (ind.value < 0 || ind.value > 100) {
        issues.push({ field: 'ADX', message: `ADX ${ind.value} outside valid range [0, 100]`, severity: 'FAIL', value: ind.value });
      }
    }

    if (ind.indicator === 'ATR') {
      if (ind.value <= 0) {
        issues.push({ field: 'ATR', message: `ATR ${ind.value} must be positive`, severity: 'FAIL', value: ind.value });
      }
    }

    if (ind.indicator.startsWith('EMA_') || ind.indicator.startsWith('SMA_')) {
      if (ind.value <= 0) {
        issues.push({ field: ind.indicator, message: `${ind.indicator} ${ind.value} must be positive`, severity: 'WARN', value: ind.value });
      }
    }
  }

  const missingCritical: IndicatorType[] = [];
  for (const req of REQUIRED_INDICATORS) {
    if (!available.has(req)) {
      missingCritical.push(req);
      issues.push({ field: req, message: `Required indicator ${req} missing — signals may be unreliable`, severity: 'FAIL' });
    }
  }

  for (const des of DESIRABLE_INDICATORS) {
    if (!available.has(des)) {
      issues.push({ field: des, message: `Desirable indicator ${des} missing — reduced analysis quality`, severity: 'WARN' });
    }
  }

  const ema50 = indicators.find(i => i.indicator === 'EMA_50');
  const ema200 = indicators.find(i => i.indicator === 'EMA_200');
  if (ema50 && ema200 && ema50.value > 0 && ema200.value > 0) {
    const spreadPct = Math.abs(ema50.value - ema200.value) / ema200.value * 100;
    if (spreadPct > 30) {
      issues.push({ field: 'EMA_SPREAD', message: `EMA50/EMA200 spread ${spreadPct.toFixed(1)}% is unusually wide — check data quality`, severity: 'WARN', value: spreadPct });
    }
  }

  const macd = indicators.find(i => i.indicator === 'MACD');
  const macdSignal = indicators.find(i => i.indicator === 'MACD_SIGNAL');
  const macdHist = indicators.find(i => i.indicator === 'MACD_HISTOGRAM');
  if (macd && macdSignal && macdHist) {
    const expectedHist = macd.value - macdSignal.value;
    if (Math.abs(expectedHist - macdHist.value) > 0.01) {
      issues.push({ field: 'MACD_CONSISTENCY', message: `MACD histogram ${macdHist.value.toFixed(4)} doesn't match MACD-Signal (${expectedHist.toFixed(4)})`, severity: 'WARN', value: { macd: macd.value, signal: macdSignal.value, hist: macdHist.value } });
    }
  }

  const atr = indicators.find(i => i.indicator === 'ATR');
  if (atr && atr.value > 0) {
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
      agreementScore: 50,
      priceDeviation: 0,
      validSources: 1,
      totalSources: quotes.length,
      bestQuote: validQuotes[0].quote,
      issues: [{ field: 'sources', message: 'Only one source available — cannot cross-validate', severity: 'WARN' }],
    };
  }

  const prices = validQuotes.map(q => q.quote.price);
  const meanPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const deviations = prices.map(p => Math.abs(p - meanPrice) / meanPrice * 100);
  const maxDeviation = Math.max(...deviations);

  const issues: ValidationIssue[] = [];

  if (maxDeviation > MAX_PRICE_DEVIATION_PCT) {
    issues.push({ field: 'price', message: `Price deviation ${maxDeviation.toFixed(2)}% across sources exceeds ${MAX_PRICE_DEVIATION_PCT}% threshold`, severity: 'FAIL', value: { prices: validQuotes.map(q => ({ source: q.source, price: q.quote.price })) } });
  } else if (maxDeviation > WARN_PRICE_DEVIATION_PCT) {
    issues.push({ field: 'price', message: `Price deviation ${maxDeviation.toFixed(2)}% across sources`, severity: 'WARN', value: { prices: validQuotes.map(q => ({ source: q.source, price: q.quote.price })) } });
  }

  const sorted = [...validQuotes].sort((a, b) => b.quote.timestamp - a.quote.timestamp);
  const bestQuote = sorted[0].quote;
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
