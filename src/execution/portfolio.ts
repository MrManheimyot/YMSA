// ─── Portfolio Manager ───────────────────────────────────────
// Portfolio snapshot, daily P&L, Sharpe ratio, max drawdown
// Syncs Alpaca positions with D1 records

import type { Env } from '../types';
import { getAccount, getPositions } from '../api/alpaca';
import {
  getOpenPositions, upsertPosition, deletePosition,
  upsertDailyPnl, getRecentDailyPnl, upsertEnginePerformance,
  getRecentTrades,
  generateId,
} from '../db/queries';

// ─── Types ───────────────────────────────────────────────────

export interface PortfolioSnapshot {
  equity: number;
  cash: number;
  buyingPower: number;
  positions: PositionSummary[];
  totalUnrealizedPnl: number;
  dailyPnl: number;
  dailyPnlPct: number;
}

export interface PositionSummary {
  symbol: string;
  side: string;
  qty: number;
  avgEntry: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  engineId: string;
}

export interface PerformanceMetrics {
  sharpeRatio: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  winRate: number;
  totalTrades: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  cagr: number;
}

// ─── Portfolio Snapshot ──────────────────────────────────────

/**
 * Build a complete portfolio snapshot by syncing Alpaca positions with D1.
 */
export async function getPortfolioSnapshot(env: Env): Promise<PortfolioSnapshot | null> {
  const account = await getAccount(env);
  if (!account) return null;

  const alpacaPositions = await getPositions(env);
  const d1Positions = await getOpenPositions(env.DB);

  // Build position summaries from Alpaca data, enriched with D1 engine mapping
  const positions: PositionSummary[] = alpacaPositions.map(ap => {
    const d1Match = d1Positions.find(d => d.symbol === ap.symbol);
    return {
      symbol: ap.symbol,
      side: ap.side,
      qty: parseFloat(ap.qty),
      avgEntry: parseFloat(ap.avg_entry_price),
      currentPrice: parseFloat(ap.current_price),
      unrealizedPnl: parseFloat(ap.unrealized_pl),
      unrealizedPnlPct: parseFloat(ap.unrealized_plpc) * 100,
      engineId: d1Match?.engine_id || 'UNKNOWN',
    };
  });

  // Sync D1 positions with Alpaca reality
  for (const d1 of d1Positions) {
    const inAlpaca = alpacaPositions.find(a => a.symbol === d1.symbol);
    if (!inAlpaca) {
      // Position closed externally — clean up D1
      await deletePosition(env.DB, d1.id);
    } else {
      // Update D1 with current price
      await upsertPosition(env.DB, {
        ...d1,
        current_price: parseFloat(inAlpaca.current_price),
        unrealized_pnl: parseFloat(inAlpaca.unrealized_pl),
      });
    }
  }

  const equity = parseFloat(account.equity);
  const totalUnrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);

  return {
    equity,
    cash: parseFloat(account.cash),
    buyingPower: parseFloat(account.buying_power),
    positions,
    totalUnrealizedPnl,
    dailyPnl: totalUnrealizedPnl, // simplified — full impl would track from market open
    dailyPnlPct: equity > 0 ? (totalUnrealizedPnl / equity) * 100 : 0,
  };
}

// ─── Daily P&L Recording ────────────────────────────────────

/**
 * Record end-of-day P&L snapshot to D1.
 * Call from the MARKET_CLOSE cron job.
 */
export async function recordDailyPnl(env: Env): Promise<void> {
  const snapshot = await getPortfolioSnapshot(env);
  if (!snapshot) return;

  const today = new Date().toISOString().split('T')[0];
  const trades = await getRecentTrades(env.DB, 100);
  const todayTrades = trades.filter(t => {
    const tradeDate = new Date(t.opened_at).toISOString().split('T')[0];
    return tradeDate === today;
  });
  const closedToday = todayTrades.filter(t => t.status === 'CLOSED');
  const wins = closedToday.filter(t => (t.pnl ?? 0) > 0).length;
  const winRate = closedToday.length > 0 ? wins / closedToday.length : 0;

  // Calculate Sharpe from last 30 days
  const recent = await getRecentDailyPnl(env.DB, 30);
  const returns = recent.map(d => d.daily_pnl_pct / 100);
  const sharpe = calculateSharpe(returns);
  const maxDD = calculateMaxDrawdown(recent.map(d => d.total_equity));

  await upsertDailyPnl(env.DB, {
    date: today,
    total_equity: snapshot.equity,
    daily_pnl: snapshot.dailyPnl,
    daily_pnl_pct: snapshot.dailyPnlPct,
    open_positions: snapshot.positions.length,
    trades_today: todayTrades.length,
    win_rate: winRate,
    sharpe_snapshot: sharpe,
    max_drawdown: maxDD,
  });
}

/**
 * Record per-engine performance for weight adjustment.
 */
