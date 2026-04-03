# YMSA Strategic Upgrade Roadmap
## Cross-Functional Team Meeting Report — April 3, 2026

**Attendees:**
- **CTO** — System Architecture & Technical Strategy
- **Chief Broker** — Trading Logic, Execution Quality & Market Microstructure
- **Lead Developer** — Implementation Feasibility, Code Quality & Testing
- **Head of Business Development** — Revenue, Scalability & Competitive Positioning
- **Head of Technical Development** — Data Infrastructure, AI/ML & Advanced Analytics

---

## I. Current System Assessment

### What We Have (Strengths)
| Capability | Status | Maturity |
|-----------|--------|----------|
| 6-engine signal generation | Production | ★★★☆☆ |
| Cross-engine merge + quality gates | Production | ★★★★☆ |
| Z.AI LLM validation layer | Production | ★★☆☆☆ |
| Paper trading simulator | Production | ★★★☆☆ |
| Risk controller (hard rules) | Production | ★★★★☆ |
| Dynamic engine budgets + probation | Production | ★★★☆☆ |
| 32-scenario stress testing | Production | ★★★★☆ |
| Walk-forward backtesting | Production | ★★☆☆☆ |
| P/L dashboard + equity tracking | Production | ★★★☆☆ |
| 12 data sources (APIs + scrapers) | Production | ★★★☆☆ |
| Telegram alert pipeline | Production | ★★★★☆ |

### What We Lack (Critical Gaps by Department)

**Chief Broker's Assessment:**
> "We're making decisions on daily candles only. We have no intraday price action, no volume profile, no order flow data. We can't see *how* price moves — only *where* it closes. This is like driving a car using only the GPS destination without seeing the road."

**Lead Developer's Assessment:**
> "The math is sound but shallow. Our signals use textbook indicators (RSI, MACD, EMA) without higher-order derivatives. No regime-adaptive thresholds, no volatility surface modeling, no cointegration with proper ADF test. The backtest engine simulates but doesn't optimize."

**Head of Business Development:**
> "We have a single-user system on Cloudflare Workers. To attract partners and capital, we need: verifiable track record, institutional-grade reporting, multi-strategy allocation, and regulatory compliance artifacts."

**Head of Technical Development:**
> "Z.AI runs Llama-3.1-8B — a consumer-grade model doing institutional work. No feedback loop, no fine-tuning, no ensemble. The model can't improve from its own mistakes."

---

## II. The 7 Upgrade Domains

We identified **7 domains** where upgrades would transform YMSA from a capable paper-trading system into a competitive quantitative trading operation. Each domain is scored on:

- **Alpha Impact**: Expected improvement to risk-adjusted returns (Sharpe lift)
- **Implementation Effort**: Developer-weeks required
- **Dependencies**: What must exist before this can be built

---

## Domain 1: Advanced Signal Mathematics

### Current State
Our signal layer uses 1st-generation indicators: RSI(14), MACD(12,26,9), EMA(50/200), ADX(14), ATR(14). These are the same tools available to every retail trader on TradingView.

### Upgrade Path

#### 1.1 — RSI/Price Divergence Detection
**Priority: CRITICAL** | Effort: 3 days | Sharpe Lift: +0.15–0.30

The most powerful mean-reversion signal missing from our system. When price makes a new low but RSI makes a higher low (bullish divergence), or price makes a new high but RSI makes a lower high (bearish divergence), reversals follow with 65-75% probability.

**Mathematical Definition:**

*Bullish divergence* over lookback window $n$:
$$\exists\; i,j \in [t-n, t],\; i < j : P_j < P_i \;\wedge\; \text{RSI}_j > \text{RSI}_i$$

where $P$ makes a lower low but RSI makes a higher low (both must be local extrema).

*Hidden bullish divergence* (trend continuation):
$$\exists\; i,j : P_j > P_i \;\wedge\; \text{RSI}_j < \text{RSI}_i$$

**Implementation:** Scan last 20 candles for swing lows (2-bar rule). If price swing low₂ < swing low₁ AND RSI at swing low₂ > RSI at swing low₁ → BULLISH_DIVERGENCE signal at confidence 70 + (RSI delta × 2).

#### 1.2 — Bollinger Band Squeeze + Keltner Channel Breakout
**Priority: HIGH** | Effort: 2 days | Sharpe Lift: +0.10–0.20

The "TTM Squeeze" — when Bollinger Bands contract inside Keltner Channels, volatility is coiling. The breakout direction (first candle to close outside BB) is a high-probability momentum signal.

**Detection:**
$$\text{Squeeze} \iff \text{BB}_{lower} > \text{KC}_{lower} \;\wedge\; \text{BB}_{upper} < \text{KC}_{upper}$$

where Keltner Channel:
$$\text{KC}_{upper} = \text{EMA}_{20} + 1.5 \times \text{ATR}_{14}$$
$$\text{KC}_{lower} = \text{EMA}_{20} - 1.5 \times \text{ATR}_{14}$$

