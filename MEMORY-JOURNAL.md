# 🧠 YMSA — Memory Journal (CTO-Level System Context)

> **Purpose**: This is the single source of truth for any LLM, AI assistant, or developer working on this project.
> Read this file FIRST before making ANY changes, running ANY commands, or deploying ANYTHING.
> Last updated: 2026-04-03 (commit 50e200d)

---

## 📌 Project Identity

| Field | Value |
|---|---|
| **Name** | YMSA — Your Money, Smarter & Automated |
| **Version** | 3.0.0 |
| **Owner** | Yotam Manheim (`yotam.manheim@gmail.com`) |
| **Runtime** | Cloudflare Workers (100% serverless, edge computing) |
| **Language** | TypeScript (strict mode) |
| **Framework** | Hono v4.7 (HTTP router on Workers) |
| **Mode** | **AUTONOMOUS PAPER TRADING** — 6-engine pipeline, Alpaca paper mode, with Telegram alerts |
| **AI Engine** | Z.AI — Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct`) |
| **Database** | D1 (`ymsa-db`) — 11 tables for trades, signals, positions, P&L, regime, risk events, telegram alerts |
| **Output** | Telegram bot alerts → Yotam's phone → Manual override if needed |
| **Local OS** | Windows 11 |
| **Local Path** | `c:\Users\yotam\Downloads\YMSA\YMSA` |
| **Worker URL** | `https://ymsa-financial-automation.kuki-25d.workers.dev` |
| **Repo** | `MrManheimyot/YMSA` (branch: `master`) |
| **Tests** | 110 tests (Vitest) across 5 files — signals, risk-controller, z-engine, data-validator, stress-test |

---

## 🏗️ Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         CLOUDFLARE WORKERS v3.0                              │
│                                                                              │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │  Engine 1   │  │  Engine 2   │  │  Engine 3   │  │  Engine 4   │           │
│  │ MTF Momentum│  │ Smart Money │  │  Stat-Arb   │  │  Crypto/DEX │           │
│  │ (W/D/4H/1H) │  │ (OB/FVG/LS) │  │  (Pairs)    │  │  (Whales)   │           │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘           │
│         │                │                │                │                │
│  ┌────────────┐  ┌────────────┐          │                │                │
│  │  Engine 5   │  │  Engine 6   │          │                │                │
│  │Event-Driven │  │  Macro/     │          │                │                │
│  │(News/Earns) │  │  Commodities│          │                │                │
│  └──────┬──────┘  └──────┬──────┘          │                │                │
│         │                │                │                │                │
│         └────────────────┴────────┬───────┴────────────────┘                │
│                                   │                                          │
│  ┌──────────────┐        ┌────────▼────────┐        ┌──────────────┐        │
│  │ Market Regime │───────▶│   Broker Mgr    │◀──────│   Z.AI       │        │
│  │  Detection    │        │ (Cycle-Based    │        │ (LLM Signal  │        │
│  │(TAAPI + SPY)  │        │  Orchestrator)  │        │  Synthesis)  │        │
│  └──────────────┘        └────────┬────────┘        └──────────────┘        │
│                                   │                                          │
│  ┌──────────────┐        ┌────────▼────────┐        ┌──────────────┐        │
│  │Risk Controller│───────▶│  Execution Eng  │───────▶│  D1 Database │        │
│  │(Hard Rules)   │        │  (Alpaca Paper) │        │  (10 tables) │        │
│  └──────────────┘        └────────┬────────┘        └──────────────┘        │
│                                   │                                          │
│                           ┌───────▼────────┐                                │
│                           │ Alert Formatter │                                │
│                           │ (24hr Dedup)    │                                │
│                           └───────┬────────┘                                │
│                                   │                                          │
│  ┌──────────────┐        ┌───────▼────────┐        ┌──────────────┐        │
│  │ Google Alerts │        │  Alert Router  │        │   KV Cache   │        │
│  │ (12 RSS feeds)│        │  (Telegram)    │        │ (TAAPI/API)  │        │
│  └──────────────┘        └───────┬────────┘        └──────────────┘        │
└──────────────────────────────────┼───────────────────────────────────────────┘
                                   │
                            ┌──────▼──────┐
                            │  Telegram   │
                            │  Bot API    │
                            └──────┬──────┘
                                   │
                            ┌──────▼──────┐
                            │  📱 Yotam   │
                            │  (Override  │
                            │   if needed) │
                            └─────────────┘
```

### Key Principle
**NOTHING runs on the local machine automatically.** The cron jobs, API calls, and Telegram alerts ALL execute on Cloudflare's edge servers. The local machine is used ONLY for development and deployment.

---

## 🚫 CRITICAL RULES FOR AI ASSISTANTS

> [!CAUTION]
> **EVERY AI assistant MUST follow these rules. Violations can cost real money or leak API keys.**

### 1. NEVER Run Background Processes Locally
- **DO NOT** start `wrangler dev` or `npm run dev` without being explicitly asked
- **DO NOT** run commands in infinite loops or in the background
- **DO NOT** send empty commands to the terminal repeatedly
- The terminal should ONLY be used for single, one-shot commands that complete and return

### 2. NEVER Expose Secrets
- **DO NOT** print, log, or display API keys in terminal output
- **DO NOT** create files containing secrets outside of `.secrets.json`
- **DO NOT** commit `.secrets.json` or `API-KEYS.txt` to git (they're gitignored)
- **DO NOT** embed API keys in code — always use `env.SECRET_NAME` pattern
- The `set-secrets.mjs` and `API-KEYS.txt` files exist but are GITIGNORED

### 3. NEVER Deploy Without Explicit Permission
- **DO NOT** run `wrangler deploy` without the user saying "deploy"
- **DO NOT** run `node deploy.mjs` without the user saying "deploy"
- **DO NOT** trigger GitHub Actions workflows without permission
- **DO NOT** run `wrangler secret put` without permission

### 4. NEVER Modify Risk Controller Logic Without Review
- `src/agents/risk-controller.ts` contains **hard-coded deterministic rules**
- It is NOT powered by AI — it's pure math with safety limits
- Changes to risk limits (drawdown %, position size %, kill switch) require explicit approval

### 5. Terminal Safety
- If a command hangs or loops, tell the user to click the 🗑️ (Kill Terminal) button
- Never run processes that require interactive input unless absolutely necessary
- Always use `--yes` or `--non-interactive` flags when available
- Prefer synchronous commands over background processes

---

## 📂 File Structure & Module Map

```
YMSA/
├── wrangler.toml                 # ⚙️ CF Worker config, 12 cron schedules, D1/KV/AI/Browser bindings
├── package.json                  # 📦 hono ^4.7, typescript ^5.7, vitest ^3.0, wrangler ^4.0
├── tsconfig.json                 # 🔧 TS strict mode, ES2022, CF workers types
├── .gitignore                    # 🔒 Ignores secrets, node_modules, .wrangler
├── .secrets.json                 # 🔐 REAL API keys (GITIGNORED — NEVER COMMIT)
├── .secrets.example.json         # 📋 Template for secrets (safe to commit)
├── API-KEYS.txt                  # 🔐 Key reference (GITIGNORED — NEVER COMMIT)
├── deploy.mjs                    # 🚀 Full deploy script (sets secrets + deploys)
├── set-secrets.mjs               # 🔐 Wrangler secret setter (GITIGNORED)
├── setup.ps1                     # 🪟 Windows PowerShell setup (git, gh, deploy)
├── README.md                     # 📖 User-facing readme
├── MEMORY-JOURNAL.md             # 🧠 THIS FILE — system memory for AI assistants
├── OWNER-REPORT-2025-07-14.md    # 📋 Owner report: brokers' meeting, 6 fixes, recommendations
├── _check.bat                    # 🔍 Quick audit script
│
├── config/
│   ├── watchlist.json            # 📊 3-tier: 15 core + 15 rotation + 9 ETFs + 6 pairs + 10 crypto
│   ├── screening-rules.json      # 📐 13 alert trigger rules (RSI, EMA, MACD, etc.)
│   └── alert-rules.json          # 🔔 Channels, batching, quiet hours config
│
├── skills/                       # 🧠 Copilot skill definitions
│   ├── ymsa-fibonacci/SKILL.md
│   ├── ymsa-stock-screener/SKILL.md
│   └── ymsa-technical-analysis/SKILL.md
│
└── src/
    ├── index.ts                  # 🚪 Hono router (20+ endpoints) + scheduled() cron handler
    ├── types.ts                  # 📝 All TS interfaces, 31 IndicatorTypes, 14 CronJobTypes (293 lines)
    ├── cron-handler.ts           # ⏰ 18+ cron job functions, 6-engine pipeline (1142 lines, LARGEST)
    ├── alert-router.ts           # 📨 Telegram sender + message splitting (132 lines)
    ├── alert-formatter.ts        # 🎨 Alert composition: Technical Info + Trade Setup (386 lines)
    ├── broker-manager.ts         # 🧩 Cycle-based orchestrator: dedup, Z.AI batch, alert budget (590 lines)
    │
    ├── ai/
    │   └── z-engine.ts           # 🤖 Z.AI: LLM signal synthesis, sentiment, trade review, weekly narrative
    │
    ├── api/                      # 🌐 External API clients (9 modules)
    │   ├── yahoo-finance.ts      # FREE — Quotes, OHLCV, commodities, indices, 52W analysis
    │   ├── alpha-vantage.ts      # KEY — EMA, RSI, MACD, OHLCV fallback
    │   ├── taapi.ts              # KEY — 200+ technical indicators (bulk API, cached 5min)
    │   ├── finnhub.ts            # KEY — Real-time quotes, news, earnings calendar
    │   ├── fred.ts               # KEY — Macro: GDP, CPI, unemployment, yield curve, VIX
    │   ├── coingecko.ts          # FREE — Crypto prices, global market, trending
    │   ├── dexscreener.ts        # FREE — DEX pair data, whale activity detection
    │   ├── polymarket.ts         # FREE — Prediction markets, value bet finder
    │   └── google-alerts.ts      # FREE — 12 RSS feeds, engine-routed news intelligence
    │
    ├── analysis/                 # 📐 Signal processing & indicator engines
    │   ├── indicators.ts         # Local compute: RSI, EMA 50/200, SMA 50/200, MACD, ATR from OHLCV
    │   ├── signals.ts            # Signal detection (RSI, EMA, MACD, 52W, Fib, Volume)
    │   ├── fibonacci.ts          # Fibonacci retracement/extension calculator
    │   ├── multi-timeframe.ts    # MTF Engine: W/D/4H confluence, mean reversion, cached TAAPI
    │   ├── smart-money.ts        # SMC: Order Blocks, FVGs, Liquidity Sweeps, BOS
    │   └── regime.ts             # Market Regime: TRENDING_UP/DOWN/RANGING/VOLATILE + engine weights
    │
    ├── execution/                # 🚀 Trade execution pipeline
    │   ├── engine.ts             # Alpaca bracket orders, Kelly sizing, risk pre-flight, position limits, contradictory blocking, dynamic win rate
    │   ├── simulator.ts          # Paper trade simulator: confidence ≥85 gate, contradictory blocking, SL/TP resolution
    │   └── portfolio.ts          # Portfolio snapshots, Sharpe, drawdown, daily P&L recording
    │
    ├── db/                       # 💾 D1 database layer
    │   ├── schema.sql            # 11 tables: trades, positions, signals, daily_pnl, telegram_alerts, etc.
    │   └── queries.ts            # 29+ CRUD functions for all tables
    │
    ├── agents/                   # 🤖 Multi-agent system
    │   ├── types.ts              # Agent types: AgentId, AgentSignal, PortfolioState
    │   ├── orchestrator.ts       # Signal aggregation + weight calibration
    │   ├── risk-controller.ts    # ⚠️ DETERMINISTIC hard rules — NOT AI (DO NOT CHANGE LIGHTLY)
    │   └── pairs-trading.ts      # Stat-arb: correlation, z-score, cointegration, half-life
    │
    ├── backtesting/              # 📈 Backtesting Engine (P1)
    │   └── engine.ts            # Walk-forward historical backtest: OHLCV → signals → simulated trades → metrics (win rate, Sharpe, profit factor, drawdown, expectancy)
    │
    ├── utils/                    # 🛠️ Utility modules
    │   ├── data-validator.ts     # 7-layer cross-validation framework: quote, indicator, cross-source, signal, trade param, env, aggregate
    │   ├── env-validator.ts      # Environment variable validation
    │   ├── logger.ts             # Structured logging utility
    │   └── retry.ts              # Retry with exponential backoff
    │
    ├── scrapers/                 # 🕷️ Browser-based scrapers (requires BROWSER binding)
    │   ├── finviz.ts             # RSI oversold stocks, 52W highs (Playwright)
    │   └── google-finance.ts     # Market overview scraper (Playwright)
    │
    └── __tests__/                # 🧪 Vitest test suite (110 tests)
        ├── signals.test.ts       # 7 tests: RSI, volume, 52W, score calculation
        ├── risk-controller.test.ts # 6 tests: Kill switch, drawdown, position size, limits
        ├── z-engine.test.ts      # 30 tests: synthesize, sentiment, review, narrative, compose, availability
        ├── data-validator.test.ts # 35 tests: quote, indicator, trade params, signal consistency, cross-validate, env thresholds, quality report
        └── stress-test.test.ts   # 32 tests (P4): flash crash, VIX spike, correlation breakdown, budget overrun, position limits, kill switch tiers, combined crisis
