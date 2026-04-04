// ─── Walk-Forward Optimization (GAP-030) ────────────────────
// Splits historical data into rolling in-sample/out-of-sample windows
// to detect overfitting and validate parameter robustness.
// Uses the core backtest engine for each window.

import type { Env } from '../types';
import { runBacktest, type BacktestConfig, type BacktestResult, type BacktestMetrics } from './engine';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface WalkForwardConfig {
  symbols: string[];
  fullStartDate: string;      // Overall start YYYY-MM-DD
  fullEndDate: string;        // Overall end YYYY-MM-DD
  inSampleMonths: number;     // Training window (default: 4)
  outOfSampleMonths: number;  // Test window (default: 2)
  stepMonths: number;         // Roll forward by (default: same as OOS)
  engines: string[];
  initialCapital: number;
  stopLossPct: number;
  takeProfitPct: number;
}

export interface WalkForwardWindow {
  windowIndex: number;
  inSampleStart: string;
  inSampleEnd: string;
  outOfSampleStart: string;
  outOfSampleEnd: string;
  inSampleResult: BacktestResult;
  outOfSampleResult: BacktestResult;
}

export interface WalkForwardResult {
  config: WalkForwardConfig;
  windows: WalkForwardWindow[];
  aggregateOOS: BacktestMetrics;
  robustnessScore: number;     // 0-100 — how consistent IS → OOS
  overfitRatio: number;        // IS_sharpe / OOS_sharpe — >2.0 = likely overfit
  summary: string;
  runAt: number;
}

// ═══════════════════════════════════════════════════════════════
// Default Config
// ═══════════════════════════════════════════════════════════════

const DEFAULT_WF_CONFIG: WalkForwardConfig = {
  symbols: [],
  fullStartDate: '',
  fullEndDate: '',
  inSampleMonths: 4,
  outOfSampleMonths: 2,
  stepMonths: 2,
  engines: ['MTF_MOMENTUM', 'SMART_MONEY', 'STAT_ARB'],
  initialCapital: 100_000,
  stopLossPct: 2.0,
  takeProfitPct: 4.0,
};

// ═══════════════════════════════════════════════════════════════
// Walk-Forward Engine
// ═══════════════════════════════════════════════════════════════

/**
 * Run walk-forward analysis with rolling IS/OOS windows.
 * Each window trains on inSampleMonths, tests on outOfSampleMonths,
 * then advances by stepMonths.
 */
