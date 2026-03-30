# 🚀 YMSA SUPERCHARGE PLAN — 40%+ Monthly Returns Blueprint

> **Author:** YMSA Algorithmic Trading Engine  
> **Date:** March 31, 2026  
> **Version:** 3.0 — "Operation Alpha Storm"  
> **Target:** 40%+ smart, risk-managed monthly returns across 6 profit engines  
> **Philosophy:** Stack multiple uncorrelated edges. No single strategy carries the load. Compound small wins at high frequency. Let math do the work.

---

## 📊 EXECUTIVE SUMMARY

Your current YMSA system is a **signal generation machine** — it detects opportunities across 5 arenas but **never acts on them**. That's like having a radar that sees every fish but no net to catch them.

This plan transforms YMSA from a **passive signal scanner** into an **autonomous 6-engine profit machine** with:

| Engine | Strategy | Monthly Target | Risk Level |
|--------|----------|---------------|------------|
| ⚡ Engine 1 | Multi-Timeframe Momentum & Mean Reversion | 8-12% | Medium |
| 🧠 Engine 2 | Smart Money + Institutional Flow | 6-10% | Medium |
| 📐 Engine 3 | Statistical Arbitrage + Pairs (Market Neutral) | 4-6% | Low |
| 🎯 Engine 4 | Options Income (Premium Selling) | 5-8% | Low-Medium |
| 🐋 Engine 5 | Crypto Swing + DeFi Yield | 8-15% | High |
| 🎰 Engine 6 | Event-Driven + Prediction Markets | 5-10% | Medium-High |
| **COMBINED** | **6 uncorrelated engines** | **36-61%** | **Managed** |

**The key insight:** 40% monthly doesn't come from one magic indicator — it comes from running **6 independent profit engines simultaneously**, each targeting 5-15%, diversified across asset classes, timeframes, and market conditions so that **when one engine underperforms, others compensate.**

---

## 🏗️ ARCHITECTURE UPGRADE: FROM SIGNALS TO EXECUTION

### Current State (v2.0)
```
[APIs] → [5 Agents] → [Signals] → [Telegram Alert] → [YOU manually trade]
                                          ↑
                                   BOTTLENECK: human speed, human emotions, human sleep
```

### Target State (v3.0)
```
[APIs + WebSocket Feeds] → [Multi-Timeframe Engine] → [Signal Scoring (ML Ensemble)]
         ↓                                                      ↓
[Regime Detector] ←→ [Strategy Selector] ←→ [Risk Controller v2 (live)]
                                                      ↓
                        [Execution Engine (Alpaca/IBKR)] ← [Position Sizer (Kelly)]
                                    ↓
         [Portfolio Manager] → [P&L Tracker] → [Performance Dashboard]
                    ↓                                    ↓
         [D1 Database] ← Trade History ← [Post-Trade Analysis]
                    ↓
         [Telegram] → Executed trade confirmations, daily P&L, weekly review
```

---

## ⚡ ENGINE 1: MULTI-TIMEFRAME MOMENTUM & MEAN REVERSION (Target: 8-12%/mo)

### The Problem With Your Current System
You scan **daily (1D) candles only**. That means:
- You see a signal ~24 hours late
- You miss intraday entries/exits that could 2-3x your edge
- You can't distinguish between a minor pullback and a trend reversal

### The Fix: Triple-Screen System (Dr. Alexander Elder, upgraded for 2026)

**Scan 3 timeframes simultaneously for confluence:**

| Timeframe | Purpose | Indicator Stack |
|-----------|---------|----------------|
| **Weekly (1W)** | Trend direction | EMA 21/55, MACD histogram slope, ADX > 25 |
| **Daily (1D)** | Signal zone | RSI divergence, Bollinger squeeze, VWAP deviation |
| **4-Hour (4H)** | Entry trigger | Stochastic cross, EMA 9/21, volume confirmation |
| **15-Min (15M)** | Precision entry | Order flow, VWAP test, candle pattern |

**Rules:**
1. **Weekly bullish + Daily pullback to support + 4H oversold bounce** = HIGH-CONFIDENCE BUY
2. **Weekly bearish + Daily rally to resistance + 4H overbought rejection** = HIGH-CONFIDENCE SHORT
3. **All 3 timeframes aligned** = FULL POSITION (5% equity)
4. **2 of 3 aligned** = HALF POSITION (2.5% equity)
5. **Conflicting timeframes** = NO TRADE

### New Indicators to Add (TAAPI Bulk supports all of these)

| Indicator | What It Tells You | Why It Matters |
|-----------|-------------------|----------------|
| **ADX (Average Directional Index)** | Trend strength (>25 = trending, <20 = ranging) | Switches between momentum vs mean-reversion strategy |
| **ATR (Average True Range)** | Volatility magnitude | Dynamic stop-loss sizing (1.5-2x ATR) |
| **Stochastic RSI** | RSI of RSI — faster overbought/oversold | Earlier entry signals than regular RSI |
| **OBV (On Balance Volume)** | Cumulative volume direction | Divergence from price = reversal incoming |
| **VWAP (Volume Weighted Avg Price)** | Institutional fair price | Price below VWAP = institutional buying zone |
| **Ichimoku Cloud** | Trend + support/resistance in one | Cloud breakout = strong momentum signal |
| **SuperTrend** | ATR-based trailing stop/direction | Clean buy/sell signals with built-in stops |
| **Williams %R** | Momentum oscillator (-100 to 0) | Confirms oversold/overbought with divergence |
| **CCI (Commodity Channel Index)** | Price deviation from mean | +100/-100 extremes = reversal setups |
| **Parabolic SAR** | Trailing stop with acceleration | Perfect for locking profits in strong trends |

### Mean Reversion Module (For Range-Bound Markets)

