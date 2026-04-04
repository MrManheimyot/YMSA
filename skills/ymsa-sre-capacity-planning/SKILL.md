---
name: ymsa-sre-capacity-planning
description: Capacity planning and cost optimization for YMSA on Cloudflare Workers — D1 limits, API quotas, CPU budgets
---

# YMSA SRE Capacity Planning

You are an expert Google SRE specializing in capacity planning. When the user asks about limits, quotas, costs, scaling, or resource usage, use this skill. Based on Google SRE Ch.18 (Software Engineering in SRE) and Cloudflare Workers documentation.

## Cloudflare Workers Limits (Paid Plan — 2026)

| Resource | Free Tier | Paid Plan | YMSA Usage Pattern |
|----------|-----------|-----------|-------------------|
| Requests/day | 100K | 10M | ~500-2000/day (cron + API) |
| CPU time/invocation | 10ms | 30s | Hourly scan: ~5-15s, Quick pulse: ~1-3s |
| Wall time/invocation | N/A | 30s (soft), 60s (hard) | Hourly scan: ~10-25s |
| Subrequests/invocation | 50 | 1000 (Standard) | Hourly scan: 30-80 subrequests |
| D1 database size | 500MB | 10GB | Current: ~50-200MB |
| D1 rows read/day | 5M | 25B | ~10K-100K/day |
| D1 rows written/day | 100K | 50M | ~500-5000/day |
| KV reads/day | 100K | 10M | Minimal usage |
| Workers AI tokens/day | 10K | Based on plan | ~2K-5K/day |

## Cron CPU Budget Analysis

Each cron invocation shares the 30s CPU limit. YMSA runs 13 cron jobs on weekdays:

| Cron Job | Frequency | Est. CPU Time | Est. Subrequests | Risk Level |
|----------|-----------|---------------|-------------------|------------|
| MORNING_BRIEFING | 1x/day | 8-15s | 40-60 | 🔴 HIGH (most complex) |
| MARKET_OPEN_SCAN | 1x/day | 5-12s | 30-50 | 🟡 MEDIUM |
| OPENING_RANGE_BREAK | 1x/day | 3-6s | 15-25 | 🟢 LOW |
| QUICK_PULSE_5MIN | 84x/day | 1-3s | 5-15 | 🟢 LOW per call, 🟡 aggregate |
| QUICK_SCAN_15MIN | 28x/day | 2-5s | 10-25 | 🟢 LOW |
| FULL_SCAN_HOURLY | 7x/day | 5-12s | 25-50 | 🟡 MEDIUM |
| MIDDAY_REBALANCE | 1x/day | 2-5s | 10-20 | 🟢 LOW |
| EVENING_SUMMARY | 1x/day | 3-6s | 10-20 | 🟢 LOW |
| DAILY_SUMMARY | 1x/day | 2-4s | 5-10 | 🟢 LOW |
| OVERNIGHT_SETUP | 1x/day | 2-5s | 10-20 | 🟢 LOW |
| WEEKLY_REVIEW | 1x/week | 5-10s | 20-40 | 🟡 MEDIUM |
| ML_RETRAIN | 1x/week | 8-15s | 10-20 | 🔴 HIGH |
| MONTHLY_PERFORMANCE | 1x/month | 5-10s | 15-30 | 🟡 MEDIUM |

**Daily aggregate**: ~130 cron invocations × weekdays = ~650/week

### CPU Budget Optimization Strategies
1. **Batch external API calls**: Use `Promise.allSettled()` for parallel fetches within subrequest limits
2. **Early termination**: If VIX > 35, skip full analysis (regime already demands minimal trading)
3. **Watchlist pruning**: Remove symbols with 0 signals over 30 days
4. **Cache aggressively**: Use KV for quotes that don't change within 1 minute
5. **Stagger heavy crons**: Don't schedule MORNING_BRIEFING and MARKET_OPEN at the same minute

## External API Rate Limits