export async function runWalkForward(
  env: Env,
  config: Partial<WalkForwardConfig> = {},
): Promise<WalkForwardResult> {
  const cfg: WalkForwardConfig = { ...DEFAULT_WF_CONFIG, ...config };

  // Default symbols from watchlist
  if (cfg.symbols.length === 0) {
    cfg.symbols = env.DEFAULT_WATCHLIST.split(',').map(s => s.trim()).filter(Boolean);
  }

  // Default to last 18 months
  if (!cfg.fullStartDate || !cfg.fullEndDate) {
    const now = new Date();
    cfg.fullEndDate = now.toISOString().split('T')[0];
    const start = new Date(now);
    start.setMonth(start.getMonth() - 18);
    cfg.fullStartDate = start.toISOString().split('T')[0];
  }

  const windows: WalkForwardWindow[] = [];
  let windowStart = new Date(cfg.fullStartDate);
  const fullEnd = new Date(cfg.fullEndDate);
  let windowIndex = 0;

  // Generate rolling windows
  while (true) {
    const isEnd = addMonths(windowStart, cfg.inSampleMonths);
    const oosStart = isEnd;
    const oosEnd = addMonths(oosStart, cfg.outOfSampleMonths);

    // Stop if OOS extends past the data
    if (oosEnd > fullEnd) break;

    const backtestBase: Partial<BacktestConfig> = {
      symbols: cfg.symbols,
      engines: cfg.engines,
      initialCapital: cfg.initialCapital,
      stopLossPct: cfg.stopLossPct,
      takeProfitPct: cfg.takeProfitPct,
      maxConcurrentTrades: 10,
    };

    // In-sample run
    const inSampleResult = await runBacktest(env, {
      ...backtestBase,
      startDate: toDateStr(windowStart),
      endDate: toDateStr(isEnd),
    });

    // Out-of-sample run (same params, different dates)
    const outOfSampleResult = await runBacktest(env, {
      ...backtestBase,
      startDate: toDateStr(oosStart),
      endDate: toDateStr(oosEnd),
    });

    windows.push({
      windowIndex,
      inSampleStart: toDateStr(windowStart),
      inSampleEnd: toDateStr(isEnd),
      outOfSampleStart: toDateStr(oosStart),
      outOfSampleEnd: toDateStr(oosEnd),
      inSampleResult,
      outOfSampleResult,
    });

    windowIndex++;
    windowStart = addMonths(windowStart, cfg.stepMonths);
  }

  // Aggregate OOS metrics across all windows
  const aggregateOOS = aggregateMetrics(windows.map(w => w.outOfSampleResult));
  const aggregateIS = aggregateMetrics(windows.map(w => w.inSampleResult));

  // Overfit ratio: IS Sharpe / OOS Sharpe — below 2.0 is healthy
  const overfitRatio = aggregateOOS.sharpeRatio > 0
    ? aggregateIS.sharpeRatio / aggregateOOS.sharpeRatio
    : aggregateIS.sharpeRatio > 0 ? Infinity : 1.0;

  // Robustness score: how many OOS windows were profitable + WR consistency
  const profitableWindows = windows.filter(w => w.outOfSampleResult.metrics.totalPnl > 0).length;
  const profitableRatio = windows.length > 0 ? profitableWindows / windows.length : 0;

  // WR consistency: std dev of window WRs
  const oosWinRates = windows.map(w => w.outOfSampleResult.metrics.winRate);
  const wrMean = oosWinRates.length > 0 ? oosWinRates.reduce((s, r) => s + r, 0) / oosWinRates.length : 0;
  const wrStd = oosWinRates.length > 1
    ? Math.sqrt(oosWinRates.reduce((s, r) => s + (r - wrMean) ** 2, 0) / (oosWinRates.length - 1))
    : 0;
  const wrConsistency = wrStd < 0.15 ? 1.0 : wrStd < 0.25 ? 0.7 : 0.4;

  const robustnessScore = Math.round(
    (profitableRatio * 50 + wrConsistency * 30 + (overfitRatio < 2.0 ? 20 : 0)) * 1
  );

  const summary = formatWalkForwardSummary(cfg, windows, aggregateOOS, robustnessScore, overfitRatio);

  return {
    config: cfg,
    windows,
    aggregateOOS,
    robustnessScore,
    overfitRatio,
    summary,
    runAt: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════
// Aggregate Metrics
// ═══════════════════════════════════════════════════════════════

function aggregateMetrics(results: BacktestResult[]): BacktestMetrics {
  const allTrades = results.flatMap(r => r.trades);
  const wins = allTrades.filter(t => t.outcome === 'WIN');
  const losses = allTrades.filter(t => t.outcome === 'LOSS');

  const totalPnl = allTrades.reduce((s, t) => s + t.pnl, 0);
  const grossWins = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  const avgWin = wins.length > 0 ? grossWins / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLosses / losses.length : 0;

  const returns = allTrades.map(t => t.pnlPct / 100);
  const avgReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
  const variance = returns.length > 1
    ? returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

  const initialCapital = results[0]?.config.initialCapital || 100_000;
  const maxDrawdown = Math.max(0, ...results.map(r => r.metrics.maxDrawdown));

  let maxConsWins = 0, maxConsLosses = 0, curWins = 0, curLosses = 0;
  for (const t of allTrades) {
    if (t.outcome === 'WIN') {
      curWins++; curLosses = 0;
      if (curWins > maxConsWins) maxConsWins = curWins;
    } else if (t.outcome === 'LOSS') {
      curLosses++; curWins = 0;
      if (curLosses > maxConsLosses) maxConsLosses = curLosses;
    }
  }

  return {
    totalTrades: allTrades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: allTrades.length > 0 ? wins.length / allTrades.length : 0,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
    totalPnl,
    totalPnlPct: initialCapital > 0 ? (totalPnl / initialCapital) * 100 : 0,
    maxDrawdown,
    maxDrawdownPct: initialCapital > 0 ? (maxDrawdown / initialCapital) * 100 : 0,
    sharpeRatio,
    avgWin,
    avgLoss,
    avgHoldingDays: allTrades.length > 0 ? allTrades.reduce((s, t) => s + t.holdingDays, 0) / allTrades.length : 0,
    expectancy: allTrades.length > 0 ? totalPnl / allTrades.length : 0,
    largestWin: wins.length > 0 ? Math.max(...wins.map(t => t.pnl)) : 0,
    largestLoss: losses.length > 0 ? Math.min(...losses.map(t => t.pnl)) : 0,
    consecutiveWins: maxConsWins,
    consecutiveLosses: maxConsLosses,
  };
}

// ═══════════════════════════════════════════════════════════════
// Formatting
// ═══════════════════════════════════════════════════════════════

function formatWalkForwardSummary(
  cfg: WalkForwardConfig,
  windows: WalkForwardWindow[],
  oos: BacktestMetrics,
  robustness: number,
  overfit: number,
): string {
  const lines = [
    `📊 <b>Walk-Forward Analysis</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `Period: ${cfg.fullStartDate} → ${cfg.fullEndDate}`,
    `Windows: ${windows.length} (${cfg.inSampleMonths}m IS / ${cfg.outOfSampleMonths}m OOS, step ${cfg.stepMonths}m)`,
    ``,
    `<b>Aggregate OOS Metrics:</b>`,
    `  Trades: ${oos.totalTrades} | Win Rate: ${(oos.winRate * 100).toFixed(1)}%`,
    `  P&L: $${oos.totalPnl.toFixed(0)} | PF: ${oos.profitFactor === Infinity ? '∞' : oos.profitFactor.toFixed(2)}`,
    `  Sharpe: ${oos.sharpeRatio.toFixed(2)} | Max DD: ${oos.maxDrawdownPct.toFixed(1)}%`,
    `  Expectancy: $${oos.expectancy.toFixed(0)}/trade`,
    ``,
    `<b>Robustness:</b>`,
    `  Score: ${robustness}/100 ${robustness >= 70 ? '✅' : robustness >= 40 ? '⚠️' : '❌'}`,
    `  Overfit Ratio: ${overfit === Infinity ? '∞' : overfit.toFixed(2)} ${overfit < 2.0 ? '✅' : '⚠️ HIGH'}`,
    `  Profitable Windows: ${windows.filter(w => w.outOfSampleResult.metrics.totalPnl > 0).length}/${windows.length}`,
  ];

  // Per-window summary
  lines.push(``, `<b>Windows:</b>`);
  for (const w of windows) {
    const isM = w.inSampleResult.metrics;
    const oosM = w.outOfSampleResult.metrics;
    lines.push(
      `  #${w.windowIndex + 1} IS: WR ${(isM.winRate * 100).toFixed(0)}% PF ${isM.profitFactor === Infinity ? '∞' : isM.profitFactor.toFixed(1)} | OOS: WR ${(oosM.winRate * 100).toFixed(0)}% PF ${oosM.profitFactor === Infinity ? '∞' : oosM.profitFactor.toFixed(1)} $${oosM.totalPnl.toFixed(0)}`
    );
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}
