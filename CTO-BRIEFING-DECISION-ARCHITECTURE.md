# YMSA — Stock Decision-Making Architecture
## CTO Briefing Document for Team Leadership Meeting

**Date:** April 3, 2026
**Prepared for:** Yotam Manheim, Owner
**Classification:** Internal — Strategic Review
**Purpose:** Explain the complete decision-making hierarchy, control systems, and approval chains to the owner, and identify gaps vs. institutional best practices.

---

## Table of Contents
1. [How a Stock Decision Is Made — End to End](#1-how-a-stock-decision-is-made--end-to-end)
2. [The System of Considerations — What Factors Influence Each Decision](#2-the-system-of-considerations)
3. [The Control System — Who Prevents Bad Trades](#3-the-control-system)
4. [The Approval Chain — Does Anyone "Sign Off" Before a Trade?](#4-the-approval-chain)
5. [The Agent Hierarchy — Who Outranks Whom](#5-the-agent-hierarchy)
6. [Comparison with Institutional Best Practices](#6-comparison-with-institutional-best-practices)
7. [Identified Gaps & Recommended Improvements](#7-identified-gaps--recommended-improvements)

---

## 1. How a Stock Decision Is Made — End to End

### In Plain Language

Imagine a company with **6 analyst teams**, each with a different specialty. Every 90 minutes during market hours, all 6 teams independently analyze the market. Their individual recommendations flow into a **Chief Broker** who merges them. The Chief Broker requires **at least 2 teams to agree** before any recommendation moves forward. Then, a **Quality Assurance department** checks the data, and an **AI Advisor** reviews the trade setup. Only after passing **15 separate checkpoints** does a trade alert reach Yotam's phone.

### The Exact Flow

```
Step 1: DATA COLLECTION
  ┃  Yahoo Finance, Finnhub, FRED, CoinGecko, DexScreener, Polymarket
  ┃  → prices, volume, indicators, news, macro data
  ┃
Step 2: DATA VALIDATION (7-Layer Quality Check)
  ┃  Layer 1: Is the price data structurally valid? (not stale, not NaN)
  ┃  Layer 2: Are indicators consistent? (RSI in range, MACD cross-check)
  ┃  Layer 3: Z.AI spot-checks 15% of stocks for anomalies
  ┃  Layer 4: If multiple data sources, do prices agree within 1%?
  ┃  Layer 5: Are signals internally consistent? (no BUY+SELL conflict)
  ┃  Layer 6: Are trade parameters sane? (R:R ≥ 2.0, SL/TP direction)
  ┃  Layer 7: Aggregate quality score — must be ≥ 60/100 with zero critical failures
  ┃  🛑 If data fails → stock is SKIPPED entirely
  ┃
Step 3: 6 ENGINES ANALYZE IN PARALLEL
  ┃  Each engine independently produces a BUY, SELL, or HOLD with confidence 0-100
  ┃
Step 4: CHIEF BROKER MERGES OPINIONS
  ┃  ✗ Single-engine recommendation → REJECTED (must have ≥2 agreeing)
  ┃  ✗ Conflicting engines (BUY vs SELL) → confidence penalized by -25 points
  ┃  ✓ Agreeing engines → confidence boosted (+5 per additional engine)
  ┃  Market regime adjustments: +10 if trade aligns with trend, -15 if counter-trend
  ┃
Step 5: TRADE ALERT PLANNING (5 Hard Gates)
  ┃  Gate 1: Final confidence must be ≥ 85/100
  ┃  Gate 2: Risk:Reward ratio must be ≥ 2.0 on first target
  ┃  Gate 3: Cannot trade against a strong trend (regime confidence ≥ 70%)
  ┃  Gate 4: VIX ≥ 35 → ALL trades blocked (extreme market fear)
  ┃  Gate 5: Max 3 trade alerts per hour + no duplicate within 24 hours
  ┃  🛑 Fail any gate → recommendation DIES here
  ┃
Step 6: Z.AI VALIDATION (AI Advisor Review)
  ┃  Z.AI reviews the full trade setup: symbol, direction, engines, R:R, regime, data quality
  ┃  Verdict: APPROVE or REJECT with confidence score and written reason
  ┃  🛑 If REJECT → trade is VETOED
  ┃
Step 7: TELEGRAM ALERT SENT TO OWNER
  ┃  Full trade card: entry price, stop loss, take profit, R:R, confidence, reasoning
  ┃  Logged to D1 database for performance tracking
  ┃
Step 8: EXECUTION (if enabled)
  ┃  Pre-flight: signal strength ≥ 60, open positions < 8, daily trades < 15
  ┃  No contradictory positions (can't BUY and SELL same stock)
  ┃  Dynamic position sizing via Kelly criterion (based on actual win rate)
  ┃  Bracket order placed: entry + stop loss + take profit
  ┃
Step 9: RISK CONTROLLER (always running, cannot be overridden)
  ┃  -3% daily drawdown → HALT new trades
  ┃  -5% daily loss → CLOSE ALL positions
  ┃  -10% daily loss → HALT ALL trading for 7 days
  ┃  Individual position ≤ 10% of equity
  ┃  Sector exposure ≤ 25%
  ┃  Always keep ≥ 20% cash
```

---

## 2. The System of Considerations

### What Factors Are Weighed Before Each Trade?

| Category | Specific Factors | Weight/Impact |
|---|---|---|
| **Technical Analysis** | RSI, EMA 50/200, SMA 50/200, MACD, ATR, Volume, Fibonacci levels, 52-week ranges | Core signals from Engines 1-2 |
| **Smart Money Detection** | Institutional order blocks, fair value gaps, liquidity sweeps, break of structure | Engine 3 — detects where "big money" is moving |
| **Statistical Arbitrage** | Pair correlations, z-score divergence, cointegration, hedge ratios | Engine 4 — finds mis-pricings between related stocks |
| **Macro Environment** | GDP, CPI, unemployment, yield curve (2Y/10Y), FRED data, VIX level | Engine 6 + regime detection |
| **Market Regime** | TRENDING_UP / TRENDING_DOWN / RANGING / VOLATILE — detected from SPY ADX, EMA gap, Bollinger width, VIX | Modifies ALL engine outputs (+10 aligned, -15 counter-trend) |
| **News Sentiment** | 12 Google Alert RSS feeds categorized by engine relevance | Routed to relevant engines for sentiment scoring |
| **Crypto/DeFi Signals** | DEX pair data, whale activity ($1M+ volume), CoinGecko trending | Engine 5 — crypto-specific |
| **Prediction Markets** | Polymarket — events with probability ≤25% and volume ≥$50K | Engine 6 — event-driven opportunities |
| **Data Quality** | Quote freshness, indicator consistency, cross-source agreement, parameter sanity | 7-layer validator — blocks bad data before engines see it |
| **Risk Position** | Current open positions, daily P&L, sector exposure, portfolio heat | Risk Controller — overrides everything |
| **Historical Performance** | Win rate from last 50 trades, engine-specific track records | Kelly criterion sizing adapts to real performance |

### How Confidence Is Calculated

A trade's final confidence score is a **composite** built through multiple layers:

```
Engine Raw Confidence (50-100)
  + Agreement Bonus: +5 per additional engine that agrees (max +15)
  - Conflict Penalty: -25 if any engine disagrees
  + Regime Alignment: +10 if trade matches market trend
  - Regime Counter: -15 if trade opposes market trend
  - VIX Penalty: -10 if VIX ≥ 30
  ═══════════════════════════════════════
  = Final Confidence (0-100, must be ≥ 85 to proceed)
```

**Example:** Smart Money says BUY NVDA (conf 75) + MTF says BUY NVDA (conf 70). Regime is TRENDING_UP (conf 85%).
→ Base: 75 + Agreement bonus: +5 + Regime aligned: +10 = **90/100** → PASSES the 85 threshold.

---

## 3. The Control System

### Overview

YMSA has **3 independent control layers** that operate simultaneously. No single point of failure can cause an unauthorized trade.

### Layer A: Data Quality Controller (`data-validator.ts`)
- **When:** Before any engine sees the data
- **Authority:** Can skip an entire stock from the analysis pipeline
- **Override possible?** No — if data fails, the stock is invisible to all engines
- **Key thresholds:** Quote quality ≥70, aggregate data quality ≥60, zero critical failures

### Layer B: Trade Quality Controller (`broker-manager.ts`)
- **When:** After engines report, before any alert is sent
- **Authority:** Can reject any trade recommendation, regardless of how many engines agree
- **Override possible?** No — hardcoded gates in `planTradeAlert()` function
- **Key gates:**
  - Confidence ≥ 85 (covers 99th percentile of quality)
  - R:R ≥ 2.0 (mathematical edge requirement)
  - Counter-trend block (regime confidence ≥ 70%)
  - VIX halt (≥ 35)
  - Hourly budget (max 3 trade alerts/hour)
  - 24-hour dedup (same symbol + direction can't repeat)

### Layer C: Risk Controller (`risk-controller.ts`)
- **When:** Before any actual order is placed by the execution engine
- **Authority:** Can HALT all trading, CLOSE all positions, or BLOCK any individual trade
- **Override possible?** **ABSOLUTELY NOT** — deterministic math, no AI, no exceptions
- **Kill switch tiers:**

| Daily Loss | Action | Duration |
|---|---|---|
| -3% | HALT new trades | Until next day |
| -5% | CLOSE ALL positions | Immediate liquidation |
| -10% | HALT ALL trading | 7 days |
| -$5,000 | HALT new trades | Until next day |

- **Position limits:**
  - Max 10% equity per position
  - Max 25% per sector
  - Max 80% total invested (always 20% cash)
  - Max 20 concurrent positions
  - No two positions with correlation > 0.85

### Additional Controls

| Control | Location | Purpose |
|---|---|---|
| VIX-based position sizing | Risk Controller | VIX 18-25: 75% size, VIX 25-35: 50% size, VIX 35+: 25% size |
| Engine capital budgets | Risk Controller | Each engine has a max % of equity (MTF: 30%, SMC: 20%, etc.) |
| Contradictory position block | Execution Engine | Can't BUY and SELL same stock simultaneously |
| Dynamic Kelly sizing | Execution Engine | Position size adapts to real win/loss ratio |
| Confidence ≥ 85 simulation gate | Simulator | Paper trades only created from high-quality alerts |

---

## 4. The Approval Chain

### Does a "Committee" Review and Approve Each Trade?

**Yes — but the committee is automated.** Here is the exact sequence of approvals:

```
 ┌──────────────────────────────────────────────────────────┐
 │  APPROVAL CHAIN — Every Trade Must Pass ALL of These     │
 │                                                          │
 │  1. DATA QUALITY BOARD         ✓ or ✗ (auto)            │
 │     data-validator.ts                                    │
 │     "Is the underlying data trustworthy?"                │
 │                                                          │
 │  2. MULTI-ENGINE CONSENSUS     ✓ or ✗ (auto)            │
 │     broker-manager.ts mergeBySymbol()                    │
 │     "Do at least 2 independent analysts agree?"          │
 │                                                          │
 │  3. QUALITY GATE PANEL         ✓ or ✗ (auto)            │
 │     broker-manager.ts planTradeAlert()                   │
 │     "Does this meet our 85 confidence + 2.0 R:R + no    │
 │      counter-trend + no extreme VIX standards?"          │
 │                                                          │
 │  4. Z.AI SENIOR ADVISOR        APPROVE or REJECT (AI)   │
 │     z-engine.ts validateTradeSetup()                     │
 │     "Given all context, should we proceed?"              │
 │                                                          │
 │  5. RISK OFFICER               ✓ or ✗ (auto)            │
 │     risk-controller.ts                                   │
 │     "Are we within all portfolio risk limits?"           │
 │                                                          │
 │  6. EXECUTION PRE-FLIGHT       ✓ or ✗ (auto)            │
 │     engine.ts executeSignal()                            │
 │     "Position limits OK? No contradictions? Strength OK?"|
 │                                                          │
 │  7. HUMAN OWNER OVERRIDE       Manual (Telegram)        │
 │     Owner sees alert on phone, can choose to ignore      │
 │                                                          │
 │  ANY SINGLE "✗" → TRADE DOES NOT HAPPEN                 │
 └──────────────────────────────────────────────────────────┘
```

### Key Insight: The Chain is Serial, Not Parallel

Each approver must say YES before the next one even sees the trade. If Stage 2 (multi-engine consensus) rejects because only 1 engine agreed, Stages 3-7 never run. This means the system is **extremely conservative** — it's much easier to block a trade than to approve one.

---

## 5. The Agent Hierarchy

### Organizational Chart

```
                     ┌─────────────────────┐
                     │    RISK CONTROLLER   │  ← SUPREME AUTHORITY
                     │   (Deterministic)    │     Cannot be overridden
                     │   Kill switch, limits│     by anyone/anything
                     └─────────┬───────────┘
                               │
                     ┌─────────▼───────────┐
                     │   BROKER MANAGER     │  ← CHIEF OPERATING OFFICER
                     │ (Synthesis + Gates)  │     Merges all input, enforces
                     │  Confidence, R:R,    │     quality standards
                     │  regime, budget      │
                     └─────────┬───────────┘
                               │
                     ┌─────────▼───────────┐
                     │      Z.AI ENGINE     │  ← SENIOR ADVISOR (Advisory)
                     │ (LLM-based review)   │     Can VETO trades, but CAN
                     │  APPROVE / REJECT    │     be bypassed if unavailable
                     └─────────┬───────────┘
                               │
                     ┌─────────▼───────────┐
                     │   DATA VALIDATOR     │  ← QUALITY ASSURANCE
                     │  (7-Layer Pipeline)  │     Blocks bad data before
                     │  Score ≥60, 0 fails  │     engines even see it
                     └─────────┬───────────┘
                               │
          ┌────────┬───────┬───┴────┬─────────┬──────────┐
          ▼        ▼       ▼        ▼         ▼          ▼
      ┌───────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
      │  MTF  │ │ SMC  │ │ TECH │ │STAT  │ │CRYPTO│ │EVENT │
      │Moment.│ │Smart │ │Analy.│ │ Arb  │ │ DeFi │ │Driven│
      │ (30%) │ │Money │ │      │ │      │ │      │ │      │
      │       │ │(20%) │ │      │ │(20%) │ │(10%) │ │(10%) │
      └───────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘
         ▲         ▲        ▲        ▲         ▲        ▲
         └─────────┴────────┴────────┴─────────┴────────┘
                    6 ENGINES — Equal rank among peers
                    No engine can override another
                    Each has a CAPITAL BUDGET (% of equity)
```

### Authority Rules

| Entity | Can Override | Cannot Override | Can Be Bypassed? |
|---|---|---|---|
| **Risk Controller** | Everything below it | Nothing — it is supreme | **Never** |
| **Broker Manager** | Individual engine opinions | Risk Controller | No |
| **Z.AI Advisor** | Broker Manager's trade plans | Risk Controller, Broker gates | Yes — if AI is unavailable, trades still flow (graceful degradation) |
| **Data Validator** | All engines (blocks their input) | Nothing above it | No — hard quality gates |
| **Any Single Engine** | Nothing | Everything | N/A — engines only propose, never decide |
| **Execution Engine** | Final order placement | Risk Controller | No |
| **Human Owner** | Everything (manual override via not acting on alerts) | Self-discipline | N/A |

### Key Design Principle: **Inverted Hierarchy**

Unlike a traditional company where the CEO (most knowledge) has the most power, YMSA deliberately gives **the most power to the simplest, most deterministic systems**:

- Risk Controller = simple math, maximum authority
- Broker Manager = rule-based gates, high authority
- Z.AI = complex AI reasoning, advisory authority (can be bypassed)
- Engines = most sophisticated analysis, zero authority (can only recommend)

**Why?** The more complex a system, the more likely it has bugs. By giving the simplest rules the highest authority, we ensure that even if the AI makes a mistake, the math won't allow a catastrophic loss.

---

## 6. Comparison with Institutional Best Practices

### How Investment Banks and Hedge Funds Structure Trading Decisions

| Practice | Institutional Standard | YMSA Current State | Assessment |
|---|---|---|---|
| **Multi-factor signal generation** | Multiple independent models contribute to a composite score | ✅ 6 independent engines with different methodologies | **Aligned** |
| **Consensus requirement** | Major firms require 2+ independent signals to agree (e.g., Renaissance Technologies' multi-model approach) | ✅ ≥2 engines must agree before any trade | **Aligned** |
| **Pre-trade risk checks** | EU MiFID II & SEC Rule 15c3-5 mandate automated pre-trade risk controls | ✅ 15 sequential gates, deterministic risk controller | **Aligned** |
| **Kill switch** | Required by all major exchanges and regulators | ✅ 3-tier kill switch (-3%, -5%, -10%) | **Aligned** |
| **Position limits** | Standard in all institutional systems | ✅ Max 10% per position, 25% per sector, 80% total exposure | **Aligned** |
| **Data validation** | MiFID II Article 17 requires "robust" data quality controls | ✅ 7-layer validation framework | **Aligned** |
| **Audit trail** | SEC Rule 17a-4 requires full trade recordkeeping | ✅ All signals, trades, alerts logged to D1 database | **Aligned** |
| **Human oversight** | EU AI Act requires "human in the loop" for financial AI | ⚠️ Owner sees Telegram alerts but no explicit "approve/deny" step before execution | **Partial Gap** |
| **Backtesting before deployment** | Standard practice at all quant firms | ❌ No backtesting engine exists | **Gap** |
| **Independent risk team** | Separate risk desk from trading desk | ✅ Risk Controller is architecturally separated, cannot be overridden by trading logic | **Aligned** |
| **Regime-aware position sizing** | Dynamic risk budgets based on market conditions (Bridgewater-style) | ✅ VIX-based multipliers (0.25x to 1.0x) + regime engine weights | **Aligned** |
| **Correlation monitoring** | Required to prevent concentrated bets | ✅ Max correlation 0.85 between any two positions | **Aligned** |
| **Performance attribution** | Per-strategy P&L tracking and weight adjustment | ✅ Per-engine performance tracking, win rate, P&L | **Aligned** |
| **Drawdown management** | Tiered response to losses | ✅ 3-tier kill switch with escalating actions | **Aligned** |
| **Model validation / second opinion** | Independent model review (Federal Reserve SR 11-7 guidance) | ✅ Z.AI validates every trade setup before execution | **Aligned** |
| **Graceful degradation** | Systems must function safely if components fail | ✅ Z.AI unavailable → system continues with deterministic rules only | **Aligned** |
| **Anti-gaming measures** | Prevent self-contradictory or manipulative positions | ✅ Contradictory position blocking, dedup, anti-trap rules | **Aligned** |
| **Stress testing / scenario analysis** | Regular "what if" analysis under extreme conditions | ❌ No stress testing framework | **Gap** |
| **Expiration / stale trade handling** | Time-limit on open recommendations | ✅ 7-day auto-expiry on simulated trades | **Aligned** |
| **Dynamic weight adaptation** | Adjust engine weights based on recent performance | ❌ Engine capital budgets are static (30/20/20/10/10/10) | **Gap** |

---

## 7. Identified Gaps & Recommended Improvements

### Gap 1: No Human "Approve Before Execute" Button
**Risk Level: MEDIUM**

**Current state:** Trades are executed automatically after passing all automated gates. The owner sees a Telegram alert, but by then the paper trade may already be placed in the simulator.

**Institutional standard:** Most firms have a "trader confirms order" step — even if it's a one-tap approval in a mobile app.

**Recommendation:** Add a Telegram inline keyboard with "✅ APPROVE" / "❌ REJECT" buttons to each trade alert. The execution engine waits up to 5 minutes for the owner's response. If no response within 5 minutes, auto-approve (to avoid missing time-sensitive opportunities). This gives the owner veto power without creating bottlenecks.

---

### Gap 2: No Backtesting Engine
**Risk Level: HIGH**

**Current state:** All 6 engines and quality gates were built from theory and textbook thresholds, then tested on live paper trading. There is no ability to run "what if we applied these rules to the last 6 months of data."

**Institutional standard:** Every quant firm backtests signals against historical data before deploying. Some run Monte Carlo simulations across thousands of scenarios.

**Recommendation:** Build a backtesting module that:
1. Takes historical Yahoo Finance OHLCV data (6-12 months)
2. Runs each engine's signal detection logic
3. Simulates the full pipeline (gates, confidence calc, R:R check)
4. Produces a performance report: win rate, profit factor, max drawdown, Sharpe ratio
5. Compares "what would have happened" vs. "what the system actually did"

---

### Gap 3: Static Engine Capital Budgets
**Risk Level: LOW-MEDIUM**

**Current state:** Engine budgets are hardcoded: MTF 30%, Smart Money 20%, Stat Arb 20%, Options 10%, Crypto 10%, Event Driven 10%. These never change regardless of performance.

**Institutional standard:** Firms like Bridgewater and Two Sigma dynamically adjust strategy allocations based on rolling performance metrics. Strategies that are winning get more capital; strategies that are losing get less.

**Recommendation:** Implement a monthly auto-rebalance of engine budgets based on:
- Rolling 30-day win rate per engine
- Rolling 30-day profit factor per engine
- Minimum floor: no engine below 5% (prevents complete shutoff)
- Maximum ceiling: no engine above 40% (prevents over-concentration)
- Rebalance runs in the `WEEKLY_SUMMARY` cron job

---

### Gap 4: No Stress Testing
**Risk Level: MEDIUM**

**Current state:** The system has never been tested against extreme scenarios: what happens if VIX spikes to 80? What if all 8 open positions gap down 10% overnight? What if an API returns corrupted data for all stocks simultaneously?

**Institutional standard:** Banks run quarterly stress tests (Dodd-Frank Act requires it for large institutions). CFTC requires automated trading firms to have risk controls that work under "extreme but plausible" scenarios.

**Recommendation:** Build a stress test suite that simulates:
1. Flash crash (all prices drop 8% in 5 minutes)
2. VIX spike to 80
3. API failure (all data sources return errors)
4. Correlation breakdown (all hedged pairs move same direction)
5. One engine producing 100% false signals
Verify that kill switch, risk limits, and data quality gates all function as designed.

---

### Gap 5: Z.AI as Single Point of Advisory Failure
**Risk Level: LOW**

**Current state:** Z.AI is the only AI validation layer. If the LLM model is biased, hallucinating, or unavailable, the system falls back to deterministic rules only.

**Assessment:** The graceful degradation design is correct — the system SHOULD still work without Z.AI. But there is no alerting when Z.AI is unavailable or producing poor-quality assessments.

**Recommendation:**
1. Log Z.AI unavailability rate to D1 — if >10% of calls fail in one scan, send warning to Telegram
2. Track Z.AI APPROVE vs REJECT ratio — if it approves >95% or rejects >80%, the model may be biased
3. Consider adding a second LLM (e.g., different prompt/temperature) as a "minority opinion" validator

---

### Gap 6: Smart Money Engine Underperformance Not Auto-Addressed
**Risk Level: MEDIUM**

**Current state:** Per the July 14 Owner Report, Smart Money produced 25 alerts, 0 wins, -$1,987 P&L. It is the highest-volume engine but the lowest quality. Its capital budget remains at 20%.

**Institutional standard:** A strategy with a negative track record would be put on "probation" — reduced allocation with heightened monitoring.

**Recommendation:** Implement an automatic "probation" system:
- If any engine has 0 wins and ≥5 closed trades → reduce its capital budget to 5% and raise its push threshold by +10
- Alert the owner via Telegram: "⚠️ Smart Money engine placed on probation: 0/5 wins"
- Restore normal budget after 5 consecutive wins

---

## Summary for the Owner

### What's Working Well

1. **15-checkpoint pipeline** — No trade reaches your phone without passing 15 independent quality gates. This is more rigorous than many retail trading systems.
2. **Inverted authority** — The simplest, most reliable systems (kill switch, position limits) have the MOST power. Complex AI has LESS power. This prevents AI mistakes from causing real damage.
3. **6-engine consensus** — Requiring ≥2 independent engines to agree eliminates most false positives. Single-engine "hot tips" are automatically rejected.
4. **Full audit trail** — Every signal, trade, alert, and risk event is logged. You can trace any decision back to its source.
5. **Graceful degradation** — If any component fails (API down, AI unavailable, database timeout), the system continues safely rather than making wild trades.

### What Needs Improvement (Priority Order)

| Priority | Gap | Impact | Effort |
|---|---|---|---|
| **P1** | Backtesting engine | Cannot validate strategy changes before deploying | Large |
| **P2** | Human approve/deny button on Telegram | Owner has no explicit veto before execution | Medium |
| **P3** | Dynamic engine budgets | Underperforming engines still get full capital allocation | Small |
| **P4** | Stress testing | No verification that safety systems work under extreme scenarios | Medium |
| **P5** | Smart Money probation system | Worst-performing engine not automatically penalized | Small |
| **P6** | Z.AI monitoring & health checks | No visibility into AI advisor's availability or quality | Small |

---

*This document is prepared for the CTO to conduct a team leadership meeting. Each gap should be discussed, prioritized, and assigned to a team lead with a delivery timeline. No code changes have been made — this is analysis only.*

*Prepared by: YMSA Development Team*
*Commit reference: `2d63cde` (current production)*
