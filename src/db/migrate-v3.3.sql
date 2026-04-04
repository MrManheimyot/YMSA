-- ─── YMSA v3.3 Migration — Config Table + Z.AI Health ────────
-- Run: wrangler d1 execute ymsa-db --file=src/db/migrate-v3.3.sql

-- Runtime configuration override table
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Z.AI health stats (hourly aggregation)
CREATE TABLE IF NOT EXISTS z_ai_health (
  hour TEXT PRIMARY KEY,     -- ISO format: 2026-04-04T18
  total_calls INTEGER DEFAULT 0,
  successful_calls INTEGER DEFAULT 0,
  failed_calls INTEGER DEFAULT 0,
  approvals INTEGER DEFAULT 0,
  rejections INTEGER DEFAULT 0,
  unavailable INTEGER DEFAULT 0,
  avg_response_length REAL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- Engine probation persistence
CREATE TABLE IF NOT EXISTS engine_probation (
  engine_id TEXT PRIMARY KEY,
  on_probation INTEGER DEFAULT 0,
  budget_override REAL DEFAULT NULL,
  reason TEXT,
  started_at INTEGER,
  updated_at INTEGER NOT NULL
);

-- Add trailing_state column to trades (if not exists)
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE,
-- so handle gracefully in application code
-- ALTER TABLE trades ADD COLUMN trailing_state TEXT DEFAULT NULL;

-- Seed default Tier A config
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('risk_per_trade', '0.02', 0);
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('max_position_pct', '0.10', 0);
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('kelly_fraction', '0.50', 0);
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('max_open_positions', '8', 0);
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('confidence_gate', '85', 0);
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('merge_min_engines', '2', 0);
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('max_leverage', '1.0', 0);
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('max_daily_trades', '15', 0);
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('kill_switch_drawdown_pct', '5', 0);
INSERT OR IGNORE INTO config (key, value, updated_at) VALUES ('daily_loss_limit_usd', '5000', 0);
