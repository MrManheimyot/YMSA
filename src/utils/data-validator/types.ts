// ─── Data Validator Types + Constants ─────────────────────────

import type { IndicatorType } from '../../types';

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
  valid: boolean;
  score: number;
  issues: ValidationIssue[];
  source?: string;
  symbol?: string;
  timestamp: number;
}

export interface CrossValidationResult {
  symbol: string;
  primarySource: string;
  agreementScore: number;
  priceDeviation: number;
  validSources: number;
  totalSources: number;
  bestQuote: import('../../types').StockQuote | null;
  issues: ValidationIssue[];
}

export interface IndicatorConsistencyResult {
  symbol: string;
  score: number;
  issues: ValidationIssue[];
  missingCritical: IndicatorType[];
  availableIndicators: IndicatorType[];
}

export interface SignalValidation {
  valid: boolean;
  score: number;
  direction: 'BUY' | 'SELL' | 'MIXED';
  bullishCount: number;
  bearishCount: number;
  conflictLevel: 'NONE' | 'MINOR' | 'MAJOR';
  issues: ValidationIssue[];
}

export interface TradeValidation {
  valid: boolean;
  score: number;
  riskReward: number;
  issues: ValidationIssue[];
}

export interface DataQualityReport {
  overallScore: number;
  quoteQuality: number;
  indicatorQuality: number;
  signalQuality: number;
  tradeQuality: number;
  crossSourceAgreement: number;
  totalIssues: number;
  failCount: number;
  warnCount: number;
  passedGate: boolean;
  issues: ValidationIssue[];
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════

export const MAX_QUOTE_AGE_MS = 15 * 60 * 1000;
export const MAX_AFTER_HOURS_AGE_MS = 4 * 60 * 60 * 1000;
export const MAX_PRICE_DEVIATION_PCT = 1.0;
export const WARN_PRICE_DEVIATION_PCT = 0.3;
export const REQUIRED_INDICATORS: IndicatorType[] = ['RSI', 'ATR', 'MACD'];
export const DESIRABLE_INDICATORS: IndicatorType[] = ['EMA_50', 'EMA_200', 'ADX', 'SMA_50', 'SMA_200'];
export const MIN_STOCK_PRICE = 0.01;
export const MAX_STOCK_PRICE = 999_999;
export const MIN_VOLUME = 0;
export const MAX_VOLUME = 50_000_000_000;
export const RSI_MIN = 0;
export const RSI_MAX = 100;
export const ATR_MAX_PCT_OF_PRICE = 0.50;
export const MIN_DATA_QUALITY_SCORE = 60;

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

export function isMarketHours(): boolean {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcDay = now.getUTCDay();
  if (utcDay === 0 || utcDay === 6) return false;
  if (utcHour < 13 || utcHour >= 20) return false;
  if (utcHour === 13 && now.getUTCMinutes() < 30) return false;
  return true;
}
