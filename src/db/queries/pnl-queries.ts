// ─── Daily P&L CRUD + Dashboard Aggregation ─────────────────

import type { DailyPnlRecord } from './types';

// ─── Daily P&L Queries ──────────────────────────────────────

export async function upsertDailyPnl(db: D1Database, record: DailyPnlRecord): Promise<void> {
  await db.prepare(
    `INSERT OR REPLACE INTO daily_pnl (date, total_equity, daily_pnl, daily_pnl_pct, open_positions, trades_today, win_rate, sharpe_snapshot, max_drawdown)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    record.date, record.total_equity, record.daily_pnl, record.daily_pnl_pct,
    record.open_positions, record.trades_today, record.win_rate,
    record.sharpe_snapshot, record.max_drawdown
  ).run();
}

export async function getDailyPnlRange(db: D1Database, startDate: string, endDate: string): Promise<DailyPnlRecord[]> {
  const result = await db.prepare(
    `SELECT * FROM daily_pnl WHERE date BETWEEN ? AND ? ORDER BY date ASC`
  ).bind(startDate, endDate).all();
  return (result.results || []) as unknown as DailyPnlRecord[];
}

export async function getRecentDailyPnl(db: D1Database, days: number = 30): Promise<DailyPnlRecord[]> {
  const result = await db.prepare(
    `SELECT * FROM daily_pnl ORDER BY date DESC LIMIT ?`
  ).bind(days).all();
  return (result.results || []) as unknown as DailyPnlRecord[];
}

// ─── P&L Dashboard Aggregation ──────────────────────────────

export async function getPnlDashboardData(db: D1Database): Promise<{
  dailyPnl: DailyPnlRecord[];
  monthlyPnl: Array<{ month: string; pnl: number; pnl_pct: number; trades: number; win_rate: number }>;
  equityCurve: Array<{ date: string; equity: number }>;
  drawdownSeries: Array<{ date: string; drawdown_pct: number }>;
  tradesByEngine: Array<{ engine_id: string; count: number; pnl: number; win_rate: number }>;
  tradesBySymbol: Array<{ symbol: string; count: number; pnl: number; win_rate: number }>;
  streaks: { currentStreak: number; currentType: 'WIN' | 'LOSS' | 'NONE'; longestWin: number; longestLoss: number };
}> {
  // Daily P&L (last 365 days — avoids full table scan)
  const cutoff = new Date(Date.now() - 365 * 86_400_000).toISOString().split('T')[0];
  const dailyResult = await db.prepare(`SELECT * FROM daily_pnl WHERE date >= ? ORDER BY date ASC`).bind(cutoff).all();
  const dailyPnl = (dailyResult.results || []) as unknown as DailyPnlRecord[];

  // Equity curve from daily_pnl
  const equityCurve = dailyPnl.map(d => ({ date: d.date, equity: d.total_equity }));

  // Drawdown series
  let peak = 0;
  const drawdownSeries = dailyPnl.map(d => {
    if (d.total_equity > peak) peak = d.total_equity;
    const dd = peak > 0 ? ((d.total_equity - peak) / peak) * 100 : 0;
    return { date: d.date, drawdown_pct: dd };
  });

  // Monthly P&L aggregation
  const monthMap = new Map<string, { pnl: number; pnl_pcts: number[]; trades: number; wins: number; total_resolved: number }>();
  for (const d of dailyPnl) {
    const month = d.date.slice(0, 7); // YYYY-MM
    const entry = monthMap.get(month) || { pnl: 0, pnl_pcts: [], trades: 0, wins: 0, total_resolved: 0 };
    entry.pnl += d.daily_pnl;
    entry.pnl_pcts.push(d.daily_pnl_pct);
    entry.trades += d.trades_today;
    if (d.win_rate > 0) {
      entry.wins += Math.round(d.win_rate * d.trades_today);
      entry.total_resolved += d.trades_today;
    }
    monthMap.set(month, entry);
  }
  const monthlyPnl = [...monthMap.entries()].map(([month, data]) => ({
    month,
    pnl: data.pnl,
    pnl_pct: data.pnl_pcts.reduce((s, v) => s + v, 0),
    trades: data.trades,
    win_rate: data.total_resolved > 0 ? data.wins / data.total_resolved : 0,
  }));

  // Trades by engine
  const engineResult = await db.prepare(
    `SELECT engine_id,
            COUNT(*) as count,
            SUM(CASE WHEN pnl IS NOT NULL THEN pnl ELSE 0 END) as pnl,
            CAST(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS REAL) / NULLIF(SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END), 0) as win_rate
     FROM trades GROUP BY engine_id`
  ).all();
  const tradesByEngine = (engineResult.results || []) as unknown as Array<{ engine_id: string; count: number; pnl: number; win_rate: number }>;

  // Trades by symbol (top 20)
  const symbolResult = await db.prepare(
    `SELECT symbol,
            COUNT(*) as count,
            SUM(CASE WHEN pnl IS NOT NULL THEN pnl ELSE 0 END) as pnl,
            CAST(SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS REAL) / NULLIF(SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END), 0) as win_rate
     FROM trades GROUP BY symbol ORDER BY count DESC LIMIT 20`
  ).all();
  const tradesBySymbol = (symbolResult.results || []) as unknown as Array<{ symbol: string; count: number; pnl: number; win_rate: number }>;

  // Win/Loss streaks
  const closedTrades = await db.prepare(
    `SELECT pnl FROM trades WHERE status = 'CLOSED' ORDER BY closed_at ASC`
  ).all();
  const closedPnls = ((closedTrades.results || []) as unknown as Array<{ pnl: number }>).map(t => t.pnl);
  
  let currentStreak = 0;
  let currentType: 'WIN' | 'LOSS' | 'NONE' = 'NONE';
  let longestWin = 0;
  let longestLoss = 0;
  let winStreak = 0;
  let lossStreak = 0;
  for (const pnl of closedPnls) {
    if (pnl > 0) {
      winStreak++;
      lossStreak = 0;
      if (winStreak > longestWin) longestWin = winStreak;
    } else if (pnl < 0) {
      lossStreak++;
      winStreak = 0;
      if (lossStreak > longestLoss) longestLoss = lossStreak;
    }
  }
  if (closedPnls.length > 0) {
    const last = closedPnls[closedPnls.length - 1];
    currentType = last > 0 ? 'WIN' : last < 0 ? 'LOSS' : 'NONE';
    currentStreak = currentType === 'WIN' ? winStreak : currentType === 'LOSS' ? lossStreak : 0;
  }

  return {
    dailyPnl,
    monthlyPnl,
    equityCurve,
    drawdownSeries,
    tradesByEngine,
    tradesBySymbol,
    streaks: { currentStreak, currentType, longestWin, longestLoss },
  };
}
