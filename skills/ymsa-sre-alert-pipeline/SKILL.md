---
name: ymsa-sre-alert-pipeline
description: Telegram alert pipeline monitoring, debugging, and optimization — from signal to delivery
---

# YMSA SRE Alert Pipeline

You are an expert in notification pipeline engineering. When the user asks about Telegram alerts, signal-to-alert flow, alert formatting, or alert pipeline debugging, use this skill.

## Pipeline Architecture

```
Engine Outputs (0-100 confidence each)
    ↓
Merge by Symbol (≥2 engines must agree)
    ↓
Regime Adjustment (VIX/ADX confidence modifier)
    ↓
Conflict Filter (-25 penalty for mixed BUY/SELL)
    ↓
Quality Gate (confidence ≥ 55)
    ↓
D1 INSERT → telegram_alerts table [Step 1b]
    ↓ (NO D1 INSERT = NO TELEGRAM — Gap 3 fix)
Z.AI Validation (optional LLM APPROVE/REJECT)
    ↓
Confidence Sort → Top 3 per cycle
    ↓
Alert Formatting (alert-formatter.ts)
    ↓
Telegram Send (alert-router.ts)
    ↓
D1 UPDATE → alert_text populated [Step 4]
    ↓
markSent() → Deduplication key set
```

### Key Design Decisions
1. **D1 before Telegram**: Every alert is recorded BEFORE sending. No phantom alerts.
2. **Top 3 per cycle**: Prevents Telegram spam. Remaining alerts still tracked in D1.
3. **markSent() dedup**: Same signal can't generate duplicate alerts across cycles.
4. **Confidence ≥ 80 for Telegram**: Only high-confidence alerts sent (D1 logs all ≥ 55).
5. **One alert per stock**: No batch grouping. Each stock gets its own alert message.

## Alert Format Spec

### Trade Alert Structure
```
📊 [BUY/SELL] $SYMBOL — YMSA AI Alert

Signals Triggered:                    ← FIRST section
• RSI(14) Oversold: 28.5
• EMA Golden Cross: 50 > 200
• Smart Money: Order Block detected

Technical Backing:                    ← Replaces old "Technical Info"
• Entry: $XXX.XX
• Stop Loss: $XXX.XX (ATR-2 based)
• Take Profit: $XXX.XX (Fib 1.618)
• Risk/Reward: X.Xx

Confidence: XX% (X engines aligned)
Engines: MTF_MOMENTUM, SMART_MONEY, ...
```

### Daily Summary Structure (23:00 IST)
```
📊 DAILY SUMMARY — YMSA

Today's Executed Trades:
┌──────┬────┬─────┬─────────┬────────┐
│Ticker│Dir │ Qty │ Price   │ P/L    │
├──────┼────┼─────┼─────────┼────────┤
│AAPL  │BUY │ 10  │ $185.50 │ +$23.40│
│NVDA  │SELL│  5  │ $925.00 │ -$12.00│
└──────┴────┴─────┴─────────┴────────┘

Current Holdings:
[holdings table with unrealized P/L]
```

### Morning Brief Sections
1. **§1 Market Pulse**: Indices with % change ONLY (no point changes). VIX raw value.
2. **§2 Core Holdings**: Header = "Last Trading Day". Daily % change.
3. ~~§3 Key Insights~~: **REMOVED**
4. **§4 Today's Signals**: Active opportunities from scan
5. **§5 Insider-Driven Positioning**: Low-probability Polymarket bets (≤25%, ≥1%, vol/liq ≥5x, $50K+, 2-week expiry)
6. **§6 News & Sentiment**: Google Alerts RSS + Z.AI sentiment
7. ~~§7 What to Watch Today~~: **REMOVED**

## Debugging the Pipeline

### Step 1: Are signals being generated?
```sql
SELECT COUNT(*) as signal_count, 
  MAX(created_at) as latest
FROM signals 
WHERE created_at > datetime('now', '-2 hours');
```
If 0: Check external API connectivity, circuit breaker states.