**Breakout signal** fires when squeeze releases AND momentum histogram turns positive/negative (using linear regression of close over 20 periods as momentum proxy).

#### 1.3 — Volume-Weighted Signal Confirmation
**Priority: HIGH** | Effort: 2 days | Sharpe Lift: +0.10–0.15

Currently volume spikes are detected but not used to *weight* other signals. A golden cross on 3× average volume is dramatically more reliable than one on 0.5× volume.

**Upgrade:** Every signal gets a volume multiplier:
$$\text{Adjusted Confidence} = \text{Base Confidence} \times \left(0.5 + 0.5 \times \min\left(2, \frac{V_{current}}{V_{avg20}}\right)\right)$$

This scales confidence from 50% (at 0 volume) to 150% (at 2× volume), capped.

#### 1.4 — Adaptive Threshold Engine
**Priority: HIGH** | Effort: 5 days | Sharpe Lift: +0.15–0.25

All our thresholds are static (RSI=30/70, ADX=20/25, confidence=55). Markets change. A ranging market needs RSI 35/65; a trending market works fine with 25/75.

**Approach:** Maintain 60-day rolling distributions of each indicator per symbol class (mega-cap, mid-cap, crypto). Set thresholds at percentile ranks rather than absolutes:

$$\text{RSI}_{oversold} = P_{10}\left(\text{RSI}_{60d}\right)$$
$$\text{RSI}_{overbought} = P_{90}\left(\text{RSI}_{60d}\right)$$

where $P_k$ is the $k$-th percentile of the trailing distribution.

#### 1.5 — Stochastic RSI + Williams %R Confirmation Layer
**Priority: MEDIUM** | Effort: 2 days | Sharpe Lift: +0.05–0.10

Add overbought/oversold confirmation from independent oscillators. When RSI, StochRSI, and Williams %R all agree on an extreme → confidence boost +15.

**StochRSI:**
$$\text{StochRSI} = \frac{\text{RSI} - \text{RSI}_{min,14}}{\text{RSI}_{max,14} - \text{RSI}_{min,14}}$$

---

## Domain 2: Regime Intelligence

### Current State
Regime detection uses SPY only: ADX for trending, VIX for volatility, BB width for ranging. Static thresholds. No cross-asset confirmation.

### Upgrade Path

#### 2.1 — Multi-Asset Regime Confirmation
**Priority: CRITICAL** | Effort: 4 days | Sharpe Lift: +0.20–0.35

Add cross-asset signals to regime detection:

| Asset | What It Tells Us | Math |
|-------|-----------------|------|
| SPY | Equity trend | EMA50 vs EMA200 |
| QQQ | Tech leadership | QQQ/SPY ratio (>1.02 = tech-led) |
| IWM | Risk appetite | IWM/SPY ratio (<0.95 = risk-off) |
| TLT | Bond flight | Inverse correlation to SPY |
| GLD | Fear gauge | GLD/SPY ratio (rising = fear) |
| HYG | Credit stress | HYG-TLT spread (widening = stress) |
| VIX | Implied vol | Already used |
| DXY/UUP | USD strength | Strong USD = headwind for equities |

**Composite Regime Score:**
$$R = w_1 \cdot \text{Trend}_{SPY} + w_2 \cdot \text{RiskAppetite}_{IWM} + w_3 \cdot \text{Credit}_{HYG} + w_4 \cdot \text{Vol}_{VIX} + w_5 \cdot \text{DollarFlow}_{UUP}$$

with $w$ learned from historical regime transitions via logistic regression.

#### 2.2 — Regime Transition Detection (Markov Chain)
**Priority: HIGH** | Effort: 5 days | Sharpe Lift: +0.15–0.25

Instead of "current regime = X", model the *probability* of transitioning to the next regime using a Hidden Markov Model:

$$P(\text{Regime}_{t+1} | \text{Regime}_t) = \text{Transition Matrix}$$

Estimated from 5-year SPY data with 4 hidden states (trending-up, trending-down, ranging, volatile). This gives us:
- **Early warning**: "60% probability of transitioning from TRENDING_UP to VOLATILE within 3 days"
- **Position pre-adjustment**: Scale down exposure *before* regime breaks, not after

#### 2.3 — FRED Macro Regime Layer
**Priority: HIGH** | Effort: 3 days | Sharpe Lift: +0.10–0.20

We fetch 11 FRED indicators but don't synthesize them into a macro regime signal. Add:

**Yield Curve Signal (recession predictor):**
$$\text{YC}_{signal} = \text{T10Y2Y spread}$$
- Inverted (<0) for 3+ months → RECESSION_WARNING regime modifier
- Steepening (>+1.5%) after inversion → RECOVERY_EARLY

