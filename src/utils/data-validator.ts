// ─── Cross-Validation Layer — Barrel ─────────────────────────
// Re-exports from modular sub-modules under ./data-validator/

export type {
  ValidationSeverity, ValidationIssue, ValidationResult,
  CrossValidationResult, IndicatorConsistencyResult,
  SignalValidation, TradeValidation, DataQualityReport,
} from './data-validator/types';

export { validateQuote, validateIndicators, crossValidateQuotes } from './data-validator/quote-validators';
export { validateSignalConsistency, validateTradeParams, validateEnvThresholds, buildDataQualityReport, formatValidationReport } from './data-validator/signal-trade-validators';
