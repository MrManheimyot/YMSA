---
name: ymsa-sre-d1-database
description: Cloudflare D1 database operations, migrations, optimization, backup, and troubleshooting for YMSA
---

# YMSA SRE D1 Database Operations

You are an expert in Cloudflare D1 (SQLite-based) database administration. When the user asks about database queries, migrations, schema changes, backups, or D1 performance, use this skill.

## Schema Overview (12 Tables)

| Table | Purpose | Critical? | Growth Rate |
|-------|---------|-----------|-------------|
| `signals` | All generated trading signals | Medium | 50-200 rows/day |
| `trades` | Executed trades (OPEN/CLOSED) | Critical | 5-20 rows/day |
| `positions` | Current open positions | Critical | Static (updates) |
| `daily_pnl` | Daily equity snapshot | Critical | 1 row/day |
| `telegram_alerts` | Alert history + outcomes | High | 5-15 rows/day |
| `engine_budgets` | Per-engine capital allocation | Critical | 6 rows (updates) |
| `engine_performance` | Daily engine stats | Medium | 6 rows/day |
| `risk_events` | Risk violations + anomalies | High | 10-50 rows/day |
| `regime_snapshots` | Market regime history | Low | 5-10 rows/day |
| `news_alerts` | RSS items + sentiment | Low | 10-30 rows/day |
| `kill_switch_state` | Persistent kill switch tier | Critical | Rare (on trigger) |
| `firebase_metadata` | Reserved | N/A | 0 |

## Common D1 Operations

### Health Check
```bash
# Verify D1 is accessible
npx wrangler d1 info ymsa-prod

# Table list
npx wrangler d1 execute ymsa-prod --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"

# Row counts
npx wrangler d1 execute ymsa-prod --remote --command "
SELECT 'signals' as tbl, COUNT(*) as rows FROM signals
UNION ALL SELECT 'trades', COUNT(*) FROM trades
UNION ALL SELECT 'positions', COUNT(*) FROM positions
UNION ALL SELECT 'daily_pnl', COUNT(*) FROM daily_pnl
UNION ALL SELECT 'telegram_alerts', COUNT(*) FROM telegram_alerts
UNION ALL SELECT 'engine_budgets', COUNT(*) FROM engine_budgets
UNION ALL SELECT 'risk_events', COUNT(*) FROM risk_events
UNION ALL SELECT 'regime_snapshots', COUNT(*) FROM regime_snapshots
"

# Database size
npx wrangler d1 execute ymsa-prod --remote --command "SELECT page_count * page_size as size_bytes FROM pragma_page_count(), pragma_page_size()"
```

### Querying Data
```bash
# Recent signals
npx wrangler d1 execute ymsa-prod --remote --command "SELECT * FROM signals ORDER BY created_at DESC LIMIT 20"

# Open trades
npx wrangler d1 execute ymsa-prod --remote --command "SELECT * FROM trades WHERE status = 'OPEN'"

# Today's P&L
npx wrangler d1 execute ymsa-prod --remote --command "SELECT * FROM daily_pnl ORDER BY date DESC LIMIT 1"

# Engine budgets
npx wrangler d1 execute ymsa-prod --remote --command "SELECT * FROM engine_budgets"

# Kill switch status
npx wrangler d1 execute ymsa-prod --remote --command "SELECT * FROM kill_switch_state ORDER BY created_at DESC LIMIT 1"

# Alert outcomes
npx wrangler d1 execute ymsa-prod --remote --command "SELECT outcome, COUNT(*) FROM telegram_alerts WHERE outcome IS NOT NULL GROUP BY outcome"
```

### Backup
```bash
# Full database export
npx wrangler d1 export ymsa-prod --remote --output ymsa-backup.sql

# Single table export (via command output)
npx wrangler d1 execute ymsa-prod --remote --command "SELECT * FROM trades" --json > trades.json
npx wrangler d1 execute ymsa-prod --remote --command "SELECT * FROM daily_pnl" --json > daily_pnl.json
```

## Migrations

### Migration Safety Rules
1. **Always backup before migrating**: `npx wrangler d1 export ymsa-prod --remote --output pre-migration-backup.sql`
2. **Test locally first**: Run migration against local D1 instance
3. **D1 does NOT support**: `DROP COLUMN`, `ALTER COLUMN`, `RENAME COLUMN` (use table rebuild)
4. **Migrations are irreversible**: Plan rollback before applying
5. **Apply migration BEFORE deploying code** that depends on new schema

