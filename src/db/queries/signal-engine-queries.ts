// ─── Signal, Engine Performance & Engine Budget CRUD ─────────

import type { SignalRecord, EnginePerformanceRecord } from './types';

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

// ─── Engine Budget Persistence ───────────────────────────────

export async function upsertEngineBudget(
  db: D1Database,
  engineId: string,
  budget: number,
  onProbation: boolean,
  originalBudget: number | null,
): Promise<void> {
  await db.prepare(
    `INSERT INTO engine_budgets (engine_id, budget, on_probation, original_budget, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(engine_id) DO UPDATE SET budget = excluded.budget, on_probation = excluded.on_probation, original_budget = excluded.original_budget, updated_at = excluded.updated_at`
  ).bind(engineId, budget, onProbation ? 1 : 0, originalBudget, Date.now()).run();
}

export async function loadEngineBudgets(
  db: D1Database,
): Promise<Array<{ engine_id: string; budget: number; on_probation: boolean; original_budget: number | null }>> {
  const result = await db.prepare(`SELECT * FROM engine_budgets`).all();
  return ((result.results || []) as unknown as Array<{ engine_id: string; budget: number; on_probation: number; original_budget: number | null }>)
    .map(r => ({ engine_id: r.engine_id, budget: r.budget, on_probation: r.on_probation === 1, original_budget: r.original_budget }));
}
