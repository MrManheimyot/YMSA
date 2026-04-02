// ─── D1 Database Query Layer ─────────────────────────────────
// CRUD operations for all 9 D1 tables
// Thin wrapper — no business logic, just data access

// ─── Types ───────────────────────────────────────────────────

export interface TradeRecord {
  id: string;
  engine_id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  entry_price: number;
  exit_price: number | null;
  stop_loss: number;
  take_profit: number;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  pnl: number | null;
  pnl_pct: number | null;
  opened_at: number;
  closed_at: number | null;
  broker_order_id: string | null;
}

export interface PositionRecord {
  id: string;
  symbol: string;
  engine_id: string;
  side: 'LONG' | 'SHORT';
  qty: number;
  avg_entry: number;
  current_price: number;
  unrealized_pnl: number;
  stop_loss: number;
  take_profit: number;
  opened_at: number;
}

export interface SignalRecord {
  id: string;
  engine_id: string;
  signal_type: string;
  symbol: string;
  direction: 'BUY' | 'SELL' | 'HOLD';
  strength: number;
  metadata: string;
  created_at: number;
  acted_on: number;
}

export interface DailyPnlRecord {
  date: string;
  total_equity: number;
  daily_pnl: number;
  daily_pnl_pct: number;
  open_positions: number;
  trades_today: number;
  win_rate: number;
  sharpe_snapshot: number | null;
  max_drawdown: number | null;
}

export interface EnginePerformanceRecord {
  id: string;
  engine_id: string;
  date: string;
  signals_generated: number;
  trades_executed: number;
  win_rate: number;
  pnl: number;
  avg_rr: number | null;
  weight: number;
}

// ─── Trade Queries ───────────────────────────────────────────

export async function insertTrade(db: D1Database, trade: Omit<TradeRecord, 'closed_at' | 'exit_price' | 'pnl' | 'pnl_pct'>): Promise<void> {
  await db.prepare(
    `INSERT INTO trades (id, engine_id, symbol, side, qty, entry_price, exit_price, stop_loss, take_profit, status, pnl, pnl_pct, opened_at, closed_at, broker_order_id)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'OPEN', NULL, NULL, ?, NULL, ?)`
  ).bind(
    trade.id, trade.engine_id, trade.symbol, trade.side, trade.qty,
    trade.entry_price, trade.stop_loss, trade.take_profit, trade.opened_at,
    trade.broker_order_id
  ).run();
}

export async function closeTrade(
  db: D1Database,
  tradeId: string,
  exitPrice: number,
  pnl: number,
  pnlPct: number
): Promise<void> {
  await db.prepare(
    `UPDATE trades SET status = 'CLOSED', exit_price = ?, pnl = ?, pnl_pct = ?, closed_at = ?
     WHERE id = ?`
  ).bind(exitPrice, pnl, pnlPct, Date.now(), tradeId).run();
}

export async function getOpenTrades(db: D1Database): Promise<TradeRecord[]> {
  const result = await db.prepare(`SELECT * FROM trades WHERE status = 'OPEN' ORDER BY opened_at DESC`).all();
  return (result.results || []) as unknown as TradeRecord[];
}

export async function cancelTrade(db: D1Database, tradeId: string): Promise<void> {
  await db.prepare(
    `UPDATE trades SET status = 'CANCELLED', closed_at = ? WHERE id = ?`
  ).bind(Date.now(), tradeId).run();
}

export async function getTradesByEngine(db: D1Database, engineId: string, limit: number = 50): Promise<TradeRecord[]> {
  const result = await db.prepare(
    `SELECT * FROM trades WHERE engine_id = ? ORDER BY opened_at DESC LIMIT ?`
  ).bind(engineId, limit).all();
  return (result.results || []) as unknown as TradeRecord[];
}

export async function getRecentTrades(db: D1Database, limit: number = 20): Promise<TradeRecord[]> {
  const result = await db.prepare(
    `SELECT * FROM trades ORDER BY opened_at DESC LIMIT ?`
  ).bind(limit).all();
  return (result.results || []) as unknown as TradeRecord[];
}

export async function getClosedTradesSince(db: D1Database, sinceMs: number): Promise<TradeRecord[]> {
  const result = await db.prepare(
    `SELECT * FROM trades WHERE status = 'CLOSED' AND closed_at >= ? ORDER BY pnl DESC`
  ).bind(sinceMs).all();
  return (result.results || []) as unknown as TradeRecord[];
}

// ─── Position Queries ────────────────────────────────────────