```

---

## ⏰ Cron Schedule (Defined in `wrangler.toml`)

All times in **UTC**. Israel Standard Time (IST) = UTC+2 / IDT = UTC+3.
US Market Hours: 14:30–21:00 UTC (9:30 AM – 4:00 PM ET).

| Cron Expression | UTC Time | IST Time | Job Type | Description |
|---|---|---|---|---|
| `0 5 * * 1-5` | 05:00 | **07:00** | `MORNING_BRIEFING` | Pre-market overview (stocks, crypto, macro, predictions) |
| `30 14 * * 1-5` | 14:30 | **16:30** | `MARKET_OPEN_SCAN` | US market open + regime detection + full 6-engine scan |
| `45 14 * * 1-5` | 14:45 | **16:45** | `OPENING_RANGE_BREAK` | Opening range breakout momentum scan |
| `*/5 14-21 * * 1-5` | Every 5m | — | `QUICK_PULSE_5MIN` | Ultra-fast pulse: RSI extremes + SMC + regime shifts |
| `*/15 14-21 * * 1-5` | Every 15m | — | `QUICK_SCAN_15MIN` | RSI + MACD monitoring (CRITICAL alerts only) |
| `0 15-21 * * 1-5` | Hourly | — | `FULL_SCAN_HOURLY` | Full 6-engine orchestration with broker cycle flush |
| `0 18 * * 1-5` | 18:00 | **20:00** | `MIDDAY_REBALANCE` | Intraday rebalance check |
| `0 15 * * 1-5` | 15:00 | **17:00** | `EVENING_SUMMARY` | Filtered recap: indices + commodities + BTC + holdings P/L |
| `30 21 * * 1-5` | 21:30 | **23:30** | `AFTER_HOURS_SCAN` | Earnings + company news + overnight setup |
| `0 7 * * SUN` | 07:00 | **09:00** | `WEEKLY_REVIEW` | Sunday full portfolio + macro + regime + performance review |
| `0 3 * * SAT` | 03:00 | **05:00** | `ML_RETRAIN` | ML model retrain + pairs recalibration |
| `0 0 1 * *` | 00:00 | **02:00** | `MONTHLY_PERFORMANCE` | Monthly performance report |

### Cron Implementation Flow
1. Cloudflare triggers `scheduled()` in `index.ts`
2. Routes to `handleCronEvent()` in `cron-handler.ts`
3. `identifyCronJob()` maps cron string → job type
4. For market-hours scans: `beginCycle()` → agents push signals → `flushCycle()` batches alerts
5. Broker Manager deduplicates (24hr per symbol), budgets alerts (max 3 trade alerts/hr)
6. Z.AI synthesizes reasoning, composes batch alerts
7. Alert Formatter adds Technical Info (RSI, MACD, SMA 50/200), Trade Setup, Confidence
8. Sends via `alert-router.ts` → Telegram

---

## 🔑 API Key Inventory

| Service | Key Name | Free? | Rate Limit | Used For |
|---|---|---|---|---|
| Yahoo Finance | *(no key needed)* | ✅ FREE | ~2000 req/hr | Quotes, OHLCV, commodities, indices, 52W analysis |
| Alpha Vantage | `ALPHA_VANTAGE_API_KEY` | Free tier (5/min) | 5 req/min, 500/day | EMA, RSI, MACD (backup to local compute) |
| TAAPI.io | `TAAPI_API_KEY` | Paid ($10+/mo) | Varies by plan | 200+ indicators, MTF bulk queries (cached 5min via KV) |
| Finnhub | `FINNHUB_API_KEY` | Free tier | 60 req/min | News, earnings calendar, company events |
| FRED | `FRED_API_KEY` | ✅ FREE | 120 req/min | Macro: GDP, CPI, yield curve, VIX, commodity prices |
| CoinGecko | *(no key needed)* | ✅ FREE | 10-50 req/min | Crypto prices, market cap, trending |
| DexScreener | *(no key needed)* | ✅ FREE | Generous | DEX pairs, whale detection |
| Polymarket | *(no key needed)* | ✅ FREE | Generous | Prediction markets, value bets |
| Google Alerts | *(RSS, no key)* | ✅ FREE | N/A | 12 RSS feeds for earnings, M&A, SEC filings, crash signals |
| Telegram | `TELEGRAM_BOT_TOKEN` | ✅ FREE | 30 msg/sec | Alert delivery |
| Telegram | `TELEGRAM_CHAT_ID` | — | — | Yotam's chat/group ID |
| Alpaca | `ALPACA_API_KEY` | ✅ FREE | — | Paper trading execution (bracket orders) |
| Alpaca | `ALPACA_SECRET_KEY` | — | — | Paper trading auth |
| Cloudflare | `CLOUDFLARE_API_TOKEN` | — | — | Deployment (NOT stored in Worker) |
| Cloudflare AI | *binding: `AI`* | ✅ FREE tier | — | Z.AI LLM: `@cf/meta/llama-3.1-8b-instruct` |
| Google OAuth | `GOOGLE_CLIENT_ID` | ✅ FREE | — | Dashboard authentication |

### Where Secrets Live
- **In Cloudflare Workers**: Set via `wrangler secret put <NAME>` — encrypted at rest
- **Locally**: `.secrets.json` (GITIGNORED) — used by `deploy.mjs` script
- **CI/CD**: GitHub Actions secrets — set via `gh secret set` or manually in GitHub Settings

---

## 🌐 HTTP Endpoints (Defined in `src/index.ts`)

### Public Routes (No Auth)
| Method | Path | Description |
|---|---|---|
| `GET` | `/` or `/health` | Health check + system info (6 engines, watchlists, Z.AI status) |
| `POST` | `/auth/google` | Google OAuth login (validates ID token) |
| `POST` | `/auth/logout` | Logout (clears session) |
| `GET` | `/auth/me` | Current user info |

### Authenticated Routes (API Key or Google OAuth)
| Method | Path | Description |
|---|---|---|
| `GET` | `/dashboard` | Full SRE dashboard (HTML) — metrics, sparklines, engine cards |
| `GET` | `/api/system-status` | JSON system status for dashboard polling |
| `GET` | `/api/quote?symbol=AAPL` | Real-time quote (Yahoo Finance) |
| `GET` | `/api/analysis?symbol=AAPL` | Full technical analysis (indicators, Fib, signals, SMC, 52W) |
| `GET` | `/api/fibonacci?symbol=AAPL` | Fibonacci retracement/extension levels |
| `GET` | `/api/scan` | Full watchlist scan with signal scoring + ranking |
| `GET` | `/api/crypto` | Crypto dashboard (CoinGecko + DexScreener whales) |
| `GET` | `/api/polymarket` | Active prediction markets + value bets |
| `GET` | `/api/commodities` | Commodity prices + FRED macro data |
| `GET` | `/api/indices` | Market indices (S&P500, NASDAQ, DOW, VIX) |
| `GET` | `/api/trades?open=true` | Trade records from D1 (open or recent) |
| `GET` | `/api/signals?limit=20` | Recent signals from D1 |
| `GET` | `/api/portfolio` | Portfolio snapshot (Alpaca-synced) |
| `GET` | `/api/risk-events` | Recent risk events from D1 |
| `GET` | `/api/news` | News alerts from D1 (filterable by category) |
| `GET` | `/api/performance` | Engine performance metrics |
| `GET` | `/api/daily-pnl` | Daily P&L history |
| `GET` | `/api/test-alert` | Send test alert to Telegram |
| `GET` | `/api/trigger?job=morning` | Manually trigger a cron job |
| `POST` | `/api/backtest` | Run historical backtest (P1) — accepts JSON config, returns metrics + equity curve |
| `GET` | `/api/ai-health` | Z.AI health stats (P6) — failure rate, approval/rejection bias, alerts |

**Auth**: Pass `X-API-Key` header or `?key=` query param. Only enforced if `YMSA_API_KEY` secret is set.

**Valid trigger jobs**: `morning`, `open`, `quick`, `hourly`, `evening`, `afterhours`, `weekly`

---

## 🤖 The 6 Engines + Support Systems

### Engine 1: MTF Momentum (`MTF_MOMENTUM`, `src/analysis/multi-timeframe.ts`)
- **4 timeframes**: Weekly → Daily → 4H → 1H confluence analysis
- Looks for aligned trend across all timeframes before triggering
- Mean reversion sub-strategy when ADX < 20 (range-bound markets)
- TAAPI bulk API calls cached 5 minutes via KV
- Rate-limited: 15.5 sec between TAAPI calls to avoid throttle
- Produces: `MTFSignal` with confluence %, suggested action (BUY/SELL/WAIT), SL/TP, position size (FULL/HALF)
- Min confluence threshold: **65%**

### Engine 2: Smart Money Concepts (`SMART_MONEY`, `src/analysis/smart-money.ts`)
- **Order Block detection**: Bearish candle before impulse up → demand zone, vice versa
- **Fair Value Gap (FVG)**: 3-candle gaps where candle 1 high < candle 3 low
- **Liquidity Sweep**: Low sweeps below recent swing then strong reversal
- **Break of Structure (BOS)**: Swing high/low structural break
- Scoring: Each signal 0-100 strength, with age, direction, zone, confluence
- Overall bias: BULLISH/BEARISH/NEUTRAL from all signal directions
- `SmartMoneyAnalysis` includes `.score` (0-100) as confidence

### Engine 3: Statistical Arbitrage (`STAT_ARB`, `src/agents/pairs-trading.ts`)
- Pearson correlation analysis between 6 defined pairs
- Log price ratio spread + Z-score calculation
- Simplified cointegration test (variance ratio proxy)
- Mean-reversion half-life estimation (OLS)
- Tradable pair criteria: correlation > 0.7, |Z-score| > 1.5, half-life 1-30 days
- Pairs: AAPL/MSFT, NVDA/AMD, XOM/CVX, JPM/GS, GOOGL/META, SPY/QQQ

### Engine 4: Crypto/DeFi (`CRYPTO_DEFI`)
- CoinGecko: prices, market cap, 24h/7d changes, trending coins
- DexScreener: DEX pair data, liquidity analysis
- Whale activity detection (large volume spikes on-chain)
- **DEX mover fallback**: When whale signals are empty, scans for top-volume DEX pairs with >5% price moves (added commit `3cb46f2`)
- Watchlist: Bitcoin, Ethereum, Solana, Cardano, Polkadot, Avalanche, Chainlink, Uniswap, Aave, Arbitrum

### Engine 5: Event-Driven (`EVENT_DRIVEN`)
- Polymarket: active prediction markets, value bet detection (volume > $10K, probability 15-85%)
- Google Alerts: 12 RSS feeds routed by engine (earnings, M&A, SEC filings, crash signals)
- Z.AI news sentiment scoring (BULLISH/BEARISH/NEUTRAL + confidence)
- Finnhub: earnings calendar, company news

### Engine 6: Macro/Commodities (`COMMODITIES` / `EVENT_DRIVEN`)
- Yahoo Finance: Gold, Silver, Oil (WTI/Brent), Natural Gas, Copper, Platinum, Corn, Wheat, etc.
- FRED: GDP, CPI, unemployment, yield curve (2Y/10Y), VIX
- Yield curve inversion alerts → `pushEventDriven('MACRO', 'YIELD_CURVE_INVERSION', ...)`
- **Commodity big-move detection** (added commit `3cb46f2`): any commodity with ≥3% daily change generates EVENT_DRIVEN signal. Named mapping: GC=F→Gold, SI=F→Silver, CL=F→Oil (WTI), BZ=F→Oil (Brent), NG=F→Natural Gas, HG=F→Copper, PL=F→Platinum
- Signals routed through `pushEventDriven()` with inline D1 recording

### Support: Market Regime Detection (`src/analysis/regime.ts`)
- Detects: TRENDING_UP, TRENDING_DOWN, RANGING, VOLATILE
- Based on: SPY ADX, EMA gap %, Bollinger width %, VIX level
- Engine weight multipliers per regime (0.5x–2.0x):

| Regime | MTF | SMC | STAT_ARB | OPTIONS | CRYPTO | EVENT |
|--------|-----|-----|----------|---------|--------|-------|
| TRENDING_UP | 1.5 | 1.3 | 0.7 | 0.8 | 1.4 | 1.0 |
| TRENDING_DOWN | 1.3 | 1.2 | 1.0 | 1.2 | 0.7 | 1.0 |
| RANGING | 0.7 | 1.0 | 1.6 | 1.5 | 0.8 | 1.0 |
| VOLATILE | 0.5 | 0.7 | 1.3 | 1.8 | 1.2 | 1.5 |

### Support: Z.AI — LLM Intelligence (`src/ai/z-engine.ts`)
- Model: `@cf/meta/llama-3.1-8b-instruct` via Cloudflare Workers AI (free tier)
- Config: max_tokens=300, temperature=0.3
- **7 LLM functions**:
  1. `synthesizeSignal()` → 2-sentence trade rationale (<150 chars)
  2. `scoreNewsSentiment()` → BULLISH/BEARISH/NEUTRAL per headline + confidence + symbols
  3. `reviewTrade()` → Post-close P&L analysis (was signal correct? lessons?)
  4. `weeklyNarrative()` → 3-5 bullet weekly summary (winners, losers, regime, watchlist)
  5. `composeAlert()` → Batch multi-signal alert (<800 chars, mobile-friendly, HTML)
  6. `validateTradeSetup()` → Pre-trade gate: APPROVE/REJECT verdict with confidence + reason (added commit `2d63cde`)
  7. `detectDataAnomalies()` → TYPE: STALE_DATA | PRICE_MISMATCH | VOLUME_ANOMALY | INDICATOR_CONFLICT | REGIME_MISMATCH (added commit `2d63cde`)
- **P6: Health Monitoring** (added commit `50e200d`):
  - `recordZAiCall(success, responseLength)` — tracks every LLM call
  - `recordValidationResult(verdict)` — tracks APPROVE/REJECT/UNAVAILABLE distribution
  - `getZAiHealthStats()` — returns failure rate, approval/rejection bias, alerts
  - `formatZAiHealthReport()` — Telegram-formatted health report
  - `resetZAiHealthStats()` — resets counters (called at start of overnight cycle)
  - **Alert thresholds**: >10% failure rate, >95% approval (rubber-stamping), >80% rejection (over-conservative)
  - Integrated: `broker-manager.ts` records each validation call, overnight cron sends report
  - Endpoint: `GET /api/ai-health`
- Graceful degradation: all functions return empty/safe defaults when AI unavailable

### Support: Broker Manager (`src/broker-manager.ts`)
- **Cycle-based orchestration**: `beginCycle()` → engines push → `flushCycle()` sends
- **ALL 6 engines now route through broker manager** (fixed commit `d5df5be`): `pushSmartMoney`, `pushMTF`, `pushTechnical`, `pushStatArb`, `pushCryptoDefi`, `pushEventDriven`, `pushOptions`
- **`pushAndRecordSignal(output, db)`** (added commit `3cb46f2`): Hybrid function that both pushes to `cycleOutputs` AND immediately inserts to D1 `signals` table. Prevents signal loss if scan times out before `flushCycle`
- The 4 non-execution push functions (`pushStatArb`, `pushCryptoDefi`, `pushEventDriven`, `pushOptions`) are async and accept optional `db: D1Database` param for inline recording
- Cross-engine dedup: 24-hour window per symbol (`DEDUP_MS = 86400000`)
- Alert budget: max 3 trade alerts per hour (`MAX_TRADE_ALERTS_PER_HOUR`)
- Per-symbol indicator storage: `cycleIndicators: Map<string, TechnicalIndicator[]>`
- Signal merging by symbol: `mergeBySymbol()` → `planTradeAlert()` (confidence ≥55, non-conflicting or ≥70)
- Z.AI integration: batch compose for 2+ high-confidence signals, individual synthesis otherwise
- Market context message appended to alerts
- "Nothing happening" fallback when no signals fire
- **D1 recording**: Only trade alerts (with `_trade` metadata) get logged to `telegram_alerts`. Market context / no-signals messages are sent to Telegram but not logged
- **Cross-Validation Gate** (added commit `2d63cde`): Before any trade alert sends in `flushCycle()`, 3 validation layers run: (1) `validateTradeParams()` — R:R, direction, confidence checks, (2) `validateSignalConsistency()` — detects conflicting signals, (3) `buildDataQualityReport()` — weighted quality score (blocks if <60), (4) Z.AI `validateTradeSetup()` APPROVE/REJECT gate
- **Event Driven R:R fixed** (commit `6631c25`): SL atr×2, TP atr×4.5 → R:R 2.25 (was 0.80)
- **Options R:R fixed** (commit `6631c25`): TP atr×3.5 → R:R 2.33 (was 1.33)

### Support: Execution Engine (`src/execution/engine.ts`)
- Alpaca paper-mode bracket orders (entry + SL + TP)
- Kelly fraction position sizing
- Pre-flight risk checks (min strength 60, equity check)
- Records every signal + trade in D1
- Default risk limits: 8 max positions, 15 daily trades, 10% max position, 6% portfolio risk
- Engine budgets: MTF 30%, SMC 20%, STAT_ARB 20%, OPTIONS 10%, CRYPTO 10%, EVENT 10% (now dynamically rebalanced — see P3 below)
- **Position limits enforced** (commit `6631c25`): maxOpen=8 and maxDaily=15 now checked via D1 queries (`getOpenTrades`, `getRecentTrades`) before execution — previously declared but never enforced
- **Contradictory position blocking** (commit `6631c25`): No BUY+SELL on same symbol — checks existing open trades before placing
- **Dynamic win rate** (commit `6631c25`): Win rate computed from last 50 closed trades (clamped 30%-80%, fallback 0.55) instead of hardcoded 0.55

### Support: Paper Trade Simulator (`src/execution/simulator.ts`)
- Converts `telegram_alerts` → simulated bracket trades
- Resolves trades on SL hit (→LOSS) or TP hit (→WIN), stagnant→BREAKEVEN
- **Confidence gate** (commit `6631c25`): Only alerts with confidence ≥85 are simulated
- **Contradictory position blocking** (commit `6631c25`): Checks for opposite-direction open positions before creating sim trade

### Support: Data Validator — 7-Layer Cross-Validation (`src/utils/data-validator.ts`)
Added commit `2d63cde`. Ensures all data entering the pipeline is structurally sound, consistent, and trustworthy.

| Layer | Function | What It Checks |
|---|---|---|
| 1 | `validateQuote()` | Price range, NaN, negative, volume, staleness (<24h), 52W consistency |
| 2 | `validateIndicators()` | RSI [0-100], ATR>0, MACD histogram = MACD−Signal, EMA spread |
| 3 | `crossValidateQuotes()` | Multi-source price agreement (<1% deviation) |
| 4 | `validateSignalConsistency()` | Detects conflicting signals on same symbol |
| 5 | `validateTradeParams()` | R:R≥2.0, SL/TP direction vs trade side, stop distance vs ATR |
| 6 | `validateEnvThresholds()` | NaN detection, range checks, cross-checks (e.g. RSI oversold < overbought) |
| 7 | `buildDataQualityReport()` | Weighted aggregate score 0-100 (min 60 to pass, any FAIL blocks) |

- Each layer returns `{ status: 'PASS' | 'WARN' | 'FAIL', issues: string[] }`
- Integrated into `cron-handler.ts`: quote + indicator + env validation runs on every stock scan
- Integrated into `broker-manager.ts`: trade param + signal consistency + quality report gate in `flushCycle()`
- Z.AI `detectDataAnomalies()` sampled 15% of stocks in each scan for stale data, price mismatches, volume anomalies

### Support: Portfolio Manager (`src/execution/portfolio.ts`)
- Real-time portfolio snapshot synced with Alpaca
- Performance metrics: Sharpe ratio, max drawdown, win rate, CAGR, profit factor
- Daily P&L recording to D1 (end-of-day)
- Per-engine performance tracking

### Support: Backtesting Engine — P1 (`src/backtesting/engine.ts`, added commit `50e200d`)
- Walk-forward historical simulation using Yahoo Finance OHLCV data
- `runBacktest(env, config)` — main entry point
- Default: last 6 months, all watchlist symbols, $100K initial capital
- Uses same `detectSignals()` + `computeIndicators()` as live pipeline
- Simulated trade flow: signal → next bar open entry → SL/TP/20-bar max hold exit
- 2% of capital per trade position sizing
- **Metrics**: win rate, profit factor, Sharpe ratio (annualized), max drawdown, expectancy, avg win/loss, consecutive wins/losses, largest win/loss, avg holding days
- **Per-engine breakdown**: `computeByEngine()` maps signals to engines via `mapSignalToEngine()`
- **Equity curve**: date + equity snapshots for charting
- `formatBacktestReport()` — Telegram-formatted report
- Endpoint: `POST /api/backtest` — accepts JSON config, returns metrics + equity curve + per-engine breakdown

---

## 🛡️ Risk Controller Rules (`src/agents/risk-controller.ts`)

These are **HARD-CODED DETERMINISTIC** rules. They are NOT AI-powered. No agent can override them.

| Rule | Limit | Description |
|---|---|---|
| Max Daily Drawdown | **3%** | Stop new trades if portfolio drops 3% in a day |
| Kill Switch | **5%** | HALT ALL trading for 24 hours if 5% daily loss |
| Max Position Size | **10%** | No single position > 10% of total equity |
| Max Sector Exposure | **25%** | No single sector > 25% of portfolio |
| Max Total Exposure | **80%** | Always keep 20% in cash |
| Max Open Positions | **20** | Hard cap on simultaneous positions |
| Daily Loss Limit | **$5,000** | Absolute dollar loss limit per day |
| Max Correlation | **0.85** | No two positions with r > 0.85 |
| Min Liquidity | **1%** | Position must be < 1% of daily volume |

### P3: Dynamic Engine Budgets (added commit `50e200d`)
- `rebalanceEngineBudgets(db)` — Monthly auto-rebalance based on rolling 30-day performance
- Composite score per engine: win rate (40%), profit factor (30%), activity (30%)
- **Floor**: 5% minimum per engine | **Ceiling**: 40% maximum per engine
- Normalizes to sum 1.0 after clamping; only reports ≥1% changes
- `formatBudgetRebalance()` — Telegram report of changes
- Integrated into `runMonthlyPerformance()` in cron-handler.ts

### P5: Engine Probation System (added commit `50e200d`)
- `evaluateEngineProbation(db)` — Daily check during overnight setup
- **Trigger**: 0 wins with ≥5 closed trades in 30 days → budget reduced to 5%
- **Recovery**: 5 consecutive wins OR win rate >40% with ≥10 trades → budget restored
- In-memory `probationState` tracks original budget and consecutive wins per engine
- `isOnProbation(engineId)` — Quick check for other modules
- `formatProbationReport()` — Telegram alert on probation changes
- Integrated into `runOvernightSetup()` in cron-handler.ts

---

## 🚀 Deployment Guide

### Method 1: Wrangler CLI (Direct — PREFERRED)
```powershell
# Prerequisites: set PATH first
$env:PATH = "C:\Program Files\Git\cmd;C:\Program Files\GitHub CLI;C:\Program Files\nodejs;" + $env:PATH

