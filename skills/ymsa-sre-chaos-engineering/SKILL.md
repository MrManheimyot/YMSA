---
name: ymsa-sre-chaos-engineering
description: Chaos engineering and resilience testing for YMSA — fault injection, circuit breaker validation, failover testing
---

# YMSA SRE Chaos Engineering

You are an expert in chaos engineering and resilience testing. When the user asks about testing system resilience, fault injection, failover behavior, or "what happens if X breaks," use this skill. Based on Google SRE Ch.17 (Testing for Reliability) and Netflix's Chaos Monkey principles.

## Why Chaos Engineering for a Trading System?

Financial systems have zero tolerance for silent failures. A trading bot that silently stops generating signals is worse than one that loudly crashes — because silence means missed opportunities or unhedged risk. YMSA's 32 stress tests (flash crash, VIX spike, correlation breaks, combined crisis) test the risk logic, but they don't test the **infrastructure**.

## Chaos Experiments Catalog

### Experiment 1: External API Blackout
**Hypothesis**: If all external APIs fail simultaneously, YMSA should gracefully degrade without generating false signals or crashing.

**Injection Method**:
```typescript
// In retry.ts — force all circuit breakers open
circuits.set('yahoo-finance', { failures: 5, lastFailure: Date.now(), open: true });
circuits.set('alpha-vantage', { failures: 5, lastFailure: Date.now(), open: true });
circuits.set('taapi', { failures: 5, lastFailure: Date.now(), open: true });
circuits.set('finnhub', { failures: 5, lastFailure: Date.now(), open: true });
```

**Expected Behavior**:
- All scans produce 0 signals (no data → no signals → no false trades)
- Dashboard shows degraded status
- Risk events logged: "API_BLACKOUT" entries
- No Telegram alerts sent (empty pipeline is correct)
- System auto-recovers when circuits reset (60s cooldown)

**Validation**:
```
GET /api/system-status → should show degraded APIs
GET /api/signals → should be empty (not errored)
GET /api/risk-events → should show circuit breaker events
```

---

### Experiment 2: D1 Database Unavailable
**Hypothesis**: If D1 becomes temporarily unavailable, YMSA should not crash and should resume when D1 returns.

**Injection Method**: Temporarily unbind D1 in wrangler.toml (test environment only)

**Expected Behavior**:
- API endpoints return 503 with structured error (not 500 crash)
- Cron jobs log failure and skip gracefully
- In-memory operations (signal calculation) still work
- Pipeline: signals generated but NOT inserted to D1 → NOT sent to Telegram (Gap 3 fix)
- When D1 returns: next cron cycle resumes normally

---

### Experiment 3: Telegram Bot Failure
**Hypothesis**: If Telegram delivery fails, signals should still be tracked in D1 and execution should still occur.

**Injection Method**: Set TELEGRAM_BOT_TOKEN to an invalid value

**Expected Behavior**:
- Signals still generated → merged → D1 inserted ✓
- Z.AI validation still runs ✓
- Telegram send fails → logged as risk event ✓
- Broker execution still proceeds (if Alpaca connected) ✓
- Simulator still tracks trades ✓
- User gets no notification but portfolio is still managed

---

### Experiment 4: Z.AI Complete Failure
**Hypothesis**: If Workers AI is completely down, signals should bypass Z.AI validation and still flow through the pipeline.

**Injection Method**: Mock Workers AI to return errors

**Expected Behavior**:
- Z.AI gate becomes a pass-through (graceful degradation in z-engine.ts)
- Signals proceed with engine-consensus confidence only
- `/api/ai-health` shows 100% failure rate
- Alert sent about Z.AI health degradation
- No false rejections (better to trade without AI than to block all trades)

---

### Experiment 5: Stale Data Injection
**Hypothesis**: If an external API returns yesterday's data, the data validator should catch it and prevent stale signals.

**Injection Method**: Mock Yahoo Finance to return data with yesterday's timestamp

**Expected Behavior**:
- Data validator flags STALE_DATA (staleness > 15min during market hours)
- Validation score drops below 55 → signals blocked at quality gate
- Risk event logged: DATA_STALENESS
- Cross-source validation catches inconsistency if other sources are fresh

---

### Experiment 6: Flash Crash During Execution
**Hypothesis**: If prices drop 10%+ between signal generation and execution, the risk controller should block the trade.

**Injection Steps**:
1. Generate a BUY signal for TICKER at $100
2. Before execution, price drops to $88
3. Risk controller should detect the >5% price deviation

**Expected Behavior**:
- Position sizer recalculates with new price
- Kill switch logic evaluates portfolio impact
- If daily P&L breach: REDUCE/CLOSE_ALL/HALT triggers
- Slippage protection prevents execution at adverse price

---

### Experiment 7: Concurrent Cron Collision
**Hypothesis**: If two crons fire simultaneously (e.g., QUICK_PULSE and FULL_SCAN), they should not interfere or double-trade.

**Expected Behavior**:
- Each cron runs in a separate Workers invocation (Cloudflare guarantees)
- D1 UPSERT logic prevents duplicate signals for the same symbol
- `markSent()` deduplication prevents double Telegram alerts
- Position limit (max 20) prevents over-allocation

---

### Experiment 8: Kill Switch Cascade Test
**Hypothesis**: When kill switch triggers at REDUCE level, if losses continue, it should escalate to CLOSE_ALL, then HALT.

**Injection Method**: Simulate portfolio with -3% daily P&L, then -5%, then -10%

**Expected Behavior**:
- At -3%: Tier → REDUCE (50% position sizes). New signals still generated.
- At -5%: Tier → CLOSE_ALL (liquidate all). No new orders.
- At -10%: Tier → HALT (7-day freeze). Kill switch persisted to D1.
- Recovery: After 7 days, HALT auto-expires. System gradually resumes.

---

## Running Chaos Tests

### Via API Trigger (Safe — No Production Impact)
```
# Trigger a specific cron job manually
POST /api/trigger?job=hourly&key=ymsa-debug-key-2026

# Check system state after
GET /api/system-status?key=ymsa-debug-key-2026
GET /api/risk-events?key=ymsa-debug-key-2026
```

### Via Stress Tests (Built-in)
```bash
cd c:\Users\yotam\Downloads\YMSA\YMSA
node .\node_modules\vitest\vitest.mjs run src/__tests__/stress-test.test.ts
```
Runs all 32 stress scenarios: flash crash, VIX spike, correlation break, combined crisis, engine probation.

### Via SRE Audit
```bash
node sre-audit.mjs https://ymsa-financial-automation.kuki-25d.workers.dev
```
Runs 30+ automated checks across 7 categories with a scored report.

## Game Day Checklist (Monthly)

Following Google SRE's "Wheel of Misfortune" practice:

- [ ] Force one external API circuit breaker open → verify graceful degradation
- [ ] Manually trigger kill switch at REDUCE tier → verify position sizing halved
- [ ] Send malformed data to `/api/trigger` → verify input validation rejects it
- [ ] Check all 12 D1 table sizes → verify retention policy is working
- [ ] Run full stress test suite → all 32 tests should pass
- [ ] Run SRE audit → score should be ≥ 70
- [ ] Verify circuit breaker auto-recovery after 60s
- [ ] Check error budget consumption for the month

## Usage Examples
```
"What happens if Yahoo Finance goes down?"
"Test the kill switch cascade"
"Run a chaos experiment on the signal pipeline"
"What's our blast radius if D1 fails?"
"Set up a game day for next Saturday"
"Validate circuit breaker recovery"
```