**Credit Spread Signal:**
$$\text{Credit}_{stress} = \text{BAA yields} - \text{10Y Treasury}$$
- Widening >200bps → HIGH_CREDIT_STRESS → reduce all equity exposure 30%

**Money Supply Signal:**
$$\text{M2}_{yoy} = \frac{M2_t - M2_{t-12m}}{M2_{t-12m}}$$
- M2 growth >10% → LIQUIDITY_EXPANSION → risk-on bias
- M2 contraction → LIQUIDITY_DRAIN → risk-off bias

#### 2.4 — Intraday Regime Switching
**Priority: MEDIUM** | Effort: 3 days | Sharpe Lift: +0.05–0.15

Currently regime is detected once per cycle. Markets can flip intraday (e.g., Fed announcement at 2pm). Add a lightweight 30-minute regime check using VIX + SPY 5-minute data (available from Yahoo Finance) that can upgrade TRENDING → VOLATILE mid-session and trigger position size reductions.

---

## Domain 3: AI/ML Intelligence Layer

### Current State
Z.AI uses Llama-3.1-8B (free tier) for trade validation. No learning, no feedback, no ensemble. Approval bias >95% detected but not corrected.

### Upgrade Path

#### 3.1 — Z.AI Feedback Loop (Reinforcement from Outcomes)
**Priority: CRITICAL** | Effort: 5 days | Sharpe Lift: +0.25–0.40

The single highest-impact upgrade. Currently Z.AI approves/rejects trades but never learns if its decisions were correct.

**Architecture:**
1. Every Z.AI APPROVE/REJECT is logged with the trade context (already done via P6)
2. After trade resolution (WIN/LOSS), score Z.AI's decision:
   - APPROVE + WIN = correct (+1)
   - APPROVE + LOSS = false positive (-1)
   - REJECT + would have won = false negative (-0.5)
   - REJECT + would have lost = correct (+1)
3. Monthly: generate "Z.AI Performance Digest" showing false positive/negative rates
4. Feed top-5 false positives and top-5 correct rejections into the system prompt as few-shot examples:

```
HISTORICAL CONTEXT (learn from these):
- WRONG APPROVAL: TSLA BUY at $381, conf 70, counter-trend in TRENDING_DOWN. Result: LOSS -3.9%. Lesson: block counter-trend single-engine trades.
- CORRECT REJECTION: AMD SELL at $195, conf 55, weak volume. Result: would have been LOSS. Lesson: low-volume signals unreliable.
```

This creates a self-improving cycle where Z.AI gets smarter with every trade.

#### 3.2 — Ensemble AI Validation (Multi-Model Consensus)
**Priority: HIGH** | Effort: 4 days | Sharpe Lift: +0.15–0.25

Replace single-model validation with 3-model ensemble:

| Model | Role | Access |
|-------|------|--------|
| Llama-3.1-8B | Fast filter (current) | Cloudflare Workers AI (free) |
| Llama-3.3-70B | Deep analysis | Cloudflare Workers AI (paid) |
| Quantitative rules engine | Deterministic check | Local code |

**Consensus rule:**
$$\text{APPROVE} \iff \sum_{i=1}^{3} w_i \cdot \text{vote}_i \geq 0.6$$

where $w_{rules} = 0.4$, $w_{8B} = 0.25$, $w_{70B} = 0.35$. This prevents the LLM from overriding hard math, while still leveraging its pattern recognition.

#### 3.3 — News Sentiment Scoring with NLP
**Priority: HIGH** | Effort: 5 days | Sharpe Lift: +0.10–0.20

We fetch 12 Google Alert RSS feeds but don't score sentiment. Currently Z.AI's `scoreNewsSentiment` uses the LLM for ad-hoc scoring. This is unreliable with 8B params.

**Upgrade:** Build a deterministic keyword-based sentiment layer as primary, with LLM as secondary:

**Positive keywords (+1 each):** beat, exceed, upgrade, raise, growth, expansion, surpass, record, outperform, accelerate, dividend, buyback, approve
**Negative keywords (-1 each):** miss, downgrade, cut, layoff, decline, recall, lawsuit, probe, warning, guidance-cut, restructure, default, bankruptcy

**Composite Score:**
$$S_{article} = \frac{\sum \text{positive} - \sum \text{negative}}{\text{total keywords found}} \times 100$$

Then aggregate per symbol within 24h window:
$$S_{symbol} = \frac{\sum_i w_i \cdot S_i}{\sum_i w_i}$$

with $w_i$ = recency weight (exponential decay, half-life = 6 hours).

#### 3.4 — Anomaly Detection (Statistical Process Control)
**Priority: MEDIUM** | Effort: 3 days | Sharpe Lift: +0.05–0.10

Z.AI's `detectDataAnomalies` uses the LLM. Replace with mathematical anomaly detection:

**Control Chart (3-sigma rule):**
$$\text{Anomaly} \iff |X - \mu_{20d}| > 3\sigma_{20d}$$

