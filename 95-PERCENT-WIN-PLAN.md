# YMSA 95% Win Rate Master Plan — 2026

> **Current**: 50% WR (1W/1L) | **Target**: ≥95% WR  
> **Mode**: Signal-Only Paper Trading | **Capital**: $100K Virtual  
> **Philosophy**: Only take trades with overwhelming evidence. Fewer trades, higher conviction.

---

## THE CORE PRINCIPLE

A 95% win rate means **we don't trade unless everything aligns**. We sacrifice quantity for quality. If the system used to fire 12 alerts and win 6, we now fire 2 alerts and win both.

Every trade must pass **5 independent gates** before becoming a live alert:

```
Signal → [GATE 1: Technical Proof] → [GATE 2: Multi-Engine Consensus]
       → [GATE 3: Regime Alignment] → [GATE 4: R:R & Structure]
       → [GATE 5: Volume + Momentum Confirmation] → 🟢 ALERT
```

If ANY gate fails → trade is KILLED, no exceptions.

---

## GATE 1: TECHNICAL PROOF (Signal Quality Score)

### Problem Found
- RSI 30 triggers BUY in a downtrend (catches falling knives)
- Golden/Death Cross fires in ranging markets (whipsaws)
- MACD crossover without histogram confirmation (noise)
- 52W proximity at 5% = too many false triggers
- `calculateSignalScore()` defined but NEVER CALLED

### Fix: Signal Quality Scoring System

| Indicator | BUY Condition | SELL Condition | Weight |
|-----------|--------------|----------------|--------|
| RSI(14) | ≤ 28 AND rising (+divergence bonus) | ≥ 72 AND falling (+divergence bonus) | 25 |
| EMA Cross | Golden cross AND ADX > 25 | Death cross AND ADX > 25 | 20 |
| MACD | Bullish cross AND histogram > 0 AND rising | Bearish cross AND histogram < 0 AND falling | 20 |
| Price vs EMA200 | Price > EMA200 for BUY | Price < EMA200 for SELL | 15 |
| Trend Alignment | EMA50 > EMA200 for BUY | EMA50 < EMA200 for SELL | 10 |
| 52W Position | Within 2% of 52W low (bounce) | Within 2% of 52W high (rejection) | 10 |

**Minimum Score**: 65/100 to pass Gate 1 (was: no minimum)

### Anti-Trap Rules
- ❌ BLOCK BUY if price < EMA200 AND RSI < 40 (falling knife)
- ❌ BLOCK SELL if price > EMA200 AND RSI > 60 (fighting trend)
- ❌ BLOCK any cross signal if ADX < 20 (ranging → whipsaw)
- ❌ BLOCK if ATR > 5% of price (too volatile for reliable SL)

---

## GATE 2: MULTI-ENGINE CONSENSUS (Agreement Filter)

### Problem Found
- 2 engines = +16 confidence bonus → easily inflates 70 → 86
- A single engine can send alerts alone
- Engines are never required to agree before firing

### Fix: Mandatory Multi-Engine Confirmation

| Engines Agreeing | Confidence Modifier | Action |
|-----------------|---------------------|--------|
| 1 engine only | BLOCK (do not send) | Log as "unconfirmed signal" |
| 2 engines agree | +5 bonus, min base 75 | Send only if final ≥ 85 |
| 3 engines agree | +12 bonus | Send if final ≥ 80 |
| 4+ engines agree | +20 bonus | Send (strong conviction) |
| ANY engine disagrees (conflict) | -25 penalty | Likely blocked |

**New Rule**: NO ALERT fires with fewer than 2 engine agreement.

### Engine Pairs That Must Agree
For highest confidence:
- **Technical + MTF** = trend confirmed across timeframes
- **Smart Money + Technical** = institutional bias + indicator proof
- **Event Driven + Smart Money** = catalyst + institutional backing

---

## GATE 3: REGIME ALIGNMENT (Market Context Gate)

### Problem Found
- `getEngineAdjustments()` calculates regime multipliers but **NEVER APPLIES THEM**
- Counter-trend trades treated same as aligned trades
- VIX > 30 doesn't block any signals

### Fix: Hard Regime Gating

| Regime | Allowed Directions | Blocked | Confidence Modifier |
|--------|-------------------|---------|---------------------|
| TRENDING_UP | BUY only | All SELL (except hedges) | +10 for aligned BUY |
| TRENDING_DOWN | SELL only | All BUY (except reversals at key levels) | +10 for aligned SELL |
| RANGING | FADE_UP / FADE_DOWN | Trend-following signals | -5 (higher bar) |
| VOLATILE (VIX>30) | SELL only, reduce size | All BUY | -15 confidence |

### VIX-Based Position Gates
| VIX Level | Effect |
|-----------|--------|
| < 18 | Normal operation |
| 18–25 | Reduce position size to 75% |
| 25–35 | Reduce to 50%, SELL bias only |
| > 35 | HALT all new positions |

---

## GATE 4: RISK:REWARD & STRUCTURE (R:R Gate)

### Problem Found
- SL/TP based on fixed ATR multiples (2x SL, 2x TP = 1:1 R:R)
- No support/resistance zone awareness
- 8% floor distance on SL is arbitrary
- TP levels ignore prior swing highs/lows

### Fix: Structural SL/TP with Minimum R:R

