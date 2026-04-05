// ─── Information Reliability Agent — Configuration ────────────
// Source profiles calibrated from real system behavior.
// Tier 1: Exchange-level, < 1min freshness
// Tier 2: Aggregators, < 5min freshness
// Tier 3: Supplementary (news, social), minutes-to-hours

import type { DataSourceId, SourceProfile } from './types';

// ═══════════════════════════════════════════════════════════════
// Source Profiles — Static Calibration
// ═══════════════════════════════════════════════════════════════

export const SOURCE_PROFILES: Record<DataSourceId, SourceProfile> = {
  YAHOO_FINANCE: {
    id: 'YAHOO_FINANCE',
    tier: 1,
    dataType: 'PRICE',
    baseReliability: 90,
    latencyMs: 30_000,
    refreshIntervalMs: 60_000,       // ~1 min quotes
    hasCrossValidation: true,
  },
  TRADINGVIEW: {
    id: 'TRADINGVIEW',
    tier: 1,
    dataType: 'PRICE',
    baseReliability: 92,
    latencyMs: 15_000,
    refreshIntervalMs: 30_000,       // TV scanner near-realtime
    hasCrossValidation: true,
  },
  FINNHUB: {
    id: 'FINNHUB',
    tier: 2,
    dataType: 'PRICE',
    baseReliability: 80,
    latencyMs: 60_000,
    refreshIntervalMs: 60_000,
    hasCrossValidation: true,
  },
  ALPHA_VANTAGE: {
    id: 'ALPHA_VANTAGE',
    tier: 2,
    dataType: 'PRICE',
    baseReliability: 78,
    latencyMs: 120_000,
    refreshIntervalMs: 300_000,      // 5 min for free tier
    hasCrossValidation: true,
  },
  COINGECKO: {
    id: 'COINGECKO',
    tier: 2,
    dataType: 'PRICE',
    baseReliability: 82,
    latencyMs: 60_000,
    refreshIntervalMs: 60_000,
    hasCrossValidation: true,
  },
  DEXSCREENER: {
    id: 'DEXSCREENER',
    tier: 2,
    dataType: 'PRICE',
    baseReliability: 75,
    latencyMs: 30_000,
    refreshIntervalMs: 30_000,
    hasCrossValidation: true,
  },
  FRED: {
    id: 'FRED',
    tier: 1,
    dataType: 'FUNDAMENTAL',
    baseReliability: 98,             // Federal Reserve data — gold standard
    latencyMs: 3_600_000,
    refreshIntervalMs: 86_400_000,   // daily for most series
    hasCrossValidation: false,
  },
  POLYMARKET: {
    id: 'POLYMARKET',
    tier: 3,
    dataType: 'EVENT',
    baseReliability: 65,
    latencyMs: 300_000,
    refreshIntervalMs: 300_000,
    hasCrossValidation: false,
  },
  TAAPI: {
    id: 'TAAPI',
    tier: 2,
    dataType: 'INDICATOR',
    baseReliability: 72,
    latencyMs: 60_000,
    refreshIntervalMs: 60_000,
    hasCrossValidation: true,        // can verify against LOCAL_INDICATORS
  },
  SEC_EDGAR: {
    id: 'SEC_EDGAR',
    tier: 1,
    dataType: 'FUNDAMENTAL',
    baseReliability: 99,             // SEC filings — authoritative
    latencyMs: 900_000,
    refreshIntervalMs: 86_400_000,
    hasCrossValidation: false,
  },
  STOCKTWITS: {
    id: 'STOCKTWITS',
    tier: 3,
    dataType: 'SENTIMENT',
    baseReliability: 45,             // social — noisy, bias-prone
    latencyMs: 300_000,
    refreshIntervalMs: 300_000,
    hasCrossValidation: true,
  },
  CNBC: {
    id: 'CNBC',
    tier: 3,
    dataType: 'SENTIMENT',
    baseReliability: 55,
    latencyMs: 600_000,
    refreshIntervalMs: 600_000,
    hasCrossValidation: true,
  },
  MARKETWATCH: {
    id: 'MARKETWATCH',
    tier: 3,
    dataType: 'SENTIMENT',
    baseReliability: 55,
    latencyMs: 600_000,
    refreshIntervalMs: 600_000,
    hasCrossValidation: true,
  },
  RSS_FEED: {
    id: 'RSS_FEED',
    tier: 3,
    dataType: 'SENTIMENT',
    baseReliability: 50,
    latencyMs: 900_000,
    refreshIntervalMs: 900_000,
    hasCrossValidation: true,
  },
  GOOGLE_ALERTS: {
    id: 'GOOGLE_ALERTS',
    tier: 3,
    dataType: 'EVENT',
    baseReliability: 60,
    latencyMs: 1_800_000,
    refreshIntervalMs: 3_600_000,
    hasCrossValidation: false,
  },
  LOCAL_INDICATORS: {
    id: 'LOCAL_INDICATORS',
    tier: 1,
    dataType: 'INDICATOR',
    baseReliability: 88,             // computed from Yahoo OHLCV — deterministic
    latencyMs: 0,
    refreshIntervalMs: 60_000,
    hasCrossValidation: true,
  },
};

// ═══════════════════════════════════════════════════════════════
// Trust Score Weights (must sum to 1.0)
// ═══════════════════════════════════════════════════════════════

export const TRUST_WEIGHTS = {
  freshness: 0.30,    // 30% — stale data is dangerous
  agreement: 0.35,    // 35% — cross-source verification is king
  provenance: 0.35,   // 35% — source track record matters
} as const;

// ═══════════════════════════════════════════════════════════════
// Trust Tier Thresholds
// ═══════════════════════════════════════════════════════════════

export const TRUST_THRESHOLDS = {
  VERY_HIGH: 85,      // all sources agree, fresh, reliable
  HIGH: 70,           // most sources agree, minor issues
  MEDIUM: 50,         // some disagreement or staleness
  LOW: 30,            // significant issues, proceed with caution
  // Below LOW = UNTRUSTED
} as const;
