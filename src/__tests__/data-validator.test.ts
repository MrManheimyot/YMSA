// ─── Cross-Validation Tests ──────────────────────────────────
import { describe, it, expect } from 'vitest';
import {
  validateQuote,
  validateIndicators,
  validateTradeParams,
  validateSignalConsistency,
  crossValidateQuotes,
  validateEnvThresholds,
  buildDataQualityReport,
} from '../utils/data-validator';
import type { StockQuote, TechnicalIndicator } from '../types';

// ═══════════════════════════════════════════════════════════════
// Quote Validation
// ═══════════════════════════════════════════════════════════════

describe('validateQuote', () => {
  const validQuote: StockQuote = {
    symbol: 'AAPL',
    price: 175.50,
    change: 2.30,
    changePercent: 1.33,
    volume: 55_000_000,
    avgVolume: 65_000_000,
    week52High: 199.62,
    week52Low: 124.17,
    timestamp: Date.now() - 5 * 60 * 1000, // 5 min ago
  };

  it('passes valid quote', () => {
    const result = validateQuote(validQuote);
    expect(result.valid).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it('fails null quote', () => {
    const result = validateQuote(null);
    expect(result.valid).toBe(false);
    expect(result.score).toBe(0);
  });

  it('fails NaN price', () => {
    const result = validateQuote({ ...validQuote, price: NaN });
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.field === 'price' && i.severity === 'FAIL')).toBe(true);
  });

  it('fails negative price', () => {
    const result = validateQuote({ ...validQuote, price: -5 });
    expect(result.valid).toBe(false);
  });

  it('warns on zero volume', () => {
    const result = validateQuote({ ...validQuote, volume: 0 });
    expect(result.valid).toBe(true); // Warn, not fail
    expect(result.issues.some(i => i.field === 'volume' && i.severity === 'WARN')).toBe(true);
  });

  it('fails when 52W low > 52W high', () => {
    const result = validateQuote({ ...validQuote, week52Low: 200, week52High: 100 });
    expect(result.valid).toBe(false);
  });

  it('warns on missing avgVolume', () => {
    const result = validateQuote({ ...validQuote, avgVolume: 0 });
    expect(result.issues.some(i => i.field === 'avgVolume')).toBe(true);
  });

  it('fails future timestamp', () => {
    const result = validateQuote({ ...validQuote, timestamp: Date.now() + 60_000 });
    expect(result.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Indicator Validation
// ═══════════════════════════════════════════════════════════════

describe('validateIndicators', () => {
  const validIndicators: TechnicalIndicator[] = [
    { symbol: 'AAPL', indicator: 'RSI', value: 55, timestamp: Date.now(), timeframe: 'daily' },
    { symbol: 'AAPL', indicator: 'ATR', value: 3.5, timestamp: Date.now(), timeframe: 'daily' },
    { symbol: 'AAPL', indicator: 'MACD', value: 0.5, timestamp: Date.now(), timeframe: 'daily' },
    { symbol: 'AAPL', indicator: 'MACD_SIGNAL', value: 0.3, timestamp: Date.now(), timeframe: 'daily' },
    { symbol: 'AAPL', indicator: 'MACD_HISTOGRAM', value: 0.2, timestamp: Date.now(), timeframe: 'daily' },
    { symbol: 'AAPL', indicator: 'EMA_50', value: 170, timestamp: Date.now(), timeframe: 'daily' },
    { symbol: 'AAPL', indicator: 'EMA_200', value: 165, timestamp: Date.now(), timeframe: 'daily' },
    { symbol: 'AAPL', indicator: 'ADX', value: 25, timestamp: Date.now(), timeframe: 'daily' },
    { symbol: 'AAPL', indicator: 'SMA_50', value: 171, timestamp: Date.now(), timeframe: 'daily' },
    { symbol: 'AAPL', indicator: 'SMA_200', value: 166, timestamp: Date.now(), timeframe: 'daily' },
  ];

  it('passes valid indicator set', () => {
    const result = validateIndicators(validIndicators, 'AAPL');
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.missingCritical).toHaveLength(0);
  });

  it('fails when RSI is out of range', () => {
    const bad = validIndicators.map(i => i.indicator === 'RSI' ? { ...i, value: 150 } : i);
    const result = validateIndicators(bad, 'AAPL');
    expect(result.issues.some(i => i.field === 'RSI' && i.severity === 'FAIL')).toBe(true);
  });

  it('fails negative ATR', () => {
    const bad = validIndicators.map(i => i.indicator === 'ATR' ? { ...i, value: -1 } : i);
    const result = validateIndicators(bad, 'AAPL');
    expect(result.issues.some(i => i.field === 'ATR' && i.severity === 'FAIL')).toBe(true);
  });

  it('reports missing critical indicators', () => {
    const partial = validIndicators.filter(i => i.indicator !== 'RSI');
    const result = validateIndicators(partial, 'AAPL');
    expect(result.missingCritical).toContain('RSI');
  });

  it('detects MACD histogram inconsistency', () => {
    const bad = validIndicators.map(i => i.indicator === 'MACD_HISTOGRAM' ? { ...i, value: 5.0 } : i);
    const result = validateIndicators(bad, 'AAPL');
    expect(result.issues.some(i => i.field === 'MACD_CONSISTENCY')).toBe(true);
  });

  it('warns on NaN indicator value', () => {
    const bad = [...validIndicators, { symbol: 'AAPL', indicator: 'RSI' as const, value: NaN, timestamp: Date.now(), timeframe: 'daily' as const }];
    const result = validateIndicators(bad, 'AAPL');
    expect(result.issues.some(i => i.severity === 'FAIL' && i.message.includes('NaN'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Trade Parameter Validation
// ═══════════════════════════════════════════════════════════════

describe('validateTradeParams', () => {
  it('passes valid BUY trade', () => {
    const result = validateTradeParams({
      entry: 175,
      stopLoss: 170,
      tp1: 190,
      direction: 'BUY',
      confidence: 90,
      atr: 3.5,
    });
    expect(result.valid).toBe(true);
    expect(result.riskReward).toBe(3); // 15/5
  });

  it('passes valid SELL trade', () => {
    const result = validateTradeParams({
      entry: 175,
      stopLoss: 180,
      tp1: 160,
      direction: 'SELL',
      confidence: 88,
      atr: 3.5,
    });
    expect(result.valid).toBe(true);
    expect(result.riskReward).toBe(3); // 15/5
  });

  it('fails BUY with stop above entry', () => {
    const result = validateTradeParams({
      entry: 175,
      stopLoss: 180,
      tp1: 190,
      direction: 'BUY',
      confidence: 90,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.field === 'stopLoss')).toBe(true);
  });

  it('fails R:R below 2.0', () => {
    const result = validateTradeParams({
      entry: 175,
      stopLoss: 165,
      tp1: 180,
      direction: 'BUY',
      confidence: 90,
    });
    expect(result.valid).toBe(false);
    expect(result.riskReward).toBe(0.5); // 5/10
    expect(result.issues.some(i => i.field === 'riskReward')).toBe(true);
  });

  it('fails low confidence', () => {
    const result = validateTradeParams({
      entry: 175,
      stopLoss: 170,
      tp1: 190,
      direction: 'BUY',
      confidence: 60,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.field === 'confidence')).toBe(true);
  });

  it('warns on very wide stop', () => {
    const result = validateTradeParams({
      entry: 175,
      stopLoss: 140,
      tp1: 250,
      direction: 'BUY',
      confidence: 90,
      atr: 3.5,
    });
    expect(result.issues.some(i => i.field === 'stopDistance' || i.field === 'stopLoss')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Signal Consistency
// ═══════════════════════════════════════════════════════════════

describe('validateSignalConsistency', () => {
  it('passes unanimous BUY signals', () => {
    const result = validateSignalConsistency([
      { direction: 'BUY', confidence: 80, engine: 'SMC' },
      { direction: 'BUY', confidence: 75, engine: 'MTF' },
    ]);
    expect(result.valid).toBe(true);
    expect(result.direction).toBe('BUY');
    expect(result.conflictLevel).toBe('NONE');
  });

  it('detects major conflict', () => {
    const result = validateSignalConsistency([
      { direction: 'BUY', confidence: 80, engine: 'SMC' },
      { direction: 'SELL', confidence: 75, engine: 'MTF' },
    ]);
    expect(result.conflictLevel).toBe('MAJOR');
    expect(result.valid).toBe(false);
  });

  it('detects counter-trend', () => {
    const result = validateSignalConsistency(
      [{ direction: 'BUY', confidence: 80, engine: 'SMC' }],
      { regime: 'TRENDING_DOWN', confidence: 80 },
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.field === 'regime')).toBe(true);
  });

  it('handles empty signals', () => {
    const result = validateSignalConsistency([]);
    expect(result.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Cross-Source Validation
// ═══════════════════════════════════════════════════════════════

describe('crossValidateQuotes', () => {
  const baseQuote: StockQuote = {
    symbol: 'AAPL',
    price: 175.50,
    change: 0,
    changePercent: 0,
    volume: 50_000_000,
    avgVolume: 60_000_000,
    week52High: 199,
    week52Low: 124,
    timestamp: Date.now(),
  };

  it('agrees when sources match closely', () => {
    const result = crossValidateQuotes([
      { quote: { ...baseQuote, price: 175.50 }, source: 'yahoo' },
      { quote: { ...baseQuote, price: 175.60 }, source: 'finnhub' },
    ]);
    expect(result.agreementScore).toBeGreaterThan(80);
    expect(result.validSources).toBe(2);
    expect(result.bestQuote).not.toBeNull();
  });

  it('detects major price deviation', () => {
    const result = crossValidateQuotes([
      { quote: { ...baseQuote, price: 175 }, source: 'yahoo' },
      { quote: { ...baseQuote, price: 180 }, source: 'finnhub' },
    ]);
    expect(result.priceDeviation).toBeGreaterThan(1);
    expect(result.issues.some(i => i.severity === 'FAIL')).toBe(true);
  });

  it('handles single source', () => {
    const result = crossValidateQuotes([
      { quote: baseQuote, source: 'yahoo' },
    ]);
    expect(result.agreementScore).toBe(50);
    expect(result.issues.some(i => i.message.includes('one source'))).toBe(true);
  });

  it('handles no valid sources', () => {
    const result = crossValidateQuotes([
      { quote: { ...baseQuote, price: 0 }, source: 'yahoo' },
    ]);
    expect(result.agreementScore).toBe(0);
    expect(result.bestQuote).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// Environment Validation
// ═══════════════════════════════════════════════════════════════

describe('validateEnvThresholds', () => {
  const validEnv: Record<string, string> = {
    RSI_OVERBOUGHT: '70',
    RSI_OVERSOLD: '30',
    EMA_FAST: '9',
    EMA_SLOW: '21',
    ALERT_PROXIMITY_52W: '2',
    VOLUME_SPIKE_MULTIPLIER: '2',
  };

  it('passes valid environment', () => {
    const result = validateEnvThresholds(validEnv);
    expect(result.valid).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it('fails missing RSI_OVERBOUGHT', () => {
    const { RSI_OVERBOUGHT, ...missing } = validEnv;
    const result = validateEnvThresholds(missing);
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.field === 'RSI_OVERBOUGHT')).toBe(true);
  });

  it('fails when RSI_OVERSOLD > RSI_OVERBOUGHT', () => {
    const result = validateEnvThresholds({ ...validEnv, RSI_OVERSOLD: '80', RSI_OVERBOUGHT: '30' });
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.field === 'RSI_THRESHOLDS')).toBe(true);
  });

  it('fails when EMA_FAST >= EMA_SLOW', () => {
    const result = validateEnvThresholds({ ...validEnv, EMA_FAST: '50', EMA_SLOW: '21' });
    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.field === 'EMA_PERIODS')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Data Quality Report
// ═══════════════════════════════════════════════════════════════

describe('buildDataQualityReport', () => {
  it('passes when all components are healthy', () => {
    const report = buildDataQualityReport({
      quote: { valid: true, score: 90, issues: [], timestamp: Date.now() },
      indicators: { symbol: 'AAPL', score: 85, issues: [], missingCritical: [], availableIndicators: [] },
      signals: { valid: true, score: 80, direction: 'BUY', bullishCount: 2, bearishCount: 0, conflictLevel: 'NONE', issues: [] },
      trade: { valid: true, score: 95, riskReward: 2.5, issues: [] },
    });
    expect(report.passedGate).toBe(true);
    expect(report.overallScore).toBeGreaterThanOrEqual(60);
    expect(report.failCount).toBe(0);
  });

  it('blocks when trade validation fails', () => {
    const report = buildDataQualityReport({
      trade: { valid: false, score: 20, riskReward: 0.8, issues: [{ field: 'riskReward', message: 'R:R 0.8 < 2.0', severity: 'FAIL' }] },
    });
    expect(report.passedGate).toBe(false);
    expect(report.failCount).toBe(1);
  });

  it('reflects weighted scoring', () => {
    const report = buildDataQualityReport({
      quote: { valid: true, score: 100, issues: [], timestamp: Date.now() },
      trade: { valid: true, score: 50, riskReward: 2.1, issues: [{ field: 'rr', message: 'marginal', severity: 'WARN' }] },
    });
    // Quote weight=3, trade weight=3 → (100*3 + 50*3) / 6 = 75
    expect(report.overallScore).toBe(75);
  });
});
