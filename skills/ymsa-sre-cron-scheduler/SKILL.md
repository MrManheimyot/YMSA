---
name: ymsa-sre-cron-scheduler
description: Cron job monitoring, troubleshooting, and scheduling optimization for YMSA's 13 automated jobs
---

# YMSA SRE Cron Scheduler

You are an expert in distributed cron scheduling and Cloudflare Workers scheduled events. When the user asks about cron jobs, scheduling, missed scheduled tasks, or cron optimization, use this skill. Based on Google SRE Ch.24 (Distributed Periodic Scheduling with Cron).

## Cron Schedule (13 Jobs)

All times in UTC. YMSA operates Monday-Friday (US market schedule).

| Time (UTC) | Time (IST) | Job ID | Frequency | CPU Budget | Purpose |
|-----------|------------|--------|-----------|------------|---------|
| `0 5 * * 1-5` | 07:30 | MORNING_BRIEFING | 1x/day | 8-15s | Market pulse, holdings, signals, news |
| `30 14 * * 1-5` | 17:00 | MARKET_OPEN_SCAN | 1x/day | 5-12s | Full 6-engine scan at US open |
| `45 14 * * 1-5` | 17:15 | OPENING_RANGE_BREAK | 1x/day | 3-6s | First 15-min range breakout |
| `*/5 14-21 * * 1-5` | 16:30-23:30 | QUICK_PULSE_5MIN | 84x/day | 1-3s | Fast momentum (CRITICAL only) |
| `*/15 14-21 * * 1-5` | 16:30-23:30 | QUICK_SCAN_15MIN | 28x/day | 2-5s | RSI/MACD/Smart Money |
| `0 15-21 * * 1-5` | 17:30-23:30 | FULL_SCAN_HOURLY | 7x/day | 5-12s | Full technical + pairs |
| `0 18 * * 1-5` | 20:30 | MIDDAY_REBALANCE | 1x/day | 2-5s | Portfolio check |
| `0 15 * * 1-5` | 17:30 | EVENING_SUMMARY | 1x/day | 3-6s | Daily P&L recording |
| `0 21 * * 1-5` | 23:30 | DAILY_SUMMARY | 1x/day | 2-4s | Executive trade summary |
| `30 21 * * 1-5` | 00:00+1 | OVERNIGHT_SETUP | 1x/day | 2-5s | After-hours crypto setup |
| `0 7 * * SUN` | 09:30 Sun | WEEKLY_REVIEW | 1x/week | 5-10s | Portfolio narrative |
| `0 3 * * SAT` | 05:30 Sat | ML_RETRAIN | 1x/week | 8-15s | Engine weight calibration |
| `0 0 1 * *` | 02:30 1st | MONTHLY_PERFORMANCE | 1x/month | 5-10s | Full month report |

### Daily Cron Count
- **Weekday**: ~130 invocations
- **Weekend**: 2 (weekly review + ML retrain)
- **Monthly extra**: 1 (performance report)
- **Weekly total**: ~652 invocations

## Monitoring Cron Health

### Are Crons Running?
```bash
# Tail for cron invocations
npx wrangler tail ymsa-financial-automation --search "scheduled" --format pretty

# Check for cron errors
npx wrangler tail ymsa-financial-automation --search "scheduled" --status error
```

### Check Last Execution
```sql
-- Most recent risk events (crons log start/end as risk_events)
SELECT event_type, details, created_at
FROM risk_events
WHERE event_type LIKE 'CRON%' OR event_type LIKE 'SCAN%'
ORDER BY created_at DESC LIMIT 20;

-- Check if morning brief ran today
SELECT * FROM risk_events
WHERE event_type = 'MORNING_BRIEF' 
  AND created_at > datetime('now', '-24 hours');
```

### Manual Cron Trigger
```bash
# Trigger any job manually
curl -X POST "https://ymsa-financial-automation.kuki-25d.workers.dev/api/trigger?job=morning&key=ymsa-debug-key-2026"
curl -X POST "https://ymsa-financial-automation.kuki-25d.workers.dev/api/trigger?job=open&key=ymsa-debug-key-2026"
curl -X POST "https://ymsa-financial-automation.kuki-25d.workers.dev/api/trigger?job=quick&key=ymsa-debug-key-2026"
curl -X POST "https://ymsa-financial-automation.kuki-25d.workers.dev/api/trigger?job=pulse&key=ymsa-debug-key-2026"
curl -X POST "https://ymsa-financial-automation.kuki-25d.workers.dev/api/trigger?job=hourly&key=ymsa-debug-key-2026"
curl -X POST "https://ymsa-financial-automation.kuki-25d.workers.dev/api/trigger?job=midday&key=ymsa-debug-key-2026"
curl -X POST "https://ymsa-financial-automation.kuki-25d.workers.dev/api/trigger?job=evening&key=ymsa-debug-key-2026"
curl -X POST "https://ymsa-financial-automation.kuki-25d.workers.dev/api/trigger?job=overnight&key=ymsa-debug-key-2026"
curl -X POST "https://ymsa-financial-automation.kuki-25d.workers.dev/api/trigger?job=weekly&key=ymsa-debug-key-2026"
curl -X POST "https://ymsa-financial-automation.kuki-25d.workers.dev/api/trigger?job=retrain&key=ymsa-debug-key-2026"
curl -X POST "https://ymsa-financial-automation.kuki-25d.workers.dev/api/trigger?job=monthly&key=ymsa-debug-key-2026"
```

