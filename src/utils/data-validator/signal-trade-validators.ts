// ─── Signal, Trade & Report Validators ────────────────────────

import type {
  ValidationIssue, ValidationResult, SignalValidation,
  TradeValidation, DataQualityReport, IndicatorConsistencyResult,
  CrossValidationResult,
} from './types';
import { MIN_DATA_QUALITY_SCORE } from './types';

// ═══════════════════════════════════════════════════════════════
// 4. Signal Integrity Validation
// ═══════════════════════════════════════════════════════════════

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

  const bullWeight = bullish.reduce((s, x) => s + x.confidence, 0);
  const bearWeight = bearish.reduce((s, x) => s + x.confidence, 0);
  const direction = bullish.length > 0 && bearish.length === 0 ? 'BUY' as const
    : bearish.length > 0 && bullish.length === 0 ? 'SELL' as const
    : 'MIXED' as const;

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

  const confs = signals.map(s => s.confidence);
  const avgConf = confs.reduce((a, b) => a + b, 0) / confs.length;
  const maxConf = Math.max(...confs);
  const minConf = Math.min(...confs);
  if (maxConf - minConf > 40) {
    issues.push({ field: 'confidence', message: `Wide confidence spread: ${minConf}-${maxConf} (avg ${avgConf.toFixed(0)})`, severity: 'WARN', value: { min: minConf, max: maxConf, avg: avgConf } });
  }

  if (regime && regime.confidence >= 50) {
    const consensusDir = bullWeight >= bearWeight ? 'BUY' : 'SELL';
    const isCounter =
      (consensusDir === 'BUY' && regime.regime === 'TRENDING_DOWN') ||
      (consensusDir === 'SELL' && regime.regime === 'TRENDING_UP');

    if (isCounter && regime.confidence >= 70) {
      issues.push({ field: 'regime', message: `Signal is COUNTER-TREND in ${regime.regime} with ${regime.confidence}% regime confidence`, severity: 'FAIL' });
    } else if (isCounter) {
      issues.push({ field: 'regime', message: `Signal is counter-trend in ${regime.regime} (regime conf ${regime.confidence}%)`, severity: 'WARN' });
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

  if (entry <= 0 || isNaN(entry)) {
    issues.push({ field: 'entry', message: 'Invalid entry price', severity: 'FAIL', value: entry });
  }
  if (stopLoss <= 0 || isNaN(stopLoss)) {
    issues.push({ field: 'stopLoss', message: 'Invalid stop loss', severity: 'FAIL', value: stopLoss });
  }
  if (tp1 <= 0 || isNaN(tp1)) {
    issues.push({ field: 'tp1', message: 'Invalid take profit', severity: 'FAIL', value: tp1 });
  }

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

  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(tp1 - entry);
  const rr = risk > 0 ? reward / risk : 0;

  if (rr < 2.0) {
    issues.push({ field: 'riskReward', message: `R:R ${rr.toFixed(2)} below 2.0 minimum`, severity: 'FAIL', value: rr });
  } else if (rr < 2.5) {
    issues.push({ field: 'riskReward', message: `R:R ${rr.toFixed(2)} is marginal (target 2.5+)`, severity: 'WARN', value: rr });
  }

  if (atr && atr > 0 && risk > 0) {
    const slAtrMultiple = risk / atr;
    if (slAtrMultiple > 4) {
      issues.push({ field: 'stopDistance', message: `Stop ${slAtrMultiple.toFixed(1)}x ATR is very wide — may not hit SL before expiry`, severity: 'WARN', value: slAtrMultiple });
    }
    if (slAtrMultiple < 0.5) {
      issues.push({ field: 'stopDistance', message: `Stop ${slAtrMultiple.toFixed(1)}x ATR is very tight — may trigger on noise`, severity: 'WARN', value: slAtrMultiple });
    }
  }

  if (confidence < 85) {
    issues.push({ field: 'confidence', message: `Confidence ${confidence} below 85 threshold`, severity: 'FAIL', value: confidence });
  }

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

  const fast = parseFloat(env['EMA_FAST'] || '');
  const slow = parseFloat(env['EMA_SLOW'] || '');
  if (!isNaN(fast) && !isNaN(slow) && fast >= slow) {
    issues.push({ field: 'EMA_PERIODS', message: `EMA_FAST (${fast}) >= EMA_SLOW (${slow})`, severity: 'FAIL' });
  }

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
