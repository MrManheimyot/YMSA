// ─── Regime, Risk, News, Kill Switch CRUD ───────────────────

import type { KillSwitchState } from './types';

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

// ─── Kill Switch State ──────────────────────────────────────

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