Applied to: volume, price change %, RSI, VIX, spread (bid-ask). Flag anomalies with severity proportional to sigma distance:
$$\text{Severity} = \min\left(100, \frac{|X - \mu|}{3\sigma} \times 100\right)$$

---

## Domain 4: Execution Excellence

### Current State
Bracket orders via Alpaca. Fixed 2% risk per trade. No trailing stops, no partial takes, no slippage modeling. Position sizing uses half-Kelly but doesn't adapt to regime.

### Upgrade Path

#### 4.1 — Trailing Stop System
**Priority: CRITICAL** | Effort: 4 days | Sharpe Lift: +0.20–0.35

Our biggest profit leak: we set a fixed TP and leave money on the table when trends extend beyond target. Trailing stops lock in profits while letting winners run.

**Three-tier trailing model:**

| Phase | Trigger | Trail Distance | Logic |
|-------|---------|---------------|-------|
| **Initial** | Entry → 1R profit | No trail (fixed SL) | Let trade breathe |
| **Breakeven** | > 1R profit | Move SL to entry | Eliminate risk |
| **Trailing** | > 1.5R profit | Trail at 1.5 × ATR below high-water | Lock profits, ride trend |

Where $R = \text{entry} - \text{original SL}$ (the initial risk).

**Chandelier Exit (ATR-based trailing):**
$$\text{Trail}_{long} = \max(\text{Close}_{last\;n}) - 3 \times \text{ATR}_{14}$$
$$\text{Trail}_{short} = \min(\text{Close}_{last\;n}) + 3 \times \text{ATR}_{14}$$

The trail only moves in the favorable direction (ratchets up for longs, down for shorts).

**Alpaca Support:** `submitOrder` already supports `trail_percent` and `trail_price` order types — the infrastructure exists, it just needs to be activated.

#### 4.2 — Partial Take-Profit (Scaling Out)
**Priority: HIGH** | Effort: 3 days | Sharpe Lift: +0.10–0.20

Instead of all-or-nothing exits:

| At Price Level | Action | Remaining Position |
|---------------|--------|-------------------|
| TP1 (1.5R) | Sell 33% | 67% |
| TP2 (2.5R) | Sell 33% | 34% |
| TP3 (trail) | Trail remaining 34% | Until trail hit |

**Expected Value Analysis:**

If win rate = 55%, avg win = 2R, avg loss = 1R:
$$E[\text{current}] = 0.55 \times 2R - 0.45 \times 1R = 0.65R$$

With partial takes (assuming 1.5R hit rate = 70%, 2.5R = 45%, trail avg = 3.5R with 25% capture):
$$E[\text{partial}] = 0.70 \times 0.33 \times 1.5R + 0.45 \times 0.33 \times 2.5R + 0.25 \times 0.34 \times 3.5R - 0.45 \times 1R$$
$$= 0.347R + 0.371R + 0.298R - 0.45R = 0.566R$$

At first glance slightly lower, but the key advantage: partial takes *reduce variance* (higher Sharpe) and trail captures outlier wins that fixed TP misses entirely.

#### 4.3 — Regime-Adaptive Position Sizing
**Priority: HIGH** | Effort: 3 days | Sharpe Lift: +0.15–0.25

Current sizing: fixed 2% risk per trade regardless of conditions. Upgrade to regime-modulated Kelly:

$$f_{regime} = f_{half\text{-}Kelly} \times \text{RegimeMultiplier} \times \text{ConfidenceMultiplier}$$

| Regime | Multiplier | Rationale |
|--------|-----------|-----------|
| TRENDING (aligned) | 1.2× | Trend is our friend |
| TRENDING (counter) | 0.5× | Fighting the tape |
| RANGING | 0.8× | Tighter stops needed |
| VOLATILE | 0.4× | Protect capital |
| VOLATILE + VIX>40 | 0.2× | Survival mode |

$$\text{ConfidenceMultiplier} = 0.5 + 0.5 \times \frac{\text{Confidence} - 55}{45}$$

This scales from 50% size at confidence=55 to 100% at confidence=100.

#### 4.4 — Slippage & Commission Modeling
**Priority: MEDIUM** | Effort: 2 days | Sharpe Lift: +0.05 (accuracy, not alpha)

Our simulator assumes perfect fills at limit prices. Real-world degradation:

**Slippage Model:**
$$\text{Slippage}_{bps} = \alpha + \beta \times \frac{\text{OrderSize}}{\text{ADV}} + \gamma \times \sigma_{intraday}$$

For mid-cap stocks with normal liquidity:
- $\alpha = 2$ bps (fixed spread cost)
- $\beta = 5$ bps per 0.1% of ADV
- $\gamma = 1$ bp per 1% realized volatility

**Integration:** Apply slippage *before* recording simulated trades. This makes paper trading results more realistic and prevents over-confidence when transitioning to live.

---

