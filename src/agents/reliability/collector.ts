// ─── Information Reliability Agent — Data Collector ───────────
// Bridges existing YMSA data sources into SourceObservation
// format for the reliability engine. Does NOT make new API
// calls — it transforms data already collected by the pipeline.

import type { StockQuote, TechnicalIndicator } from '../../types';
import type { SourceObservation, DataSourceId } from './types';

// ═══════════════════════════════════════════════════════════════
// Quote → Observation
// ═══════════════════════════════════════════════════════════════

/** Convert a StockQuote (from Yahoo, TV, etc.) to an observation */
export function quoteToObservation(
  quote: StockQuote,
  sourceId: DataSourceId,
  fetchTimestamp?: number,
): SourceObservation {
  return {
    sourceId,
    symbol: quote.symbol,
    timestamp: fetchTimestamp || Date.now(),
    dataTimestamp: quote.timestamp || fetchTimestamp || Date.now(),
    price: quote.price,
    direction: quote.changePercent > 1 ? 'BULLISH' : quote.changePercent < -1 ? 'BEARISH' : 'NEUTRAL',
    confidence: undefined,
  };
}

// ═══════════════════════════════════════════════════════════════
// Indicators → Observation
// ═══════════════════════════════════════════════════════════════

/** Convert TechnicalIndicator[] to a single observation */
export function indicatorsToObservation(
  symbol: string,
  indicators: TechnicalIndicator[],
  sourceId: DataSourceId = 'LOCAL_INDICATORS',
): SourceObservation {
  const indMap: Record<string, number> = {};
  let direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  let bullishCount = 0;
  let bearishCount = 0;

  for (const ind of indicators) {
    indMap[ind.indicator] = ind.value;

    // Derive direction from key indicators
    if (ind.indicator === 'RSI') {
      if (ind.value < 30) bullishCount++; // oversold → potential buy
      else if (ind.value > 70) bearishCount++; // overbought → potential sell
    }
    if (ind.indicator === 'MACD') {
      if (ind.value > 0) bullishCount++;
      else if (ind.value < 0) bearishCount++;
    }
  }

  if (bullishCount > bearishCount) direction = 'BULLISH';
  else if (bearishCount > bullishCount) direction = 'BEARISH';

  return {
    sourceId,
    symbol,
    timestamp: Date.now(),
    indicators: indMap,
    direction,
  };
}

// ═══════════════════════════════════════════════════════════════
// Engine Signals → Observation
// ═══════════════════════════════════════════════════════════════

/** Convert engine outputs to directional observations */
export function engineOutputToObservation(
  symbol: string,
  direction: 'BUY' | 'SELL' | 'HOLD' | 'NEUTRAL',
  confidence: number,
  engineId: string,
): SourceObservation {
  // Map engine names to source IDs where applicable
  const sourceMap: Record<string, DataSourceId> = {
    MTF_MOMENTUM: 'LOCAL_INDICATORS',
    SMART_MONEY: 'LOCAL_INDICATORS',
    STAT_ARB: 'LOCAL_INDICATORS',
    OPTIONS: 'LOCAL_INDICATORS',
    CRYPTO_DEFI: 'COINGECKO',
    EVENT_DRIVEN: 'RSS_FEED',
  };

  return {
    sourceId: sourceMap[engineId] || 'LOCAL_INDICATORS',
    symbol,
    timestamp: Date.now(),
    direction: direction === 'BUY' ? 'BULLISH' : direction === 'SELL' ? 'BEARISH' : 'NEUTRAL',
    confidence,
  };
}

// ═══════════════════════════════════════════════════════════════
// Sentiment → Observation
// ═══════════════════════════════════════════════════════════════

/** Convert social/news sentiment data to an observation */
export function sentimentToObservation(
  symbol: string,
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
  score: number,
  sourceId: DataSourceId,
  timestamp?: number,
): SourceObservation {
  return {
    sourceId,
    symbol,
    timestamp: timestamp || Date.now(),
    sentiment,
    sentimentScore: score,
    direction: sentiment,
  };
}

// ═══════════════════════════════════════════════════════════════
// RSS/News → Observation
// ═══════════════════════════════════════════════════════════════

/** Convert an RSS item with sentiment to an observation */
export function rssToObservation(
  symbol: string,
  headline: string,
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
  confidence: number,
  publishedAt: number,
  sourceId: DataSourceId = 'RSS_FEED',
): SourceObservation {
  return {
    sourceId,
    symbol,
    timestamp: Date.now(),
    dataTimestamp: publishedAt,
    direction: sentiment,
    confidence,
    raw: headline,
    sentiment,
    sentimentScore: sentiment === 'BULLISH' ? confidence : sentiment === 'BEARISH' ? -confidence : 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// Batch Collection — Gather all observations for a symbol
// ═══════════════════════════════════════════════════════════════

export interface SymbolDataBundle {
  symbol: string;
  quotes: Array<{ quote: StockQuote; source: DataSourceId; fetchTime?: number }>;
  indicators: TechnicalIndicator[];
  engineDirections: Array<{ direction: 'BUY' | 'SELL' | 'HOLD' | 'NEUTRAL'; confidence: number; engineId: string }>;
  sentiments: Array<{ sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; score: number; source: DataSourceId; timestamp?: number }>;
  rssItems: Array<{ headline: string; sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; confidence: number; publishedAt: number; source?: DataSourceId }>;
}

/** Collect all observations for a symbol from available data */
export function collectObservations(bundle: SymbolDataBundle): SourceObservation[] {
  const obs: SourceObservation[] = [];

  for (const q of bundle.quotes) {
    obs.push(quoteToObservation(q.quote, q.source, q.fetchTime));
  }

  if (bundle.indicators.length > 0) {
    obs.push(indicatorsToObservation(bundle.symbol, bundle.indicators));
  }

  for (const e of bundle.engineDirections) {
    obs.push(engineOutputToObservation(bundle.symbol, e.direction, e.confidence, e.engineId));
  }

  for (const s of bundle.sentiments) {
    obs.push(sentimentToObservation(bundle.symbol, s.sentiment, s.score, s.source, s.timestamp));
  }

  for (const r of bundle.rssItems) {
    obs.push(rssToObservation(bundle.symbol, r.headline, r.sentiment, r.confidence, r.publishedAt, r.source));
  }

  return obs;
}
