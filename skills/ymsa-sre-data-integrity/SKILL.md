---
name: ymsa-sre-data-integrity
description: Data integrity validation, cross-source reconciliation, and financial accuracy for YMSA trading data
---

# YMSA SRE Data Integrity

You are an expert in data integrity for financial systems. When the user asks about data quality, validation, reconciliation, or accuracy of market data, P&L, or trades, use this skill. Based on Google SRE Ch.26 (Data Integrity: What You Read Is What You Wrote).

## The Three Laws of Financial Data Integrity

1. **No silent corruption**: Every data point must be validated before acting on it
2. **No phantom trades**: Every Telegram alert must have a D1 record (Gap 3 fix — commit 4b76209)
3. **No ghost P&L**: Every P&L number must trace back to broker-reported equity (Bug #1 fix — commit b0abd36)

## Data Validation Pipeline (3 Layers)

### Layer 1: Structural Validation (data-validator.ts)

Each incoming quote/indicator is checked:

| Check | Rule | Score Impact | Action |
|-------|------|-------------|--------|
| Price range | $0.01 - $999,999 | -30 if FAIL | Block signal |
| Volume sanity | > 0, < 10B shares | -30 if FAIL | Block signal |
| 52-week range | Low < Current < High × 1.1 | -10 if WARN | Flag for review |
| Staleness (market hours) | < 15 min old | -30 if FAIL | Block signal |
| Staleness (after hours) | < 4 hours old | -10 if WARN | Flag for review |
| Timestamp validity | Not in future | -30 if FAIL | Block signal |

**Composite Score**: Start at 100, subtract penalties. **Minimum for trading: 55/100**.

### Layer 2: Cross-Source Validation

Compare the same data point across multiple sources:

| Source A | Source B | Max Deviation | If Exceeded |
|----------|----------|---------------|-------------|
| Yahoo Finance price | Alpha Vantage price | ±1% | WARN |
| Yahoo Finance price | Finnhub price | ±1% | WARN |
| Any two sources | — | > 0.3% | INFO (minor discrepancy) |
| Any two sources | — | > 1% | WARN (significant) |
| Any two sources | — | > 5% | FAIL (probably stale/wrong) |

### Layer 3: Temporal Validation

| Check | Rule | Action |
|-------|------|--------|
| Future timestamp | `dataTimestamp > now` | BLOCK — data is corrupted or timezone issue |
| Weekend data as "live" | Source claims live on Saturday | WARN — probably Friday close |
| Large gap (> 5 trading days) | No data for symbol for 5 days | WARN — delisted? halted? |
| Monotonicity violation | Today's cumulative volume < yesterday's final | WARN — data reset issue |

## P&L Reconciliation

### Daily P&L Verification
The correct formula (fixed in commit b0abd36):
```
dailyPnl = currentEquity - lastEquity
```
Where `lastEquity` is Alpaca's `last_equity` field (previous day's close equity).

**WRONG (old formula)**: `dailyPnl = totalUnrealizedPnl` — this was BUG #1

### P&L Reconciliation Checklist
1. **Broker equity**: `GET /api/account` → `equity` field
2. **Dashboard equity**: `GET /api/pnl-dashboard` → `totalEquity` field
3. **These must match within $0.01**: `|broker - dashboard| < 0.01`
4. **Daily P&L**: `currentEquity - lastEquity` must match `GET /api/daily-pnl` latest row
5. **Realized P&L**: Sum of closed trades today must match dashboard realized P&L
6. **Unrealized P&L**: Sum of open position P&L must match broker's `totalUnrealizedPnl`

### Common P&L Discrepancies

| Discrepancy | Cause | Fix |
|-------------|-------|-----|
| Dashboard equity ≠ broker equity | Dashboard using cached data | Force refresh via `/api/portfolio` |
| Daily P&L wrong | Using unrealized instead of equity delta | Verify `dailyPnl = equity - lastEquity` |
| Realized P&L missing trades | `recordDailyPnl()` missed trades | Check `getRecentTrades()` in portfolio.ts |
| Engine stats showing 0% win rate | Computed from stale trades table | Re-query: `SELECT engine_id, COUNT(*), ...` |

## Signal-to-Trade Traceability

