---
name: ymsa-sre-observability
description: Structured logging, tracing, and dashboarding for YMSA — Cloudflare Workers tail, D1 audit trail, risk event monitoring
---

# YMSA SRE Observability

You are an expert in distributed systems observability. When the user asks about logs, tracing, debugging production issues, or monitoring improvements, use this skill. Based on Google SRE Ch.6 (Monitoring) and Cloudflare Workers observability docs.

## Observability Stack

YMSA runs on Cloudflare Workers (serverless) — traditional APM tools don't apply. Our observability stack:

| Layer | Tool | Purpose |
|-------|------|---------|
| **Logs** | `console.log/error` + Workers Tail | Real-time structured logging |
| **Metrics** | Workers Analytics + D1 queries | Request counts, CPU time, error rates |
| **Traces** | D1 `risk_events` table | Audit trail for every significant action |
| **Alerts** | Telegram bot | Real-time notification of anomalies |
| **Dashboard** | `/dashboard` endpoint | Visual system status |
| **Health Checks** | `/api/system-status`, `/api/ai-health` | Endpoint-level health |

## Structured Logging Standard

All YMSA logs should follow this JSON format for searchability in Workers tail:

```typescript
// ✅ CORRECT: Structured JSON, searchable in Workers tail
console.log(JSON.stringify({
  level: 'INFO',
  component: 'broker-manager',
  action: 'flushCycle',
  data: {
    cycleOutputs: 12,
    mergedTrades: 5,
    d1Inserts: 5,
    telegramSent: 3,
    duration_ms: 2340
  },
  traceId: `scan-${Date.now()}`
}));

// ✅ CORRECT: Error with context
console.error(JSON.stringify({
  level: 'ERROR',
  component: 'alpaca',
  action: 'submitOrder',
  error: 'INSUFFICIENT_BUYING_POWER',
  symbol: 'AAPL',
  qty: 10,
  traceId: `exec-${Date.now()}`
}));

// ❌ WRONG: Unstructured string
console.log('flushCycle: processed 12 outputs, 5 merged, 3 sent');
```

### Log Levels
| Level | Use For | Workers Tail Filter |
|-------|---------|-------------------|
| `console.error` | Failures requiring attention | `--status error` |
| `console.warn` | Degraded but functional | Search "WARN" |
| `console.log` | Normal operations, audit trail | Search by component |
| `console.debug` | Verbose development only | Not in production |

## Real-Time Monitoring Commands

### Tail Live Logs
```bash
# All logs
npx wrangler tail ymsa-financial-automation

# Errors only
npx wrangler tail ymsa-financial-automation --status error

# Filter by component
npx wrangler tail ymsa-financial-automation --search "broker-manager"

# Filter by HTTP method
npx wrangler tail ymsa-financial-automation --method POST

# Pretty format
npx wrangler tail ymsa-financial-automation --format pretty

# Sample 10% of traffic (high-traffic periods)
npx wrangler tail ymsa-financial-automation --sampling-rate 0.1
```

### D1 Audit Queries
```sql
-- Recent risk events (last 24h)
SELECT * FROM risk_events
WHERE created_at > datetime('now', '-1 day')
ORDER BY created_at DESC LIMIT 50;

-- Signal pipeline health (last scan)
SELECT engine_id, COUNT(*) as signals, AVG(confidence) as avg_conf
FROM signals
WHERE created_at > datetime('now', '-1 hour')
GROUP BY engine_id;

-- Alert delivery audit
SELECT sent_at, symbol, direction, confidence, outcome
FROM telegram_alerts
WHERE sent_at > datetime('now', '-1 day')
ORDER BY sent_at DESC;

-- Engine performance trend (7 days)
SELECT engine_id, date, win_rate, total_pnl
FROM engine_performance
WHERE date > date('now', '-7 days')
ORDER BY engine_id, date;

-- Kill switch history
SELECT * FROM kill_switch_state
ORDER BY created_at DESC LIMIT 10;

-- Daily P&L trend
SELECT date, equity, daily_pnl, win_rate, sharpe_ratio
FROM daily_pnl
ORDER BY date DESC LIMIT 30;
```

## Tracing: Request ID Propagation