# 1. Login to Cloudflare (one-time)
node .\node_modules\wrangler\bin\wrangler.js login

# 2. Set secrets (one-time, or after key rotation)
node .\node_modules\wrangler\bin\wrangler.js secret put ALPHA_VANTAGE_API_KEY
node .\node_modules\wrangler\bin\wrangler.js secret put TAAPI_API_KEY
node .\node_modules\wrangler\bin\wrangler.js secret put FINNHUB_API_KEY
node .\node_modules\wrangler\bin\wrangler.js secret put FRED_API_KEY
node .\node_modules\wrangler\bin\wrangler.js secret put TELEGRAM_BOT_TOKEN
node .\node_modules\wrangler\bin\wrangler.js secret put TELEGRAM_CHAT_ID
node .\node_modules\wrangler\bin\wrangler.js secret put ALPACA_API_KEY
node .\node_modules\wrangler\bin\wrangler.js secret put ALPACA_SECRET_KEY

# 3. Deploy
node .\node_modules\wrangler\bin\wrangler.js deploy
```

### Method 2: Deploy Script (`deploy.mjs`)
```powershell
# Set environment variables first
$env:CLOUDFLARE_API_TOKEN = "your-cf-api-token"
$env:CLOUDFLARE_ACCOUNT_ID = "25d6c25b2232bbe0a5ae57c6fde9921c"

