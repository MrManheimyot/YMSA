---
name: ymsa-sre-golden-signals
description: Google SRE Four Golden Signals monitoring for YMSA trading platform — latency, traffic, errors, saturation
---

# YMSA SRE Golden Signals Monitor

You are an expert Google SRE. When the user asks about system health, performance, monitoring, or the "four golden signals," use this skill to diagnose and report on YMSA's production state.

## The Four Golden Signals (Google SRE Ch.6)

Every request to YMSA must be measured against these four dimensions. If you can only measure four things, measure these.

### 1. LATENCY — How long requests take

| Metric | Source | SLO Target | Alert Threshold |
|--------|--------|------------|-----------------|
| API response time (p50) | Workers Analytics | < 100ms | > 200ms |
| API response time (p99) | Workers Analytics | < 500ms | > 1000ms |
| Cron job wall time | `console.log` timing in cron-handler.ts | < 8s (Workers 10s limit) | > 6s |
| D1 query latency | Measured per query in queries.ts | < 50ms | > 200ms |
| External API round-trip | Per-service in retry.ts | < 3s (Yahoo, Alpha Vantage) | > 5s |
| Telegram send latency | alert-router.ts | < 2s | > 5s |
| Z.AI inference time | z-engine.ts Workers AI call | < 3s | > 8s |

**Key insight**: Track error latency separately. A fast 500 error is better than a slow 500 — but both must be counted. An HTTP 500 triggered by a DB timeout has different characteristics than a fast validation rejection.

### 2. TRAFFIC — Demand on the system

| Metric | Source | Normal Range | Alert |
|--------|--------|-------------|-------|
| Cron invocations/day | 13 scheduled jobs × weekdays | ~65-80/day | < 50 (missed crons) |
| API requests/hour | Workers Analytics | 10-200 | > 1000 (abuse) or 0 (down) |
| Signals generated/scan | broker-manager.ts `flushCycle()` | 5-15 per hourly scan | 0 for 3+ consecutive scans |
| Telegram alerts sent/day | telegram_alerts table | 3-15 | 0 (pipeline broken) or > 30 (spam) |
| External API calls/hour | Per-service counters | Varies by tier | Approaching free-tier limits |
| D1 reads/writes per day | Cloudflare dashboard | < 100K reads, < 10K writes | Approaching plan limits |

### 3. ERRORS — Failed requests

| Metric | Source | SLO | Alert |
|--------|--------|-----|-------|
| HTTP 5xx rate | Workers Analytics | < 0.1% of requests | > 1% over 5min window |
| Cron job failures | risk_events table | 0 per day | Any unhandled exception |
| External API failures | Circuit breaker state (retry.ts) | < 5% per service | Circuit OPEN on any service |
| D1 query errors | queries.ts error handling | 0 | Any persistent failure |
| Signal pipeline drops | Signals generated vs. alerts inserted | < 10% drop rate | > 50% |
| Z.AI failure rate | z-engine.ts health monitor | < 10% | > 10% (triggers health alert) |
| Telegram delivery failures | alert-router.ts | < 1% | > 5% |
| Data validation failures | data-validator.ts score < 55 | < 20% of sources | > 50% |

**Distinguish error types**:
- **Explicit errors**: HTTP 500, thrown exceptions, circuit breaker trips
- **Implicit errors**: HTTP 200 but wrong/stale data (data validator score < 55)
- **Policy errors**: Request succeeds but violates SLO (e.g., response > 500ms)

### 4. SATURATION — How "full" the system is

| Metric | Source | Warning | Critical |
|--------|--------|---------|----------|
| Workers CPU time | Workers Analytics (30s paid limit) | > 20s | > 25s |
| Workers wall time | Workers Analytics | > 25s | > 28s |
| D1 database size | Cloudflare D1 dashboard | > 400MB (500MB free) | > 450MB |
| D1 rows per table | `SELECT COUNT(*)` on key tables | signals > 100K | signals > 500K |
| KV storage | If applicable | > 80% quota | > 90% quota |
| External API rate limits | Per-service headers (X-RateLimit-Remaining) | < 20% remaining | < 5% remaining |
| Open positions count | portfolio.ts | > 15 (max 20) | = 20 (full) |
| Subrequest count | Workers limit (50 free, 10M paid) | > 40 | > 48 |

## How to Diagnose

### Quick Health Check
```
GET /api/system-status?key=ymsa-debug-key-2026
```
Returns: uptime, cron status, API connectivity, D1 health, alert pipeline status.

### Deep Diagnosis Command Chain
```
# 1. Check golden signals from dashboard data
GET /api/dashboard-data?key=ymsa-debug-key-2026

# 2. Check recent risk events (errors + anomalies)
GET /api/risk-events?key=ymsa-debug-key-2026

# 3. Check Z.AI health
GET /api/ai-health?key=ymsa-debug-key-2026

# 4. Check engine performance
GET /api/engine-stats?key=ymsa-debug-key-2026

# 5. Check alert pipeline
GET /api/telegram-alert-stats?key=ymsa-debug-key-2026

# 6. Tail live logs
npx wrangler tail ymsa-financial-automation --status error
```

### Incident Triage Decision Tree
```
Is the system serving errors?
├── YES → Check /api/system-status for which component
│   ├── D1 errors → Check D1 size/row counts, run VACUUM
│   ├── External API errors → Check circuit breaker states
│   ├── Z.AI errors → Check /api/ai-health, Workers AI status page
│   └── Telegram errors → Check bot token, chat ID
├── NO errors but slow?
│   ├── Check CPU time in Workers Analytics
│   ├── Check D1 query latency (missing indexes?)
│   └── Check external API response times
└── NO errors, not slow, but wrong results?
    ├── Check data-validator scores
    ├── Check signal merge logic (≥2 engine requirement)
    └── Check regime adjustment modifiers
```

## SLI/SLO Definitions for YMSA

| SLI | SLO | Measurement Window | Error Budget |
|-----|-----|--------------------|--------------|
| API availability | 99.5% | 30-day rolling | 3.6 hrs/month |
| Cron execution success | 99% | 7-day rolling | ~1 missed job/week |
| Signal pipeline throughput | ≥5 signals/hourly scan | Per scan | 0 consecutive empty scans |
| Alert delivery latency | < 30s from signal to Telegram | Per alert | p99 < 60s |
| Dashboard data freshness | < 15min during market hours | Continuous | No stale data > 30min |
| Daily P&L accuracy | ±$0.01 vs broker | Daily reconciliation | 0 tolerance |

## Usage Examples
```
"Check the four golden signals"
"What's our error budget status?"
"Is YMSA healthy right now?"
"Run a golden signals audit"
"What's our API latency p99?"
"Are we approaching any saturation limits?"
```