Every significant operation should carry a trace ID for end-to-end debugging:

```
Signal Generated    → traceId: scan-1712345678000-AAPL
  ↓ D1 Insert       → same traceId in signals.trace_id
  ↓ Z.AI Validation → same traceId in log
  ↓ Telegram Alert  → same traceId in telegram_alerts.trace_id
  ↓ Execution       → same traceId in trades.trace_id
  ↓ Resolution      → same traceId in final P&L
```

### Recommended Trace ID Format
```typescript
const traceId = `${jobType}-${Date.now()}-${symbol || 'system'}`;
// Examples:
// scan-1712345678000-AAPL
// morning-1712345678000-system
// exec-1712345678000-TSLA
```

## Dashboard Observability Endpoints

| Endpoint | What It Shows | Refresh Rate |
|----------|--------------|-------------|
| `GET /dashboard` | Full visual dashboard (HTML) | On-demand |
| `GET /api/dashboard-data` | JSON: P&L, holdings, signals, engines | On-demand |
| `GET /api/system-status` | System health + component status | On-demand |
| `GET /api/ai-health` | Z.AI failure rate, approval/rejection bias | On-demand |
| `GET /api/engine-stats` | Per-engine win rate, P&L, signal count | On-demand |
| `GET /api/risk-events` | Recent risk violations + anomalies | On-demand |
| `GET /api/telegram-alert-stats` | Alert pipeline metrics | On-demand |
| `GET /api/performance` | Overall system performance | On-demand |

## Alerting Rules (What Should Page You)

### Page-Worthy (Telegram CRITICAL)
| Condition | Check Method | Why |
|-----------|-------------|-----|
| Kill switch activated | D1 kill_switch_state | Money at risk |
| 0 signals for 3+ consecutive hourly scans | D1 signals count by hour | Pipeline broken |
| D1 write failures | risk_events type = DB_ERROR | Data integrity |
| All circuits open simultaneously | risk_events type = CIRCUIT_OPEN | Total API blackout |

### Ticket-Worthy (Log and Review Daily)
| Condition | Check Method |
|-----------|-------------|
| Single API circuit opens | risk_events |
| Z.AI failure rate > 10% | ai-health endpoint |
| Data validator score < 55 for major stock | risk_events |
| Engine on probation | engine_budgets where budget_pct = 5 |
| Daily P&L > -2% (approaching kill switch) | daily_pnl |

### Informational (Dashboard Only)
| Condition | Check Method |
|-----------|-------------|
| VIX regime change | regime_snapshots |
| Engine budget rebalance | engine_budgets |
| New high watermark | daily_pnl equity |

## Debugging Playbook

### "Why didn't signal X become a Telegram alert?"
```sql
-- 1. Was the signal generated?
SELECT * FROM signals WHERE symbol = 'AAPL' AND created_at > datetime('now', '-1 day');

-- 2. Was confidence ≥ 55 (D1 insert gate)?
-- Check confidence column

-- 3. Was it merged (≥2 engines)?
-- Check if multiple engine_id entries exist for same symbol+hour

-- 4. Was it sent to Telegram?
SELECT * FROM telegram_alerts WHERE symbol = 'AAPL' AND sent_at > datetime('now', '-1 day');

-- 5. If inserted but not sent: Was it in top 3 batch?
-- Check if there were 3+ higher-confidence alerts that cycle
```

### "Why is the dashboard showing stale data?"
```bash
# 1. Check last cron execution
npx wrangler tail ymsa-financial-automation --search "cron" --format pretty

# 2. Check if cron is scheduled properly
cat wrangler.toml | grep crons

# 3. Manual trigger to verify data flow
curl "https://ymsa-financial-automation.kuki-25d.workers.dev/api/trigger?job=evening&key=ymsa-debug-key-2026"

# 4. Check D1 for latest entries
# wrangler d1 execute ymsa-prod --remote --command "SELECT MAX(created_at) FROM signals"
```

## Usage Examples
```
"Show me production logs"
"Tail errors from the last scan"
"Debug why no alerts were sent for AAPL"
"What does the audit trail show for today?"
"Query the D1 risk events"
"Set up better tracing for the signal pipeline"
```