export async function recordEnginePerformance(
  engineId: string,
  signalsGenerated: number,
  tradesExecuted: number,
  pnl: number,
  weight: number,
  env: Env
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const trades = await getRecentTrades(env.DB, 200);
  const engineTrades = trades.filter(t => t.engine_id === engineId && t.status === 'CLOSED');
  const wins = engineTrades.filter(t => (t.pnl ?? 0) > 0).length;
  const winRate = engineTrades.length > 0 ? wins / engineTrades.length : 0;
  const avgRR = engineTrades.length > 0
    ? engineTrades.reduce((s, t) => s + Math.abs(t.pnl ?? 0), 0) / engineTrades.length
    : null;

  await upsertEnginePerformance(env.DB, {
    id: generateId('eng'),
    engine_id: engineId,
    date: today,
    signals_generated: signalsGenerated,
    trades_executed: tradesExecuted,
    win_rate: winRate,
    pnl,
    avg_rr: avgRR,
    weight,
  });
}

// ─── Performance Metrics ─────────────────────────────────────

/**
 * Calculate comprehensive performance metrics from trade history.
 */
export async function getPerformanceMetrics(env: Env): Promise<PerformanceMetrics> {
  const trades = await getRecentTrades(env.DB, 500);
  const closed = trades.filter(t => t.status === 'CLOSED');

  const wins = closed.filter(t => (t.pnl ?? 0) > 0);
  const losses = closed.filter(t => (t.pnl ?? 0) <= 0);

  const avgWin = wins.length > 0
    ? wins.reduce((s, t) => s + (t.pnl ?? 0), 0) / wins.length
    : 0;
  const avgLoss = losses.length > 0
    ? Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0) / losses.length)
    : 0;
  const totalWins = wins.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const totalLosses = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0));

  const dailyPnl = await getRecentDailyPnl(env.DB, 252); // 1 year
  const returns = dailyPnl.map(d => d.daily_pnl_pct / 100);
  const equities = dailyPnl.map(d => d.total_equity);

  return {
    sharpeRatio: calculateSharpe(returns),
    maxDrawdown: calculateMaxDrawdown(equities),
    maxDrawdownPct: calculateMaxDrawdownPct(equities),
    winRate: closed.length > 0 ? wins.length / closed.length : 0,
    totalTrades: closed.length,
    avgWin,
    avgLoss,
    profitFactor: totalLosses > 0 ? totalWins / totalLosses : 0,
    cagr: calculateCAGR(equities, dailyPnl.length),
  };
}

// ─── Formatting ──────────────────────────────────────────────

export function formatPortfolioSnapshot(snap: PortfolioSnapshot): string {
  const lines = [
    `💼 <b>Portfolio Snapshot</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `💰 Equity: $${snap.equity.toLocaleString()}`,
    `💵 Cash: $${snap.cash.toLocaleString()}`,
    `📈 Day P&L: ${snap.dailyPnl >= 0 ? '+' : ''}$${snap.dailyPnl.toFixed(0)} (${snap.dailyPnlPct.toFixed(2)}%)`,
    `📊 Open Positions: ${snap.positions.length}`,
    ``,
  ];

  for (const pos of snap.positions) {
    const emoji = pos.unrealizedPnl >= 0 ? '🟢' : '🔴';
    lines.push(
      `${emoji} ${pos.symbol}: ${pos.qty} @ $${pos.avgEntry.toFixed(2)} → $${pos.currentPrice.toFixed(2)} (${pos.unrealizedPnlPct >= 0 ? '+' : ''}${pos.unrealizedPnlPct.toFixed(1)}%) [${pos.engineId}]`
    );
  }

  return lines.join('\n');
}

export function formatPerformanceReport(metrics: PerformanceMetrics): string {
  return [
    `📊 <b>Performance Report</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `📈 Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)}`,
    `📉 Max Drawdown: ${metrics.maxDrawdownPct.toFixed(1)}%`,
    `🎯 Win Rate: ${(metrics.winRate * 100).toFixed(1)}%`,
    `📊 Total Trades: ${metrics.totalTrades}`,
    `💰 Avg Win: $${metrics.avgWin.toFixed(0)}`,
    `💸 Avg Loss: $${metrics.avgLoss.toFixed(0)}`,
    `⚖️ Profit Factor: ${metrics.profitFactor.toFixed(2)}`,
    `🚀 CAGR: ${(metrics.cagr * 100).toFixed(1)}%`,
  ].join('\n');
}

// ─── Math Helpers ────────────────────────────────────────────

function calculateSharpe(returns: number[], riskFreeRate: number = 0.05): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  const annualizedReturn = mean * 252;
  const annualizedStd = std * Math.sqrt(252);
  return (annualizedReturn - riskFreeRate) / annualizedStd;
}

function calculateMaxDrawdown(equities: number[]): number {
  if (equities.length < 2) return 0;
  let peak = equities[0];
  let maxDD = 0;
  for (const eq of equities) {
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function calculateMaxDrawdownPct(equities: number[]): number {
  if (equities.length < 2) return 0;
  let peak = equities[0];
  let maxDD = 0;
  for (const eq of equities) {
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? (peak - eq) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD * 100;
}

function calculateCAGR(equities: number[], tradingDays: number): number {
  if (equities.length < 2 || tradingDays < 1) return 0;
  const start = equities[0];
  const end = equities[equities.length - 1];
  if (start <= 0) return 0;
  const years = tradingDays / 252;
  return Math.pow(end / start, 1 / years) - 1;
}