### Step 2: Are signals merging (≥2 engines)?
```sql
SELECT symbol, COUNT(DISTINCT engine_id) as engine_count
FROM signals
WHERE created_at > datetime('now', '-1 hour')
GROUP BY symbol
HAVING engine_count >= 2;
```
If 0: Engines may be generating signals for different symbols (no overlap).

### Step 3: Are merged signals passing the quality gate (≥55)?
```sql
SELECT symbol, confidence, direction
FROM signals
WHERE created_at > datetime('now', '-1 hour')
  AND confidence >= 55;
```
If 0: VIX regime adjustment may be killing confidence. Check VIX value.

### Step 4: Were alerts inserted to D1?
```sql
SELECT * FROM telegram_alerts 
WHERE created_at > datetime('now', '-2 hours')
ORDER BY created_at DESC;
```
If rows exist but no Telegram: Check Step 5.

### Step 5: Were alerts actually sent?
```sql
SELECT id, symbol, sent_at, alert_text IS NOT NULL as has_text
FROM telegram_alerts 
WHERE created_at > datetime('now', '-2 hours');
```
- If `sent_at IS NULL`: Alert didn't make top 3 in batch, or Telegram delivery failed.
- If `alert_text IS NULL` but `sent_at` exists: Shouldn't happen — investigate.

### Step 6: Was Telegram delivery successful?
```bash
# Tail logs for Telegram errors
npx wrangler tail ymsa-financial-automation --search "telegram" --status error
```

### Common Pipeline Failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| 0 signals generated | External APIs down | Check circuit breakers, API quotas |
| Signals but 0 merges | Engines finding different stocks | Review watchlist, check engine configs |
| Merges but 0 above 55 | VIX too high | Working as designed (regime caution) |
| D1 inserts but 0 Telegram | Confidence < 80 for Telegram | Working as designed (D1 logs all ≥55) |
| D1 inserts but 0 Telegram | Telegram bot error | Check TELEGRAM_BOT_TOKEN, bot not blocked |
| Telegram sent but not received | Wrong chat ID | Verify TELEGRAM_CHAT_ID |
| Duplicate alerts | markSent() not working | Check dedup key logic in broker-manager.ts |

## Telegram Bot Health Check

```bash
# Test bot can send messages
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": "<CHAT_ID>", "text": "YMSA health check ✅"}'

# Get bot info
curl "https://api.telegram.org/bot<BOT_TOKEN>/getMe"

# Check webhook (should NOT be set — we use polling)
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

## Alert Outcome Tracking

Each alert's outcome can be tracked:
```sql
-- Mark alert outcome
UPDATE telegram_alerts 
SET outcome = 'WIN', -- or 'LOSS', 'BREAKEVEN', 'EXPIRED'
    pnl_amount = 45.50,
    resolved_at = datetime('now')
WHERE id = ?;

-- Win rate by month
SELECT 
  strftime('%Y-%m', sent_at) as month,
  COUNT(*) as total_alerts,
  SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) as wins,
  ROUND(100.0 * SUM(CASE WHEN outcome = 'WIN' THEN 1 ELSE 0 END) / COUNT(*), 1) as win_rate
FROM telegram_alerts
WHERE outcome IS NOT NULL
GROUP BY month
ORDER BY month DESC;
```

## Pipeline Metrics

| Metric | How to Measure | Target |
|--------|---------------|--------|
| **Signal generation rate** | `COUNT(signals)` per hourly cron | 5-15 per scan |
| **Merge rate** | % of signals that merge (≥2 engines) | > 30% |
| **Quality gate pass rate** | % of merges with confidence ≥ 55 | > 50% |
| **D1 insert success rate** | Insert success / Total attempts | 100% |
| **Telegram delivery rate** | Messages sent / Top 3 selected | > 99% |
| **Alert-to-delivery latency** | Time from signal creation to Telegram receipt | < 30s |
| **Alert accuracy (win rate)** | Profitable alerts / Total resolved | Target ≥ 60% |

## Usage Examples
```
"Why didn't I get any alerts today?"
"Debug the signal pipeline"
"Check Telegram bot health"
"What's our alert win rate this month?"
"How many signals merged in the last scan?"
"Show the alert pipeline metrics"
"Why was this specific stock not alerted?"
```