| Service | Free Tier Limit | YMSA Usage | Headroom | Action When Exhausted |
|---------|----------------|------------|----------|----------------------|
| Alpha Vantage | 25 calls/day (free), 75/min (premium) | ~50-200/day | 🟡 Tight on free | Fallback to TAAPI.io |
| TAAPI.io | 1 call/15s (free), varies paid | ~100-500/day | 🟡 Depends on plan | Batch indicator requests |
| Finnhub | 60 calls/min (free) | ~30-100/day | 🟢 OK | Rate-limit aware fetching |
| FRED | 120 calls/min | ~10-20/day | 🟢 Plenty | Cache macro data for 1hr |
| CoinGecko | 5-30 calls/min (free) | ~20-50/day | 🟢 OK | Cache crypto for 5min |
| DexScreener | Public, ~300/min | ~10-30/day | 🟢 Plenty | — |
| Polymarket | Public | ~5-10/day | 🟢 Plenty | — |
| Yahoo Finance | Unofficial, variable | ~100-500/day | 🟡 Risk of blocking | Rotate user-agents |
| Alpaca | 200 calls/min | ~50-200/day | 🟢 Plenty | — |
| Telegram Bot | 30 msg/sec, 20 msg/min to group | ~5-20/day | 🟢 Plenty | Batch messages |

## D1 Growth Projections

### Table Growth Rates (Estimated)
| Table | Rows/Day | Rows/Month | Rows/Year | Size/Row | Annual Size |
|-------|----------|------------|-----------|----------|-------------|
| signals | 50-200 | 1.5K-6K | 18K-72K | ~500B | 9-36MB |
| trades | 5-20 | 150-600 | 1.8K-7.2K | ~400B | 0.7-2.9MB |
| telegram_alerts | 5-15 | 150-450 | 1.8K-5.4K | ~600B | 1-3.2MB |
| risk_events | 10-50 | 300-1.5K | 3.6K-18K | ~300B | 1-5.4MB |
| daily_pnl | 1 | 22 | 264 | ~200B | ~53KB |
| regime_snapshots | 5-10 | 150-300 | 1.8K-3.6K | ~400B | 0.7-1.4MB |
| engine_performance | 6 | 132 | 1.6K | ~300B | ~480KB |
| engine_budgets | 6 | 132 | 1.6K | ~200B | ~320KB |
| news_alerts | 10-30 | 300-900 | 3.6K-10.8K | ~500B | 1.8-5.4MB |

**Projected Total Annual Growth**: ~15-55MB/year → **D1 free tier (500MB) lasts 9-33 years**

### Retention Policy Recommendations
| Table | Retain | Archive Strategy |
|-------|--------|-----------------|
| signals | 90 days | DELETE WHERE created_at < datetime('now', '-90 days') |
| trades | Forever | No pruning (critical financial data) |
| telegram_alerts | 1 year | Archive to R2 bucket, then delete |
| risk_events | 90 days | DELETE older, keep KILL_SWITCH events forever |
| daily_pnl | Forever | Core performance tracking |
| regime_snapshots | 30 days | DELETE older |
| news_alerts | 14 days | DELETE older |

## Cost Optimization

### Current Cost Structure (Estimated)
| Item | Free Tier | Paid Plan | Monthly Cost |
|------|-----------|-----------|-------------|
| Workers | 100K req/day | $5/mo + $0.50/M req | $5 |
| D1 | 5M reads/day | $0.75/M reads | ~$0 (under free) |
| Workers AI | 10K neurons/day | Pay-as-you-go | ~$0-2 |
| KV | 100K reads/day | $0.50/M reads | ~$0 |
| **Total** | | | **~$5-7/mo** |

### Cost Reduction Tactics
1. **KV caching layer**: Cache Yahoo/Finnhub quotes for 60s → reduce D1 reads by ~40%
2. **Batch D1 writes**: Use D1 batch API for multi-row inserts instead of one-by-one
3. **Smart cron scheduling**: Quick pulse every 5min may be overkill — consider 10min
4. **Workers AI efficiency**: Batch Z.AI calls for multiple signals in one inference
5. **Response compression**: Hono `compress()` middleware for dashboard API responses

## Scaling Triggers

| Trigger | Current | When to Act | Action |
|---------|---------|-------------|--------|
| D1 approaching 500MB | ~50MB | > 400MB | Enable retention policy, upgrade to paid |
| CPU time > 25s on any cron | ~5-15s | > 20s regularly | Split heavy crons, optimize queries |
| API quota > 80% | < 50% | > 80% any service | Upgrade API plan or add caching |
| > 1000 requests/day | < 500 | > 5000 | Review for abuse, add rate limiting |
| Signal backlog | 0 | Signals not processing in time | Increase cron frequency or parallelize |

## Usage Examples
```
"What are our Cloudflare Workers limits?"
"How much D1 storage are we using?"
"When will we hit API rate limits?"
"Optimize our cron CPU budget"
"What's our monthly cost projection?"
"Plan capacity for 2x the current watchlist"
```
