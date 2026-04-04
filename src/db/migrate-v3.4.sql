-- ─── YMSA v3.4 Migration — Superpower Data Layer ─────────────
-- Run: wrangler d1 execute ymsa-db --remote --file=src/db/migrate-v3.4.sql

-- RSS/News items from 25+ free feeds (CNBC, Yahoo, MarketWatch, SEC, etc.)
CREATE TABLE IF NOT EXISTS rss_items (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT NOT NULL UNIQUE,
  pub_date TEXT NOT NULL,
  symbols TEXT,            -- JSON array of extracted tickers
  sentiment INTEGER,       -- -100 to +100 (Z.AI analyzed)
  event_type TEXT,         -- earnings, fda, mna, macro, insider, etc.
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rss_pub_date ON rss_items(pub_date);
CREATE INDEX IF NOT EXISTS idx_rss_source ON rss_items(source);
CREATE INDEX IF NOT EXISTS idx_rss_category ON rss_items(category);

-- TradingView scanner snapshots (bulk market data, no API key)
CREATE TABLE IF NOT EXISTS tv_scanner_snapshots (
  id TEXT PRIMARY KEY,
  scan_type TEXT NOT NULL,        -- top_gainers, top_losers, high_volume, oversold, overbought
  symbol TEXT NOT NULL,
  close REAL,
  change_pct REAL,
  volume INTEGER,
  relative_volume REAL,
  rsi REAL,
  market_cap REAL,
  sector TEXT,
  recommendation TEXT,
  scanned_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tv_scan_type ON tv_scanner_snapshots(scan_type);
CREATE INDEX IF NOT EXISTS idx_tv_scanned_at ON tv_scanner_snapshots(scanned_at);
CREATE INDEX IF NOT EXISTS idx_tv_symbol ON tv_scanner_snapshots(symbol);

-- Social sentiment tracking (StockTwits, Reddit)
CREATE TABLE IF NOT EXISTS social_sentiment (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  source TEXT NOT NULL,           -- stocktwits, reddit
  bullish INTEGER DEFAULT 0,
  bearish INTEGER DEFAULT 0,
  total_messages INTEGER DEFAULT 0,
  sentiment_score INTEGER,        -- -100 to +100
  watchlist_count INTEGER DEFAULT 0,
  recorded_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sentiment_symbol ON social_sentiment(symbol);
CREATE INDEX IF NOT EXISTS idx_sentiment_recorded ON social_sentiment(recorded_at);

-- Feed health tracking (which sources are most reliable/predictive)
CREATE TABLE IF NOT EXISTS feed_health (
  source TEXT PRIMARY KEY,
  total_fetches INTEGER DEFAULT 0,
  successful_fetches INTEGER DEFAULT 0,
  avg_items_per_fetch REAL DEFAULT 0,
  last_success_at INTEGER,
  last_failure_at INTEGER,
  consecutive_failures INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL
);
