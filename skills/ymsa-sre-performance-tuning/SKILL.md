---
name: ymsa-sre-performance-tuning
description: Performance optimization for YMSA — CPU time reduction, D1 query optimization, API call batching, cron efficiency
---

# YMSA SRE Performance Tuning

You are an expert in Cloudflare Workers performance optimization. When the user asks about speed, CPU usage, timeouts, slow queries, or optimization opportunities, use this skill. Based on Cloudflare Workers best practices and Google SRE performance engineering.

## Performance Budget

Cloudflare Workers paid plan limits:
- **CPU time**: 30 seconds per invocation (hard limit)
- **Wall time**: 30s soft, 60s hard (cron can go higher)
- **Subrequests**: 1000 per invocation (standard model)
- **D1 reads**: 25B rows/day (paid)
- **D1 writes**: 50M rows/day (paid)

### YMSA's Heaviest Operations

| Operation | Estimated CPU | Estimated Wall | Risk |
|-----------|-------------|---------------|------|
| MORNING_BRIEFING | 8-15s CPU | 10-20s wall | 🔴 Could timeout on bad day |
| MARKET_OPEN_SCAN | 5-12s CPU | 8-15s wall | 🟡 Moderate |
| FULL_SCAN_HOURLY | 5-12s CPU | 8-15s wall | 🟡 Moderate |
| ML_RETRAIN (weekly) | 8-15s CPU | 10-20s wall | 🔴 Heavy compute |
| WEEKLY_REVIEW | 5-10s CPU | 8-15s wall | 🟡 Moderate |
| QUICK_PULSE_5MIN | 1-3s CPU | 2-5s wall | 🟢 Safe |

## Optimization Strategies

### 1. Parallel API Calls (Biggest Win)

Most YMSA scans call 5-10 external APIs sequentially. Using `Promise.allSettled()`:

```typescript
// ❌ SLOW: Sequential (20s for 10 APIs × 2s each)
const yahoo = await fetchYahoo(symbol);
const alpha = await fetchAlpha(symbol);
const taapi = await fetchTaapi(symbol);

// ✅ FAST: Parallel (2s for 10 APIs in parallel)
const [yahoo, alpha, taapi] = await Promise.allSettled([
  fetchYahoo(symbol),
  fetchAlpha(symbol),
  fetchTaapi(symbol),
]);
```

**Where to apply**:
- `cron-handler.ts` — Fetch multiple symbols in parallel batches
- `broker-manager.ts` — Scan cycle data collection
- `dashboard.ts` — Dashboard data aggregation
- `signals.ts` — Multi-source indicator collection

### 2. D1 Query Optimization

#### Missing Indexes (Add These)
```sql
-- Speed up signal queries by date range
CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at);

-- Speed up trade queries by engine
CREATE INDEX IF NOT EXISTS idx_trades_engine ON trades(engine_id, status);

-- Speed up telegram_alerts by date
CREATE INDEX IF NOT EXISTS idx_alerts_sent ON telegram_alerts(sent_at);

-- Speed up risk_events filtering
CREATE INDEX IF NOT EXISTS idx_risk_events_type ON risk_events(event_type, created_at);

-- Speed up daily_pnl lookups
CREATE INDEX IF NOT EXISTS idx_daily_pnl_date ON daily_pnl(date);
```

#### Batch D1 Operations
```typescript
// ❌ SLOW: Individual inserts (10 round trips)
for (const signal of signals) {
  await db.prepare('INSERT INTO signals ...').bind(signal).run();
}

// ✅ FAST: Batch insert (1 round trip)
const batch = signals.map(s =>
  db.prepare('INSERT INTO signals ...').bind(s)
);
await db.batch(batch);
```

#### Query Selectivity
```sql
-- ❌ SLOW: Full table scan
SELECT * FROM signals WHERE symbol LIKE '%AAP%';

-- ✅ FAST: Indexed prefix match
SELECT * FROM signals WHERE symbol = 'AAPL' AND created_at > datetime('now', '-1 day');
```

### 3. KV Caching Layer

Add a KV cache for frequently accessed, slowly-changing data:

```typescript
// Cache Yahoo quote for 60 seconds (markets update ~every 15s)
async function getCachedQuote(env: Env, symbol: string): Promise<StockQuote | null> {
  const cacheKey = `quote:${symbol}`;
  const cached = await env.KV?.get(cacheKey, 'json');
  if (cached) return cached as StockQuote;

  const fresh = await fetchYahooQuote(symbol);
  if (fresh && env.KV) {
    await env.KV.put(cacheKey, JSON.stringify(fresh), { expirationTtl: 60 });
  }
  return fresh;
}
```

**High-value cache targets**:
| Data | Cache TTL | Reason |
|------|-----------|--------|
| Stock quotes | 60s | Called by multiple crons within same minute |
| Market indices | 120s | Rarely change within 2 minutes |
| Regime snapshot | 300s | Regime changes slowly |
| VIX value | 120s | Used in every risk check |
| Watchlist | 3600s | Rarely changes (manual updates) |

### 4. Early Termination

Short-circuit unnecessary work:

```typescript
// Skip full analysis if market is closed
if (!isMarketOpen() && jobType !== 'MORNING_BRIEFING') {
  return { signals: 0, reason: 'Market closed' };
}

// Skip if kill switch is HALT
const killSwitch = await getKillSwitchState(env.DB);
if (killSwitch?.tier === 'HALT') {
  return { signals: 0, reason: 'Kill switch HALT active' };
}

// Skip full scan if VIX > 35 (regime too dangerous for trading)
if (vix > 35 && jobType === 'QUICK_PULSE_5MIN') {
  return { signals: 0, reason: 'Extreme VIX, quick pulse skipped' };
}
```

### 5. Watchlist Optimization

With 50+ symbols, full scans are expensive. Optimize:

```typescript
// Tier the watchlist by priority
const TIER_1 = ['AAPL', 'NVDA', 'GOOGL', 'MSFT', 'AMZN']; // Always scan
const TIER_2 = ['TSLA', 'META', 'AMD', 'NFLX', ...];        // Hourly scan
const TIER_3 = ['...remaining'];                               // Daily scan only

// Quick pulse: Only TIER_1 (5 symbols × 3s = 15s total)
// Hourly scan: TIER_1 + TIER_2 (20 symbols × 3s = 60s → needs batching)
// Full daily: All tiers
```

### 6. Response Compression

For the dashboard (returns large JSON):
```typescript
import { compress } from 'hono/compress';

app.use('/api/*', compress()); // Gzip responses — 60-80% size reduction
```

## Performance Monitoring

### Track CPU Time Per Operation
```typescript
const start = performance.now();
// ... operation ...
const cpuMs = performance.now() - start;
console.log(JSON.stringify({
  component: 'cron',
  operation: jobType,
  cpu_ms: Math.round(cpuMs),
  subrequests: subrequestCount,
  symbols_scanned: symbolCount,
}));
```

### Workers Analytics (Cloudflare Dashboard)
- **Requests**: Total, success, error by status code
- **CPU Time**: p50, p75, p99 per Worker invocation
- **Wall Time**: Duration including await time
- **Subrequests**: Count per invocation

### Performance Budget Alerts
| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| CPU time p99 | > 15s | > 25s | Optimize heaviest cron job |
| Wall time p99 | > 20s | > 28s | Reduce external API calls |
| Subrequests p99 | > 500 | > 800 | Add KV caching |
| D1 query time p99 | > 100ms | > 500ms | Add indexes |

## Benchmarks (Target vs. Actual)

| Operation | Target | Run Benchmark |
|-----------|--------|--------------|
| Single symbol analysis | < 3s | `GET /api/analysis?symbol=AAPL` |
| Quick quote | < 500ms | `GET /api/quote?symbol=AAPL` |
| Dashboard data | < 5s | `GET /api/dashboard-data` |
| Fibonacci calc | < 2s | `GET /api/fibonacci?symbol=AAPL` |
| Scan 50 symbols | < 25s | `POST /api/trigger?job=hourly` |

## Usage Examples
```
"Why is the morning brief so slow?"
"Optimize D1 query performance"
"Add caching for stock quotes"
"How much CPU are we using per scan?"
"Is our cron going to timeout?"
"Benchmark the dashboard endpoint"
"Which queries need indexes?"
```