**Minimum R:R = 2.0:1** (was effectively 1:1)  
**Optimal R:R = 3.0:1** (+5 confidence bonus)

| Component | BUY Logic | SELL Logic |
|-----------|-----------|------------|
| Stop Loss | MAX(nearest support - 0.3×ATR, entry - 1.5×ATR) | MIN(nearest resistance + 0.3×ATR, entry + 1.5×ATR) |
| Take Profit 1 | MIN(nearest resistance, entry + SL_distance × 2) | MAX(nearest support, entry - SL_distance × 2) |
| Take Profit 2 | Entry + SL_distance × 3 | Entry - SL_distance × 3 |

**R:R Check**: If calculated R:R < 2.0 → BLOCK trade  
**Trailing Stop**: After TP1 hit, move SL to entry (breakeven)

### ATR Volatility Gate
- ATR < 0.3% of price → Skip (no meaningful move expected)
- ATR > 5% of price → Skip (too volatile for reliable SL)
- Sweet spot: 0.5% – 3% ATR

---

## GATE 5: VOLUME + MOMENTUM CONFIRMATION

### Problem Found
- Volume spike threshold at 1.5x average (catches routine fluctuations)
- No momentum confirmation (price barely moving but signal fires)
- No candle body size check (doji/spinning top = uncertainty)

### Fix: Volume & Momentum Requirements

| Check | Threshold | Weight |
|-------|-----------|--------|
| Volume ≥ 2.0x 20-day average | Required for all signals | Gate (block if not met) |
| Volume ≥ 3.0x average | Strong confirmation bonus | +8 confidence |
| Price move > 0.5% in signal direction (last 2 candles) | Required | Gate |
| Candle body > 50% of range | Required (no doji entries) | Gate |
| 3+ consecutive candles in signal direction | Strong trend confirmation | +5 confidence |

---

## IMPLEMENTATION PHASES

### Phase 1: Core Gates (Immediate)
- [x] Audit complete
- [ ] Implement `signalQualityScore()` in signals.ts with anti-trap rules
- [ ] Apply regime adjustments in broker-manager.ts (was calculated, never used)
- [ ] Require ≥2 engine agreement for any alert
- [ ] Raise Telegram gate from 80 → 88 confidence
- [ ] Add R:R ≥ 2.0 gate before alert creation

### Phase 2: Enhanced Indicators (Week 2)
- [ ] Add ADX(14) to indicators.ts
- [ ] Add Stochastic(14,3,3) oscillator
- [ ] Implement RSI divergence detection
- [ ] Add Bollinger Band squeeze detection
- [ ] Smart Money age penalty (older zones = weaker)

### Phase 3: Dynamic Learning (Week 3-4)
- [ ] Track win rate per engine → auto-adjust weights
- [ ] Track win rate per regime → auto-disable wrong-regime engines
- [ ] Implement trailing stop simulation in paper trading
- [ ] Add partial profit-taking at TP1

### Phase 4: Advanced Filters (Month 2)
- [ ] Sector rotation awareness (tech down ≠ energy down)
- [ ] Earnings calendar filter (no trades 3 days before earnings)
- [ ] Fed/FOMC meeting filter (no trades on event days)
- [ ] Correlation filter (don't take AAPL BUY + MSFT BUY + GOOGL BUY = triple exposure)

---

## EXPECTED PROGRESSION

| Phase | Expected Win Rate | Trades/Day | Key Change |
|-------|------------------|------------|------------|
| Current | 50% | 6–12 | No filtering |
| Phase 1 | 70–75% | 2–4 | Quality gates + regime gating |
| Phase 2 | 80–85% | 1–3 | Enhanced indicators + ADX filter |
| Phase 3 | 88–92% | 1–2 | Dynamic learning + trailing stops |
| Phase 4 | 93–95%+ | 0–2 | Full confluence with external filters |

---

## KEY METRICS TO TRACK

| Metric | Current | Target |
|--------|---------|--------|
| Win Rate | 50% | ≥ 95% |
| Avg Risk:Reward | ~1:1 | ≥ 2:1 |
| Profit Factor | ~0.8 | ≥ 3.0 |
| Max Drawdown | -2% | ≤ -5% |
| Sharpe Ratio | N/A | ≥ 2.0 |
| Avg Trades/Day | 6–12 | 1–2 |
| Avg Confidence | 65 | ≥ 88 |
| Counter-Trend Trades | ~50% | 0% |
| Single-Engine Trades | ~70% | 0% |

---

## FILES TO MODIFY

| File | Changes |
|------|---------|
| `src/analysis/signals.ts` | Signal quality scoring, anti-trap rules, ADX gate |
| `src/broker-manager.ts` | Regime gating, multi-engine requirement, R:R gate, confidence adjustments |
| `src/analysis/indicators.ts` | Add ADX computation |
| `src/analysis/regime.ts` | VIX position gate, regime confidence modifiers |
| `src/cron-handler.ts` | Apply regime adjustments to engine outputs, volume gate |
| `src/analysis/smart-money.ts` | Age decay, zone strength weighting |
| `src/execution/simulator.ts` | Trailing stop, partial profit-taking |
| `config/screening-rules.json` | Updated thresholds |

---

*Created: April 2, 2026 | YMSA v3 | Signal-Only Mode*  
*Goal: From 50% to 95% — quality over quantity*