## Domain 5: Data Intelligence Expansion

### Current State
12 data sources, mostly surface-level. Missing: insider flows, credit spreads, on-chain metrics, options flow, and true intraday data.

### Upgrade Path (Ranked by Alpha per API Call)

#### 5.1 — Finnhub Insider Trading Feed
**Priority: CRITICAL** | Effort: 2 days | Sharpe Lift: +0.15–0.25

Academic research consistently shows insider buying predicts 3-6 month outperformance by 7-13% (Lakonishok & Lee, 2001; Jeng et al., 2003).

**Endpoint:** `GET /api/v1/stock/insider-transactions?symbol={symbol}`

**Smart Money engine integration:**
- Cluster buys >$500K within 2 weeks = STRONG_INSIDER_BUY signal
- CEO/CFO buys weighted 2× vs director buys
- Insider selling during lockup window = neutral (expected)
- Insider buying during market decline = CONTRARIAN_SIGNAL (highest alpha)

**Confidence boost:**
$$\Delta\text{conf} = \min\left(20, \sum_{i} \frac{\text{insiderBuy}_i}{\$100K} \times w_{role}\right)$$

where $w_{CEO} = 3$, $w_{CFO} = 2$, $w_{Director} = 1$.

#### 5.2 — FRED Credit Spreads & Macro Dashboard
**Priority: HIGH** | Effort: 2 days | Sharpe Lift: +0.10–0.20

Add these FRED series to `getMacroDashboard()`:

| Series | Name | Signal |
|--------|------|--------|
| `BAA10Y` | Credit spread | >300bps = credit stress (reduce equity exposure) |
| `T10Y3M` | Near-term yield curve | Inversion = recession in 6-18 months |
| `M2SL` | Money supply M2 | YoY growth >8% = liquidity tailwind |
| `WALCL` | Fed balance sheet | QE expansion = risk-on; QT = risk-off |
| `ICSA` | Initial jobless claims | 4-week avg >300K = labor deterioration |
| `CPILFESL` | Core CPI | MoM >0.4% = hot inflation → hawkish Fed risk |

**Macro Regime Composite:**
$$\text{Macro}_{score} = w_1 \cdot \text{YieldCurve} + w_2 \cdot \text{CreditSpread} + w_3 \cdot \text{M2Growth} + w_4 \cdot \text{FedBalance} + w_5 \cdot \text{Employment}$$

Score > 0: risk-on bias. Score < 0: risk-off bias. Feed into regime detection as additional input.

#### 5.3 — Yahoo Finance Intraday Data
**Priority: HIGH** | Effort: 3 days | Sharpe Lift: +0.10–0.15

Yahoo Finance already supports `interval=5m&range=1d`. This unlocks:
- True 4-hour bars for MTF analysis (replacing current daily approximation)
- Intraday volume profile (identify accumulation/distribution periods)
- More accurate simulator resolution (check SL/TP against intraday high/low, not daily close)

#### 5.4 — Options Flow Intelligence
**Priority: MEDIUM** | Effort: 4 days | Sharpe Lift: +0.15–0.25

Unusual options activity is one of the strongest predictive signals. When someone buys $2M in weekly calls on a $50 stock, they usually know something.

**Data Source:** Finnhub supports basic options chain data; Finviz shows put/call ratio.

**Signal:**
- Put/Call ratio < 0.5 for individual stock = extreme bullish positioning
- Put/Call ratio > 1.5 = extreme bearish or hedging
- Unusual volume (>5× normal options volume) = event anticipation

**Integration into OPTIONS engine:**
$$\text{OptionsFlow}_{signal} = \begin{cases} \text{BULLISH} & \text{if PCR} < 0.5 \;\wedge\; \text{vol} > 5\times\text{avg} \\ \text{BEARISH} & \text{if PCR} > 1.5 \;\wedge\; \text{vol} > 5\times\text{avg} \\ \text{NEUTRAL} & \text{otherwise} \end{cases}$$

#### 5.5 — CoinGecko On-Chain Metrics
**Priority: MEDIUM** | Effort: 2 days | Sharpe Lift: +0.05–0.10

Add whale tracking for CRYPTO_DEFI engine:
- Exchange inflow spikes (>2σ above 7-day avg) = SELL_PRESSURE
- Exchange outflow (accumulation) = ACCUMULATION
- Active addresses growing >10% week-over-week = ADOPTION_SIGNAL

---

## Domain 6: Statistical Rigor

### Current State
Pairs trading uses fake cointegration test (variance ratio). Sharpe assumes normal returns. No Monte Carlo simulation. No walk-forward optimization.

### Upgrade Path

#### 6.1 — Proper Cointegration Testing (Engle-Granger)
**Priority: HIGH** | Effort: 3 days | Sharpe Lift: +0.10 for STAT_ARB engine

Current pairs trading uses variance ratio as a proxy for stationarity. This is not a cointegration test. Implement Engle-Granger two-step:

**Step 1:** Run OLS regression:
$$Y_t = \alpha + \beta X_t + \epsilon_t$$

**Step 2:** Test residuals $\hat{\epsilon}_t$ for stationarity using Augmented Dickey-Fuller:
$$\Delta \hat{\epsilon}_t = \gamma \hat{\epsilon}_{t-1} + \sum_{k=1}^{p} \delta_k \Delta \hat{\epsilon}_{t-k} + u_t$$

Reject $H_0: \gamma = 0$ if $t_{stat} < t_{critical}$ (Engle-Granger critical values, not standard ADF).

**TypeScript Implementation:** Pure math (no external library needed). OLS via normal equations:
$$\hat{\beta} = \frac{\sum(X_i - \bar{X})(Y_i - \bar{Y})}{\sum(X_i - \bar{X})^2}$$

ADF test via iterative least squares on lagged differences.

#### 6.2 — Monte Carlo Confidence Intervals
**Priority: HIGH** | Effort: 3 days | Sharpe Lift: +0.05 (risk management)

Instead of single-point backtest metrics, run 10,000 Monte Carlo simulations by:
1. Randomly resampling trade sequence (bootstrap)
2. Computing Sharpe, max drawdown, and final equity for each run
3. Reporting 5th/50th/95th percentile outcomes

**Key outputs:**
- **95% VaR (Value at Risk):** "With 95% confidence, max monthly loss will not exceed X%"
- **Expected Sharpe Range:** [5th percentile, 95th percentile] — shows how stable our edge is
- **Probability of Ruin:** P(equity drops below 50% of starting) across all simulations

$$\text{VaR}_{95} = -P_{5}\left(\text{sorted monthly returns}\right)$$
$$\text{CVaR}_{95} = -\frac{1}{N \times 0.05} \sum_{r_i \leq \text{VaR}} r_i$$

#### 6.3 — Sortino Ratio (Downside-Only Risk)
**Priority: MEDIUM** | Effort: 1 day | Sharpe Lift: N/A (better metric)

Replace Sharpe with Sortino as primary performance metric. Sharpe penalizes upside volatility (good moves); Sortino only penalizes downside:

$$\text{Sortino} = \frac{R_p - R_f}{\sigma_{downside}}$$

where:
$$\sigma_{downside} = \sqrt{\frac{1}{N}\sum_{r_i < 0} r_i^2}$$

#### 6.4 — Walk-Forward Optimization
**Priority: MEDIUM** | Effort: 5 days | Sharpe Lift: +0.10–0.20

Extend our backtest engine with parameter optimization:

1. **In-sample window** (6 months): Optimize thresholds (RSI levels, confidence gates, ATR multipliers) to maximize Sharpe
2. **Out-of-sample window** (2 months): Validate optimized parameters
3. **Roll forward**: Shift windows by 2 months, repeat
4. **Final metrics**: Average across all out-of-sample periods

**Optimization method:** Grid search over key parameters:
- RSI oversold: [25, 28, 30, 32, 35]
- RSI overbought: [65, 68, 70, 72, 75]
- Confidence gate: [50, 55, 60, 65]
- ATR stop multiplier: [1.5, 2.0, 2.5, 3.0]
- Minimum engines: [2, 3]

This finds the *regime-adaptive* optimal parameters rather than static settings.

#### 6.5 — Maximum Drawdown Duration Tracking
**Priority: LOW** | Effort: 1 day

Track not just drawdown magnitude but *duration* — how long until recovery:
$$\text{DD}_{duration} = t_{recovery} - t_{peak}$$

Alert if drawdown duration exceeds 20 trading days (psychological breaking point for most traders).

---

## Domain 7: Infrastructure & Scale

### Current State
Single Cloudflare Worker, D1 database, no streaming, manual deployment.

### Upgrade Path

#### 7.1 — Real-Time WebSocket Price Streaming
**Priority: HIGH** | Effort: 5 days | Sharpe Lift: +0.10–0.15

Switch from REST polling (5-minute intervals) to Alpaca's real-time WebSocket stream. This enables:
- Sub-second SL/TP monitoring (catch exact touches, not daily approximations)
- Real-time trailing stop updates
- Instant regime change detection on VIX spikes
- Market-on-close execution (last 15 minutes of session)

**Architecture:** Cloudflare Durable Object maintaining persistent WebSocket connection to Alpaca stream. Fan-out to trigger alerts when price crosses thresholds.

#### 7.2 — Multi-Strategy Portfolio Allocation
**Priority: HIGH** | Effort: 4 days | Sharpe Lift: +0.15–0.25

Currently all 6 engines share one portfolio. Implement strategy-level isolation:

| Strategy Sleeve | Engines | Allocation | Correlation Target |
|----------------|---------|-----------|-------------------|
| Momentum | MTF_MOMENTUM | 30% | 0.7 to SPY |
| Mean Reversion | STAT_ARB, SMART_MONEY | 25% | <0.3 to Momentum |
| Event-Driven | EVENT_DRIVEN, OPTIONS | 25% | <0.2 to both above |
| Crypto/Alternative | CRYPTO_DEFI | 20% | <0.5 to any above |

**Benefit:** When momentum fails (regime change), mean reversion compensates. This is the core principle of institutional portfolio construction: **diversification of return streams**, not just assets.

**Rebalance Logic (Markowitz-Inspired):**
$$w^* = \arg\min_w \; w^T \Sigma w \quad \text{s.t.} \quad w^T \mu = \mu_{target}, \quad w^T \mathbf{1} = 1, \quad w \geq 0$$

Simplified for our 4-sleeve case: monthly compute 30-day return correlations between sleeves; if any pair exceeds 0.6, reduce both by 10% and move to cash.

#### 7.3 — Verifiable Track Record (Audit Trail)
**Priority: HIGH** | Effort: 3 days | Impact: Partner confidence

For partner fundraising, generate a verifiable performance document:

1. **Immutable trade log**: Hash every trade record with SHA-256 chain:
   $$H_n = \text{SHA256}(H_{n-1} \| \text{trade}_n)$$
2. **Monthly attestation**: Generate signed JSON with all trades, equity curve, and hash chain root
3. **Comparison benchmarks**: SPY total return, 60/40 portfolio, risk-free rate over same period
4. **Risk-adjusted metrics**: Sharpe, Sortino, Calmar, max DD, win rate, profit factor, expectancy

#### 7.4 — Alerting & Monitoring Dashboard
**Priority: MEDIUM** | Effort: 3 days

Real-time health dashboard showing:
- System uptime (cron execution success rate)
- Data freshness per source (stale data = yellow, missing = red)
- Z.AI response time and error rate
- Current regime with transition probability
- Open positions with real-time P&L
- Engine-by-engine performance (last 7/30/90 days)

---

## III. Implementation Roadmap

### Phase 1: "Sharp Edge" (Weeks 1-3)
*Goal: Maximize signal quality with existing infrastructure*

| # | Upgrade | Domain | Effort | Impact |
|---|---------|--------|--------|--------|
| 1 | RSI/Price Divergence Detection | D1.1 | 3d | +0.15–0.30 Sharpe |
| 2 | Trailing Stop System | D4.1 | 4d | +0.20–0.35 Sharpe |
| 3 | Z.AI Feedback Loop | D3.1 | 5d | +0.25–0.40 Sharpe |
| 4 | Finnhub Insider Trading Feed | D5.1 | 2d | +0.15–0.25 Sharpe |
| 5 | Bollinger Squeeze + Keltner | D1.2 | 2d | +0.10–0.20 Sharpe |

**Phase 1 Target:** Combined Sharpe improvement of +0.50–0.80
**Verification:** Run walk-forward backtest before/after to measure actual impact

### Phase 2: "Market Intelligence" (Weeks 4-6)
*Goal: Understand regime transitions and macro context*

| # | Upgrade | Domain | Effort | Impact |
|---|---------|--------|--------|--------|
| 6 | Multi-Asset Regime Confirmation | D2.1 | 4d | +0.20–0.35 Sharpe |
| 7 | FRED Credit Spreads & Macro | D2.2+5.2 | 3d | +0.10–0.20 Sharpe |
| 8 | Yahoo Intraday Data | D5.3 | 3d | +0.10–0.15 Sharpe |
| 9 | Ensemble AI Validation | D3.2 | 4d | +0.15–0.25 Sharpe |
| 10 | Volume-Weighted Signals | D1.3 | 2d | +0.10–0.15 Sharpe |

**Phase 2 Target:** Combined additional Sharpe improvement of +0.30–0.50

### Phase 3: "Institutional Grade" (Weeks 7-10)
*Goal: Statistical rigor, execution quality, and partner readiness*

| # | Upgrade | Domain | Effort | Impact |
|---|---------|--------|--------|--------|
| 11 | Partial Take-Profit System | D4.2 | 3d | +0.10–0.20 Sharpe |
| 12 | Regime-Adaptive Position Sizing | D4.3 | 3d | +0.15–0.25 Sharpe |
| 13 | Proper Cointegration (Engle-Granger) | D6.1 | 3d | +0.10 Sharpe |
| 14 | Monte Carlo Confidence Intervals | D6.2 | 3d | Risk management |
| 15 | Adaptive Threshold Engine | D1.4 | 5d | +0.15–0.25 Sharpe |
| 16 | Multi-Strategy Portfolio Allocation | D7.2 | 4d | +0.15–0.25 Sharpe |

**Phase 3 Target:** Combined additional Sharpe improvement of +0.30–0.45

### Phase 4: "Scale & Verify" (Weeks 11-14)
*Goal: Infrastructure for growth and verifiable performance*

