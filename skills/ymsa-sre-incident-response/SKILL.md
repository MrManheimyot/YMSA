---
name: ymsa-sre-incident-response
description: Google SRE incident response runbooks for YMSA trading system — triage, mitigate, resolve, postmortem
---

# YMSA SRE Incident Response

You are an expert Google SRE incident commander. When the user reports a problem, outage, or anomaly in the YMSA system, use this skill to guide structured incident response following Google SRE Chapter 14 (Managing Incidents).

## Incident Severity Levels

| Severity | Definition | Response Time | Examples |
|----------|-----------|---------------|---------|
| **SEV-1** | Trading halted, money at risk, kill switch triggered | Immediate | Kill switch HALT, Alpaca auth failure during market hours, negative equity spiral |
| **SEV-2** | Major feature broken, data integrity at risk | < 15 min | Pipeline producing 0 alerts, D1 write failures, all external APIs down |
| **SEV-3** | Degraded service, non-critical feature broken | < 1 hour | Single API source down (circuit open), Z.AI fully rejecting, dashboard stale |
| **SEV-4** | Minor issue, cosmetic, no user impact | Next business day | Formatting bugs, non-critical log noise, test failures |

## Runbook: SEV-1 — Kill Switch Triggered

### Symptoms
- `risk_events` table shows KILL_SWITCH entry with tier HALT/CLOSE_ALL/REDUCE
- Dashboard shows "KILL SWITCH ACTIVE" banner
- Daily P&L shows ≤ -3% (REDUCE), ≤ -5% (CLOSE_ALL), or ≤ -10% (HALT)

### Immediate Actions
1. **DO NOT PANIC** — The kill switch is working as designed
2. Check kill switch tier in D1: `SELECT * FROM kill_switch_state ORDER BY created_at DESC LIMIT 1`
3. Check what triggered it: `SELECT * FROM risk_events WHERE event_type LIKE 'KILL%' ORDER BY created_at DESC LIMIT 5`
4. If HALT (7-day freeze): System will auto-recover. **Do not override unless you understand the loss.**
5. If CLOSE_ALL: Verify all positions liquidated via `GET /api/positions`
6. If REDUCE: Check that position sizes were halved

### Resolution
- Investigate root cause (bad signal? flash crash? API data error?)
- If false trigger (bad data): Fix data source, manually reset via D1
- If real market event: Let the kill switch do its job, review position sizing

---

## Runbook: SEV-2 — Signal Pipeline Producing Zero Alerts

### Symptoms
- `GET /api/telegram-alert-stats` shows 0 alerts for current day during market hours
- `GET /api/signals` shows 0 recent signals
- Cron jobs running but `flushCycle()` outputs empty

### Triage Steps
1. **Check cron execution**: `GET /api/system-status` — are crons firing?
2. **Check external APIs**: Run `GET /api/quote?symbol=AAPL` — do we get data?
3. **Check circuit breakers**: Search logs for `[CircuitBreaker] ... is OPEN`
4. **Check signal generation**: Trigger manual scan: `POST /api/trigger?job=hourly&key=ymsa-debug-key-2026`
5. **Check merge gate**: Are signals being generated but not merging? (Need ≥2 engines agreeing)
6. **Check confidence gate**: Are merged signals below 55 threshold?
7. **Check regime adjustment**: Is VIX extremely high? (VIX ≥ 35 → 0.25x confidence = most signals killed)

### Common Causes
| Cause | Fix |
|-------|-----|
| All external APIs rate-limited | Wait for reset, check API key quotas |
| Market closed/holiday | Expected — no signals on weekends/holidays |
| VIX > 35 regime | Working as designed — extreme caution mode |
| D1 insert failing | Check D1 size, run `VACUUM`, check schema |
| Code regression | Check last deploy, rollback: `wrangler rollbacks list` then `wrangler rollback` |

---

## Runbook: SEV-2 — D1 Database Issues

### Symptoms
- 500 errors on any endpoint that queries D1
- `risk_events` insertions failing
- Dashboard returning empty/stale data

### Triage
1. Check D1 binding: `wrangler d1 info ymsa-prod`
2. Check table sizes: `SELECT name, COUNT(*) FROM sqlite_master WHERE type='table'`
3. Check for locks: D1 is single-writer — long transactions can block
4. Check size: Free tier = 500MB max

