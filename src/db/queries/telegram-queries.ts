// ─── Telegram Alert CRUD + Stats + Resolution ───────────────

import type { TelegramAlertRecord } from './types';

// ─── Basic CRUD ──────────────────────────────────────────────

export async function insertTelegramAlert(db: D1Database, alert: Omit<TelegramAlertRecord, 'outcome' | 'outcome_price' | 'outcome_pnl' | 'outcome_pnl_pct' | 'outcome_notes' | 'outcome_at'>): Promise<void> {
  await db.prepare(
    `INSERT INTO telegram_alerts (id, symbol, action, engine_id, entry_price, stop_loss, take_profit_1, take_profit_2, confidence, alert_text, outcome, regime, metadata, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)`
  ).bind(
    alert.id, alert.symbol, alert.action, alert.engine_id,
    alert.entry_price, alert.stop_loss, alert.take_profit_1, alert.take_profit_2,
    alert.confidence, alert.alert_text, alert.regime, alert.metadata, alert.sent_at
  ).run();
}

export async function updateTelegramAlertOutcome(
  db: D1Database,
  id: string,
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'EXPIRED',
  outcomePrice: number | null,
  outcomePnl: number | null,
  outcomePnlPct: number | null,
  outcomeNotes: string | null
): Promise<void> {
  await db.prepare(
    `UPDATE telegram_alerts SET outcome = ?, outcome_price = ?, outcome_pnl = ?, outcome_pnl_pct = ?, outcome_notes = ?, outcome_at = ? WHERE id = ?`
  ).bind(outcome, outcomePrice, outcomePnl, outcomePnlPct, outcomeNotes, Date.now(), id).run();
}

export async function getRecentTelegramAlerts(db: D1Database, limit: number = 50): Promise<TelegramAlertRecord[]> {
  const result = await db.prepare(
    `SELECT * FROM telegram_alerts ORDER BY sent_at DESC LIMIT ?`
  ).bind(limit).all();
  return (result.results || []) as unknown as TelegramAlertRecord[];
}

export async function getTelegramAlertById(db: D1Database, id: string): Promise<TelegramAlertRecord | null> {
  const result = await db.prepare(
    `SELECT * FROM telegram_alerts WHERE id = ?`
  ).bind(id).first();
  return result as unknown as TelegramAlertRecord | null;
}

// ─── Stats Aggregation ──────────────────────────────────────

export async function getTelegramAlertStats(db: D1Database): Promise<{
  total: number;
  wins: number;
  losses: number;
  pending: number;
  breakeven: number;
  expired: number;
  winRate: number;
  avgWinPnl: number;
  avgLossPnl: number;
  totalPnl: number;
  profitFactor: number;
  bestTrade: TelegramAlertRecord | null;
  worstTrade: TelegramAlertRecord | null;
  expectancy: number;
  byEngine: Array<{ engine: string; total: number; wins: number; losses: number; winRate: number; avgConf: number; pnl: number }>;
}> {
  const all = await db.prepare(`SELECT * FROM telegram_alerts ORDER BY sent_at DESC`).all();
  const alerts = (all.results || []) as unknown as TelegramAlertRecord[];
  const resolved = alerts.filter(a => a.outcome !== 'PENDING');
  const wins = alerts.filter(a => a.outcome === 'WIN');
  const losses = alerts.filter(a => a.outcome === 'LOSS');
  const pending = alerts.filter(a => a.outcome === 'PENDING');
  const breakeven = alerts.filter(a => a.outcome === 'BREAKEVEN');
  const expired = alerts.filter(a => a.outcome === 'EXPIRED');

  const totalWinPnl = wins.reduce((s, a) => s + (a.outcome_pnl || 0), 0);
  const totalLossPnl = Math.abs(losses.reduce((s, a) => s + (a.outcome_pnl || 0), 0));

  const sorted = [...resolved].sort((a, b) => (b.outcome_pnl || 0) - (a.outcome_pnl || 0));

  // Per-engine breakdown
  const engineMap = new Map<string, { total: number; wins: number; losses: number; confSum: number; pnl: number }>();
  for (const a of alerts) {
    const engines = a.engine_id.split('+');
    for (const eng of engines) {
      const e = engineMap.get(eng) || { total: 0, wins: 0, losses: 0, confSum: 0, pnl: 0 };
      e.total++;
      e.confSum += a.confidence || 0;
      if (a.outcome === 'WIN') e.wins++;
      if (a.outcome === 'LOSS') e.losses++;
      e.pnl += a.outcome_pnl || 0;
      engineMap.set(eng, e);
    }
  }
  const byEngine = [...engineMap.entries()]
    .map(([engine, e]) => ({
      engine,
      total: e.total,
      wins: e.wins,
      losses: e.losses,
      winRate: (e.wins + e.losses) > 0 ? e.wins / (e.wins + e.losses) : 0,
      avgConf: e.total > 0 ? Math.round(e.confSum / e.total) : 0,
      pnl: e.pnl,
    }))
    .sort((a, b) => b.total - a.total);

  const avgWin = wins.length > 0 ? totalWinPnl / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLossPnl / losses.length : 0;
  const wr = resolved.length > 0 ? wins.length / resolved.length : 0;

  return {
    total: alerts.length,
    wins: wins.length,
    losses: losses.length,
    pending: pending.length,
    breakeven: breakeven.length,
    expired: expired.length,
    winRate: wr,
    avgWinPnl: avgWin,
    avgLossPnl: avgLoss,
    totalPnl: totalWinPnl - totalLossPnl,
    profitFactor: totalLossPnl > 0 ? totalWinPnl / totalLossPnl : totalWinPnl > 0 ? Infinity : 0,
    bestTrade: sorted[0] || null,
    worstTrade: sorted[sorted.length - 1] || null,
    expectancy: resolved.length > 0 ? (wr * avgWin) - ((1 - wr) * avgLoss) : 0,
    byEngine,
  };
}

// ─── Pending Alert Resolution Helpers ────────────────────────

/** Get all PENDING alerts (for auto-resolution against current prices) */
export async function getPendingTelegramAlerts(db: D1Database): Promise<TelegramAlertRecord[]> {
  const result = await db.prepare(
    `SELECT * FROM telegram_alerts WHERE outcome = 'PENDING' ORDER BY sent_at ASC`
  ).all();
  return (result.results || []) as unknown as TelegramAlertRecord[];
}

/** Expire PENDING alerts older than the given age in milliseconds */
export async function expireOldTelegramAlerts(db: D1Database, maxAgeMs: number): Promise<number> {
  const cutoff = Date.now() - maxAgeMs;
  const result = await db.prepare(
    `UPDATE telegram_alerts SET outcome = 'EXPIRED', outcome_at = ?, outcome_notes = 'Auto-expired after timeout' WHERE outcome = 'PENDING' AND sent_at < ?`
  ).bind(Date.now(), cutoff).run();
  return result.meta?.changes ?? 0;
}
