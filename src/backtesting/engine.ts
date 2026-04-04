// ─── Backtesting Engine (P1) ─────────────────────────────────
// Runs historical signal detection against OHLCV data to produce
// performance metrics: win rate, profit factor, max drawdown, Sharpe.
// Uses the same signal detection logic as the live pipeline.

import type { Env } from '../types';
import * as yahooFinance from '../api/yahoo-finance';
import { computeIndicators } from '../analysis/indicators';
import { detectSignals } from '../analysis/signals';
import { calculateHalfKelly } from '../analysis/position-sizer';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface BacktestConfig {
  symbols: string[];
  startDate: string;          // YYYY-MM-DD
  endDate: string;            // YYYY-MM-DD
  initialCapital: number;     // Starting equity
  engines: string[];          // Which engines to test
  stopLossPct: number;        // Default SL % (e.g. 2.0)
  takeProfitPct: number;      // Default TP % (e.g. 4.0)
  maxConcurrentTrades: number;
}

export interface BacktestTrade {
  symbol: string;
  engine: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  exit: number;
  stopLoss: number;
  takeProfit: number;
  entryDate: string;
  exitDate: string;
  pnl: number;
  pnlPct: number;
  holdingDays: number;
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN';
  signalType: string;
}

export interface BacktestResult {
  config: BacktestConfig;
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
  equityCurve: Array<{ date: string; equity: number }>;
  byEngine: Record<string, EngineBacktestMetrics>;
  runAt: number;
}

export interface BacktestMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  totalPnl: number;
  totalPnlPct: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  avgWin: number;
  avgLoss: number;
  avgHoldingDays: number;
  expectancy: number;
  largestWin: number;
  largestLoss: number;
  consecutiveWins: number;
  consecutiveLosses: number;
}

export interface EngineBacktestMetrics {
  engineId: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  profitFactor: number;
  totalPnl: number;
  avgRR: number;
}

// ═══════════════════════════════════════════════════════════════
// Default Config
// ═══════════════════════════════════════════════════════════════

const DEFAULT_CONFIG: BacktestConfig = {
  symbols: [],
  startDate: '',
  endDate: '',
  initialCapital: 100_000,
  engines: ['MTF_MOMENTUM', 'SMART_MONEY', 'STAT_ARB'],
  stopLossPct: 2.0,
  takeProfitPct: 4.0,
  maxConcurrentTrades: 10,
};

// ═══════════════════════════════════════════════════════════════
// Core Backtest Engine
// ═══════════════════════════════════════════════════════════════

