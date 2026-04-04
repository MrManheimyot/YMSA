---
name: ymsa-sre-risk-management
description: Risk management audit, position sizing validation, kill switch testing, and portfolio risk assessment
---

# YMSA SRE Risk Management

You are an expert in financial risk management and Google SRE safety-critical system design. When the user asks about risk controls, kill switch, position sizing, or portfolio risk, use this skill.

## Risk Architecture Overview

YMSA implements a **deterministic risk controller** (no AI in the risk path). This is an intentional design decision — risk management must be predictable and auditable.

### Kill Switch (Tiered, Persistent)

| Tier | Trigger | Action | Duration | Recovery |
|------|---------|--------|----------|----------|
| **REDUCE** | Daily P&L ≤ -3% | 50% position sizes | Until next trading day | Auto at market open |
| **CLOSE_ALL** | Daily P&L ≤ -5% | Liquidate all positions | Until next trading day | Auto at market open |
| **HALT** | Daily P&L ≤ -10% | Freeze ALL trading | 7 calendar days | Auto-expire (D1 persisted) |

**Important**: Kill switch state is persisted to D1 `kill_switch_state` table — survives Worker cold starts and deploys.

### Position Limits (Hard Caps)

| Limit | Value | Enforcement |
|-------|-------|-------------|
| Max open positions | 20 | Position count check before new orders |
| Max single position | 10% of equity | Position sizer in `position-sizer.ts` |
| Max risk per trade | 2% of equity | ATR-based stop-loss width |
| Max portfolio exposure | 80% (20% cash reserve) | Total position value check |
| Max correlation | No more than 3 positions in same sector | Sector analysis (future) |

### VIX-Based Regime Adjustment

| VIX Level | Position Size Modifier | Max Exposure | Confidence Modifier |
|-----------|----------------------|-------------|-------------------|
| VIX < 18 | 1.0x (normal) | 80% | No adjustment |
| 18 ≤ VIX < 25 | 0.75x | 65% | -5 confidence |
| 25 ≤ VIX < 35 | 0.5x | 50% | -15 confidence |
| VIX ≥ 35 | 0.25x | 30% | -25 confidence |

### Engine Budget System (Dynamic, D1-Persisted)

| Engine | Default Budget | Range | Probation |
|--------|---------------|-------|-----------|
| MTF_MOMENTUM | 30% | 5-40% | 0 wins / 5 trades → 5% |
| SMART_MONEY | 20% | 5-40% | 0 wins / 5 trades → 5% |
| STAT_ARB | 20% | 5-40% | 0 wins / 5 trades → 5% |
| OPTIONS | 10% | 5-40% | 0 wins / 5 trades → 5% |
| CRYPTO_DEFI | 10% | 5-40% | 0 wins / 5 trades → 5% |
| EVENT_DRIVEN | 10% | 5-40% | 0 wins / 5 trades → 5% |

**Rebalance**: Monthly (MONTHLY_PERFORMANCE cron). Winners get more, losers get less, minimum 5% floor.

**Probation**: Engine with 0 wins out of 5 consecutive trades gets budget cut to 5%. Auto-recovery when it wins a trade.

### Conflict Resolution

When engines disagree on a symbol:
- Mixed BUY/SELL signals → -25 confidence penalty on final merge
- If confidence drops below 55 after penalty → signal killed
- Prevents "confused" signals from reaching execution

## Risk Audit Checklist

### Daily (Automated in EVENING_SUMMARY)
- [ ] Daily P&L within -3% to +5% range
- [ ] No kill switch triggers
- [ ] Position count ≤ 20
- [ ] Cash reserve ≥ 20% of equity
- [ ] All engine budgets sum to 100%

### Weekly (Manual Review)
- [ ] Win rate per engine ≥ 40% (watch for probation candidates)
- [ ] Max drawdown from peak < 15%
- [ ] No single position dominates (> 10% equity)
- [ ] Sharpe ratio trend (should be improving)
- [ ] Signal-to-trade conversion rate > 50%