### Mitigation
```sql
-- Archive old signals (keep last 30 days)
DELETE FROM signals WHERE created_at < datetime('now', '-30 days');

-- Archive old risk events
DELETE FROM risk_events WHERE created_at < datetime('now', '-90 days');

-- Reclaim space
VACUUM;
```

---

## Runbook: SEV-2 — Broker Connection Failure

### Symptoms
- `GET /api/account` returns error
- `GET /api/positions` returns empty when positions should exist
- Execution engine logs show Alpaca auth failures

### Triage
1. Check Alpaca API status: https://status.alpaca.markets/
2. Verify secrets: `wrangler secret list` — check ALPACA_API_KEY, ALPACA_SECRET_KEY
3. Test connection: `GET /api/account?key=ymsa-debug-key-2026`
4. Check if paper vs live mode: wrangler.toml `ALPACA_BASE_URL` setting

### Mitigation
- If Alpaca down: System falls back to SIGNALS ONLY mode (by design)
- If keys expired: Rotate via `wrangler secret put ALPACA_API_KEY`
- If rate limited: Reduce scan frequency temporarily

---

## Runbook: SEV-3 — Z.AI Health Degraded

### Symptoms
- `GET /api/ai-health` shows failure rate > 10%
- Z.AI approval rate > 95% (rubber-stamping) or rejection rate > 80% (over-conservative)

### Triage
1. Check Workers AI status page
2. Check Z.AI health endpoint: `GET /api/ai-health?key=ymsa-debug-key-2026`
3. Review recent Z.AI decisions: Look for pattern (all approve = rubber-stamp bias)

### Mitigation
- Z.AI failure: Signals proceed WITHOUT Z.AI validation (graceful degradation)
- Rubber-stamping: Review prompt template, check if input data is too simple
- Over-rejection: Check if market regime is extreme (Z.AI may be correctly cautious)

---

## Runbook: SEV-3 — External API Degradation

### Symptoms
- Circuit breaker OPEN for one or more services
- Logs show repeated timeouts for specific API
- Data validator scores dropping below 55

### Service Recovery Priority
| Priority | Service | Impact if Down | Fallback |
|----------|---------|---------------|----------|
| P0 | Yahoo Finance | No quotes, no screening | Alpha Vantage + Finnhub |
| P0 | Alpaca | No execution | Simulator mode |
| P1 | TAAPI.io | No indicators | Alpha Vantage technical indicators |
| P1 | Finnhub | No earnings/news | Google Alerts RSS |
| P2 | Alpha Vantage | Reduced indicator coverage | TAAPI.io |
| P2 | FRED | No macro data (VIX from FRED) | Hardcoded VIX fallback |
| P3 | CoinGecko | No crypto prices | DexScreener |
| P3 | Polymarket | No prediction market data | Skip section |

### Circuit Breaker Recovery
Circuit breakers auto-reset after 60 seconds cooldown (CIRCUIT_RESET_MS in retry.ts). If a service is persistently down:
1. Check service status page
2. Check API key validity/quota
3. Consider temporarily disabling that engine's dependency
4. Circuit will auto-recover once service returns

---

## Postmortem Template (Google SRE Ch.15)

After every SEV-1 or SEV-2 incident:

```markdown
# Incident Postmortem: [TITLE]
**Date**: YYYY-MM-DD
**Severity**: SEV-X
**Duration**: X hours Y minutes
**Impact**: [What was affected, how many signals/trades impacted]

## Summary
[2-3 sentence description]

## Timeline (UTC)
- HH:MM — First alert/symptom detected
- HH:MM — Investigation started
- HH:MM — Root cause identified
- HH:MM — Mitigation applied
- HH:MM — Full resolution confirmed

## Root Cause
[Technical explanation]

## Impact
- Signals missed: X
- Trades affected: X
- P&L impact: $X

## What Went Well
- [bullet points]

## What Went Wrong
- [bullet points]

## Action Items
| Action | Owner | Priority | Due Date |
|--------|-------|----------|----------|
| [action] | [name] | P0/P1/P2 | YYYY-MM-DD |

## Lessons Learned
[Key takeaways for future prevention]
```

## Usage Examples
```
"The system is down, help me triage"
"Kill switch just triggered, what do I do?"
"No alerts have been sent today, diagnose"
"D1 is returning errors"
"Write a postmortem for yesterday's outage"
"What's the runbook for broker disconnection?"
```
