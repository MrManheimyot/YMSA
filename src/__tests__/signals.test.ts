import { describe, it, expect } from 'vitest';
import { detectSignals, calculateSignalScore } from '../analysis/signals';
import type { Env, StockQuote, TechnicalIndicator } from '../types';

const mockEnv = {
  RSI_OVERBOUGHT: '70',
  RSI_OVERSOLD: '30',
  ALERT_PROXIMITY_52W: '0.05',
  VOLUME_SPIKE_MULTIPLIER: '1.5',
  EMA_FAST: '50',
  EMA_SLOW: '200',
} as unknown as Env;

const baseQuote: StockQuote = {
  symbol: 'AAPL',
  price: 150,
  change: 2,
  changePercent: 1.35,
  volume: 50_000_000,
  avgVolume: 40_000_000,
  week52High: 180,
  week52Low: 120,
  timestamp: Date.now(),
};

describe('detectSignals', () => {
  it('returns empty array when no indicators', () => {
    const signals = detectSignals(baseQuote, [], null, mockEnv);
    expect(Array.isArray(signals)).toBe(true);
  });

  it('detects RSI oversold signal', () => {
    const indicators: TechnicalIndicator[] = [
      { symbol: 'AAPL', indicator: 'RSI', value: 25, timestamp: Date.now(), timeframe: 'daily' },
    ];
    const signals = detectSignals(baseQuote, indicators, null, mockEnv);
    const rsiSignal = signals.find((s) => s.type === 'RSI_OVERSOLD');
    expect(rsiSignal).toBeDefined();
    expect(rsiSignal!.priority).toBe('CRITICAL');
  });

  it('detects RSI overbought signal', () => {
    const indicators: TechnicalIndicator[] = [
      { symbol: 'AAPL', indicator: 'RSI', value: 78, timestamp: Date.now(), timeframe: 'daily' },
    ];
    const signals = detectSignals(baseQuote, indicators, null, mockEnv);
    const rsiSignal = signals.find((s) => s.type === 'RSI_OVERBOUGHT');
    expect(rsiSignal).toBeDefined();
    expect(rsiSignal!.priority).toBe('CRITICAL');
  });

  it('detects volume spike', () => {
    const quote = { ...baseQuote, volume: 80_000_000 };
    const signals = detectSignals(quote, [], null, mockEnv);
    const volumeSignal = signals.find((s) => s.type === 'VOLUME_SPIKE');
    expect(volumeSignal).toBeDefined();
  });

  it('detects 52-week high proximity', () => {
    const quote = { ...baseQuote, price: 177, week52High: 180, week52Low: 120 };
    const signals = detectSignals(quote, [], null, mockEnv);
    const highSignal = signals.find((s) => s.type === '52W_HIGH_PROXIMITY');
    expect(highSignal).toBeDefined();
  });
});

describe('calculateSignalScore', () => {
  it('returns 0 for no signals', () => {
    expect(calculateSignalScore([])).toBe(0);
  });

  it('returns higher score for critical signals', () => {
    const critSignals = detectSignals(
      baseQuote,
      [{ symbol: 'AAPL', indicator: 'RSI', value: 20, timestamp: Date.now(), timeframe: 'daily' }],
      null,
      mockEnv,
    );
    expect(calculateSignalScore(critSignals)).toBeGreaterThan(0);
  });
});
