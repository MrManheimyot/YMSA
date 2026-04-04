// ─── Trade & Position CRUD ───────────────────────────────────

import type { TradeRecord, PositionRecord } from './types';

// ─── Trade Queries ───────────────────────────────────────────

export async function insertTrade(db: D1Database, trade: Omit<TradeRecord, 'closed_at' | 'exit_price' | 'pnl' | 'pnl_pct'>): Promise<void> {
  await db.prepare(
    `INSERT INTO trades (id, engine_id, symbol, side, qty, entry_price, exit_price, stop_loss, take_profit, status, pnl, pnl_pct, opened_at, closed_at, broker_order_id, trailing_state)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 'OPEN', NULL, NULL, ?, NULL, ?, ?)`
  ).bind(
    trade.id, trade.engine_id, trade.symbol, trade.side, trade.qty,
    trade.entry_price, trade.stop_loss, trade.take_profit, trade.opened_at,
    trade.broker_order_id, trade.trailing_state ?? null
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

export async function updateTrailingState(
  db: D1Database,
  tradeId: string,
  stopLoss: number,
  trailingStateJson: string,
): Promise<void> {
  await db.prepare(
    `UPDATE trades SET stop_loss = ?, trailing_state = ? WHERE id = ?`
  ).bind(stopLoss, trailingStateJson, tradeId).run();
}

export async function updateTradeQty(
  db: D1Database,
  tradeId: string,
  newQty: number,
): Promise<void> {
  await db.prepare(
    `UPDATE trades SET qty = ? WHERE id = ?`
  ).bind(newQty, tradeId).run();
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
