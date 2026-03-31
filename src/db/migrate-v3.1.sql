-- v3.1 Migration: Add telegram_alerts table
-- Run: node .\node_modules\wrangler\bin\wrangler.js d1 execute ymsa-db --remote --file=src/db/migrate-v3.1.sql

CREATE TABLE IF NOT EXISTS telegram_alerts (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL,
  engine_id TEXT NOT NULL,
  entry_price REAL NOT NULL,
  stop_loss REAL,
  take_profit_1 REAL,
  take_profit_2 REAL,
  confidence INTEGER DEFAULT 0,
  alert_text TEXT NOT NULL,
  outcome TEXT DEFAULT 'PENDING',
  outcome_price REAL,
  outcome_pnl REAL,
  outcome_pnl_pct REAL,
  outcome_notes TEXT,
  outcome_at INTEGER,
  regime TEXT,
  metadata TEXT,
  sent_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tg_alerts_symbol ON telegram_alerts(symbol);
CREATE INDEX IF NOT EXISTS idx_tg_alerts_outcome ON telegram_alerts(outcome);
CREATE INDEX IF NOT EXISTS idx_tg_alerts_sent ON telegram_alerts(sent_at);
CREATE INDEX IF NOT EXISTS idx_tg_alerts_engine ON telegram_alerts(engine_id);
