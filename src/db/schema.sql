-- ═══════════════════════════════════════════════════════════════
-- YMSA v3.0 — D1 Database Schema
-- Google SRE: Structured, auditable, with proper indices
-- Columns MUST match queries.ts INSERT statements exactly
-- ═══════════════════════════════════════════════════════════════

-- Drop all tables to fix column mismatches (DB has 0 rows)
DROP TABLE IF EXISTS trades;
DROP TABLE IF EXISTS positions;
DROP TABLE IF EXISTS signals;
DROP TABLE IF EXISTS daily_pnl;
DROP TABLE IF EXISTS engine_performance;
DROP TABLE IF EXISTS regime_history;
DROP TABLE IF EXISTS pairs_state;
DROP TABLE IF EXISTS news_alerts;
DROP TABLE IF EXISTS risk_events;

-- ─── Trades (execution history) ──────────────────────────────
CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  engine_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,                -- BUY, SELL
  qty REAL NOT NULL,
  entry_price REAL NOT NULL,
  exit_price REAL,
  stop_loss REAL,
  take_profit REAL,
  status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN, CLOSED, CANCELLED
  pnl REAL,
  pnl_pct REAL,
  opened_at INTEGER NOT NULL,
  closed_at INTEGER,
  broker_order_id TEXT
);

CREATE INDEX idx_trades_engine ON trades(engine_id);
CREATE INDEX idx_trades_symbol ON trades(symbol);
CREATE INDEX idx_trades_status ON trades(status);
CREATE INDEX idx_trades_opened ON trades(opened_at);

-- ─── Positions (current open) ────────────────────────────────
CREATE TABLE positions (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  engine_id TEXT NOT NULL,
  side TEXT NOT NULL,                -- LONG, SHORT
  qty REAL NOT NULL,
  avg_entry REAL NOT NULL,
  current_price REAL DEFAULT 0,
  unrealized_pnl REAL DEFAULT 0,
  stop_loss REAL,
  take_profit REAL,
  opened_at INTEGER NOT NULL
);

CREATE INDEX idx_positions_engine ON positions(engine_id);
CREATE INDEX idx_positions_symbol ON positions(symbol);

-- ─── Signals (all generated signals for audit) ──────────────
CREATE TABLE signals (
  id TEXT PRIMARY KEY,
  engine_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,           -- BUY, SELL, HOLD
  strength REAL DEFAULT 0,
  metadata TEXT,                     -- JSON blob
  created_at INTEGER NOT NULL,
  acted_on INTEGER DEFAULT 0        -- 0=no trade, 1=trade generated
);

CREATE INDEX idx_signals_engine ON signals(engine_id);
CREATE INDEX idx_signals_symbol ON signals(symbol);
CREATE INDEX idx_signals_created ON signals(created_at);

-- ─── Daily P&L Snapshots ─────────────────────────────────────
CREATE TABLE daily_pnl (
  date TEXT PRIMARY KEY,             -- YYYY-MM-DD
  total_equity REAL NOT NULL,
  daily_pnl REAL NOT NULL,
  daily_pnl_pct REAL NOT NULL,
  open_positions INTEGER DEFAULT 0,
  trades_today INTEGER DEFAULT 0,
  win_rate REAL DEFAULT 0,
  sharpe_snapshot REAL,
  max_drawdown REAL
);

-- ─── Engine Performance (calibration data) ───────────────────
CREATE TABLE engine_performance (
  id TEXT PRIMARY KEY,
  engine_id TEXT NOT NULL,
  date TEXT NOT NULL,
  signals_generated INTEGER DEFAULT 0,
  trades_executed INTEGER DEFAULT 0,
  win_rate REAL DEFAULT 0,
  pnl REAL DEFAULT 0,
  avg_rr REAL,
  weight REAL DEFAULT 0
);

CREATE INDEX idx_engine_perf_engine ON engine_performance(engine_id);
CREATE INDEX idx_engine_perf_date ON engine_performance(date);

-- ─── Market Regime History ───────────────────────────────────
CREATE TABLE regime_history (
  id TEXT PRIMARY KEY,
  regime TEXT NOT NULL,              -- TRENDING_UP, TRENDING_DOWN, RANGING, VOLATILE
  detected_at INTEGER NOT NULL,
  vix_level REAL,
  spy_trend TEXT,
  confidence REAL
);

CREATE INDEX idx_regime_detected ON regime_history(detected_at);

-- ─── Pairs Trading State ─────────────────────────────────────
CREATE TABLE pairs_state (
  pair_key TEXT PRIMARY KEY,         -- SYMBOLA_SYMBOLB
  symbol_a TEXT NOT NULL,
  symbol_b TEXT NOT NULL,
  correlation REAL NOT NULL,
  cointegration_pval REAL,
  half_life REAL,
  hedge_ratio REAL NOT NULL,
  z_score REAL,
  status TEXT DEFAULT 'WATCHING',    -- WATCHING, LONG_SPREAD, SHORT_SPREAD
  last_entry_z REAL,
  entry_date INTEGER,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- ─── Google Alerts News Cache ────────────────────────────────
CREATE TABLE news_alerts (
  id TEXT PRIMARY KEY,               -- hash of url
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  processed INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX idx_news_category ON news_alerts(category);
CREATE INDEX idx_news_published ON news_alerts(published_at);

-- ─── Kill Switch / Risk Events ───────────────────────────────
CREATE TABLE risk_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,          -- KILL_SWITCH, DRAWDOWN_LIMIT, POSITION_LIMIT, etc.
  severity TEXT NOT NULL,            -- WARNING, CRITICAL, HALT
  description TEXT NOT NULL,
  action_taken TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_risk_created ON risk_events(created_at);