# Reads .secrets.json, sets all secrets via CF API, then deploys
node deploy.mjs
```

### Method 3: GitHub Actions CI/CD
- Push to `main` branch → Auto-deploy via `.github/workflows/deploy.yml`
- Manual trigger: `gh workflow run deploy.yml`
- Requires GitHub Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, + all API keys
- Pipeline: Checkout → npm ci → TypeScript check → Wrangler deploy → Set secrets

### Method 4: PowerShell Setup Script (`setup.ps1`)
- End-to-end: Install gh CLI → git init → create repo → push → set GitHub secrets → trigger deploy
- Run: `.\setup.ps1` (PowerShell as Administrator)

### Post-Deployment Verification
```bash
# 1. Health check
curl https://ymsa-financial-automation.kuki-25d.workers.dev/health

# 2. Test Telegram alert
curl https://ymsa-financial-automation.kuki-25d.workers.dev/api/test-alert

# 3. Check logs
node .\node_modules\wrangler\bin\wrangler.js tail
```

---

## 📊 Cloudflare Configuration (`wrangler.toml`)

| Setting | Value |
|---|---|
| Worker Name | `ymsa-financial-automation` |
| Main Entry | `src/index.ts` |
| Compatibility Date | `2026-03-26` |
| Compatibility Flags | `nodejs_compat` |
| Account ID | `25d6c25b2232bbe0a5ae57c6fde9921c` |

### Active Bindings
| Type | Name | Details |
|---|---|---|
| **D1 Database** | `DB` → `ymsa-db` | ID: `fbc9947c-7654-43d2-9cc9-e949baa60d05` — 11 tables |
| **KV Namespace** | `YMSA_CACHE` | ID: `a110e14c46e440dcad5a9f46a32e85b9` — API response caching |
| **Workers AI** | `AI` | `@cf/meta/llama-3.1-8b-instruct` — Z.AI engine |
| **Browser** | `BROWSER` | Playwright for Finviz/Google scraping |

### Environment Variables (`[vars]`)
| Variable | Value | Purpose |
|---|---|---|
| `DEFAULT_WATCHLIST` | `AAPL,MSFT,NVDA,...` (10 stocks) | Core stock watchlist |
| `CRYPTO_WATCHLIST` | `bitcoin,ethereum,...` (10 coins) | Crypto watchlist |
| `EMA_FAST` / `EMA_SLOW` | 50 / 200 | EMA periods |
| `RSI_OVERBOUGHT` / `RSI_OVERSOLD` | 70 / 30 | RSI thresholds |
| `FIBO_LEVELS` | `0,0.236,0.382,0.5,0.618,0.786,1.0` | Fibonacci levels |
| `FIBO_EXTENSIONS` | `1.0,1.272,1.618,2.0,2.618` | Fibonacci extensions |
| `ALERT_PROXIMITY_52W` | `5` | 52-week proximity alert % |
| `VOLUME_SPIKE_MULTIPLIER` | `1.5` | Volume spike threshold |
| `ALPACA_PAPER_MODE` | `true` | Paper trading only |

---

## 🐛 Known Issues & Gotchas

### 1. Alpha Vantage Rate Limits
- Free tier: 5 requests/minute, 500/day
- Mostly superseded by local `computeIndicators()` from Yahoo OHLCV data
- TAAPI.io used for MTF bulk queries; Alpha Vantage is last-resort backup

### 2. Yahoo Finance Unofficial API
- Uses `query1.finance.yahoo.com/v8/finance/chart/` — no official guarantee
- Works reliably but could break if Yahoo changes their API
- User-Agent header set to `YMSA-Financial-Bot/1.0`

### 3. Browser Rendering (Scrapers)
- Finviz and Google Finance scrapers require the `BROWSER` binding (Cloudflare Browser Rendering)
- If binding isn't configured, scrapers skip silently (graceful fallback in `runScraperScan()`)
- Browser Rendering requires Cloudflare Workers Paid Plan

### 4. TAAPI Rate Limiting for MTF
- MTF engine now primarily uses **Yahoo Finance OHLCV + local indicators** (free, reliable)
- TAAPI is used only as optional enhancement (stochastic, supertrend) when cached in KV
- Results cached 5 minutes in KV to avoid repeated calls

### 5. Local Indicator Engine Replaces TAAPI for Stocks
- `src/analysis/indicators.ts` computes RSI, EMA, SMA, MACD, ATR from Yahoo OHLCV candles
- This was built because TAAPI free tier broke for individual stock queries
- MTF now uses `buildBulkFromOHLCV()` with daily data as 4H proxy (Yahoo free tier doesn't have 4h for stocks)

### 6. Pairs Trading — Cointegration Test
- Uses simplified variance-ratio proxy — NOT the full Augmented Dickey-Fuller test
- Adequate for screening but should not be treated as statistically rigorous

### 7. Telegram Message Limits
- Max 4096 characters per message
- `splitMessage()` in `alert-router.ts` handles chunking automatically
- Rate limit: 30 messages per second per bot

### 8. Z.AI Graceful Degradation
- All Z.AI functions catch LLM errors and return empty/safe defaults
- If `env.AI` binding is unavailable, `isZAiAvailable()` returns false
- System continues fully operational without LLM — just loses AI reasoning text

### 9. Evening Summary — Holdings Require D1
- Holdings report in evening summary queries `getOpenTrades(env.DB)`
- If D1 is unavailable or has no open trades, holdings section is simply skipped
- Commodity/Index/Bitcoin sections always show regardless

### 10. Silent Engines Are Normal in Sideways Markets
- **MTF_MOMENTUM**: Confluence threshold is 65% + requires BUY/SELL (not WAIT). In neutral/sideways markets (RSI ~50, no strong trend), most stocks return null. This is correct behavior.
- **STAT_ARB**: Requires |z-score| > 1.5 for tradable pair. In correlated markets, few pairs diverge enough. This is correct.
- **CRYPTO_DEFI**: DexScreener whale detection needs $1M+ volume + 10% change. CoinGecko trending can return empty. DEX mover fallback (>5% + $100K vol) helps but crypto can still be quiet.
- As of 2026-04-01: 3/6 engines producing signals (EVENT_DRIVEN, SMART_MONEY, OPTIONS). The other 3 are market-condition dependent, not broken.

### 11. `telegram_alerts` Table vs Telegram Messages
- `telegram_alerts` D1 table ONLY stores trade alerts (BUY/SELL with entry/SL/TP) that pass `planTradeAlert` gating (confidence ≥55, not conflicting below 70).
- Market context messages and "no signals" fallback ARE sent to Telegram but NOT logged to the table.
- Having 0 rows in `telegram_alerts` does NOT mean Telegram isn't receiving messages.

### 12. Cloudflare Worker CPU Timeout vs Signal Recording
- Full scan runs ~30 seconds. If scan times out before `flushCycle()`, signals from late engines would be lost.
- **Fix**: `pushAndRecordSignal()` records each signal to D1 INLINE as it's generated — no longer depends on scan completing.
- Engine stats update at end of `runFullScan` may still be missed on timeout; `/api/engine-stats` has a live fallback that queries `signals` table directly.

---

## 💰 Cost Structure

| Tier | Monthly Cost | What You Get |
|---|---|---|
| **Minimum** | ~$5 | Cloudflare Workers Paid Plan only |
| **Current** | ~$15-25 | + TAAPI.io basic plan |
| **Full Production** | ~$65-85 | + Alpha Vantage premium, additional API tiers |

Free APIs used: Yahoo Finance, CoinGecko, DexScreener, Polymarket, FRED

---

## 🔄 Development Workflow

### PATH Setup (Required for every new terminal)
```powershell
$env:PATH = "C:\Program Files\Git\cmd;C:\Program Files\GitHub CLI;C:\Program Files\nodejs;" + $env:PATH
```

### Local Development
```powershell
# Install dependencies
npm install

