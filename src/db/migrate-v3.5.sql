-- ─── YMSA v3.5 Migration — Universe Expansion + Pre-Market Pipeline ──────
-- Run: wrangler d1 execute ymsa-db --remote --file=src/db/migrate-v3.5.sql
--
-- New table: scan_candidates — stores discovered stocks from TradingView/FinViz
-- scans for ranking, promotion, and full pipeline evaluation.

CREATE TABLE IF NOT EXISTS scan_candidates (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  source TEXT NOT NULL,            -- TV_GAINER, TV_LOSER, TV_VOLUME, TV_OVERSOLD, TV_OVERBOUGHT, FINVIZ_OVERSOLD, FINVIZ_52HIGH, EARNINGS_MOVER, PREMARKET_GAP
  direction TEXT,                  -- BUY, SELL, or NULL
  score INTEGER DEFAULT 0,        -- composite ranking score 0-100
  price REAL,
  change_pct REAL,
  volume REAL,
  volume_ratio REAL,
  rsi REAL,
  market_cap REAL,
  sector TEXT,
  reason TEXT,                     -- human-readable reason for candidacy
  discovered_at INTEGER NOT NULL,
  scan_date TEXT NOT NULL,         -- YYYY-MM-DD
  promoted INTEGER DEFAULT 0,     -- 0=candidate, 1=promoted to full pipeline
  evaluated INTEGER DEFAULT 0     -- 0=pending, 1=evaluated by full pipeline
);

CREATE INDEX IF NOT EXISTS idx_candidates_date_promoted ON scan_candidates(scan_date, promoted);
CREATE INDEX IF NOT EXISTS idx_candidates_score ON scan_candidates(score DESC);
CREATE INDEX IF NOT EXISTS idx_candidates_symbol_date ON scan_candidates(symbol, scan_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_unique ON scan_candidates(symbol, scan_date, source);