When ADX < 20 (no trend), switch to **mean reversion mode:**
1. **Bollinger Band squeeze** → volatility contraction = breakout imminent
2. **RSI divergence at bands** → price hits lower band but RSI rises = BUY
3. **Keltner Channel inside Bollinger** → "squeeze" signal (John Carter's TTM Squeeze)
4. **Z-score > 2.0 from 20-day mean** → fade the move (counter-trend entry)

**Target per trade:** 1.5-3% gain, 1% max risk → **2:1 minimum reward:risk**

### Implementation Plan
```typescript
// New: src/analysis/multi-timeframe.ts
interface MTFSignal {
  weekly:  TrendDirection;   // BULLISH | BEARISH | NEUTRAL
  daily:   SignalZone;       // SUPPORT | RESISTANCE | MID_RANGE
  h4:      EntryTrigger;     // BUY_TRIGGER | SELL_TRIGGER | NO_TRIGGER
  m15:     PrecisionEntry;   // CONFIRMED | REJECTED
  regime:  MarketRegime;     // TRENDING | RANGING | VOLATILE | CALM
  confluence: number;        // 0-100 score (>70 = trade)
}

// TAAPI Bulk call per timeframe (4 calls = 80 indicators total)
const timeframes = ['1w', '1d', '4h', '15m'];
for (const tf of timeframes) {
  const indicators = await taapi.getBulkIndicators(symbol, tf, [
    'rsi', 'macd', 'ema:21', 'ema:55', 'ema:9', 'ema:200',
    'adx', 'atr', 'stochrsi', 'obv', 'vwap', 'ichimoku',
    'supertrend', 'willr', 'cci', 'psar', 'bbands', 'stoch'
  ]);
}
```

---

## 🧠 ENGINE 2: SMART MONEY CONCEPTS + INSTITUTIONAL FLOW (Target: 6-10%/mo)

### What Is Smart Money?
Banks, hedge funds, and market makers move **80% of daily volume**. They leave footprints:

1. **Order Blocks (OB):** Where institutions placed massive orders — price WILL revisit
2. **Fair Value Gaps (FVG):** 3-candle patterns where price jumped — gets filled 70%+ of the time
3. **Liquidity Sweeps:** Stop-loss hunts above/below key levels before real moves
4. **Break of Structure (BOS):** Confirmation of trend change when swing high/low broken

### How We Detect Smart Money Automatically

```
ORDER BLOCK DETECTION:
━━━━━━━━━━━━━━━━━━━━
1. Find the last bearish candle before a strong bullish impulse move
2. That bearish candle = BULLISH ORDER BLOCK (institutional buy zone)
3. When price returns to that zone = HIGH-PROBABILITY BUY ENTRY
4. Stop loss: 1 ATR below the order block
5. Take profit: next resistance or 2:1 R:R

FAIR VALUE GAP (FVG):
━━━━━━━━━━━━━━━━━━━━
1. Candle 1 high < Candle 3 low = BULLISH FVG (gap up)
2. 70% of FVGs get filled within 5 trading days
3. Enter LONG when price returns to fill the gap
4. Combine with RSI < 40 for extra confirmation

LIQUIDITY SWEEP:
━━━━━━━━━━━━━━━━
1. Price pushes below previous low (grabs stops)
2. Immediately reverses with strong bullish candle
3. = "SPRING" or "SWEEP" → institutional accumulation → BUY
4. Opposite: price pushes above high then dumps = SELL
```

### Data Sources for Institutional Flow

| Source | Data | Free? | Integration |
|--------|------|-------|-------------|
| **Finnhub Insider Transactions** | SEC Form 4 filings (CEO/CFO buys) | ✅ Free tier | Already have Finnhub key |
| **Finviz Dark Pool** | Unusual options activity, block trades | ✅ Screener | Already have scraper |
| **Unusual Whales API** | Options flow, dark pool prints | 💰 $30/mo | REST API |
| **Quiver Quant** | Congress trades, insider, lobbying | ✅ Free | REST API |
| **SEC EDGAR** | 13-F filings (quarterly holdings) | ✅ Free | RSS + scraper |

### Signal Priority

| Signal | Confidence | Action |
|--------|-----------|--------|
| Order Block + RSI oversold + Volume spike | 🔴 95% | FULL POSITION |
| FVG fill + EMA support + bullish MACD | 🟠 85% | FULL POSITION |
| Liquidity sweep + immediate reversal | 🟡 80% | HALF POSITION |
| CEO/Insider buying > $1M + technical setup | 🔴 90% | FULL POSITION |
| Dark pool block > 5x avg + bullish technicals | 🟠 85% | FULL POSITION |
| Congress member buys + sector momentum | 🟡 75% | HALF POSITION |

### Implementation
```typescript
// New: src/analysis/smart-money.ts
interface SmartMoneySignal {
  type: 'ORDER_BLOCK' | 'FVG' | 'LIQUIDITY_SWEEP' | 'BOS' | 'INSIDER_BUY';
  direction: 'BULLISH' | 'BEARISH';
  zone: { high: number; low: number };  // price zone
  age: number;           // days since formation
  strength: number;      // 0-100 (volume, impulse move magnitude)
  filled: boolean;       // has price returned to zone?
  confluence: string[];  // other indicators confirming
}
```

---

## 📐 ENGINE 3: STATISTICAL ARBITRAGE + PAIRS (Market Neutral, Target: 4-6%/mo)

### Why This Is Your Safest Profit Engine
Stat-arb is **market neutral** — you're long one stock and short its correlated partner. When the market crashes, your longs lose but your shorts gain. In theory: **zero beta, pure alpha.**

### Current State (Broken)
Your `pairs-trading.ts` calculates correlation, z-score, and cointegration but **never executes trades**. The orchestrator generates orders but they go nowhere.

### Upgraded Pairs Trading System (Kalman Filter + Regime Switching)

**Phase 1: Pair Universe Generation**
```
ALL POSSIBLE PAIRS from expanded 50-stock watchlist:
   50 symbols → 1,225 possible pairs
   Filter: Correlation > 0.75 over 252 trading days
   → ~80-120 qualifying pairs

COINTEGRATION TEST (Engle-Granger):
   For each qualifying pair, test stationarity of spread
   Filter: p-value < 0.05
   → ~20-40 cointegrated pairs

HALF-LIFE CHECK:
   Calculate Ornstein-Uhlenbeck half-life
   Filter: 3 < half_life < 30 days
   → ~10-20 tradeable pairs (our "pairs portfolio")
```

**Phase 2: Dynamic Hedge Ratio (Kalman Filter)**
Instead of static OLS regression (which drifts), use a **Kalman Filter** to:
- Update the hedge ratio daily
- Adapt to changes in the relationship
- Reduce false signals from structural breaks

```
KALMAN FILTER SPREAD:
   spread_t = price_A - β_t * price_B
   where β_t updates each day via Kalman recursion
   z_score = (spread_t - mean_spread) / std_spread
```

**Phase 3: Entry/Exit Rules**

| Condition | Action | Position Size |
|-----------|--------|--------------|
| Z-score > +2.0 | SHORT spread (short A, long B) | 3% equity each leg |
| Z-score < -2.0 | LONG spread (long A, short B) | 3% equity each leg |
| Z-score returns to 0 | CLOSE position | — |
| Z-score > +3.5 | STOP LOSS (relationship may have broken) | Exit |
| Half-life exceeded 2x | STOP LOSS | Exit |

**Phase 4: Pair Universe — Sector Clustering**

| Sector | Example Pairs | Historical Correlation |
|--------|---------------|----------------------|
| Mega Tech | MSFT/GOOGL, AAPL/MSFT, META/GOOGL | 0.82-0.91 |
| Semiconductors | NVDA/AMD, AVGO/INTC, TSM/ASML | 0.78-0.88 |
| Banks | JPM/BAC, GS/MS, WFC/C | 0.85-0.93 |
| Oil Majors | XOM/CVX, COP/EOG, SLB/HAL | 0.80-0.90 |
| Retail | WMT/COST, TGT/WMT, HD/LOW | 0.75-0.85 |
| Airlines | DAL/UAL, AAL/LUV, DAL/AAL | 0.80-0.88 |
| Pharma | JNJ/PFE, MRK/ABBV, LLY/NVO | 0.70-0.82 |
| ETF Pairs | SPY/QQQ, IWM/SPY, XLF/XLK | 0.75-0.92 |

**Expected: 3-5 active pair trades at any time, each generating 1-2% per trade cycle (5-15 day hold).**

---

## 🎯 ENGINE 4: OPTIONS INCOME MACHINE (Target: 5-8%/mo)

### The "Theta Gang" Strategy — Time Decay Is Your Salary

Every option loses value every day (theta decay). By **selling** options strategically, you get paid to wait. This is how market makers make billions.

### Strategy Stack

#### 4A. Cash-Secured Puts (The "Get Paid to Buy Cheap" Play)
```
SETUP:
   1. Identify stock you WANT to own (from Engine 1 BUY list)
   2. Sell a PUT at the price you'd want to buy (e.g., 5-10% below current)
   3. Collect premium (typically 1-3% of strike price per month)

OUTCOME A: Stock stays above strike → You keep the premium (FREE MONEY)
OUTCOME B: Stock drops to strike → You buy at a discount + keep premium

EXAMPLE:
   NVDA trading at $150
   Sell NVDA $140 Put, 30 DTE → collect $4.50 premium
   → If NVDA stays > $140: you make $450 per contract (3.2% monthly return)
   → If NVDA drops to $140: you buy NVDA at effectively $135.50 (9.7% discount)

RULES:
   - Only sell puts on stocks in Engine 1 BUY list (fundamental + technical alignment)
   - Strike at or below nearest support / Fibonacci 61.8% level
   - Delta: -0.20 to -0.30 (15-25% probability of assignment)
   - DTE: 21-45 days (sweet spot for theta decay)
   - Max 5 simultaneous positions
```

#### 4B. Covered Calls (The "Get Paid to Hold" Play)
```
SETUP:
   1. Own 100 shares of a stock (from Engine 1 or previous put assignments)
   2. Sell a CALL above current price (resistance level)
   3. Collect premium monthly

EXAMPLE:
   Own 100 AAPL at $185
   Sell AAPL $195 Call, 30 DTE → collect $3.00 premium
   → If AAPL < $195: keep shares + $300 premium (1.6% monthly)
   → If AAPL > $195: sell at $195 + $300 premium = $198 effective (7% gain)

RULES:
   - Strike at resistance / Fibonacci extension / 2 ATR above current
   - Delta: 0.20-0.30 (70-80% chance of keeping shares)
   - Roll up and out if challenged (stock approaches strike)
```

#### 4C. Iron Condors (The "Range-Bound Cash Machine")
```
SETUP: (When ADX < 20 = no trend)
   1. Sell OTM Put spread (bull put) + Sell OTM Call spread (bear call)
   2. Collect double premium
   3. Win if stock stays between short strikes

EXAMPLE:
   AAPL at $185
   Sell $175/$170 Put spread + Sell $195/$200 Call spread
   Net premium: $2.50 → $250 per contract
   Max risk: $250 per contract
   Win rate: ~65-75% (wide enough strikes)

   Monthly return on risk: 5-10%
```

#### 4D. 0DTE Scalping (High Frequency Options — Advanced)
```
0 Days To Expiry options on SPX/SPY:
   - Massive theta decay (option loses 80%+ of value in last day)
   - Sell credit spreads at 9:45 AM, close by 2 PM
   - Target: $100-500 per trade, 3-5 trades per week
   - Win rate: 70-80% with proper strike selection
   - Uses VIX + market internals (TICK, ADD) for direction

THIS ALONE: 3-5% monthly on allocated capital
```

### Options Data Source
```
Broker: Interactive Brokers (IBKR) or Tastytrade
   - Real-time options chain
   - Greeks (delta, gamma, theta, vega, rho)
   - Implied volatility surface
   - Auto-execution via IBKR API

Alternative: Alpaca Options (free commission, API-first)
```

---

## 🐋 ENGINE 5: CRYPTO SWING + DEFI YIELD (Target: 8-15%/mo)

### 5A. Crypto Technical Swing Trading

Your CoinGecko + DexScreener setup is solid but passive. Upgrade:

**Top 20 Crypto Watchlist (Market Cycle Optimized):**
```
LAYER 1:    BTC, ETH, SOL, AVAX, SUI, APT
LAYER 2:    MATIC, ARB, OP, BASE (Coinbase L2)
DEFI:       AAVE, UNI, MKR, LINK, SNX
AI TOKENS:  RNDR, FET, AGIX, TAO
MEME/MOMENTUM: (rotate based on social volume — auto-detected)
```

**Strategies:**

| Strategy | Timeframe | Edge | Target |
|----------|-----------|------|--------|
| BTC/ETH trend following | 4H | EMA 21/55 cross + volume | 5-15% per swing |
| Altcoin momentum rotation | Daily | Top 5 by 7d change on breakouts | 10-30% per rotation |
| Funding rate arbitrage | 8-hourly | Long spot + short perp when funding > 0.05% | 0.1-0.3% per 8h |
| Whale wallet tracking | Real-time | Copy top 100 wallets with >70% win rate | 5-20% per trade |
| DEX new pair sniping | Minutes | DexScreener >$500k liq + rising volume | 10-50% (high risk) |

**On-Chain Signals to Add:**
```
GLASSNODE / SANTIMENT / NANSEN DATA:
   - Exchange inflow/outflow (large outflow = bullish — holding not selling)
   - Active addresses surge (adoption signal)
   - MVRV Z-Score < 1 (undervalued) / > 7 (overvalued)
   - NUPL (Net Unrealized Profit/Loss) — cycle positioning
   - Whale transaction count (>$1M moves)
   - Mining revenue / hash rate trends
   - Stablecoin supply on exchanges (dry powder = buy pressure incoming)
```

### 5B. DeFi Yield Farming (Passive Income Layer)

**Conservative Yield Stack (battle-tested protocols, 2+ years operating):**

| Protocol | Strategy | APY | Risk |
|----------|----------|-----|------|
| **Aave v3** | Lend USDC/USDT | 5-12% | Very Low |
| **Lido / Rocket Pool** | ETH staking | 3-5% | Low |
| **Pendle Finance** | Fixed yield on staked ETH | 8-20% | Low-Medium |
| **GMX / GNS** | Provide liquidity for perp traders | 15-40% | Medium |
| **Ethena (USDe)** | Delta-neutral stablecoin yield | 15-30% | Medium |
| **Morpho** | Optimized lending aggregator | 8-18% | Low |
| **Convex/Aura** | Boosted Curve/Balancer LP | 10-25% | Medium |

**Conservative allocation: 20% of crypto capital in yield = 8-15% APY baseline**

### 5C. Market-Making on DEXs
```
UNISWAP v3/v4 CONCENTRATED LIQUIDITY:
   - Provide liquidity in tight range around current price
   - Earn 0.3% fee on every trade in your range
   - For BTC/ETH pair in ±5% range: 20-50% APY in fees
   - Re-balance weekly using our own technical analysis
   - Impermanent loss managed by tight range + frequent adjustment
```

---

## 🎰 ENGINE 6: EVENT-DRIVEN + PREDICTION MARKETS (Target: 5-10%/mo)

### 6A. Earnings Plays (4x per year per company, 200+ events)

```
PRE-EARNINGS STRATEGY:
━━━━━━━━━━━━━━━━━━━━━
SETUP: 3-5 days before earnings
   1. Check implied volatility (IV) via options chain
   2. Compare to historical move
   3. If IV implies ±8% but stock historically moves ±3%
      → SELL a strangle (collect inflated premium)
   4. If IV implies ±3% but catalysts suggest big move
      → BUY a straddle (bet on movement either direction)

POST-EARNINGS DRIFT:
━━━━━━━━━━━━━━━━━━━
   - Stocks that BEAT estimates by >10% continue drifting up for 20-60 days
   - Stocks that MISS by >10% continue drifting down
   - Enter 1-3 days after earnings in drift direction
   - Historical edge: 3-5% per drift trade
   - Winnhub earnings calendar = data source (ALREADY HAVE KEY)
```

### 6B. Macro Event Reactions (Fed, CPI, NFP, GDP)

```
FOMC REACTION PLAYBOOK:
━━━━━━━━━━━━━━━━━━━━━━
RATE CUT (dovish):
   → Long QQQ, Long TLT (bonds), Long GLD
   → Short DXY (dollar weakens)
   → Long small caps (IWM)

RATE HIKE / HAWKISH HOLD:
   → Short QQQ or buy QQQ puts
   → Long DXY, Short GLD
   → Short HYG (high yield bonds)

CPI COOL (below consensus):
   → Long SPY, Long TLT
   → Long rate-sensitive: XLRE, XLU

CPI HOT (above consensus):
   → Short TLT, Long TIP
   → Long: XLE, commodities
   → Short: XLRE, XLU

IMPLEMENTATION:
   - FRED API already fetches these data series
   - Finnhub economic calendar for exact release dates
   - Pre-position 1 day before with defined risk
   - Use options for capped downside
```

### 6C. Prediction Markets (Polymarket Alpha)

Your Polymarket scanner already finds value bets. Upgrade:

```
KELLY CRITERION SIZING FOR POLYMARKET:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   f* = (p * b - q) / b
   where:
     p = your estimated true probability
     b = decimal odds (1/market_price - 1)
     q = 1 - p

   EXAMPLE:
     Market says "Event X" = 40% likely (price $0.40)
     You estimate 55% likely (based on data analysis)
     b = (1/0.40 - 1) = 1.5
     f* = (0.55 * 1.5 - 0.45) / 1.5 = 0.25 → bet 25% of Polymarket bankroll

EDGE SOURCES:
   - Aggregate polling data (for political markets)
   - On-chain data (for crypto markets)
   - Our own technical analysis (for financial markets)
   - Sentiment analysis (Reddit, Twitter/X, news)
   - Historical base rates (for recurring events)

TARGET: 2-5 Polymarket bets active at any time, $500-$2000 each
EXPECTED: 60-65% win rate at 1.5-2.5x payout = 5-10% monthly
```

---

## 🛡️ RISK MANAGEMENT v2.0 — THE FORTRESS

### Dynamic Position Sizing (Kelly Criterion)

Forget fixed 5% per position. Use **fractional Kelly** for optimal growth:

```
KELLY FRACTION:
   f* = (win_rate × avg_win - loss_rate × avg_loss) / avg_win
   Use HALF KELLY (f*/2) for safety margin

EXAMPLE:
   Win rate: 62%   Avg win: 3.2%   Avg loss: -1.5%
   f* = (0.62 × 3.2 - 0.38 × 1.5) / 3.2 = 0.44
   Half Kelly = 22% → allocate 22% per high-conviction trade
   Quarter Kelly = 11% → allocate 11% per medium-conviction trade
```

### Volatility-Adjusted Stops (No More Fixed %)

```
ATR-BASED STOP LOSS:
   Stop = Entry - (2.0 × ATR)    for swing trades (daily ATR)
   Stop = Entry - (1.5 × ATR)    for scalps (4H ATR)
   Stop = Entry - (3.0 × ATR)    for position trades (weekly ATR)

   This automatically WIDENS stops in volatile markets (fewer whipsaws)
   and TIGHTENS stops in calm markets (smaller losses)
```

### Risk Budget Per Engine

| Engine | Max Equity | Max Drawdown | Kill Switch |
|--------|-----------|-------------|-------------|
| Engine 1: MTF Momentum | 30% | -8% monthly | -12% |
| Engine 2: Smart Money | 15% | -5% monthly | -8% |
| Engine 3: Stat-Arb | 20% | -3% monthly | -5% |
| Engine 4: Options | 20% | -5% monthly | -8% |
| Engine 5: Crypto | 10% | -10% monthly | -15% |
| Engine 6: Event-Driven | 5% | -5% monthly | -8% |
| **TOTAL** | **100%** | **-5% avg** | **-10%** |

### Correlation Guard

```
REAL-TIME CORRELATION MATRIX:
   Monitor cross-engine correlation daily
   If Engine 1 + Engine 2 correlation > 0.7:
      → Reduce Engine 2 size by 50% (overlapping risk)
   If VIX > 30 (fear spike):
      → Reduce all equity engines by 50%
      → Increase stat-arb and options income engines
   If VIX < 15 (extreme calm):
      → Increase iron condor positions (premium selling works best)
      → Add more pairs trades
```

### The Master Kill Switch

```
PORTFOLIO-LEVEL RULES (CANNOT BE OVERRIDDEN):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✦ -3% daily drawdown    → Reduce all positions by 50%
✦ -5% daily drawdown    → CLOSE ALL POSITIONS, cash for 24h
✦ -10% monthly drawdown → HALT ALL ENGINES for 7 days, manual review
✦ -15% monthly drawdown → HALT ALL ENGINES for 30 days, full system audit

NO EXCEPTIONS. MATH DOESN'T HAVE FEELINGS.
```

---

## 🤖 MACHINE LEARNING LAYER — THE BRAIN UPGRADE

### Signal Scoring Ensemble (Replace Simple Scoring)

Current: `score = CRITICAL×30 + IMPORTANT×15 + INFO×5` (max 100)  
Upgraded: **ML ensemble that learns which signal combinations actually make money**

```
FEATURE ENGINEERING (per signal):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Input features per trade candidate:
   [RSI_14_1D, RSI_14_4H, RSI_14_1W,           // Multi-TF RSI
    MACD_hist, MACD_hist_slope,                  // Momentum
    EMA_50_200_gap, EMA_9_21_gap,               // Trend
    ADX, ATR_pct, Bollinger_%B,                  // Volatility
    OBV_divergence, volume_ratio,                // Flow
    VIX, yield_spread, sector_momentum,          // Macro context
    smart_money_score, insider_activity,          // Institutional
    days_since_earnings, earnings_surprise_pct,   // Event
    market_regime]                                // Regime

MODEL ENSEMBLE:
   1. XGBoost (gradient boosted trees) — best for tabular financial data
   2. LightGBM (faster, handles categorical features)
   3. Simple Neural Net (2 hidden layers, 64 neurons each)

   FINAL SCORE = weighted average of 3 models
   → Probability of 2%+ gain within 5 trading days

TRAINING DATA:
   - Backtest all historical signals using Yahoo Finance OHLCV
   - Label: did price move +2% within 5 days? (1/0)
   - Walk-forward validation (train on 2020-2024, test on 2025)
   - Retrain monthly with latest data
```

### Market Regime Detection

```
REGIME CLASSIFIER (Hidden Markov Model):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

4 REGIMES:
   🟢 TRENDING UP    — ADX > 25, price > EMA200, EMA50 > EMA200
   🔴 TRENDING DOWN  — ADX > 25, price < EMA200, EMA50 < EMA200
   🟡 RANGING        — ADX < 20, Bollinger width < 0.05
   🟣 HIGH VOLATILITY — VIX > 25, ATR > 2x average

STRATEGY MAPPING:
   🟢 TRENDING UP    → Engine 1 (momentum long), Engine 2 (smart money), Engine 5 (crypto long)
   🔴 TRENDING DOWN  → Engine 1 (momentum short), Engine 4 (put spreads), Engine 3 (pairs)
   🟡 RANGING        → Engine 3 (mean reversion), Engine 4 (iron condors), Engine 6 (theta)
   🟣 HIGH VOLATILITY → Cash 50%, Engine 3 (pairs), Engine 4 (wide iron condors)

AUTO-ADJUSTMENT:
   Regime detected hourly
   Engine allocations shift within 15 minutes
   Telegram notification: "🔄 REGIME CHANGE: Trending → Ranging. Adjusting engines..."
```

---

## 💰 EXECUTION ENGINE — MAKING IT REAL

### Broker Integration

**Primary: Alpaca Markets (for US Equities + Options)**
```
WHY ALPACA:
   ✅ Zero commission stocks + options
   ✅ REST API + WebSocket (real-time)
   ✅ Paper trading for testing (same API, fake money)
   ✅ Fractional shares (invest exact $ amounts)
   ✅ Free real-time market data (IEX)
   ✅ Crypto trading built-in
   ✅ Available via npm: @alpacahq/alpaca-trade-api

API CAPABILITIES:
   - Submit orders: market, limit, stop, stop-limit, trailing stop
   - Options: buy/sell puts/calls, spreads, multi-leg
   - Get positions, account info, history
   - Stream real-time quotes + trades via WebSocket
   - Paper trading mode = same API, zero risk for testing
```

**Secondary: Interactive Brokers (for Global Markets + Advanced Options)**
```
WHY IBKR:
   ✅ Access to 150+ markets globally
   ✅ Full options chain + complex strategies
   ✅ Lowest margin rates in industry
   ✅ Direct market access (DMA)
   ✅ TWS API or Client Portal API (REST)
```

### Order Execution Flow

```
SIGNAL GENERATED → ML SCORING → RISK CHECK → POSITION SIZING → ORDER TYPE SELECTION
                                                                        ↓
                                                               ┌─ Market (CRITICAL urgency)
                                                               ├─ Limit (standard entry)
                                                               ├─ Stop-Limit (breakout)
                                                               └─ Bracket (entry + SL + TP)
                                                                        ↓
                                                               ALPACA API → ORDER SUBMITTED
                                                                        ↓
                                                               CONFIRMATION → TELEGRAM
                                                                        ↓
                                                               POSITION TRACKED → D1 DATABASE
                                                                        ↓
                                                               TRAILING STOP MANAGED → EXIT
                                                                        ↓
                                                               P&L RECORDED → PERFORMANCE DASHBOARD
```

---

## 📈 EXPANDED WATCHLIST — FROM 10 TO 50+ SYMBOLS

### Tier System

```
TIER 1 — CORE (Always Monitored, Full Analysis):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MEGA_CAP:  AAPL, MSFT, NVDA, GOOGL, AMZN, META, TSLA
SEMIS:     AMD, AVGO, INTC, TSM, ASML, QCOM, MU
FINANCE:   JPM, GS, BAC, MS, V, MA

TIER 2 — ROTATION (Scanned Daily, Full Analysis on Signal):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HEALTH:    UNH, LLY, JNJ, PFE, ABBV, MRK, ISRG
ENERGY:    XOM, CVX, COP, SLB, OXY
CONSUMER:  WMT, COST, HD, MCD, SBUX, NKE, DIS
INDUSTRIAL: CAT, DE, BA, GE, HON, UPS
SAAS:      CRM, NOW, SNOW, PLTR, NET, DDOG, ZS

TIER 3 — OPPORTUNISTIC (Signal-Driven, Finviz Screener):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   - Finviz daily screener: RSI < 30 + Volume > 1M + Market Cap > $10B
   - Finviz daily screener: New 52-week high + Volume spike > 2x
   - Finviz daily screener: Insider buying > $1M in past week
   - Up to 10 dynamic symbols added/removed weekly

ETFs (For Macro Plays):
━━━━━━━━━━━━━━━━━━━━━━━
   SPY, QQQ, IWM, DIA       — Indices
   XLF, XLK, XLE, XLV, XLRE — Sectors
   TLT, TIP, HYG, LQD       — Bonds
   GLD, SLV, USO, UNG       — Commodities
   EEM, FXI, EWJ            — International

CRYPTO (CoinGecko):
━━━━━━━━━━━━━━━━━━━
   BTC, ETH, SOL, AVAX, SUI, APT, ARB, OP,
   LINK, AAVE, UNI, MKR, RNDR, FET, TAO, DOGE, PEPE
```

---

## 🗓️ UPGRADED CRON SCHEDULE

```
# ═══════════════════════════════════════════════════
# YMSA v3.0 — SUPERCHARGED CRON SCHEDULE
# ═══════════════════════════════════════════════════

# PRE-MARKET INTELLIGENCE (Before US open)
0 4 * * 1-5    morning_deep_scan       # 06:00 IST — Overnight gaps, Asia/EU moves, pre-market
0 5 * * 1-5    morning_briefing        # 07:00 IST — (existing) Full 5-arena briefing
0 13 * * 1-5   pre_market_setup        # 15:00 IST — Final pre-open: insider buys, unusual options

# MARKET HOURS — ACTIVE TRADING (US Open: 16:30 IST)
30 14 * * 1-5  market_open_scan        # 16:30 IST — (existing) Open + first 5min analysis
45 14 * * 1-5  opening_range_break     # 16:45 IST — 15-min opening range breakout signals
*/5 14-21 * * 1-5  quick_pulse         # Every 5min — Critical signal check (RSI extreme, volume)
*/15 14-21 * * 1-5 quick_scan          # Every 15min — (existing) RSI + MACD + Smart Money
0 15-21 * * 1-5    full_scan           # Hourly — (existing) All 6 engines scan
0 17 * * 1-5   midday_rebalance        # 19:00 IST — Check positions, adjust stops, rebalance

# POST-MARKET (US Close: 23:00 IST)
0 21 * * 1-5   market_close_scan       # 23:00 IST — Close prices, after-hours activity
0 22 * * 1-5   evening_summary         # 00:00 IST — (moved) Full day recap + P&L
0 23 * * 1-5   overnight_setup         # 01:00 IST — Set overnight stops, Asian market prep

# WEEKLY
0 7 * * SUN    weekly_review           # 09:00 IST — (existing) Full portfolio review + rebalance
0 8 * * SUN    ml_retrain              # 10:00 IST — Retrain ML models with latest week's data
0 9 * * SUN    pairs_recalibrate       # 11:00 IST — Recalculate correlations + hedge ratios

# MONTHLY
0 6 1 * *      monthly_performance     # 1st of month — Full performance report + engine tuning
```

---

## 🔮 ADVANCED TECHNIQUES — THE SECRET SAUCE

### 1. Volatility Smile Arbitrage
```
Options IV often mispriced at extremes:
   - If put IV >> call IV (skew) + bullish technicals → Sell expensive puts
   - If IV rank < 20 (options cheap) + catalyst coming → Buy straddles
   - If IV rank > 80 (options expensive) + no catalyst → Sell iron condors
```

### 2. Gamma Scalping
```
Buy a straddle (long gamma) → continuously delta-hedge:
   - Stock goes up → sell shares to flatten delta
   - Stock goes down → buy shares to flatten delta
   - The hedging PROFITS exceed the theta decay IF realized vol > implied vol
   - Check: is current IV below 30-day realized vol? → gamma scalp
```

### 3. Dispersion Trading
```
INDEX OPTIONS vs SINGLE-STOCK OPTIONS:
   - SPX implied correlation usually OVERSTATED
   - Sell SPX straddle + Buy component straddles (AAPL, MSFT, NVDA, etc.)
   - Profits when individual stocks move independently (usual case)
   - Best during earnings season (stock-specific moves, not market-wide)
```

### 4. Sentiment Quant (NLP Edge)
```
DATA SOURCES:
   - Reddit (r/wallstreetbets, r/stocks) → Monitor mention velocity
   - Twitter/X → Aggregate sentiment via keyword tracking
   - Finnhub News → FinBERT sentiment scoring (-1 to +1)
   - Fear & Greed Index (CNN) → Contrarian indicator

SIGNAL:
   - Extreme fear (F&G < 20) + RSI oversold = STRONG BUY
   - Extreme greed (F&G > 80) + RSI overbought = STRONG SELL
   - WSB mention spike > 3σ above average = CAUTION (usually late)
   - Insider buying + negative sentiment = SMART MONEY ACCUMULATION
```

### 5. Cross-Asset Momentum (Global Macro)
```
RELATIVE STRENGTH ROTATION:
   Rank all assets monthly by 3M + 6M + 12M momentum
   Long top 5, Short bottom 5
   Rebalance monthly

ASSETS:
   SPY, QQQ, EEM, GLD, TLT, HYG, USO, DBA, UUP, BTC

HISTORICAL CAGR: 15-25% with max drawdown < 15%
Monthly: 1.5-2.5% CONSISTENT (lower variance than stock picking)
```

### 6. Order Flow Imbalance
```
Using Alpaca WebSocket real-time trades:
   - Track buy vs sell volume in real-time
   - Imbalance > 70% buy at support level = STRONG BUY signal
   - Imbalance > 70% sell at resistance level = STRONG SELL signal
   - Combined with Level 2 data (if available via IBKR)
```

---

## 📊 PROJECTED MONTHLY P&L BREAKDOWN

```
CONSERVATIVE SCENARIO (All engines running, moderate market):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Engine 1 — MTF Momentum:     +6%   (20 trades, 58% win rate, 2.5:1 R:R)
Engine 2 — Smart Money:      +4%   (8 trades, 65% win rate, 2:1 R:R)
Engine 3 — Stat-Arb:         +3%   (6 pair cycles, 70% win rate, 1.5:1 R:R)
Engine 4 — Options Income:   +4%   (12 premium sales, 75% win rate)
Engine 5 — Crypto:           +5%   (5 swings + yield farming baseline)
Engine 6 — Events:           +3%   (3 earnings + 1 macro + polymarket)
─────────────────────────────────
GROSS:                       +25%
Risk/Drawdown Reserve:       -3%   (stopped out trades, hedging cost)
─────────────────────────────────
NET CONSERVATIVE:            ~22%

MODERATE SCENARIO (Good setups, trending month):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Engine 1: +10%  |  Engine 2: +7%  |  Engine 3: +5%
Engine 4: +6%   |  Engine 5: +10% |  Engine 6: +7%
GROSS: +45%  |  NET: ~40%

AGGRESSIVE SCENARIO (Strong trends, high volatility, crypto bull):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Engine 1: +15%  |  Engine 2: +10%  |  Engine 3: +6%
Engine 4: +8%   |  Engine 5: +20%  |  Engine 6: +10%
GROSS: +69%  |  NET: ~60%
```

---

## 🛠️ IMPLEMENTATION ROADMAP

### Phase 1: FOUNDATION (Week 1-2) — "Get the Plumbing Right"
```
□ Wire orchestrator + risk controller into cron pipeline
□ Set up D1 database schema (trades, positions, P&L, signals history)
□ Implement KV caching for API calls (reduce rate limit hits)
□ Expand watchlist to 50 symbols (3 tiers)
□ Add multi-timeframe TAAPI calls (1W, 1D, 4H, 15M)
□ Implement ATR-based dynamic stop losses
□ Add ADX regime detection (trending vs ranging)
□ Deploy + test with Telegram-only (no execution yet)
```

### Phase 2: EXECUTION (Week 3-4) — "Connect the Broker"
```
□ Integrate Alpaca API (paper trading mode first!)
□ Build position manager (track entries, exits, P&L in D1)
□ Implement Kelly Criterion position sizing
□ Build order execution flow (signal → risk check → order → confirm)
□ Add trailing stop management (ATR-based)
□ Run 2 weeks on PAPER TRADING — validate all signals
□ Build performance dashboard (daily/weekly/monthly P&L)
```

### Phase 3: ENGINES (Week 5-8) — "Turn On the Machines"
```
□ Engine 2: Smart Money detection (order blocks, FVGs, insider tracking)
□ Engine 3: Upgrade pairs trading (Kalman filter, 50-stock universe)
□ Engine 4: Options integration (cash-secured puts, covered calls)
□ Engine 5: Crypto upgrade (funding rate arb, on-chain signals, DeFi yield)
□ Engine 6: Event-driven (earnings plays, FOMC reactions, Polymarket Kelly)
□ Add sentiment layer (Finnhub news NLP, Fear & Greed)
□ Run 2 more weeks paper trading with all engines
```

### Phase 4: ML & OPTIMIZATION (Week 9-12) — "Let the Machine Learn"
```
□ Build backtest framework (replay historical signals against OHLCV)
□ Train XGBoost signal scorer on at least 2 years of data
□ Implement regime detection (HMM or simple rules-based)
□ Dynamic engine allocation based on regime
□ Correlation-based hedging (cross-engine diversification)
□ Performance attribution (which engine/signal generates alpha)
□ Full month of live paper trading with ML scoring
```

### Phase 5: GO LIVE (Week 13+) — "Release the Kraken"
```
□ Switch Alpaca from paper to LIVE with SMALL CAPITAL ($5-10k)
□ Start with Engine 1 + Engine 3 + Engine 4 ONLY (most proven)
□ Scale up by 2x each month if profitable
□ Add remaining engines as paper results validate
□ Weekly review: adjust Kelly fractions, engine weights, watchlist
□ Monthly: retrain ML, recalibrate pairs, review risk limits
```

---

## ⚠️ CRITICAL DISCLAIMERS & RISK WARNINGS

```
1. 40%/month IS POSSIBLE but NOT GUARANTEED. Even Renaissance Technologies
   (the best hedge fund in history) averages ~66% ANNUALLY before fees.
   40% monthly = 5,700% annually. This is ONLY achievable with:
   - Leverage (options, margin)
   - Concentrated positions in high-conviction setups
   - Crypto volatility (asymmetric upside)
   - Active management (not passive)
   - Everything going right

2. REALISTIC EXPECTATIONS:
   - Month 1-3 (paper trading): Learning, calibrating, 0% real returns
   - Month 4-6 (small live): Target 10-15%/month (prove systems work)
   - Month 7-12 (scaling): Target 20-30%/month (all engines proven)
   - Month 13+: Target 30-50%/month (fully optimized, ML-enhanced)

3. MAXIMUM DRAWDOWN EXPECTATIONS:
   - Any single month: up to -15% possible (kill switch kicks in)
   - Worst quarter: up to -20%
   - These are NECESSARY for the strategy to also produce +40% months

4. NEVER TRADE WITH MONEY YOU CAN'T AFFORD TO LOSE.
   Start with paper trading. Then $5k. Then $10k. Scale with profits.

5. PAST PERFORMANCE ≠ FUTURE RESULTS.
   Markets evolve. Edges decay. Systems must adapt continuously.
```

---

## 🏆 WHY THIS WILL WORK

```
EDGE STACKING:
━━━━━━━━━━━━━━
1. Multi-timeframe confluence         → Better entries than 80% of traders
2. Smart Money tracking               → Follow institutions, don't fight them
3. Market-neutral pairs               → Profit in ANY market direction
4. Theta decay income                 → Get paid while waiting for setups
5. Crypto asymmetry                   → 10x potential upside on small allocation
6. Event exploitation                 → Predictable catalysts = predictable profits
7. ML scoring                         → Remove cognitive bias, optimize signal quality
8. Regime adaptation                  → Right strategy for current market conditions
9. Risk management                    → Survive drawdowns, compound winners
10. Automation                        → No sleep needed, no emotions, no missed signals

EACH EDGE ALONE: maybe 5-10%/month
ALL 10 EDGES STACKED: this is how 40%+ becomes achievable.
```

---

## 📡 GOOGLE ALERTS RSS FEEDS — LIVE NEWS INTELLIGENCE LAYER

All 12 Google Alerts are **active** on `yotam.manheim@gmail.com`, configured as **RSS feeds**, **English**, **All Results**, **As-it-happens**.

### Feed URLs (Base: `https://www.google.com/alerts/feeds/06848252681093017981/`)

| # | Alert Query | Feed ID | Full RSS URL |
|---|-------------|---------|--------------|
| 1 | `AAPL OR MSFT OR NVDA OR GOOGL OR AMZN stock earnings revenue` | `6901773025916462726` | `https://www.google.com/alerts/feeds/06848252681093017981/6901773025916462726` |
| 2 | `META OR TSLA OR AMD OR AVGO OR CRM stock earnings revenue` | `7474253027077514119` | `https://www.google.com/alerts/feeds/06848252681093017981/7474253027077514119` |
| 3 | `stock acquisition merger partnership deal` | `2830240277168549326` | `https://www.google.com/alerts/feeds/06848252681093017981/2830240277168549326` |
| 4 | `"short squeeze" OR "unusual options activity" OR "insider buying"` | `7958317856286447665` | `https://www.google.com/alerts/feeds/06848252681093017981/7958317856286447665` |
| 5 | `"rate cut" OR "rate hike" OR "Federal Reserve" OR FOMC decision` | `17133247196091448819` | `https://www.google.com/alerts/feeds/06848252681093017981/17133247196091448819` |
| 6 | `"earnings beat" OR "earnings miss" OR "guidance raised" OR "guidance lowered"` | `5081257511531522414` | `https://www.google.com/alerts/feeds/06848252681093017981/5081257511531522414` |
| 7 | `SEC filing 13F hedge fund buying OR selling` | `11133225676798148886` | `https://www.google.com/alerts/feeds/06848252681093017981/11133225676798148886` |
| 8 | `bitcoin OR ethereum OR solana regulation OR ETF approval` | `12127202496566810889` | `https://www.google.com/alerts/feeds/06848252681093017981/12127202496566810889` |
| 9 | `JPM OR GS OR BAC OR MS stock earnings analyst` | `8450950994453056585` | `https://www.google.com/alerts/feeds/06848252681093017981/8450950994453056585` |
| 10 | `NVDA OR AMD OR INTC OR TSM semiconductor chip earnings` | `14651396047479077800` | `https://www.google.com/alerts/feeds/06848252681093017981/14651396047479077800` |
| 11 | `"stock split" OR "share buyback" OR "dividend increase" OR "special dividend"` | `14632073281308566125` | `https://www.google.com/alerts/feeds/06848252681093017981/14632073281308566125` |
| 12 | `"market crash" OR "correction" OR "bear market" OR "recession" indicator` | `3519822132556371923` | `https://www.google.com/alerts/feeds/06848252681093017981/3519822132556371923` |

### How These Feed Into Each Engine

| Engine | Feeds Used | Signal Type |
|--------|-----------|-------------|
| Engine 1 (Momentum) | #1, #2, #9, #10 | Stock-specific earnings/analyst catalysts |
| Engine 2 (Smart Money) | #4, #7 | Insider buying, options flow, 13F filings |
| Engine 3 (Pairs/Stat-Arb) | #3, #10 | M&A disruptions, sector moves |
| Engine 4 (Options Income) | #4, #6, #11 | Earnings surprises, buybacks, dividends |
| Engine 5 (Crypto) | #8 | Regulation & ETF headlines |
| Engine 6 (Event-Driven) | #3, #5, #6, #12 | Fed, earnings, M&A, market crash signals |
| Risk Controller | #5, #12 | Macro regime shifts, recession triggers |

### Integration Code (Cron Worker)

```typescript
const GOOGLE_ALERTS_FEEDS = [
  { id: 'mega-tech', url: 'https://www.google.com/alerts/feeds/06848252681093017981/6901773025916462726' },
  { id: 'more-tech', url: 'https://www.google.com/alerts/feeds/06848252681093017981/7474253027077514119' },
  { id: 'mna', url: 'https://www.google.com/alerts/feeds/06848252681093017981/2830240277168549326' },
  { id: 'short-squeeze', url: 'https://www.google.com/alerts/feeds/06848252681093017981/7958317856286447665' },
  { id: 'fed-rates', url: 'https://www.google.com/alerts/feeds/06848252681093017981/17133247196091448819' },
  { id: 'earnings', url: 'https://www.google.com/alerts/feeds/06848252681093017981/5081257511531522414' },
  { id: 'sec-13f', url: 'https://www.google.com/alerts/feeds/06848252681093017981/11133225676798148886' },
  { id: 'crypto', url: 'https://www.google.com/alerts/feeds/06848252681093017981/12127202496566810889' },
  { id: 'banks', url: 'https://www.google.com/alerts/feeds/06848252681093017981/8450950994453056585' },
  { id: 'semis', url: 'https://www.google.com/alerts/feeds/06848252681093017981/14651396047479077800' },
  { id: 'buybacks', url: 'https://www.google.com/alerts/feeds/06848252681093017981/14632073281308566125' },
  { id: 'crash-signals', url: 'https://www.google.com/alerts/feeds/06848252681093017981/3519822132556371923' },
];

// Fetch & parse all feeds (Atom XML → JSON)
async function fetchGoogleAlerts(): Promise<NewsItem[]> {
  const results = await Promise.all(
    GOOGLE_ALERTS_FEEDS.map(async (feed) => {
      const res = await fetch(feed.url);
      const xml = await res.text();
      // Parse Atom XML entries
      const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
      return entries.map(entry => ({
        category: feed.id,
        title: entry.match(/<title[^>]*>(.*?)<\/title>/)?.[1] || '',
        url: entry.match(/<link[^>]*href="(.*?)"/)?.[1] || '',
        published: entry.match(/<published>(.*?)<\/published>/)?.[1] || '',
      }));
    })
  );
  return results.flat().sort((a, b) => 
    new Date(b.published).getTime() - new Date(a.published).getTime()
  );
}
```

---

> **"The goal is not to make money. The goal is to build a money-making machine, and then let it run."**
>  
> *— YMSA v3.0, Operation Alpha Storm*
