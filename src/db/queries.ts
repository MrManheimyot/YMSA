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