### Monthly (MONTHLY_PERFORMANCE cron + manual)
- [ ] Engine budget rebalance executed correctly
- [ ] Any engines on probation reviewed
- [ ] Total realized P&L vs. expected from signals
- [ ] Compare simulator results with actual execution
- [ ] VIX regime distribution (how much time in each zone)

## Risk Validation Queries

```sql
-- Current kill switch status
SELECT * FROM kill_switch_state ORDER BY created_at DESC LIMIT 1;

-- Engine budget allocation (should sum to 100%)
SELECT engine_id, budget_pct, on_probation, updated_at
FROM engine_budgets
ORDER BY engine_id;

-- Engines approaching probation (0 wins, 3+ trades)
SELECT engine_id, 
  COUNT(*) as total_trades,
  SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins
FROM trades
WHERE status = 'CLOSED' AND engine_id IS NOT NULL
  AND created_at > datetime('now', '-30 days')
GROUP BY engine_id
HAVING wins = 0 AND total_trades >= 3;

-- Maximum drawdown calculation
SELECT 
  date, equity,
  MAX(equity) OVER (ORDER BY date ROWS UNBOUNDED PRECEDING) as peak,
  (equity - MAX(equity) OVER (ORDER BY date ROWS UNBOUNDED PRECEDING)) / 
    MAX(equity) OVER (ORDER BY date ROWS UNBOUNDED PRECEDING) * 100 as drawdown_pct
FROM daily_pnl
ORDER BY date DESC
LIMIT 30;

-- Position concentration risk
SELECT symbol, 
  SUM(qty * current_price) as position_value,
  SUM(qty * current_price) / (SELECT equity FROM daily_pnl ORDER BY date DESC LIMIT 1) * 100 as pct_of_equity
FROM positions
GROUP BY symbol
HAVING pct_of_equity > 8
ORDER BY pct_of_equity DESC;

-- Daily P&L distribution (should not be fat-tailed to the left)
SELECT 
  CASE 
    WHEN daily_pnl < -500 THEN '< -$500'
    WHEN daily_pnl < -100 THEN '-$500 to -$100'
    WHEN daily_pnl < 0 THEN '-$100 to $0'
    WHEN daily_pnl < 100 THEN '$0 to $100'
    WHEN daily_pnl < 500 THEN '$100 to $500'
    ELSE '> $500'
  END as bucket,
  COUNT(*) as days
FROM daily_pnl
GROUP BY bucket;
```

## Stress Test Coverage

YMSA has 32 stress tests in `src/__tests__/stress-test.test.ts`:

| Category | Tests | What's Validated |
|----------|-------|-----------------|
| Flash Crash | 4 | Kill switch activation at -5%, -10% |
| VIX Spike | 4 | Position sizing reduction, exposure caps |
| Correlation Break | 4 | Stat arb engine handling |
| Combined Crisis | 4 | Multiple simultaneous failures |
| Engine Probation | 4 | Budget reduction after losing streak |
| Recovery Scenarios | 4 | System resumption after HALT |
| Edge Cases | 8 | Zero equity, max positions, etc. |

Run: `node .\node_modules\vitest\vitest.mjs run src/__tests__/stress-test.test.ts`

## Risk Improvement Recommendations

| Priority | Item | Status | Impact |
|----------|------|--------|--------|
| P1 | Trailing stop-loss | Not implemented | Protect profits on runners |
| P1 | Partial take-profit | Not implemented | Lock in gains at 1.272 Fib |
| P2 | Sector exposure limits | Not implemented | Prevent correlation blowup |
| P2 | Maximum loss per trade $ cap | Implicit via 2% rule | Make explicit |
| P3 | Intraday P&L monitoring | Only daily snapshot | Missed mid-day kill switch |
| P3 | Slippage tracking | Not measured | Execution quality unknown |

## Usage Examples
```
"Run a risk audit"
"Check the kill switch status"
"What's our current exposure?"
"Are any engines on probation?"
"Calculate maximum drawdown"
"Validate position sizing is correct"
"What happens during a VIX spike?"
```