## Cron Failure Modes

| Failure | Detection | Impact | Mitigation |
|---------|-----------|--------|------------|
| **Cron never fires** | 0 invocations in Workers Analytics | Missed scan/alert | Check wrangler.toml cron syntax |
| **Cron fires but errors** | Error status in tail | No signals generated | Tail errors, check API keys |
| **Cron timeout (>30s CPU)** | Workers Runtime Error log | Partial results | Optimize heavy operations |
| **Cron runs but produces 0 signals** | Empty signals table for period | No alerts | May be valid (market closed/VIX high) |
| **Duplicate cron execution** | Multiple entries in same minute | Double signals | Cloudflare guarantees at-most-once — if happening, it's a bug |
| **Cron runs on weekend** | Unexpected invocations | Wasted resources/errors | `1-5` in cron expression limits to Mon-Fri |

## Cron Dependency Chain

Some crons depend on others' output:

```
05:00 MORNING_BRIEFING ──→ (independent, pulls fresh market data)
14:30 MARKET_OPEN_SCAN ──→ Produces signals for the day
14:45 OPENING_RANGE_BREAK ──→ Uses market open data
*/5   QUICK_PULSE ──→ Fast layer, CRITICAL priority only
*/15  QUICK_SCAN ──→ Uses regime from hourly scan
 :00  FULL_SCAN_HOURLY ──→ Main signal generator → feeds flushCycle()
18:00 MIDDAY_REBALANCE ──→ Uses portfolio data from trades
15:00 EVENING_SUMMARY ──→ Uses daily_pnl (depends on trades executing)
21:00 DAILY_SUMMARY ──→ Uses trades + holdings data
21:30 OVERNIGHT_SETUP ──→ Independent (crypto focus)
SUN   WEEKLY_REVIEW ──→ Uses all week's daily_pnl + trades
SAT   ML_RETRAIN ──→ Uses engine_performance from the week
1st   MONTHLY_PERF ──→ Uses full month's data
```

## Schedule Optimization

### Current Bottleneck: Market Open Window

Between 14:30-15:00 UTC, three crons fire within 15 minutes:
- 14:30 MARKET_OPEN_SCAN (heavy)
- 14:45 OPENING_RANGE_BREAK (medium)
- 15:00 FULL_SCAN_HOURLY + EVENING_SUMMARY (both at :00)

Each gets its own Worker invocation, but all compete for external API quotas.

### Recommendation: Stagger Heavy Jobs
```
Current: 14:30, 14:45, 15:00 (3 heavy scans in 30min)
Better:  14:30, 14:50, 15:15 (spread over 45min)
```

### Recommendation: Reduce Quick Pulse Frequency
```
Current: */5 (every 5 min) = 84 calls/day
Better:  */10 (every 10 min) = 42 calls/day — half the cost, minimal signal loss
```

Quick pulse only fires for CRITICAL priority events. The probability of catching a truly critical signal in a 5-min window vs 10-min window is marginal.

## US Market Hours Reference

| Event | Time (ET) | Time (UTC) | Time (IST) |
|-------|----------|------------|------------|
| Pre-market open | 04:00 | 08:00 | 10:30 |
| Market open | 09:30 | 13:30 | 16:00 |
| Lunch doldrums | 12:00-13:00 | 16:00-17:00 | 18:30-19:30 |
| Power hour | 15:00-16:00 | 19:00-20:00 | 21:30-22:30 |
| Market close | 16:00 | 20:00 | 22:30 |
| After-hours close | 20:00 | 00:00+1 | 02:30+1 |

Note: During US Daylight Saving (Mar-Nov), UTC times shift -1 hour. YMSA's current schedule uses fixed UTC times.

## Usage Examples
```
"Are all crons running properly?"
"When does the morning brief fire?"
"Trigger a manual hourly scan"
"Why didn't the evening summary run?"
"Optimize the cron schedule"
"What's the cron dependency chain?"
"How many cron invocations do we use per day?"
```
