// ─── Information Reliability Agent Tests ──────────────────────
import { describe, it, expect, beforeEach } from 'vitest';
import {
  assessReliability,
  formatForZAi,
  getReliabilityStats,
  resetReliabilityStats,
} from '../agents/reliability/engine';
import {
  quoteToObservation,
  indicatorsToObservation,
  engineOutputToObservation,
  sentimentToObservation,
  rssToObservation,
  collectObservations,
} from '../agents/reliability/collector';
import { SOURCE_PROFILES, TRUST_WEIGHTS, TRUST_THRESHOLDS } from '../agents/reliability/config';
import type { SourceObservation, DataSourceId } from '../agents/reliability/types';
import type { StockQuote, TechnicalIndicator } from '../types';

// ═══════════════════════════════════════════════════════════════
// Helper factories
// ═══════════════════════════════════════════════════════════════

function makeObs(overrides: Partial<SourceObservation> & { sourceId: DataSourceId; symbol: string }): SourceObservation {
  return {
    timestamp: Date.now(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// 1. Configuration Tests
// ═══════════════════════════════════════════════════════════════

describe('Reliability Agent — Configuration', () => {
  it('trust weights sum to 1.0', () => {
    const sum = TRUST_WEIGHTS.freshness + TRUST_WEIGHTS.agreement + TRUST_WEIGHTS.provenance;
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('all source profiles have valid tier (1-3)', () => {
    for (const [id, profile] of Object.entries(SOURCE_PROFILES)) {
      expect(profile.tier).toBeGreaterThanOrEqual(1);
      expect(profile.tier).toBeLessThanOrEqual(3);
      expect(profile.baseReliability).toBeGreaterThanOrEqual(0);
      expect(profile.baseReliability).toBeLessThanOrEqual(100);
      expect(profile.id).toBe(id);
    }
  });

  it('trust thresholds are ordered correctly', () => {
    expect(TRUST_THRESHOLDS.VERY_HIGH).toBeGreaterThan(TRUST_THRESHOLDS.HIGH);
    expect(TRUST_THRESHOLDS.HIGH).toBeGreaterThan(TRUST_THRESHOLDS.MEDIUM);
    expect(TRUST_THRESHOLDS.MEDIUM).toBeGreaterThan(TRUST_THRESHOLDS.LOW);
  });

  it('covers all 16 data sources', () => {
    expect(Object.keys(SOURCE_PROFILES).length).toBe(16);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. Collector Tests
// ═══════════════════════════════════════════════════════════════

describe('Reliability Agent — Collector', () => {
  it('converts StockQuote to observation', () => {
    const quote: StockQuote = {
      symbol: 'AAPL', price: 175.50, change: 2.30, changePercent: 1.33,
      volume: 55_000_000, avgVolume: 65_000_000,
      week52High: 199.62, week52Low: 124.17, timestamp: Date.now(),
    };
    const obs = quoteToObservation(quote, 'YAHOO_FINANCE');
    expect(obs.sourceId).toBe('YAHOO_FINANCE');
    expect(obs.symbol).toBe('AAPL');
    expect(obs.price).toBe(175.50);
    expect(obs.direction).toBe('BULLISH'); // +1.33%
  });

  it('detects bearish direction from negative change', () => {
    const quote: StockQuote = {
      symbol: 'TSLA', price: 200, change: -5, changePercent: -2.5,
      volume: 50_000_000, avgVolume: 40_000_000,
      week52High: 300, week52Low: 150, timestamp: Date.now(),
    };
    const obs = quoteToObservation(quote, 'TRADINGVIEW');
    expect(obs.direction).toBe('BEARISH');
  });

  it('converts indicators to observation', () => {
    const indicators: TechnicalIndicator[] = [
      { indicator: 'RSI', value: 25, signal: 1, symbol: 'AAPL', timestamp: Date.now(), timeframe: 'daily' },
      { indicator: 'MACD', value: -0.5, signal: -1, symbol: 'AAPL', timestamp: Date.now(), timeframe: 'daily' },
    ];
    const obs = indicatorsToObservation('AAPL', indicators);
    expect(obs.sourceId).toBe('LOCAL_INDICATORS');
    expect(obs.indicators?.RSI).toBe(25);
    expect(obs.indicators?.MACD).toBe(-0.5);
    // RSI oversold (bullish) + MACD negative (bearish) = tie → NEUTRAL
    expect(obs.direction).toBe('NEUTRAL');
  });

  it('converts engine output to observation', () => {
    const obs = engineOutputToObservation('NVDA', 'BUY', 85, 'MTF_MOMENTUM');
    expect(obs.sourceId).toBe('LOCAL_INDICATORS');
    expect(obs.direction).toBe('BULLISH');
    expect(obs.confidence).toBe(85);
  });

  it('converts sentiment to observation', () => {
    const obs = sentimentToObservation('AAPL', 'BULLISH', 75, 'STOCKTWITS');
    expect(obs.sentiment).toBe('BULLISH');
    expect(obs.sentimentScore).toBe(75);
  });

  it('converts RSS to observation with metadata', () => {
    const obs = rssToObservation('MSFT', 'MSFT beats earnings', 'BULLISH', 80, Date.now() - 3600_000);
    expect(obs.sourceId).toBe('RSS_FEED');
    expect(obs.raw).toBe('MSFT beats earnings');
    expect(obs.direction).toBe('BULLISH');
  });

  it('collectObservations bundles all sources', () => {
    const bundle = {
      symbol: 'AAPL',
      quotes: [{ quote: { symbol: 'AAPL', price: 175, change: 1, changePercent: 0.5, volume: 50e6, avgVolume: 60e6, week52High: 200, week52Low: 120, timestamp: Date.now() } as StockQuote, source: 'YAHOO_FINANCE' as DataSourceId }],
      indicators: [{ indicator: 'RSI' as const, value: 45, signal: 0, symbol: 'AAPL', timestamp: Date.now(), timeframe: 'daily' as const }],
      engineDirections: [{ direction: 'BUY' as const, confidence: 75, engineId: 'MTF_MOMENTUM' }],
      sentiments: [{ sentiment: 'BULLISH' as const, score: 60, source: 'STOCKTWITS' as DataSourceId }],
      rssItems: [{ headline: 'AAPL up', sentiment: 'BULLISH' as const, confidence: 70, publishedAt: Date.now() }],
    };
    const obs = collectObservations(bundle);
    expect(obs.length).toBe(5); // 1 quote + 1 indicator + 1 engine + 1 sentiment + 1 rss
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. Core Engine — Freshness Tests
// ═══════════════════════════════════════════════════════════════

describe('Reliability Agent — Freshness Scoring', () => {
  it('gives high score to fresh data', () => {
    const obs: SourceObservation[] = [
      makeObs({ sourceId: 'YAHOO_FINANCE', symbol: 'AAPL', price: 175, timestamp: Date.now(), dataTimestamp: Date.now() }),
    ];
    const verdict = assessReliability('AAPL', obs);
    const yahooScore = verdict.sourceScores.find(s => s.sourceId === 'YAHOO_FINANCE');
    expect(yahooScore?.freshnessScore).toBeGreaterThanOrEqual(90);
  });

  it('degrades score for stale data (30 min old)', () => {
    const obs: SourceObservation[] = [
      makeObs({ sourceId: 'YAHOO_FINANCE', symbol: 'AAPL', price: 175, timestamp: Date.now(), dataTimestamp: Date.now() - 30 * 60 * 1000 }),
    ];
    const verdict = assessReliability('AAPL', obs);
    const yahooScore = verdict.sourceScores.find(s => s.sourceId === 'YAHOO_FINANCE');
    expect(yahooScore?.freshnessScore).toBeLessThan(10);
  });

  it('gives 0 freshness to extremely stale data (4h+)', () => {
    const obs: SourceObservation[] = [
      makeObs({ sourceId: 'YAHOO_FINANCE', symbol: 'AAPL', price: 175, timestamp: Date.now(), dataTimestamp: Date.now() - 4 * 60 * 60 * 1000 }),
    ];
    const verdict = assessReliability('AAPL', obs);
    const yahooScore = verdict.sourceScores.find(s => s.sourceId === 'YAHOO_FINANCE');
    expect(yahooScore?.freshnessScore).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. Core Engine — Agreement Tests
// ═══════════════════════════════════════════════════════════════

describe('Reliability Agent — Agreement Scoring', () => {
  it('high agreement when prices match closely', () => {
    const now = Date.now();
    const obs: SourceObservation[] = [
      makeObs({ sourceId: 'YAHOO_FINANCE', symbol: 'AAPL', price: 175.50, timestamp: now, dataTimestamp: now }),
      makeObs({ sourceId: 'TRADINGVIEW', symbol: 'AAPL', price: 175.55, timestamp: now, dataTimestamp: now }),
    ];
    const verdict = assessReliability('AAPL', obs);
    const yahooScore = verdict.sourceScores.find(s => s.sourceId === 'YAHOO_FINANCE');
    expect(yahooScore?.agreementScore).toBeGreaterThanOrEqual(90);
  });

  it('low agreement when prices diverge significantly', () => {
    const now = Date.now();
    const obs: SourceObservation[] = [
      makeObs({ sourceId: 'YAHOO_FINANCE', symbol: 'AAPL', price: 175.50, timestamp: now, dataTimestamp: now }),
      makeObs({ sourceId: 'TRADINGVIEW', symbol: 'AAPL', price: 180.00, timestamp: now, dataTimestamp: now }),
    ];
    const verdict = assessReliability('AAPL', obs);
    const yahooScore = verdict.sourceScores.find(s => s.sourceId === 'YAHOO_FINANCE');
    expect(yahooScore?.agreementScore).toBeLessThan(50);
  });

  it('direction agreement among multiple sources', () => {
    const now = Date.now();
    const obs: SourceObservation[] = [
      makeObs({ sourceId: 'YAHOO_FINANCE', symbol: 'AAPL', direction: 'BULLISH', timestamp: now }),
      makeObs({ sourceId: 'TRADINGVIEW', symbol: 'AAPL', direction: 'BULLISH', timestamp: now }),
      makeObs({ sourceId: 'STOCKTWITS', symbol: 'AAPL', direction: 'BULLISH', timestamp: now }),
    ];
    const verdict = assessReliability('AAPL', obs);
    expect(verdict.directionConsensus.consensusDirection).toBe('BULLISH');
    expect(verdict.directionConsensus.consensusStrength).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. Contradiction Detection
// ═══════════════════════════════════════════════════════════════

describe('Reliability Agent — Contradiction Detection', () => {
  it('detects price divergence between sources', () => {
    const now = Date.now();
    const obs: SourceObservation[] = [
      makeObs({ sourceId: 'YAHOO_FINANCE', symbol: 'AAPL', price: 175.00, timestamp: now, dataTimestamp: now }),
      makeObs({ sourceId: 'FINNHUB', symbol: 'AAPL', price: 178.50, timestamp: now, dataTimestamp: now }),
    ];
    const verdict = assessReliability('AAPL', obs);
    const priceContra = verdict.contradictions.find(c => c.type === 'PRICE_DIVERGENCE');
    expect(priceContra).toBeDefined();
    expect(priceContra!.severity).toBe('MEDIUM'); // ~2% gap → MEDIUM threshold
  });

  it('detects direction conflict', () => {
    const now = Date.now();
    const obs: SourceObservation[] = [
      makeObs({ sourceId: 'YAHOO_FINANCE', symbol: 'AAPL', direction: 'BULLISH', timestamp: now }),
      makeObs({ sourceId: 'TRADINGVIEW', symbol: 'AAPL', direction: 'BULLISH', timestamp: now }),
      makeObs({ sourceId: 'RSS_FEED', symbol: 'AAPL', direction: 'BEARISH', timestamp: now }),
    ];
    const verdict = assessReliability('AAPL', obs);
    const dirContra = verdict.contradictions.find(c => c.type === 'DIRECTION_CONFLICT');
    expect(dirContra).toBeDefined();
    expect(dirContra!.resolution).toBe('TRUST_A'); // majority wins
  });

  it('detects stale vs fresh conflict', () => {
    const now = Date.now();
    const obs: SourceObservation[] = [
      makeObs({ sourceId: 'YAHOO_FINANCE', symbol: 'AAPL', direction: 'BULLISH', timestamp: now, dataTimestamp: now - 1 * 60 * 1000 }),
      makeObs({ sourceId: 'RSS_FEED', symbol: 'AAPL', direction: 'BEARISH', timestamp: now, dataTimestamp: now - 45 * 60 * 1000 }),
    ];
    const verdict = assessReliability('AAPL', obs);
    const staleContra = verdict.contradictions.find(c => c.type === 'STALE_VS_FRESH');
    expect(staleContra).toBeDefined();
    expect(staleContra!.resolution).toBe('TRUST_A');
  });

  it('no contradictions when sources agree', () => {
    const now = Date.now();
    const obs: SourceObservation[] = [
      makeObs({ sourceId: 'YAHOO_FINANCE', symbol: 'AAPL', price: 175.50, direction: 'BULLISH', timestamp: now, dataTimestamp: now }),
      makeObs({ sourceId: 'TRADINGVIEW', symbol: 'AAPL', price: 175.55, direction: 'BULLISH', timestamp: now, dataTimestamp: now }),
    ];
    const verdict = assessReliability('AAPL', obs);
    expect(verdict.contradictions.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. Trust Score Computation
// ═══════════════════════════════════════════════════════════════

describe('Reliability Agent — Trust Score', () => {
  beforeEach(() => resetReliabilityStats());

  it('VERY_HIGH trust for perfect data', () => {
    const now = Date.now();
    const obs: SourceObservation[] = [
      makeObs({ sourceId: 'YAHOO_FINANCE', symbol: 'AAPL', price: 175.50, direction: 'BULLISH', timestamp: now, dataTimestamp: now }),
      makeObs({ sourceId: 'TRADINGVIEW', symbol: 'AAPL', price: 175.55, direction: 'BULLISH', timestamp: now, dataTimestamp: now }),
      makeObs({ sourceId: 'LOCAL_INDICATORS', symbol: 'AAPL', direction: 'BULLISH', timestamp: now, dataTimestamp: now }),
    ];
    const verdict = assessReliability('AAPL', obs);
    expect(verdict.trustScore).toBeGreaterThanOrEqual(TRUST_THRESHOLDS.HIGH);
    expect(verdict.trustTier === 'VERY_HIGH' || verdict.trustTier === 'HIGH').toBe(true);
    expect(verdict.confidenceMultiplier).toBeGreaterThanOrEqual(1.0);
  });

  it('LOW trust for conflicting stale data', () => {
    const now = Date.now();
    const obs: SourceObservation[] = [
      makeObs({ sourceId: 'YAHOO_FINANCE', symbol: 'AAPL', price: 175.50, direction: 'BULLISH', timestamp: now, dataTimestamp: now - 60 * 60 * 1000 }),
      makeObs({ sourceId: 'FINNHUB', symbol: 'AAPL', price: 170.00, direction: 'BEARISH', timestamp: now, dataTimestamp: now - 120 * 60 * 1000 }),
    ];
    const verdict = assessReliability('AAPL', obs);
    expect(verdict.trustScore).toBeLessThan(TRUST_THRESHOLDS.HIGH);
    expect(verdict.confidenceMultiplier).toBeLessThan(1.0);
  });

  it('applies confidence multiplier based on trust tier', () => {
    const now = Date.now();
    // Single stale observation should get moderate trust
    const obs: SourceObservation[] = [
      makeObs({ sourceId: 'STOCKTWITS', symbol: 'MEME', direction: 'BULLISH', timestamp: now, dataTimestamp: now - 20 * 60 * 1000 }),
    ];
    const verdict = assessReliability('MEME', obs);
    expect(verdict.confidenceMultiplier).toBeLessThanOrEqual(1.0);
  });

  it('handles empty observations gracefully', () => {
    const verdict = assessReliability('NONE', []);
    expect(verdict.trustScore).toBe(0);
    expect(verdict.trustTier).toBe('UNTRUSTED');
    expect(verdict.confidenceMultiplier).toBe(0.50);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. Recency Assessment
// ═══════════════════════════════════════════════════════════════

describe('Reliability Agent — Recency Assessment', () => {
  it('all fresh when data is recent', () => {
    const now = Date.now();
    const obs: SourceObservation[] = [
      makeObs({ sourceId: 'YAHOO_FINANCE', symbol: 'AAPL', timestamp: now, dataTimestamp: now - 60_000 }),
      makeObs({ sourceId: 'TRADINGVIEW', symbol: 'AAPL', timestamp: now, dataTimestamp: now - 30_000 }),
    ];
    const verdict = assessReliability('AAPL', obs);
    expect(verdict.recency.allFresh).toBe(true);
    expect(verdict.recency.staleCount).toBe(0);
  });

  it('detects stale sources', () => {
    const now = Date.now();
    const obs: SourceObservation[] = [
      makeObs({ sourceId: 'YAHOO_FINANCE', symbol: 'AAPL', timestamp: now, dataTimestamp: now - 60_000 }),
      makeObs({ sourceId: 'RSS_FEED', symbol: 'AAPL', timestamp: now, dataTimestamp: now - 30 * 60 * 1000 }),
    ];
    const verdict = assessReliability('AAPL', obs);
    expect(verdict.recency.allFresh).toBe(false);
    expect(verdict.recency.staleCount).toBe(1);
    expect(verdict.recency.staleSources).toContain('RSS_FEED');
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. Z.AI Integration Format
// ═══════════════════════════════════════════════════════════════

describe('Reliability Agent — Z.AI Format', () => {
  it('produces structured prompt injection text', () => {
    const now = Date.now();
    const obs: SourceObservation[] = [
      makeObs({ sourceId: 'YAHOO_FINANCE', symbol: 'AAPL', price: 175.50, direction: 'BULLISH', timestamp: now, dataTimestamp: now }),
      makeObs({ sourceId: 'TRADINGVIEW', symbol: 'AAPL', price: 175.55, direction: 'BULLISH', timestamp: now, dataTimestamp: now }),
    ];
    const verdict = assessReliability('AAPL', obs);
    const formatted = formatForZAi(verdict);

    expect(formatted).toContain('INFORMATION RELIABILITY ASSESSMENT');
    expect(formatted).toContain('Trust Score:');
    expect(formatted).toContain('Confidence Multiplier:');
    expect(formatted).toContain('Direction Consensus:');
    expect(formatted).toContain('Most Trusted:');
  });

  it('includes contradiction details in Z.AI prompt', () => {
    const now = Date.now();
    const obs: SourceObservation[] = [
      makeObs({ sourceId: 'YAHOO_FINANCE', symbol: 'AAPL', direction: 'BULLISH', timestamp: now }),
      makeObs({ sourceId: 'RSS_FEED', symbol: 'AAPL', direction: 'BEARISH', timestamp: now }),
    ];
    const verdict = assessReliability('AAPL', obs);
    const formatted = formatForZAi(verdict);
    if (verdict.contradictions.length > 0) {
      expect(formatted).toContain('Contradictions');
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. Agent Stats Tracking
// ═══════════════════════════════════════════════════════════════

describe('Reliability Agent — Stats', () => {
  it('tracks assessment count and average trust', () => {
    resetReliabilityStats();
    const now = Date.now();
    const obs: SourceObservation[] = [
      makeObs({ sourceId: 'YAHOO_FINANCE', symbol: 'AAPL', price: 175.50, direction: 'BULLISH', timestamp: now, dataTimestamp: now }),
    ];
    assessReliability('AAPL', obs);
    assessReliability('AAPL', obs);
    const stats = getReliabilityStats();
    expect(stats.totalAssessments).toBe(2);
    expect(stats.avgTrustScore).toBeGreaterThan(0);
  });

  it('resets stats correctly', () => {
    resetReliabilityStats();
    const stats = getReliabilityStats();
    expect(stats.totalAssessments).toBe(0);
    expect(stats.avgTrustScore).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 10. Stress & Edge Cases
// ═══════════════════════════════════════════════════════════════

describe('Reliability Agent — Stress & Edge Cases', () => {
  it('handles single observation (no cross-validation possible)', () => {
    const now = Date.now();
    const obs: SourceObservation[] = [
      makeObs({ sourceId: 'YAHOO_FINANCE', symbol: 'SOLO', price: 100, timestamp: now, dataTimestamp: now }),
    ];
    const verdict = assessReliability('SOLO', obs);
    expect(verdict.trustScore).toBeGreaterThan(0);
    expect(verdict.sourceScores[0].agreementScore).toBe(50); // neutral — no peers
  });

  it('handles observation with no price/direction/sentiment', () => {
    const now = Date.now();
    const obs: SourceObservation[] = [
      makeObs({ sourceId: 'FRED', symbol: 'MACRO', timestamp: now, dataTimestamp: now }),
    ];
    const verdict = assessReliability('MACRO', obs);
    expect(verdict.trustScore).toBeGreaterThanOrEqual(0);
  });

  it('handles many sources (10+) without error', () => {
    const now = Date.now();
    const sources: DataSourceId[] = [
      'YAHOO_FINANCE', 'TRADINGVIEW', 'FINNHUB', 'LOCAL_INDICATORS',
      'STOCKTWITS', 'CNBC', 'MARKETWATCH', 'RSS_FEED', 'GOOGLE_ALERTS', 'POLYMARKET',
    ];
    const obs: SourceObservation[] = sources.map(s =>
      makeObs({ sourceId: s, symbol: 'AAPL', direction: 'BULLISH', timestamp: now, dataTimestamp: now }),
    );
    const verdict = assessReliability('AAPL', obs);
    expect(verdict.sourceScores.length).toBe(10);
    expect(verdict.trustScore).toBeGreaterThan(0);
    expect(verdict.directionConsensus.consensusStrength).toBe(100);
  });

  it('correctly penalizes when half sources disagree', () => {
    const now = Date.now();
    const obs: SourceObservation[] = [
      makeObs({ sourceId: 'YAHOO_FINANCE', symbol: 'AAPL', direction: 'BULLISH', timestamp: now }),
      makeObs({ sourceId: 'TRADINGVIEW', symbol: 'AAPL', direction: 'BULLISH', timestamp: now }),
      makeObs({ sourceId: 'RSS_FEED', symbol: 'AAPL', direction: 'BEARISH', timestamp: now }),
      makeObs({ sourceId: 'STOCKTWITS', symbol: 'AAPL', direction: 'BEARISH', timestamp: now }),
    ];
    const verdict = assessReliability('AAPL', obs);
    // Should have direction conflict + lower trust
    expect(verdict.contradictions.length).toBeGreaterThan(0);
    expect(verdict.trustScore).toBeLessThan(TRUST_THRESHOLDS.VERY_HIGH);
    expect(verdict.directionConsensus.consensusStrength).toBe(50);
  });

  it('tier-1 sources weighted more heavily than tier-3', () => {
    resetReliabilityStats();
    const now = Date.now();
    // All tier 1 sources agreeing
    const tier1Obs: SourceObservation[] = [
      makeObs({ sourceId: 'YAHOO_FINANCE', symbol: 'T1', direction: 'BULLISH', price: 100, timestamp: now, dataTimestamp: now }),
      makeObs({ sourceId: 'TRADINGVIEW', symbol: 'T1', direction: 'BULLISH', price: 100.05, timestamp: now, dataTimestamp: now }),
    ];
    const verdict1 = assessReliability('T1', tier1Obs);

    // All tier 3 sources agreeing
    const tier3Obs: SourceObservation[] = [
      makeObs({ sourceId: 'STOCKTWITS', symbol: 'T3', direction: 'BULLISH', timestamp: now, dataTimestamp: now }),
      makeObs({ sourceId: 'CNBC', symbol: 'T3', direction: 'BULLISH', timestamp: now, dataTimestamp: now }),
    ];
    const verdict3 = assessReliability('T3', tier3Obs);

    // Tier 1 agreement should produce higher trust
    expect(verdict1.trustScore).toBeGreaterThan(verdict3.trustScore);
  });
});