export async function runBacktest(
  env: Env,
  config: Partial<BacktestConfig> = {},
): Promise<BacktestResult> {
  const cfg: BacktestConfig = { ...DEFAULT_CONFIG, ...config };

  // Default to watchlist if no symbols specified
  if (cfg.symbols.length === 0) {
    cfg.symbols = env.DEFAULT_WATCHLIST.split(',').map(s => s.trim()).filter(Boolean);
  }

  // Default to last 6 months if no dates
  if (!cfg.startDate || !cfg.endDate) {
    const now = new Date();
    cfg.endDate = now.toISOString().split('T')[0];
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    cfg.startDate = sixMonthsAgo.toISOString().split('T')[0];
  }

  const allTrades: BacktestTrade[] = [];
  const equityCurve: Array<{ date: string; equity: number }> = [];
  let equity = cfg.initialCapital;
  let peakEquity = equity;
  let maxDrawdown = 0;

  // Fetch historical data for all symbols
  for (const symbol of cfg.symbols) {
    try {
      const ohlcv = await yahooFinance.getOHLCV(symbol, '2y', '1d');
      if (!ohlcv || ohlcv.length < 50) continue;

      // Filter to date range
      const startMs = new Date(cfg.startDate).getTime();
      const endMs = new Date(cfg.endDate).getTime();
      const filtered = ohlcv.filter(bar => {
        const barMs = typeof bar.timestamp === 'number' ? bar.timestamp : new Date(bar.timestamp).getTime();
        return barMs >= startMs && barMs <= endMs;
      });

      if (filtered.length < 20) continue;

      // Walk forward through bars, computing signals at each point
      for (let i = 50; i < filtered.length - 1; i++) {
        const historicalSlice = ohlcv.slice(0, ohlcv.indexOf(filtered[i]) + 1);
        if (historicalSlice.length < 50) continue;

        // Compute indicators on the data up to this point
        const indicators = computeIndicators(symbol, historicalSlice);
        const quote = barToQuote(symbol, filtered[i], filtered[i - 1]);

        // Detect signals
        const signals = detectSignals(
          quote,
          indicators,
          null,
          env,
        );

        if (signals.length === 0) continue;

        // Check if we have too many open simulated trades
        const openCount = allTrades.filter(t => !t.exitDate).length;
        if (openCount >= cfg.maxConcurrentTrades) continue;

        // Generate trades from signals
        for (const signal of signals) {
          const isBuy = signal.type.includes('BUY') ||
            signal.type.includes('OVERSOLD') ||
            signal.type.includes('GOLDEN') ||
            signal.type.includes('BULLISH') ||
            signal.type.includes('BREAKOUT');

          const direction = isBuy ? 'BUY' : 'SELL';
          const entry = filtered[i + 1]?.open || filtered[i].close; // Next bar open
          if (!entry || entry <= 0) continue;

          const sl = isBuy
            ? entry * (1 - cfg.stopLossPct / 100)
            : entry * (1 + cfg.stopLossPct / 100);
          const tp = isBuy
            ? entry * (1 + cfg.takeProfitPct / 100)
            : entry * (1 - cfg.takeProfitPct / 100);

          // Walk forward to find exit
          let exitPrice = entry;
          let exitDate = '';
          let exitIdx = i + 1;

          for (let j = i + 2; j < filtered.length; j++) {
            const bar = filtered[j];
            // Check stop loss
            if (isBuy && bar.low <= sl) {
              exitPrice = sl;
              exitDate = toDateStr(bar.timestamp);
              exitIdx = j;
              break;
            }
            if (!isBuy && bar.high >= sl) {
              exitPrice = sl;
              exitDate = toDateStr(bar.timestamp);
              exitIdx = j;
              break;
            }
            // Check take profit
            if (isBuy && bar.high >= tp) {
              exitPrice = tp;
              exitDate = toDateStr(bar.timestamp);
              exitIdx = j;
              break;
            }
            if (!isBuy && bar.low <= tp) {
              exitPrice = tp;
              exitDate = toDateStr(bar.timestamp);
              exitIdx = j;
              break;
            }
            // Max hold 20 bars → exit at close
            if (j - i >= 20) {
              exitPrice = bar.close;
              exitDate = toDateStr(bar.timestamp);
              exitIdx = j;
              break;
            }
          }

          if (!exitDate) {
            const lastBar = filtered[filtered.length - 1];
            exitPrice = lastBar.close;
            exitDate = toDateStr(lastBar.timestamp);
            exitIdx = filtered.length - 1;
          }

          // GAP-029: Kelly-based position sizing (matches live pipeline)
          // Compute running win rate from completed trades
          const completedTrades = allTrades.filter(t => t.exitDate);
          const wins = completedTrades.filter(t => t.outcome === 'WIN').length;
          const losses = completedTrades.filter(t => t.outcome === 'LOSS').length;
          const runningWinRate = completedTrades.length >= 5
            ? wins / completedTrades.length
            : 0.5; // default before enough samples
          const avgWinPct = completedTrades.length >= 5
            ? completedTrades.filter(t => t.pnlPct > 0).reduce((s, t) => s + t.pnlPct, 0) / Math.max(1, wins)
            : cfg.takeProfitPct;
          const avgLossPct = completedTrades.length >= 5
            ? Math.abs(completedTrades.filter(t => t.pnlPct < 0).reduce((s, t) => s + t.pnlPct, 0) / Math.max(1, losses))
            : cfg.stopLossPct;

          const kellyFrac = calculateHalfKelly(runningWinRate, avgWinPct, avgLossPct);
          const positionFrac = Math.max(0.005, Math.min(kellyFrac, 0.10)); // floor 0.5%, cap 10%
          const shares = (equity * positionFrac) / entry;
          const pnl = isBuy
            ? (exitPrice - entry) * shares
            : (entry - exitPrice) * shares;
          const pnlPct = isBuy
            ? ((exitPrice - entry) / entry) * 100
            : ((entry - exitPrice) / entry) * 100;

          const engineId = mapSignalToEngine(signal.type);
          if (!cfg.engines.includes(engineId)) continue;

          const holdingDays = exitIdx - (i + 1);

          allTrades.push({
            symbol,
            engine: engineId,
            direction,
            entry,
            exit: exitPrice,
            stopLoss: sl,
            takeProfit: tp,
            entryDate: toDateStr(filtered[i + 1]?.timestamp || filtered[i].timestamp),
            exitDate,
            pnl,
            pnlPct,
            holdingDays: Math.max(1, holdingDays),
            outcome: pnlPct > 0.1 ? 'WIN' : pnlPct < -0.1 ? 'LOSS' : 'BREAKEVEN',
            signalType: signal.type,
          });

          equity += pnl;
          if (equity > peakEquity) peakEquity = equity;
          const dd = peakEquity - equity;
          if (dd > maxDrawdown) maxDrawdown = dd;

          equityCurve.push({ date: exitDate, equity });

          // Only one trade per signal batch per bar
          break;
        }
      }
    } catch (err) {
      console.error(`[Backtest] Error processing ${symbol}:`, err);
    }
  }

  // Sort trades chronologically
  allTrades.sort((a, b) => a.entryDate.localeCompare(b.entryDate));

  const metrics = computeMetrics(allTrades, cfg.initialCapital, maxDrawdown);
  const byEngine = computeByEngine(allTrades);

  return {
    config: cfg,
    trades: allTrades,
    metrics,
    equityCurve,
    byEngine,
    runAt: Date.now(),
  };
}

