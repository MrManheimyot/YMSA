-- ═══════════════════════════════════════════════════════════════
-- YMSA v3.0 — D1 Database Schema
-- Google SRE: Structured, auditable, with proper indices
-- ═══════════════════════════════════════════════════════════════

-- ─── Trades (execution history) ──────────────────────────────
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  engine_id TEXT NOT NULL,           -- MTF_MOMENTUM, SMART_MONEY, STAT_ARB, OPTIONS, CRYPTO, EVENT_DRIVEN
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,                -- BUY, SELL, SHORT, COVER
  order_type TEXT NOT NULL,          -- MARKET, LIMIT, STOP, TRAILING_STOP
  quantity REAL NOT NULL,
  entry_price REAL NOT NULL,
  exit_price REAL,
  stop_loss REAL,
  take_profit REAL,
  realized_pnl REAL DEFAULT 0,
  realized_pnl_pct REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN, CLOSED, CANCELLED, STOPPED
  confidence REAL DEFAULT 0,
  reasoning TEXT,
  opened_at INTEGER NOT NULL,
  closed_at INTEGER,
  holding_period_hours REAL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_trades_engine ON trades(engine_id);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_opened ON trades(opened_at);

-- ─── Positions (current open) ────────────────────────────────
CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  trade_id TEXT NOT NULL REFERENCES trades(id),
  engine_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,                -- LONG, SHORT
  quantity REAL NOT NULL,
  entry_price REAL NOT NULL,
  current_price REAL DEFAULT 0,
  unrealized_pnl REAL DEFAULT 0,
  unrealized_pnl_pct REAL DEFAULT 0,
  stop_loss REAL,
  take_profit REAL,
  trailing_stop REAL,
  sector TEXT,
  opened_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_positions_engine ON positions(engine_id);
CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions(symbol);

-- ─── Signals (all generated signals for audit) ──────────────
CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  engine_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  symbol TEXT NOT NULL,
  priority TEXT NOT NULL,            -- CRITICAL, IMPORTANT, INFO
  direction TEXT,                    -- BULLISH, BEARISH, NEUTRAL
  value REAL,
  score REAL DEFAULT 0,              -- ML-scored confidence 0-100
  metadata TEXT,                     -- JSON blob for engine-specific data
  acted_on INTEGER DEFAULT 0,       -- 0=no trade, 1=trade generated
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_signals_engine ON signals(engine_id);
CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol);
CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at);

-- ─── Daily P&L Snapshots ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_pnl (
  date TEXT PRIMARY KEY,             -- YYYY-MM-DD
  total_equity REAL NOT NULL,
  cash_balance REAL NOT NULL,
  total_pnl REAL NOT NULL,
  total_pnl_pct REAL NOT NULL,
  engine_pnl TEXT NOT NULL,          -- JSON: { engine_id: pnl_pct }
  num_trades INTEGER DEFAULT 0,
  win_count INTEGER DEFAULT 0,
  loss_count INTEGER DEFAULT 0,
  max_drawdown_pct REAL DEFAULT 0,
  regime TEXT,                       -- TRENDING_UP, TRENDING_DOWN, RANGING, VOLATILE
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- ─── Engine Performance (calibration data) ───────────────────
CREATE TABLE IF NOT EXISTS engine_performance (
  engine_id TEXT NOT NULL,
  period TEXT NOT NULL,              -- YYYY-MM or YYYY-Www
  total_trades INTEGER DEFAULT 0,
  win_rate REAL DEFAULT 0,
  avg_pnl_pct REAL DEFAULT 0,
  sharpe_ratio REAL DEFAULT 0,
  max_drawdown_pct REAL DEFAULT 0,
  profit_factor REAL DEFAULT 0,
  current_weight REAL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (engine_id, period)
);

-- ─── Market Regime History ───────────────────────────────────
CREATE TABLE IF NOT EXISTS regime_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  regime TEXT NOT NULL,              -- TRENDING_UP, TRENDING_DOWN, RANGING, VOLATILE
  vix REAL,
  adx REAL,
  spy_ema50_200_gap REAL,
  detected_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_regime_detected ON regime_history(detected_at);

-- ─── Pairs Trading State ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS pairs_state (
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
CREATE TABLE IF NOT EXISTS news_alerts (
  id TEXT PRIMARY KEY,               -- hash of url
  category TEXT NOT NULL,            -- mega-tech, mna, fed-rates, etc.
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  processed INTEGER DEFAULT 0,
  sentiment REAL,                    -- -1.0 to 1.0
  symbols_mentioned TEXT,            -- JSON array
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_news_category ON news_alerts(category);
CREATE INDEX IF NOT EXISTS idx_news_published ON news_alerts(published_at);

-- ─── Kill Switch / Risk Events ───────────────────────────────
CREATE TABLE IF NOT EXISTS risk_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,          -- KILL_SWITCH, DRAWDOWN_LIMIT, POSITION_LIMIT, etc.
  severity TEXT NOT NULL,            -- WARNING, CRITICAL, HALT
  message TEXT NOT NULL,
  portfolio_state TEXT,              -- JSON snapshot
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