export async function upsertPosition(db: D1Database, pos: PositionRecord): Promise<void> {
  await db.prepare(
    `INSERT OR REPLACE INTO positions (id, symbol, engine_id, side, qty, avg_entry, current_price, unrealized_pnl, stop_loss, take_profit, opened_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    pos.id, pos.symbol, pos.engine_id, pos.side, pos.qty,
    pos.avg_entry, pos.current_price, pos.unrealized_pnl,
    pos.stop_loss, pos.take_profit, pos.opened_at
  ).run();
}

export async function deletePosition(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM positions WHERE id = ?`).bind(id).run();
}

export async function getOpenPositions(db: D1Database): Promise<PositionRecord[]> {
  const result = await db.prepare(`SELECT * FROM positions ORDER BY opened_at DESC`).all();
  return (result.results || []) as unknown as PositionRecord[];
}

export async function getPositionBySymbol(db: D1Database, symbol: string): Promise<PositionRecord | null> {
  const result = await db.prepare(
    `SELECT * FROM positions WHERE symbol = ? LIMIT 1`
  ).bind(symbol).first();
  return result as unknown as PositionRecord | null;
}

// ─── Signal Queries ──────────────────────────────────────────

export async function insertSignal(db: D1Database, signal: SignalRecord): Promise<void> {
  await db.prepare(
    `INSERT INTO signals (id, engine_id, signal_type, symbol, direction, strength, metadata, created_at, acted_on)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    signal.id, signal.engine_id, signal.signal_type, signal.symbol,
    signal.direction, signal.strength, signal.metadata, signal.created_at,
    signal.acted_on
  ).run();
}

export async function getRecentSignals(db: D1Database, limit: number = 50): Promise<SignalRecord[]> {
  const result = await db.prepare(
    `SELECT * FROM signals ORDER BY created_at DESC LIMIT ?`
  ).bind(limit).all();
  return (result.results || []) as unknown as SignalRecord[];
}

export async function getSignalsByEngine(db: D1Database, engineId: string, limit: number = 20): Promise<SignalRecord[]> {
  const result = await db.prepare(
    `SELECT * FROM signals WHERE engine_id = ? ORDER BY created_at DESC LIMIT ?`
  ).bind(engineId, limit).all();
  return (result.results || []) as unknown as SignalRecord[];
}

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

// ─── Engine Performance Queries ──────────────────────────────

export async function upsertEnginePerformance(db: D1Database, record: EnginePerformanceRecord): Promise<void> {
  await db.prepare(
    `INSERT OR REPLACE INTO engine_performance (id, engine_id, date, signals_generated, trades_executed, win_rate, pnl, avg_rr, weight)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    record.id, record.engine_id, record.date, record.signals_generated,
    record.trades_executed, record.win_rate, record.pnl, record.avg_rr,
    record.weight
  ).run();
}

export async function getEnginePerformance(db: D1Database, engineId: string, days: number = 30): Promise<EnginePerformanceRecord[]> {
  const result = await db.prepare(
    `SELECT * FROM engine_performance WHERE engine_id = ? ORDER BY date DESC LIMIT ?`
  ).bind(engineId, days).all();
  return (result.results || []) as unknown as EnginePerformanceRecord[];
}

export async function getAllLatestEnginePerformance(db: D1Database): Promise<EnginePerformanceRecord[]> {
  const result = await db.prepare(
    `SELECT ep.* FROM engine_performance ep
     INNER JOIN (SELECT engine_id, MAX(date) as max_date FROM engine_performance GROUP BY engine_id) latest
     ON ep.engine_id = latest.engine_id AND ep.date = latest.max_date
     ORDER BY ep.engine_id`
  ).all();
  return (result.results || []) as unknown as EnginePerformanceRecord[];
}

// ─── Regime History Queries ──────────────────────────────────