// ═══════════════════════════════════════════════════════════════
// Metrics Calculation
// ═══════════════════════════════════════════════════════════════

function computeMetrics(
  trades: BacktestTrade[],
  initialCapital: number,
  maxDrawdown: number,
): BacktestMetrics {
  const wins = trades.filter(t => t.outcome === 'WIN');
  const losses = trades.filter(t => t.outcome === 'LOSS');

  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const grossWins = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  const avgWin = wins.length > 0 ? grossWins / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLosses / losses.length : 0;

  // Sharpe ratio (annualized, daily returns approx)
  const returns = trades.map(t => t.pnlPct / 100);
  const avgReturn = returns.length > 0 ? returns.reduce((s, r) => s + r, 0) / returns.length : 0;
  const variance = returns.length > 1
    ? returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

  // Consecutive wins/losses
  let maxConsWins = 0, maxConsLosses = 0, curWins = 0, curLosses = 0;
  for (const t of trades) {
    if (t.outcome === 'WIN') {
      curWins++;
      curLosses = 0;
      if (curWins > maxConsWins) maxConsWins = curWins;
    } else if (t.outcome === 'LOSS') {
      curLosses++;
      curWins = 0;
      if (curLosses > maxConsLosses) maxConsLosses = curLosses;
    }
  }

  return {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length > 0 ? wins.length / trades.length : 0,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
    totalPnl,
    totalPnlPct: initialCapital > 0 ? (totalPnl / initialCapital) * 100 : 0,
    maxDrawdown,
    maxDrawdownPct: initialCapital > 0 ? (maxDrawdown / initialCapital) * 100 : 0,
    sharpeRatio,
    avgWin,
    avgLoss,
    avgHoldingDays: trades.length > 0 ? trades.reduce((s, t) => s + t.holdingDays, 0) / trades.length : 0,
    expectancy: trades.length > 0 ? totalPnl / trades.length : 0,
    largestWin: wins.length > 0 ? Math.max(...wins.map(t => t.pnl)) : 0,
    largestLoss: losses.length > 0 ? Math.min(...losses.map(t => t.pnl)) : 0,
    consecutiveWins: maxConsWins,
    consecutiveLosses: maxConsLosses,
  };
}