# TypeScript type checking (MUST pass before deploy)
node .\node_modules\typescript\bin\tsc --noEmit

# Run tests (MUST pass before deploy)
node .\node_modules\vitest\vitest.mjs run

# Deploy to Cloudflare (only with user permission)
node .\node_modules\wrangler\bin\wrangler.js deploy

# Git commit + push
git add -A
git commit -m "description"
git push origin master
```

### Making Changes
1. Edit source files in `src/`
2. Run `node .\node_modules\typescript\bin\tsc --noEmit` to check types
3. Run `node .\node_modules\vitest\vitest.mjs run` to run tests
4. Deploy with `node .\node_modules\wrangler\bin\wrangler.js deploy` (with user permission)
5. Commit and push: `git add -A && git commit -m "..." && git push origin master`

### Config Changes (No Deploy Needed After Initial Deploy)
- **Watchlist**: `config/watchlist.json` defines 3 tiers, but the active runtime watchlist comes from `DEFAULT_WATCHLIST` in `wrangler.toml` [vars]
- **Alert Rules**: `config/alert-rules.json` is reference only; logic is in `alert-formatter.ts` + `broker-manager.ts`
- **Screening Rules**: `config/screening-rules.json` is reference only; logic is in `signals.ts`

> [!IMPORTANT]
> The JSON config files in `config/` are **documentation/reference files**. The actual logic is hard-coded in the TypeScript source. To change watchlist or thresholds, update `wrangler.toml` [vars] and redeploy.

---

## 📐 Signal Detection Logic (`src/analysis/signals.ts`)

| Signal Type | Trigger | Priority |
|---|---|---|
| `RSI_OVERSOLD` | RSI ≤ 30 | IMPORTANT (CRITICAL if ≤ 25) |
| `RSI_OVERBOUGHT` | RSI ≥ 70 | IMPORTANT (CRITICAL if ≥ 75) |
| `GOLDEN_CROSS` | EMA50 crosses above EMA200 | CRITICAL |
| `DEATH_CROSS` | EMA50 crosses below EMA200 | CRITICAL |
| `EMA_CROSSOVER` | EMA50/200 gap < 0.5% | IMPORTANT |
| `MACD_BULLISH_CROSS` | MACD crosses above signal | IMPORTANT |
| `MACD_BEARISH_CROSS` | MACD crosses below signal | IMPORTANT |
| `52W_BREAKOUT` | Price ≥ 52-week high | CRITICAL |
| `52W_BREAKDOWN` | Price ≤ 52-week low | CRITICAL |
| `52W_HIGH_PROXIMITY` | Within 5% of 52W high | IMPORTANT |
| `52W_LOW_PROXIMITY` | Within 5% of 52W low | IMPORTANT |
| `VOLUME_SPIKE` | Volume ≥ 1.5x average | IMPORTANT (CRITICAL if ≥ 3x) |
| `FIBONACCI_LEVEL_HIT` | Price within 1% of Fib level | IMPORTANT (61.8%/50%) or INFO |

### Signal Score Calculation
- CRITICAL signal = +30 points
- IMPORTANT signal = +15 points
- INFO signal = +5 points
- Capped at 100

---

## 🔧 TypeScript Configuration

- Target: ES2022
- Module: ES2022 with bundler resolution
- Strict: true (all strict checks enabled)
- Types: `@cloudflare/workers-types`
- Path alias: `@/*` → `./src/*`
- `noUnusedLocals` and `noUnusedParameters` enabled

---

## 📱 Telegram Bot Details

| Field | Value |
|---|---|
| Bot Token | `TELEGRAM_BOT_TOKEN` secret |
| Chat ID | `TELEGRAM_CHAT_ID` secret |
| Parse Mode | HTML |
| Web Preview | Disabled |
| Message Format | Emoji-rich structured alerts with links |

### Alert Priority Routing (from `config/alert-rules.json`)
- **CRITICAL**: Sent immediately
- **IMPORTANT**: Batched every 30 minutes
- **INFO**: Daily digest only
- **Quiet Hours**: 23:00–06:00 IST (override for CRITICAL)
- **Duplicate Suppression**: 24-hour window per symbol per action (e.g., `TECH:AAPL:BUY`)
- **Trade Alert Budget**: Max 3 trade alerts per hour (broker-manager enforced)

---

## 🚨 Emergency Procedures

### Worker Not Sending Alerts
1. Check health: `curl https://ymsa-financial-automation.kuki-25d.workers.dev/health`
2. Test alert: `curl https://ymsa-financial-automation.kuki-25d.workers.dev/api/test-alert`
3. Check logs: `node .\node_modules\wrangler\bin\wrangler.js tail`
4. Verify secrets: `node .\node_modules\wrangler\bin\wrangler.js secret list`

### Need to Stop All Cron Jobs
- Remove or comment out the `[triggers] crons = [...]` block in `wrangler.toml`
- Redeploy: `npx wrangler deploy`
- This immediately stops all scheduled executions

### API Key Rotation
1. Get new key from provider
2. Update `.secrets.json` locally
3. Run: `npx wrangler secret put <KEY_NAME>` and paste new value
4. If using GitHub Actions: `gh secret set <KEY_NAME> --body "new-value"`

### Rollback
```powershell
# List deployments
node .\node_modules\wrangler\bin\wrangler.js deployments list

# Rollback to previous version
node .\node_modules\wrangler\bin\wrangler.js rollback
```

---

## 📋 Watchlist (Current — from `config/watchlist.json`)

### Tier 1: CORE (15 stocks — always scanned)
| Sector | Symbols |
|---|---|
| Technology | AAPL, MSFT, NVDA, GOOGL, META, CRM |
| Consumer | AMZN, TSLA |
| Semiconductors | AMD, AVGO, INTC, QCOM |
| Finance | JPM, GS, V |

### Tier 2: ROTATION (15 stocks — regime-dependent)
| Sector | Symbols |
|---|---|
| Healthcare | UNH, JNJ, PFE |
| Energy | XOM, CVX, COP |
| Consumer/Retail | NKE, SBUX, MCD |
| Industrial | CAT, BA, HON |
| SaaS | NOW, SNOW, PANW |

### Tier 3: ETFs + Indices (9 instruments — regime detection)
| Category | Symbols |
|---|---|
| Index ETFs | SPY, QQQ, IWM |
| Sector ETFs | XLF, XLK, XLE |
| Commodity/Bond | GLD, TLT |
| Volatility | VIX |

### Stat-Arb Pairs (6 defined)
AAPL/MSFT, NVDA/AMD, XOM/CVX, JPM/GS, GOOGL/META, SPY/QQQ

### Crypto Watchlist (10 coins)
Bitcoin, Ethereum, Solana, Cardano, Polkadot, Avalanche, Chainlink, Uniswap, Aave, Arbitrum

### Commodity Symbols (Yahoo Finance)
Gold (`GC=F`), Silver (`SI=F`), Oil WTI (`CL=F`), Brent (`BZ=F`), Nat Gas (`NG=F`), Copper (`HG=F`), Platinum (`PL=F`), Corn (`ZC=F`), Wheat (`ZW=F`), Soybean (`ZS=F`), Cocoa (`CC=F`), Coffee (`KC=F`), Sugar (`SB=F`), Cotton (`CT=F`)

### Evening Summary — Tracked Investments (filtered view)
The evening summary only shows updates for:
- **Indices**: S&P 500 (`^GSPC`), NASDAQ (`^IXIC`), DOW JONES (`^DJI`)
- **Commodities**: GOLD (`GC=F`), Oil WTI (`CL=F`)
- **Crypto**: Bitcoin (`BTC-USD` via CoinGecko)
- **Holdings**: Any stocks from open BUY trades in D1
- **Holdings Report**: Company, Ticker, Closing Price, Purchase Price, Trade Date, Daily P/L, Accumulated P/L

---

## 📝 Version History

| Date | Commit | Changes |
|---|---|---|
| 2026-03-26 | `3e77f5c` | Initial commit: 5-agent system, Hono framework, all API integrations |
| 2026-03-26 | `5884b24` | Fix Sunday cron from `0` to `SUN` for Cloudflare compatibility |
| 2026-03-26 | `8d6718d` | SRE dashboard + production audit script (87% score) |
| 2026-03-26 | `e7f4072` | 100% SRE audit — secrets, KV, D1, tests, parallel scan |
| 2026-03-26 | `8e962cb` | Fix TAAPI bulk API + correct stock symbol format + cron SUN match |
| 2026-03-27 | `d5b4adc` | Add SUPERCHARGE.md: 6-engine blueprint with 12 Google Alerts RSS feeds |
| 2026-03-27 | `29b159f` | **v3.0: SUPERCHARGE** — 6 engines, Alpaca execution, D1 database, regime detection |
| 2026-03-27 | `e738ade` | v3.0.1: Fix D1 schema + dashboard v3 overhaul |
| 2026-03-27 | `85e5632` | Fix dashboard bugs — confidence, regime, portfolio fallback, favicon |
| 2026-03-27 | `c0e28a4` | Wire Google Alerts + v3 engines into cron pipeline, `/api/news` endpoint |
| 2026-03-27 | `449deda` | Fix dashboard metrics — performance/daily-pnl/engine-stats endpoints, win rate |
| 2026-03-28 | `77a05d5` | Fix regime_history D1 INSERT column mismatch + news_alerts created_at |
| 2026-03-28 | `a7776b8` | **Local indicator engine** — compute RSI/MACD/EMA from Yahoo OHLCV, replacing broken TAAPI free tier |
| 2026-03-28 | `629a1e3` | Actionable trade alert format for all Telegram alerts |
| 2026-03-28 | `fbffe3e` | Add `/api/send-trade-alert` endpoint + fix SL zone anchoring bug |
| 2026-03-28 | `82492ab` | **Smart Broker Manager** — centralized Telegram decision engine |
| 2026-03-29 | `b2de6f2` | **Enterprise upgrade**: Google Auth + Z.AI + P0/P1 fixes |
| 2026-03-29 | `b93014f` | Configure Google OAuth Client ID for authentication |
| 2026-03-30 | `8df582f` | **Z.AI full integration**: wire reviewTrade, composeAlert, real weekly P&L, 30 tests |
| 2026-04-01 | `bca9e2e` | **Trade alert overhaul**: SMA 50/200, 24hr dedup, remove commodity Big Moves, filtered evening summary with holdings report |
| 2026-04-01 | `db99f78` | **v3.1: Win/Loss Tracker + P&L Dashboard** — telegram_alerts table, 5 new API endpoints, alert outcome tracking, equity curve, drawdown, monthly returns, daily P&L, engine/symbol breakdown |
| 2026-04-01 | `d5df5be` | **Fix: All 6 engines route through broker manager** — previously 5/6 engines bypassed broker, sending Telegram directly. Now all push through `pushStatArb`, `pushCryptoDefi`, `pushEventDriven`, `pushOptions` |
| 2026-04-01 | `3cb46f2` | **Inline D1 signal recording + scan enhancements** — `pushAndRecordSignal()` records signals immediately to D1 (not waiting for flushCycle). Commodity big-move detection (>3%), crypto DEX mover fallback |
| 2026-04-01 | `fc4e614` | **Live engine signal counts in dashboard** — `/api/engine-stats` merges `engine_performance` table with live signal counts from `signals` table. Engine stats updated after each full scan |
| 2026-04-02 | `b0abd36` | **Critical P&L fix** — dailyPnl uses Alpaca last_equity, engine-stats live win rates, realized P&L breakdown, Morning Brief v2 |
| 2026-04-02 | `3b66e69` | **Phase 1 Quality Gates** — ADX gating, anti-trap rules, multi-engine ≥2 requirement, R:R ≥2.0 gate, counter-trend blocking at regime conf ≥70, VIX halt ≥35, Smart Money age decay |
| 2026-04-02 | `0d5491c` | **MD3 Mobile-First Dashboard** — Converted all CSS to mobile-first with 3 breakpoints (480px, 768px, 1100px). Responsive grid, touch-friendly tables, compact hero metrics |
| 2026-04-03 | `6631c25` | **6 Critical Trading Fixes** — Event Driven R:R 0.80→2.25, Options R:R 1.33→2.33, simulator confidence ≥85 gate, position limits enforced (maxOpen=8, maxDaily=15), contradictory position blocking, dynamic win rate from trade history |
| 2026-04-03 | `46b2158` | **Owner Report** — OWNER-REPORT-2025-07-14.md: structured brokers' meeting, senior audit, 6 root causes, 6 fixes, validation, recommendations |
| 2026-04-03 | `2d63cde` | **Cross-Validation Layer** — 7-layer data-validator.ts (~550 lines), Z.AI validateTradeSetup() APPROVE/REJECT gate, Z.AI detectDataAnomalies(), integrated into cron-handler + broker-manager, 35 new tests (78 total) |
| 2026-04-03 | `50e200d` | **5 Institutional Gaps Fixed (P1/P3/P4/P5/P6)** — Backtesting engine (walk-forward historical simulation with Sharpe, profit factor, win rate, drawdown, expectancy), dynamic engine budget rebalancing (monthly, performance-based, 5-40% range), stress testing suite (32 tests across 9 scenarios), engine probation system (0 wins/5+ trades → 5% budget), Z.AI health monitoring (failure rate, approval/rejection bias alerts). 110 tests (5 files). New endpoints: POST /api/backtest, GET /api/ai-health |

---

## 💾 D1 Database Schema (`src/db/schema.sql`)

11 tables with full audit trail:

| Table | Key Columns | Purpose |
|---|---|---|
| `trades` | id, engine_id, symbol, side, qty, entry_price, exit_price, stop_loss, take_profit, status, pnl, pnl_pct, opened_at, closed_at, broker_order_id | All trade records (OPEN/CLOSED/CANCELLED) |
| `positions` | id, symbol, engine_id, side, qty, avg_entry, current_price, unrealized_pnl | Live position tracking |
| `signals` | id, engine_id, signal_type, symbol, direction, strength, metadata (JSON), acted_on | Signal audit trail |
| `daily_pnl` | date (PK), total_equity, daily_pnl, daily_pnl_pct, open_positions, trades_today, win_rate, sharpe_snapshot, max_drawdown | End-of-day snapshots |
| `engine_performance` | id, engine_id, date, signals_generated, trades_executed, win_rate, pnl, avg_rr, weight | Per-engine metrics |
| `regime_history` | id, regime, detected_at, vix_level, spy_trend, confidence | Regime change log |
| `pairs_state` | pair_key (PK), symbol_a, symbol_b, correlation, cointegration_pval, half_life, hedge_ratio, z_score, status | Pairs trading state |
| `news_alerts` | id, category, title, url, published_at, processed, created_at | Google Alerts ingestion |
| `risk_events` | id, event_type, severity, description, action_taken, created_at | Risk event audit |
| `kill_switch_state` | id=singleton, tier, activated_at, daily_pnl_pct, reason | Kill switch persistence |
| `telegram_alerts` | id, symbol, action, engine_id, entry_price, stop_loss, take_profit_1/2, confidence, alert_text, outcome (PENDING/WIN/LOSS/BREAKEVEN/EXPIRED), outcome_price, outcome_pnl, outcome_pnl_pct, outcome_notes, outcome_at, regime, metadata, sent_at | Track every Telegram alert for win/loss analysis |

### Key Queries (`src/db/queries.ts` — 29+ exported functions)
- **Trades**: `insertTrade`, `closeTrade`, `getOpenTrades`, `getTradesByEngine`, `getRecentTrades`, `getClosedTradesSince`
- **Positions**: `upsertPosition`, `deletePosition`, `getOpenPositions`, `getPositionBySymbol`
- **Signals**: `insertSignal`, `getRecentSignals`, `getSignalsByEngine`
- **P&L**: `upsertDailyPnl`, `getDailyPnlRange`, `getRecentDailyPnl`
- **Engine**: `upsertEnginePerformance`, `getEnginePerformance`
- **Utility**: `generateId(prefix)`, `insertRiskEvent`, `getRecentRiskEvents`, `getRecentNewsAlerts`, `getNewsAlertsByCategory`
- **Telegram Alerts**: `insertTelegramAlert`, `updateTelegramAlertOutcome`, `getRecentTelegramAlerts`, `getTelegramAlertById`, `getTelegramAlertStats`, `getPnlDashboardData`, `getPendingTelegramAlerts`, `expireOldTelegramAlerts`

---

## 📨 Trade Alert Format (as of commit bca9e2e)

Every trade alert follows this exact structure:

```
🟢 TRADE ALERT — BUY AAPL

Reason: Smart Money + MTF confluence detected bullish setup.
🧠 Z.AI: Order block at demand zone with rising volume confirmation.

Signals:
• Order Block (Strength: 85, Age: 3d, BULLISH)
• MTF Confluence (Weekly: bullish, Daily: support, 4H: trigger)
• Models: Smart Money + MTF (2 agree)

Technical Info:
• RSI(14): 28.5
• MACD: 0.253 (Bullish)
• SMA 50: $178.50
• SMA 200: $165.30

Trade Setup:
  Entry: $180.50
  Stop Loss: $175.00
  Take Profit:
    TP1: $190.00 (R:R 1:1.7)
    TP2: $196.25 (R:R 1:2.9)

Confidence: 85/100 (High)

Market Context:
Trend-aligned trade — market is trending up (conf 78%). VIX elevated at 26.

🔗 TradingView | Yahoo
⏰ 2026-04-01 12:00:00 UTC
```

### Alert Dedup Rules
- **Broker Manager**: `DEDUP_MS = 24 * 60 * 60 * 1000` (24 hours)
- **Alert Formatter**: `DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000` (24 hours)
- Key format: `{ENGINE}:{SYMBOL}:{ACTION}` (e.g., `TECH:AAPL:BUY`, `SMC:NVDA:SELL`)
- Same stock + same action = suppressed for 24 hours
- **Max 3 trade alerts per hour** (broker-manager budget)

---

## 📰 Google Alerts RSS Feeds (12 feeds, `src/api/google-alerts.ts`)

| # | Feed Topic | Routed To Engines |
|---|---|---|
| 1 | Mega Tech Earnings (AAPL, MSFT, GOOGL, AMZN) | MTF_MOMENTUM |
| 2 | More Tech Earnings (META, NVDA, CRM, TSLA) | MTF_MOMENTUM |
| 3 | M&A Deals | STAT_ARB, EVENT_DRIVEN |
| 4 | Short Squeeze / Options Flow | SMART_MONEY, OPTIONS |
| 5 | Fed / Rate Decisions | EVENT_DRIVEN, RISK |
| 6 | Earnings Beat/Miss | OPTIONS, EVENT_DRIVEN |
| 7 | SEC 13F Filings | SMART_MONEY |
| 8 | Crypto Regulation/ETF | CRYPTO_DEFI |
| 9 | Bank Earnings (JPM, GS) | MTF_MOMENTUM |
| 10 | Semiconductor Earnings (AMD, AVGO, INTC) | MTF_MOMENTUM, STAT_ARB |
| 11 | Buybacks/Dividends | OPTIONS |
| 12 | Market Crash Signals | EVENT_DRIVEN, RISK |

Feeds are parsed via regex-based Atom XML parsing (no external XML library needed).

---

## 📐 Local Indicator Engine (`src/analysis/indicators.ts`)

`computeIndicators(symbol, candles, timeframe='daily')` returns up to **9 indicators**:

| Indicator | Method | Period |
|---|---|---|
| RSI | Wilder's smoothing | 14 |
| EMA_50 | Exponential MA | 50 |
| EMA_200 | Exponential MA | 200 |
| SMA_50 | Simple MA | 50 |
| SMA_200 | Simple MA | 200 |
| MACD | EMA(12) − EMA(26) | Standard |
| MACD_SIGNAL | EMA(9) of MACD | 9 |
| MACD_HISTOGRAM | MACD − Signal | — |
| ATR | Wilder's smoothing | 14 |

**Input**: OHLCV candles (newest-first from Yahoo Finance, reversed internally)
**Why built**: TAAPI.io free tier broke for individual stock queries; this computes locally from Yahoo data at zero cost.

---

## 🧪 Test Suite (`src/__tests__/`)

**Framework**: Vitest ^3.0.0 | **Total**: 110 tests | **All passing**

| File | Tests | Coverage |
|---|---|---|
| `signals.test.ts` | 7 | RSI oversold/overbought, volume spike, 52W proximity, score calculation |
| `risk-controller.test.ts` | 6 | Kill switch, daily drawdown, position size, loss limit, custom limits |
| `z-engine.test.ts` | 30 | synthesizeSignal, scoreNewsSentiment, reviewTrade, weeklyNarrative, composeAlert, isZAiAvailable, error handling, edge cases |
| `data-validator.test.ts` | 35 | validateQuote (8), validateIndicators (6), validateTradeParams (6), validateSignalConsistency (4), crossValidateQuotes (4), validateEnvThresholds (4), buildDataQualityReport (3) |
| `stress-test.test.ts` | 32 | Flash crash (6), VIX spike (5), correlation breakdown (3), engine budget (4), position limits (2), exposure cap (2), kill switch tiers (8), combined crisis (1), sector concentration (1) |

### Running Tests
```powershell
$env:PATH = "C:\Program Files\Git\cmd;C:\Program Files\GitHub CLI;C:\Program Files\nodejs;" + $env:PATH
node .\node_modules\vitest\vitest.mjs run
```

---

## 🧩 Planned Features / Future Improvements

### Completed (formerly planned)
- ✅ KV Namespace caching for API responses (YMSA_CACHE active)
- ✅ D1 Database for trade history and performance tracking (11 tables)
- ✅ Previous indicator storage (cycleIndicators in broker-manager)
- ✅ Z.AI LLM integration for signal reasoning

### Still Planned
- [ ] Backtest UI in dashboard (currently API-only via POST /api/backtest)
- [ ] R2 Bucket for historical data storage (backtest datasets)
- [ ] Durable Objects for persistent orchestrator state across invocations
- [ ] Full ADF cointegration test (replace variance ratio proxy)
- [ ] WhatsApp and email alert channels
- [ ] Glassnode integration for on-chain crypto metrics (NVT, exchange flows)
- [ ] Custom watchlist management via Telegram bot commands
- [ ] Backtesting engine for signal validation
- [ ] Live (non-paper) Alpaca execution mode
- [ ] Options pricing engine (Black-Scholes, Greeks)
- [ ] Portfolio heat map visualization

### Recently Completed
- ✅ **Win/Loss Alert Tracker** — Every Telegram alert logged to D1 `telegram_alerts` table with full trade setup. Dashboard table with filters (ALL/PENDING/WIN/LOSS/BREAKEVEN/EXPIRED), click-to-open modal with trade details, manual outcome marking.
- ✅ **P&L Analytics Dashboard** — Equity curve, drawdown chart, monthly returns heatmap, daily P&L bars, engine/symbol breakdown tables. Hero metrics (total P&L, win rate, profit factor, max drawdown). Canvas-based charts, Material Design 3 dark theme.
- ✅ **Alert logging pipeline** — Both `alert-router.ts` (direct sends) and `broker-manager.ts` (cycle flush) log to D1.
- ✅ **Auto-resolution cron** — `runOvernightSetup` checks PENDING alerts against market prices (SL→LOSS, TP1→WIN, stagnant→BREAKEVEN). Alerts older than 7 days auto-expire.
- ✅ Batch `/api/dashboard-data` endpoint (reduces 3 API calls to 1). Dashboard now makes 12 parallel calls instead of 14.
- ✅ 6 new API endpoints: `/api/telegram-alerts`, `/api/telegram-alert`, `/api/telegram-alert-stats`, `/api/telegram-alert-outcome`, `/api/pnl-dashboard`, `/api/dashboard-data`
- ✅ **All 6 engines through broker manager** — Fixed 5/6 engines that were bypassing broker manager and sending Telegram directly. All now use `pushStatArb`, `pushCryptoDefi`, `pushEventDriven`, `pushOptions` (commit `d5df5be`).
- ✅ **Inline D1 signal recording** — `pushAndRecordSignal()` records signals to D1 immediately as each engine produces output, not waiting for `flushCycle`. Prevents signal loss on scan timeout (commit `3cb46f2`).
- ✅ **Commodity big-move detection** — `runCommodityScan` now detects ≥3% daily commodity price moves and generates EVENT_DRIVEN signals with named commodities (commit `3cb46f2`).
- ✅ **Crypto DEX mover fallback** — `runCryptoWhaleScan` falls back to top-volume DEX pairs with >5% moves when whale signals are empty (commit `3cb46f2`).
- ✅ **Live engine stats in dashboard** — `/api/engine-stats` now merges `engine_performance` table with live signal counts from `signals` table. Engine cards show real-time signal counts (commit `fc4e614`).
- ✅ **Verified live**: 38 signals from 3 engines (EVENT_DRIVEN: 12, SMART_MONEY: 8, OPTIONS: 2) visible in dashboard as of 2026-04-01.
- ✅ **Critical P&L calculation fix** — `dailyPnl` was incorrectly set to `totalUnrealizedPnl` in `getPortfolioSnapshot()`. Now uses Alpaca's `last_equity` field: `dailyPnl = equity - lastEquity`. All daily P&L history recording and dashboard display now shows true daily P&L (commit `b0abd36`).
- ✅ **Engine-stats live win rates** — `/api/engine-stats` now computes real-time `win_rate`, `pnl`, `trades_executed` from closed trades per engine instead of stale cron-recorded values (commit `b0abd36`).
- ✅ **Realized P&L breakdown** — Dashboard daily P&L subtitle now shows `(realized: $X)` when trades closed today. `PortfolioSnapshot` includes `realizedPnlToday` and `lastEquity` fields (commit `b0abd36`).
- ✅ **Morning Brief v2** — 6 premium sections + KEY INSIGHTS (2-3 data-driven commentary bullets) + WHAT TO WATCH TODAY (earnings, Fed, risks, opportunities). 50-stock tech scan with relaxed thresholds + volume spike indicator (commits `84dab35`, `a09e543`).
- ✅ **Phase 1 Quality Gates** (commit `3b66e69`) — ADX gating (trend trades need ADX≥20, range trades ADX<25), anti-trap rules (RSI divergence + volume confirmation), multi-engine ≥2 requirement, R:R ≥2.0 gate, counter-trend blocking at regime confidence ≥70, VIX halt when ≥35, Smart Money order block age decay.
- ✅ **MD3 Mobile-First Dashboard** (commit `0d5491c`) — Converted all CSS from desktop-first to mobile-first. 3 breakpoints (480px, 768px, 1100px). Responsive grid layouts, touch-friendly filter buttons, compact hero metrics, adaptive font sizes.
- ✅ **6 Critical Trading Defect Fixes** (commit `6631c25`) — (1) Event Driven R:R 0.80→2.25 (SL atr×2, TP atr×4.5), (2) Options R:R 1.33→2.33 (TP atr×3.5), (3) Simulator confidence ≥85 gate, (4) Position limits enforced via D1 queries (maxOpen=8, maxDaily=15), (5) Contradictory position blocking (no BUY+SELL same symbol), (6) Dynamic win rate from last 50 closed trades (clamped 30%-80%).
- ✅ **Owner Report** (commit `46b2158`) — OWNER-REPORT-2025-07-14.md: structured brokers' morning meeting, senior leadership audit, 6 root causes identified, 6 fixes implemented, validation results, expected impact projections, forward recommendations.
- ✅ **Cross-Validation Layer** (commit `2d63cde`) — 7-layer `data-validator.ts` (~550 lines): quote structural validation, indicator consistency, cross-source price agreement, signal conflict detection, trade param validation, env threshold checks, aggregate quality scoring (weighted 0-100, min 60 to pass). Z.AI `validateTradeSetup()` APPROVE/REJECT gate before every trade alert. Z.AI `detectDataAnomalies()` sampled 15% of stocks. Integrated into cron-handler (scan-time validation) and broker-manager (pre-send gate). 35 new tests, 78 total passing.

---

> **Note to AI Assistants**: When the user asks you to work on this project, READ THIS FILE FIRST. It contains everything you need to understand the system without reading every source file. If you need specific implementation details, the source file locations are mapped above. Always set PATH first: `$env:PATH = "C:\Program Files\Git\cmd;C:\Program Files\GitHub CLI;C:\Program Files\nodejs;" + $env:PATH`. Use `node .\node_modules\...` instead of `npx` — npx is blocked by execution policy on this machine.