export async function insertRegimeChange(
  db: D1Database,
  id: string,
  regime: string,
  vix: number,
  spy_trend: string,
  confidence: number
): Promise<void> {
  await db.prepare(
    `INSERT INTO regime_history (id, regime, detected_at, vix_level, spy_trend, confidence)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, regime, Date.now(), vix, spy_trend, confidence).run();
}

export async function getLatestRegime(db: D1Database): Promise<{ regime: string; vix_level: number; confidence: number } | null> {
  const result = await db.prepare(
    `SELECT regime, vix_level, confidence FROM regime_history ORDER BY detected_at DESC LIMIT 1`
  ).first();
  return result as { regime: string; vix_level: number; confidence: number } | null;
}

// ─── Risk Events Queries ─────────────────────────────────────

export async function insertRiskEvent(
  db: D1Database,
  id: string,
  eventType: string,
  severity: string,
  description: string,
  action: string
): Promise<void> {
  await db.prepare(
    `INSERT INTO risk_events (id, event_type, severity, description, action_taken, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, eventType, severity, description, action, Date.now()).run();
}

export async function getRecentRiskEvents(db: D1Database, limit: number = 20): Promise<Array<{
  id: string; event_type: string; severity: string; description: string; action_taken: string; created_at: number;
}>> {
  const result = await db.prepare(
    `SELECT * FROM risk_events ORDER BY created_at DESC LIMIT ?`
  ).bind(limit).all();
  return (result.results || []) as unknown as Array<{
    id: string; event_type: string; severity: string; description: string; action_taken: string; created_at: number;
  }>;
}

// ─── News Alerts Queries ─────────────────────────────────────

export async function getRecentNewsAlerts(db: D1Database, limit: number = 30): Promise<Array<{
  id: string; category: string; title: string; url: string; published_at: number; processed: number;
}>> {
  const result = await db.prepare(
    `SELECT * FROM news_alerts ORDER BY published_at DESC LIMIT ?`
  ).bind(limit).all();
  return (result.results || []) as unknown as Array<{
    id: string; category: string; title: string; url: string; published_at: number; processed: number;
  }>;
}

export async function getNewsAlertsByCategory(db: D1Database, category: string, limit: number = 20): Promise<Array<{
  id: string; category: string; title: string; url: string; published_at: number; processed: number;
}>> {
  const result = await db.prepare(
    `SELECT * FROM news_alerts WHERE category = ? ORDER BY published_at DESC LIMIT ?`
  ).bind(category, limit).all();
  return (result.results || []) as unknown as Array<{
    id: string; category: string; title: string; url: string; published_at: number; processed: number;
  }>;
}

// ─── Utility ─────────────────────────────────────────────────

export function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Kill Switch State ──────────────────────────────────────

export interface KillSwitchState {
  tier: 'NONE' | 'REDUCE' | 'CLOSE_ALL' | 'HALT';
  activated_at: number | null;
  daily_pnl_pct: number | null;
  reason: string | null;
  updated_at: number;
}

export async function getKillSwitchState(db: D1Database): Promise<KillSwitchState | null> {
  try {
    const result = await db.prepare(
      `SELECT tier, activated_at, daily_pnl_pct, reason, updated_at FROM kill_switch_state WHERE id = 'singleton'`
    ).first();
    return result as KillSwitchState | null;
  } catch {
    return null;
  }
}

export async function upsertKillSwitchState(
  db: D1Database,
  tier: string,
  dailyPnlPct: number | null,
  reason: string | null,
): Promise<void> {
  const now = Date.now();
  await db.prepare(
    `INSERT INTO kill_switch_state (id, tier, activated_at, daily_pnl_pct, reason, updated_at)
     VALUES ('singleton', ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       tier = excluded.tier,
       activated_at = CASE WHEN excluded.tier != 'NONE' AND kill_switch_state.tier = 'NONE' THEN ? ELSE kill_switch_state.activated_at END,
       daily_pnl_pct = excluded.daily_pnl_pct,
       reason = excluded.reason,
       updated_at = excluded.updated_at`
  ).bind(tier, tier !== 'NONE' ? now : null, dailyPnlPct, reason, now, now).run();
}

// ─── Telegram Alert Log Queries ─────────────────────────────

export interface TelegramAlertRecord {
  id: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  engine_id: string;
  entry_price: number;
  stop_loss: number | null;
  take_profit_1: number | null;
  take_profit_2: number | null;
  confidence: number;
  alert_text: string;
  outcome: 'PENDING' | 'WIN' | 'LOSS' | 'BREAKEVEN' | 'EXPIRED';
  outcome_price: number | null;
  outcome_pnl: number | null;
  outcome_pnl_pct: number | null;
  outcome_notes: string | null;
  outcome_at: number | null;
  regime: string | null;
  metadata: string | null;
  sent_at: number;
}

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

export async function getPnlDashboardData(db: D1Database): Promise<{
  dailyPnl: DailyPnlRecord[];
  monthlyPnl: Array<{ month: string; pnl: number; pnl_pct: number; trades: number; win_rate: number }>;
  equityCurve: Array<{ date: string; equity: number }>;
  drawdownSeries: Array<{ date: string; drawdown_pct: number }>;
  tradesByEngine: Array<{ engine_id: string; count: number; pnl: number; win_rate: number }>;
  tradesBySymbol: Array<{ symbol: string; count: number; pnl: number; win_rate: number }>;
  streaks: { currentStreak: number; currentType: 'WIN' | 'LOSS' | 'NONE'; longestWin: number; longestLoss: number };
}> {
  // Daily P&L (all time)
  const dailyResult = await db.prepare(`SELECT * FROM daily_pnl ORDER BY date ASC`).all();
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