function computeByEngine(trades: BacktestTrade[]): Record<string, EngineBacktestMetrics> {
  const result: Record<string, EngineBacktestMetrics> = {};
  const engineIds = [...new Set(trades.map(t => t.engine))];

  for (const engineId of engineIds) {
    const engineTrades = trades.filter(t => t.engine === engineId);
    const wins = engineTrades.filter(t => t.outcome === 'WIN');
    const losses = engineTrades.filter(t => t.outcome === 'LOSS');
    const grossWins = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLosses = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

    result[engineId] = {
      engineId,
      totalTrades: engineTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: engineTrades.length > 0 ? wins.length / engineTrades.length : 0,
      profitFactor: grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0,
      totalPnl: engineTrades.reduce((s, t) => s + t.pnl, 0),
      avgRR: engineTrades.length > 0
        ? engineTrades.reduce((s, t) => s + Math.abs(t.pnlPct) / (t.outcome === 'WIN' ? 1 : 1), 0) / engineTrades.length
        : 0,
    };
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// Format Backtest Report for Telegram
// ═══════════════════════════════════════════════════════════════

export function formatBacktestReport(result: BacktestResult): string {
  const m = result.metrics;
  const lines = [
    `📈 <b>YMSA Backtest Report</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `Period: ${result.config.startDate} → ${result.config.endDate}`,
    `Symbols: ${result.config.symbols.slice(0, 5).join(', ')}${result.config.symbols.length > 5 ? ` +${result.config.symbols.length - 5}` : ''}`,
    `Capital: $${result.config.initialCapital.toLocaleString()}`,
    ``,
    `<b>Performance:</b>`,
    `  Total P&L: $${m.totalPnl.toFixed(0)} (${m.totalPnlPct >= 0 ? '+' : ''}${m.totalPnlPct.toFixed(1)}%)`,
    `  Trades: ${m.totalTrades} | Win Rate: ${(m.winRate * 100).toFixed(1)}%`,
    `  Profit Factor: ${m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2)}`,
    `  Sharpe: ${m.sharpeRatio.toFixed(2)}`,
    `  Max DD: $${m.maxDrawdown.toFixed(0)} (${m.maxDrawdownPct.toFixed(1)}%)`,
    ``,
    `<b>Trade Stats:</b>`,
    `  Avg Win: $${m.avgWin.toFixed(0)} | Avg Loss: $${m.avgLoss.toFixed(0)}`,
    `  Largest Win: $${m.largestWin.toFixed(0)} | Largest Loss: $${m.largestLoss.toFixed(0)}`,
    `  Avg Hold: ${m.avgHoldingDays.toFixed(1)} days`,
    `  Expectancy: $${m.expectancy.toFixed(0)}/trade`,
    `  Consec Wins: ${m.consecutiveWins} | Consec Losses: ${m.consecutiveLosses}`,
  ];

  // Per-engine breakdown
  const engines = Object.values(result.byEngine);
  if (engines.length > 0) {
    lines.push(``, `<b>By Engine:</b>`);
    for (const e of engines) {
      lines.push(
        `  ${e.engineId}: ${e.totalTrades}T | WR ${(e.winRate * 100).toFixed(0)}% | PF ${e.profitFactor === Infinity ? '∞' : e.profitFactor.toFixed(2)} | $${e.totalPnl.toFixed(0)}`
      );
    }
  }

  lines.push(``, `⏱️ Run at: ${new Date(result.runAt).toISOString()}`);
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

function barToQuote(symbol: string, bar: any, prevBar?: any): any {
  return {
    symbol,
    price: bar.close,
    change: prevBar ? bar.close - prevBar.close : 0,
    changePercent: prevBar ? ((bar.close - prevBar.close) / prevBar.close) * 100 : 0,
    volume: bar.volume || 0,
    avgVolume: bar.volume || 0,
    high: bar.high,
    low: bar.low,
    open: bar.open,
    previousClose: prevBar?.close,
    week52High: bar.high,
    week52Low: bar.low,
    timestamp: typeof bar.timestamp === 'number' ? bar.timestamp : new Date(bar.timestamp).getTime(),
  };
}

function toDateStr(ts: number | string): string {
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  return d.toISOString().split('T')[0];
}

function mapSignalToEngine(signalType: string): string {
  if (signalType.startsWith('MTF_') || signalType.includes('CONFLUENCE')) return 'MTF_MOMENTUM';
  if (signalType.startsWith('ORDER_BLOCK') || signalType.includes('SMART_MONEY') ||
    signalType.includes('FAIR_VALUE') || signalType.includes('LIQUIDITY') ||
    signalType.includes('BREAK_OF_STRUCTURE') || signalType.includes('INSIDER'))
    return 'SMART_MONEY';
  if (signalType.includes('PAIR') || signalType.includes('SPREAD') || signalType.includes('STAT_ARB'))
    return 'STAT_ARB';
  if (signalType.includes('OPTION') || signalType.includes('IV') || signalType.includes('SKEW'))
    return 'OPTIONS';
  if (signalType.includes('CRYPTO') || signalType.includes('DEFI') || signalType.includes('DEX'))
    return 'CRYPTO_DEFI';
  if (signalType.includes('EVENT') || signalType.includes('EARNINGS') || signalType.includes('MACRO'))
    return 'EVENT_DRIVEN';
  return 'MTF_MOMENTUM'; // Default — most signals are technical
}