Every trade must have a complete audit trail:

```
Signal (signals table)
  → signal_id, symbol, engine_id, confidence, created_at
    → Merge (broker-manager.ts flushCycle)
      → merged_trade with ≥2 engines, adjusted confidence
        → D1 Insert (telegram_alerts table)
          → alert_id, symbol, confidence, engines, created_at
            → Z.AI Validation
              → approved/rejected, rationale
                → Telegram Send (if approved + top 3)
                  → alert_text updated, sent_at populated
                    → Broker Execution (trades table)
                      → trade_id, entry_price, stop_loss, take_profit
                        → Resolution (SL/TP hit or manual close)
                          → pnl calculated, status = CLOSED
```

**Verification Query**:
```sql
-- Signals without corresponding alerts (pipeline leak)
SELECT s.id, s.symbol, s.confidence, s.created_at 
FROM signals s 
LEFT JOIN telegram_alerts ta ON s.symbol = ta.symbol 
  AND ta.created_at > datetime(s.created_at, '-1 hour')
WHERE ta.id IS NULL 
  AND s.confidence >= 55
  AND s.created_at > datetime('now', '-24 hours');

-- Alerts without corresponding trades (execution gap)
SELECT ta.id, ta.symbol, ta.created_at
FROM telegram_alerts ta
LEFT JOIN trades t ON ta.symbol = t.symbol
  AND t.created_at > datetime(ta.created_at, '-1 hour')
WHERE t.id IS NULL
  AND ta.created_at > datetime('now', '-24 hours');
```

## D1 Data Health Checks

### Row Count Sanity
```sql
SELECT 
  'signals' as tbl, COUNT(*) as cnt FROM signals
UNION ALL SELECT 'trades', COUNT(*) FROM trades
UNION ALL SELECT 'telegram_alerts', COUNT(*) FROM telegram_alerts
UNION ALL SELECT 'risk_events', COUNT(*) FROM risk_events
UNION ALL SELECT 'daily_pnl', COUNT(*) FROM daily_pnl
UNION ALL SELECT 'engine_budgets', COUNT(*) FROM engine_budgets
UNION ALL SELECT 'positions', COUNT(*) FROM positions;
```

### Anomaly Detection Queries
```sql
-- Duplicate signals (same symbol + engine within 5 minutes)
SELECT symbol, engine_id, COUNT(*) as dupes, MIN(created_at), MAX(created_at)
FROM signals
WHERE created_at > datetime('now', '-24 hours')
GROUP BY symbol, engine_id, strftime('%Y-%m-%d %H', created_at)
HAVING dupes > 3;

-- Orphaned positions (in positions table but not in open trades)
SELECT p.symbol FROM positions p
LEFT JOIN trades t ON p.symbol = t.symbol AND t.status = 'OPEN'
WHERE t.id IS NULL;

-- P&L anomalies (daily P&L > 5% of equity)
SELECT * FROM daily_pnl 
WHERE ABS(daily_pnl) > (equity * 0.05)
ORDER BY date DESC;
```

## Backup & Recovery

### D1 Export (Manual Backup)
```powershell
# Export all critical tables
node .\node_modules\wrangler\bin\wrangler.js d1 execute ymsa-prod --remote --command="SELECT * FROM trades" --json > trades-backup.json
node .\node_modules\wrangler\bin\wrangler.js d1 execute ymsa-prod --remote --command="SELECT * FROM daily_pnl" --json > pnl-backup.json
```

### Recovery Priority
| Priority | Table | Recovery Method |
|----------|-------|----------------|
| P0 | kill_switch_state | Manual D1 insert (safety-critical) |
| P0 | engine_budgets | Manual D1 insert (capital allocation) |
| P0 | trades (OPEN) | Reconcile with Alpaca positions |
| P1 | daily_pnl | Recalculate from broker history |
| P2 | signals | Regenerate from next scan |
| P3 | telegram_alerts | Non-critical for operation |

## Usage Examples
```
"Validate today's P&L accuracy"
"Check for data integrity issues"
"Reconcile dashboard with broker data"
"Are there any orphaned positions?"
"Run the signal-to-trade audit trail"
"Check cross-source price consistency"
```