| # | Upgrade | Domain | Effort | Impact |
|---|---------|--------|--------|--------|
| 17 | WebSocket Price Streaming | D7.1 | 5d | +0.10–0.15 Sharpe |
| 18 | Walk-Forward Optimization | D6.4 | 5d | +0.10–0.20 Sharpe |
| 19 | Verifiable Track Record | D7.3 | 3d | Partner confidence |
| 20 | News Sentiment NLP | D3.3 | 5d | +0.10–0.20 Sharpe |
| 21 | Regime Transition (Markov) | D2.2 | 5d | +0.15–0.25 Sharpe |
| 22 | Slippage & Commission Model | D4.4 | 2d | Accuracy |
| 23 | Options Flow Intelligence | D5.4 | 4d | +0.15–0.25 Sharpe |

---

## IV. Projected Performance Trajectory

### Mathematical Projection

Assuming current system Sharpe ≈ 0.5 (estimated from limited paper trading data):

| Phase | Cumulative Sharpe (Conservative) | Cumulative Sharpe (Optimistic) | Comparable Benchmark |
|-------|--------------------------------|-------------------------------|---------------------|
| Current | 0.50 | 0.50 | Average retail trader |
| After Phase 1 | 0.80 | 1.10 | Good systematic fund |
| After Phase 2 | 1.00 | 1.40 | Top-quartile quant fund |
| After Phase 3 | 1.20 | 1.70 | Elite multi-strategy fund |
| After Phase 4 | 1.40 | 2.00 | Institutional benchmark |

**Context:**
- S&P 500 long-term Sharpe ≈ 0.4
- Average hedge fund Sharpe ≈ 0.5-0.8
- Renaissance Medallion Fund Sharpe ≈ 2.0+ (the gold standard)
- Two Sigma, DE Shaw ≈ 1.5-2.0

**Compound return implications** (assuming 10% annualized volatility target):

$$\text{Annual Return} \approx \text{Sharpe} \times \sigma_{target} + R_f$$

| Sharpe | Annual Return (σ=10%) | $100K → 1 Year | $100K → 3 Years |
|--------|----------------------|----------------|-----------------|
| 0.50 | 10% | $110,000 | $133,100 |
| 1.00 | 15% | $115,000 | $152,088 |
| 1.50 | 20% | $120,000 | $172,800 |
| 2.00 | 25% | $125,000 | $195,313 |

---

## V. Cost Analysis

| Resource | Current Cost | After All Phases | Notes |
|----------|-------------|-----------------|-------|
| Cloudflare Workers | Free tier | Free–$5/mo | May hit paid tier with WebSocket |
| Cloudflare D1 | Free (5M rows) | Free | Well within limits |
| Workers AI | Free (Llama-3.1-8B) | $0–$10/mo | 70B model has usage costs |
| TAAPI.IO | Free (rate-limited) | Free | Bulk API is efficient |
| Finnhub | Free (60 req/min) | Free | Insider trades in free tier |
| Alpha Vantage | Free (25/day) | May deprecate | Redundant with TAAPI + Yahoo |
| Yahoo Finance | Free | Free | Adding intraday = more calls |
| FRED | Free | Free | Adding 6 more series |
| CoinGecko | Free | Free | |
| Alpaca | Free (paper) | Free (paper) | WebSocket available in free tier |
| **Total** | **$0/mo** | **$5–$15/mo** | |

The entire upgrade path costs less than a Netflix subscription.

---

## VI. Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Overfitting during walk-forward optimization | Medium | Strategy fails on new data | Strict train/test split, minimum 30 trades per segment |
| Z.AI feedback loop creates echo chamber | Low | Self-reinforcing biases | Maintain 40% weight on deterministic rules engine |
| Yahoo Finance rate limit crackdown | Medium | Loss of core data source | Alpaca bars as backup; TAAPI for indicators |
| Cloudflare Workers stateless limitations | Low | Already mitigated with D1 persistence | Durable Objects for WebSocket upgrade |
| False sense of confidence from backtest metrics | Medium | Oversize positions in live | Conservative sizing (quarter-Kelly), 3-month live paper validation per phase |

---

## VII. Key Decisions Required from Ownership

1. **Approve Phase 1 start?** (15 developer-days, $0 cost, biggest immediate impact)
2. **Workers AI paid tier for 70B model?** ($5-10/month for significantly better AI validation)
3. **Live trading graduation criteria?** (Team recommendation: Sharpe ≥ 1.0, max DD < 15%, 90+ day paper track record, ≥100 closed trades)
4. **Partner reporting cadence?** (Monthly PDF vs real-time dashboard access)

---

*This report was prepared collaboratively by the YMSA leadership team.*
*CTO • Chief Broker • Lead Developer • Head of Business Development • Head of Technical Development*

*Date: April 3, 2026*
*Next Review: Upon completion of Phase 1*
