-- Information Reliability Agent — D1 Migration
-- Source performance tracking for learning-based trust scoring

CREATE TABLE IF NOT EXISTS source_reliability (
  source_id TEXT NOT NULL,
  date TEXT NOT NULL,
  total_signals INTEGER DEFAULT 0,
  correct_signals INTEGER DEFAULT 0,
  accuracy_rate REAL DEFAULT 0,
  avg_freshness_ms REAL DEFAULT 0,
  avg_agreement_score REAL DEFAULT 0,
  bullish_bias_pct REAL DEFAULT 0,
  downtime_minutes INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (source_id, date)
);

CREATE INDEX IF NOT EXISTS idx_source_reliability_date ON source_reliability(date);
CREATE INDEX IF NOT EXISTS idx_source_reliability_source ON source_reliability(source_id);