### Migration Template
```sql
-- Migration: v3.2 - Description of changes
-- Author: [name]
-- Date: YYYY-MM-DD
-- Rollback: See bottom of file

-- ── Forward Migration ──

-- Add new column (safe — doesn't break existing queries)
ALTER TABLE signals ADD COLUMN trace_id TEXT;

-- Add index (safe — improves performance, no data change)
CREATE INDEX IF NOT EXISTS idx_signals_trace ON signals(trace_id);

-- ── Rollback Instructions ──
-- D1 doesn't support DROP COLUMN. To rollback:
-- 1. Create temp table without new column
-- 2. Copy data
-- 3. Drop original
-- 4. Rename temp to original
-- (Only if absolutely necessary — the column is nullable and harmless)
```

### Current Migration Files
- `src/db/schema.sql` — Initial schema (12 tables)
- `src/db/migrate-v3.1.sql` — Engine budgets + kill switch persistence

### Applying Migration
```bash
# Test locally first
npx wrangler d1 execute ymsa-prod --local --file=src/db/migrate-v3.2.sql

# Apply to production
npx wrangler d1 execute ymsa-prod --remote --file=src/db/migrate-v3.2.sql

# Verify
npx wrangler d1 execute ymsa-prod --remote --command "SELECT sql FROM sqlite_master WHERE type='table' AND name='signals'"
```

## Performance Optimization

### Recommended Indexes
```sql
-- These indexes significantly improve common query patterns
CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at);
CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol, created_at);
CREATE INDEX IF NOT EXISTS idx_signals_engine ON signals(engine_id, created_at);

CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_engine ON trades(engine_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol, created_at);

CREATE INDEX IF NOT EXISTS idx_alerts_sent ON telegram_alerts(sent_at);
CREATE INDEX IF NOT EXISTS idx_alerts_symbol ON telegram_alerts(symbol, sent_at);
CREATE INDEX IF NOT EXISTS idx_alerts_outcome ON telegram_alerts(outcome);

CREATE INDEX IF NOT EXISTS idx_risk_type ON risk_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_daily_pnl_date ON daily_pnl(date);
CREATE INDEX IF NOT EXISTS idx_regime_date ON regime_snapshots(created_at);
```

### Batch Operations
```typescript
// Use D1 batch API for multiple operations
const results = await env.DB.batch([
  env.DB.prepare('INSERT INTO signals ...').bind(...),
  env.DB.prepare('INSERT INTO signals ...').bind(...),
  env.DB.prepare('UPDATE engine_performance SET ...').bind(...),
]);
```

### Query Analysis
```sql
-- Explain plan for slow queries
EXPLAIN QUERY PLAN SELECT * FROM signals WHERE symbol = 'AAPL' AND created_at > datetime('now', '-1 day');
-- Should show "USING INDEX" if properly indexed
```

## Data Cleanup (Retention)

```bash
# Run as monthly maintenance
npx wrangler d1 execute ymsa-prod --remote --command "
  DELETE FROM signals WHERE created_at < datetime('now', '-90 days');
  DELETE FROM risk_events WHERE created_at < datetime('now', '-90 days') AND event_type NOT LIKE 'KILL%';
  DELETE FROM regime_snapshots WHERE created_at < datetime('now', '-30 days');
  DELETE FROM news_alerts WHERE created_at < datetime('now', '-14 days');
  DELETE FROM engine_performance WHERE date < date('now', '-365 days');
"

# Reclaim space
npx wrangler d1 execute ymsa-prod --remote --command "VACUUM"
```

## Troubleshooting

### D1 Returns Empty
```
Possible causes:
1. Wrong database_id in wrangler.toml (check binding name)
2. Table doesn't exist (schema not applied)
3. Query syntax error (D1 uses SQLite dialect, not MySQL/Postgres)
4. Data genuinely empty (new deployment)
```

### D1 Write Failures
```
Possible causes:
1. D1 concurrency limit (single writer at a time)
2. Database size approaching limit (check with page_count query)
3. UNIQUE constraint violation (duplicate signal insertion)
4. Schema mismatch (column name changed without migration)
```

### D1 Slow Queries
```
Fixes:
1. Add index on WHERE clause columns
2. Use LIMIT to cap result sets
3. Avoid SELECT * — specify needed columns
4. Use D1 batch for multiple operations
5. VACUUM periodically to defragment
```

## Usage Examples
```
"Show me the D1 table sizes"
"Backup the database"
"Run data cleanup on old signals"
"Add an index to improve query speed"
"Apply a database migration"
"Check if D1 is healthy"
"Query today's trades"
"What's the kill switch status in D1?"
```
