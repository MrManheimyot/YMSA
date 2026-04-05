// ─── Information Reliability Agent — Barrel ───────────────────
// Re-exports for clean importing throughout the system.

export type {
  DataSourceId, SourceProfile, SourceObservation,
  SourceReliabilityScore, ContradictionReport, RecencyAssessment,
  ReliabilityVerdict, ReliabilityAgentStats, SourcePerformanceRecord,
} from './types';

export { SOURCE_PROFILES, TRUST_WEIGHTS, TRUST_THRESHOLDS } from './config';

export {
  assessReliability,
  formatForZAi,
  getReliabilityStats,
  resetReliabilityStats,
  loadSourceAccuracy,
  persistSourcePerformance,
} from './engine';

export {
  quoteToObservation,
  indicatorsToObservation,
  engineOutputToObservation,
  sentimentToObservation,
  rssToObservation,
  collectObservations,
} from './collector';
export type { SymbolDataBundle } from './collector';
