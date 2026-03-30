# 🧠 YMSA — Memory Journal (CTO-Level System Context)

> **Purpose**: This is the single source of truth for any LLM, AI assistant, or developer working on this project.
> Read this file FIRST before making ANY changes, running ANY commands, or deploying ANYTHING.
> Last updated: 2026-03-27

---

## 📌 Project Identity

| Field | Value |
|---|---|
| **Name** | YMSA — Your Money, Smarter & Automated |
| **Version** | 2.0.0 |
| **Owner** | Yotam Manheim (`yotam.manheim@gmail.com`) |
| **Runtime** | Cloudflare Workers (100% serverless, edge computing) |
| **Language** | TypeScript (strict mode) |
| **Framework** | Hono v4.7 (HTTP router on Workers) |
| **Mode** | **SIGNALS-ONLY** — No automated execution. All trading is manual. |
| **Output** | Telegram bot alerts → Yotam's phone → Manual trade decisions |
| **Local OS** | Windows 11 |
| **Local Path** | `d:\Users\yotam\Downloads\YMSA` |

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                  CLOUDFLARE WORKERS                      │
│                  (Runs in the CLOUD)                     │
│                                                         │
│  ┌─────────┐  ┌─────────┐  ┌──────────┐  ┌──────────┐ │
│  │ Agent 1 │  │ Agent 2 │  │ Agent 3  │  │ Agent 4  │ │
│  │ Stocks  │  │ Stat-Arb│  │ Crypto   │  │Polymarket│ │
│  │Technical│  │ Pairs   │  │ Whales   │  │ Bets     │ │
│  └────┬────┘  └────┬────┘  └────┬─────┘  └────┬─────┘ │
│       │            │            │              │        │
│       └────────────┴─────┬──────┴──────────────┘        │
│                          │                              │
│  ┌──────────┐    ┌───────▼──────┐    ┌──────────────┐  │
│  │ Agent 5  │───▶│ Orchestrator │───▶│Risk Controller│ │
│  │Commoditi │    │  (Aggregator)│    │(Hard Rules)   │ │
│  │ + Macro  │    └───────┬──────┘    └──────────────┘  │
│  └──────────┘            │                              │
│                   ┌──────▼──────┐                       │
│                   │Alert Router │                       │
│                   │ (Telegram)  │                       │
│                   └──────┬──────┘                       │
└──────────────────────────┼──────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │  Telegram   │
                    │  Bot API    │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  📱 Yotam   │
                    │  (Manual    │
                    │   Trading)  │
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
├── wrangler.toml                 # ⚙️ CF Worker config, cron schedules, env vars
├── package.json                  # 📦 Dependencies: hono, wrangler, typescript
├── tsconfig.json                 # 🔧 TS strict mode, ES2022, CF workers types
├── .gitignore                    # 🔒 Ignores secrets, node_modules, .wrangler
├── .secrets.json                 # 🔐 REAL API keys (GITIGNORED — NEVER COMMIT)
├── .secrets.example.json         # 📋 Template for secrets (safe to commit)
├── API-KEYS.txt                  # 🔐 Key reference (GITIGNORED — NEVER COMMIT)
├── deploy.mjs                    # 🚀 Full deploy script (sets secrets + deploys)
├── set-secrets.mjs               # 🔐 Wrangler secret setter (GITIGNORED)
├── setup.ps1                     # 🪟 Windows PowerShell setup (git, gh, deploy)
├── README.md                     # 📖 User-facing readme
│
├── .github/workflows/
│   └── deploy.yml                # 🤖 GitHub Actions CI/CD pipeline
│
├── config/
│   ├── watchlist.json            # 📊 10 stocks: AAPL, MSFT, NVDA, GOOGL, AMZN, META, TSLA, AMD, AVGO, CRM
│   ├── screening-rules.json      # 📐 13 alert trigger rules (RSI, EMA, MACD, etc.)
│   └── alert-rules.json          # 🔔 Channels, batching, quiet hours config
│
├── skills/                       # 🧠 OpenClaw / LLM skill definitions
│   ├── ymsa-fibonacci/SKILL.md
│   ├── ymsa-stock-screener/
│   └── ymsa-technical-analysis/
│
└── src/
    ├── index.ts                  # 🚪 Main entry: HTTP router + scheduled() handler
    ├── types.ts                  # 📝 All TypeScript interfaces (225 lines)
    ├── cron-handler.ts           # ⏰ 7 cron job implementations (633 lines, LARGEST FILE)
    ├── alert-router.ts           # 📨 Telegram message formatter + sender
    │
    ├── api/                      # 🌐 External API clients (8 modules)
    │   ├── yahoo-finance.ts      # FREE — No key needed. Quotes, OHLCV, commodities, indices
    │   ├── alpha-vantage.ts      # KEY REQUIRED — EMA, RSI, MACD, OHLCV fallback
    │   ├── taapi.ts              # KEY REQUIRED — 200+ technical indicators (bulk API)
    │   ├── finnhub.ts            # KEY REQUIRED — Real-time quotes, news, earnings calendar
    │   ├── fred.ts               # KEY REQUIRED — Macro data: GDP, CPI, unemployment, yield curve
    │   ├── coingecko.ts          # FREE — Crypto prices, global market, trending
    │   ├── dexscreener.ts        # FREE — DEX pair data, whale activity detection
    │   └── polymarket.ts         # FREE — Prediction markets, value bet finder
    │
    ├── analysis/                 # 📐 Signal processing
    │   ├── fibonacci.ts          # Fibonacci retracement/extension calculator
    │   └── signals.ts            # Signal detection engine (RSI, EMA, MACD, 52W, Fib, Volume)
    │
    ├── agents/                   # 🤖 Multi-agent system (Phase 2, partially implemented)
    │   ├── types.ts              # Agent types: AgentId, AgentSignal, PortfolioState, etc.
    │   ├── orchestrator.ts       # Signal aggregation + weight calibration
    │   ├── risk-controller.ts    # ⚠️ DETERMINISTIC hard rules — NOT AI (DO NOT CHANGE LIGHTLY)
    │   └── pairs-trading.ts      # Stat-arb: correlation, z-score, cointegration proxy
    │
    └── scrapers/                 # 🕷️ Browser-based scrapers (requires BROWSER binding)
        ├── finviz.ts             # RSI oversold stocks, 52W highs (Playwright)
        └── google-finance.ts     # Market overview scraper (Playwright)
```

---

## ⏰ Cron Schedule (Defined in `wrangler.toml`)

All times in **UTC**. Israel Standard Time (IST) = UTC+2 / IDT = UTC+3.
US Market Hours: 14:30–21:00 UTC (9:30 AM – 4:00 PM ET).

| Cron Expression | UTC Time | IST Time | Job Type | Description |
|---|---|---|---|---|
| `0 5 * * 1-5` | 05:00 | **07:00** | `MORNING_BRIEFING` | Pre-market overview (stocks, crypto, macro, predictions) |
| `30 14 * * 1-5` | 14:30 | **16:30** | `MARKET_OPEN_SCAN` | Full 5-agent scan at US market open |
| `*/15 14-21 * * 1-5` | Every 15m | — | `QUICK_SCAN_15MIN` | RSI + MACD monitoring (CRITICAL alerts only) |
| `0 15-21 * * 1-5` | Hourly | — | `FULL_SCAN_HOURLY` | EMA, Fibonacci, screener, all agents |
| `0 15 * * 1-5` | 15:00 | **17:00** | `EVENING_SUMMARY` | Day recap + portfolio performance |
| `0 18 * * 1-5` | 18:00 | **20:00** | `AFTER_HOURS_SCAN` | Earnings + company news scan |
| `0 7 * * 0` | 07:00 | **09:00** | `WEEKLY_REVIEW` | Sunday full portfolio + macro review |

### Cron Implementation Flow
1. Cloudflare triggers `scheduled()` in `index.ts`
2. Routes to `handleCronEvent()` in `cron-handler.ts`
3. `identifyCronJob()` maps cron string → job type
4. Runs appropriate scan function
5. Sends results via `alert-router.ts` → Telegram

---

## 🔑 API Key Inventory

| Service | Key Name | Free? | Rate Limit | Used For |
|---|---|---|---|---|
| Yahoo Finance | *(no key needed)* | ✅ FREE | ~2000 req/hr | Quotes, OHLCV, commodities, indices |
| Alpha Vantage | `ALPHA_VANTAGE_API_KEY` | Free tier (5/min) | 5 req/min, 500/day | EMA, RSI, MACD (backup) |
| TAAPI.io | `TAAPI_API_KEY` | Paid ($10+/mo) | Varies by plan | 200+ technical indicators (primary) |
| Finnhub | `FINNHUB_API_KEY` | Free tier | 60 req/min | News, earnings calendar |
| FRED | `FRED_API_KEY` | ✅ FREE | 120 req/min | Macro: GDP, CPI, yield curve, VIX |
| CoinGecko | *(no key needed)* | ✅ FREE | 10-50 req/min | Crypto prices, market cap, trending |
| DexScreener | *(no key needed)* | ✅ FREE | Generous | DEX pairs, whale detection |
| Polymarket | *(no key needed)* | ✅ FREE | Generous | Prediction markets, value bets |
| Telegram | `TELEGRAM_BOT_TOKEN` | ✅ FREE | 30 msg/sec | Alert delivery |
| Telegram | `TELEGRAM_CHAT_ID` | — | — | Yotam's chat/group ID |
| Cloudflare | `CLOUDFLARE_API_TOKEN` | — | — | Deployment (NOT stored in Worker) |

### Where Secrets Live
- **In Cloudflare Workers**: Set via `wrangler secret put <NAME>` — encrypted at rest
- **Locally**: `.secrets.json` (GITIGNORED) — used by `deploy.mjs` script
- **CI/CD**: GitHub Actions secrets — set via `gh secret set` or manually in GitHub Settings

---

## 🌐 HTTP Endpoints (Defined in `src/index.ts`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/` or `/health` | None | Health check + system info |
| `GET` | `/api/quote?symbol=AAPL` | API Key | Real-time quote (Yahoo Finance) |
| `GET` | `/api/analysis?symbol=AAPL` | API Key | Full technical analysis (RSI, EMA, MACD, Fib) |
| `GET` | `/api/fibonacci?symbol=AAPL` | API Key | Fibonacci retracement/extension levels |
| `GET` | `/api/scan` | API Key | Full watchlist scan with signal scoring |
| `GET` | `/api/crypto` | API Key | Crypto dashboard (CoinGecko + DexScreener) |
| `GET` | `/api/polymarket` | API Key | Active prediction markets + value bets |
| `GET` | `/api/commodities` | API Key | Commodity prices + FRED macro data |
| `GET` | `/api/indices` | API Key | Market indices (S&P500, NASDAQ, DOW, VIX) |
| `GET` | `/api/test-alert` | API Key | Send test alert to Telegram |
| `GET` | `/api/trigger?job=morning` | API Key | Manually trigger a cron job |

**Auth**: Pass `X-API-Key` header or `?key=` query param. Only enforced if `YMSA_API_KEY` secret is set.

**Valid trigger jobs**: `morning`, `open`, `quick`, `hourly`, `evening`, `afterhours`, `weekly`

---

## 🤖 The 5 Agents

### Agent 1: Stocks Technical (`STOCKS_TECHNICAL`, weight: 30%)
- RSI(14) oversold/overbought detection
- EMA(50/200) Golden Cross / Death Cross
- MACD(12,26,9) signal line crossovers
- 52-week high/low proximity and breakouts
- Fibonacci retracement level hits
- Volume spike detection (1.5x+ average)
- Data: Yahoo Finance (free) + TAAPI.io (paid) + Alpha Vantage (backup)

### Agent 2: Statistical Arbitrage (`STOCKS_STAT_ARB`, weight: 20%)
- Pearson correlation analysis between watchlist pairs
- Log price ratio spread + Z-score calculation
- Simplified cointegration test (variance ratio proxy)
- Mean-reversion half-life estimation (OLS)
- Tradable pair criteria: correlation > 0.7, |Z-score| > 1.5, half-life 1-30 days

### Agent 3: Crypto (`CRYPTO`, weight: 15%)
- CoinGecko: prices, market cap, 24h/7d changes, trending coins
- DexScreener: DEX pair data, liquidity analysis
- Whale activity detection (large volume spikes on-chain)
- Watchlist: Bitcoin, Ethereum, Solana, Cardano, Polkadot

### Agent 4: Prediction Markets (`POLYMARKET`, weight: 15%)
- Polymarket active markets scraping (via CLOB API)
- Value bet detection (odds mispricing in high-volume markets)
- Filters: volume > $10K, probability range 15-85%

### Agent 5: Commodities + Macro (`COMMODITIES`, weight: 20%)
- Yahoo Finance: Gold, Silver, Oil (WTI/Brent), Natural Gas, Copper, Corn, Wheat
- FRED: GDP, CPI, unemployment, yield curve (2Y/10Y), VIX
- Yield curve inversion alerts
- Big commodity move alerts (> 2% daily change)

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

---

## 🚀 Deployment Guide

### Method 1: Wrangler CLI (Direct)
```powershell
# 1. Login to Cloudflare (one-time)
npx wrangler login

# 2. Set secrets (one-time, or after key rotation)
npx wrangler secret put ALPHA_VANTAGE_API_KEY
npx wrangler secret put TAAPI_API_KEY
npx wrangler secret put FINNHUB_API_KEY
npx wrangler secret put FRED_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID

# 3. Deploy
npx wrangler deploy
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
curl https://ymsa-financial-automation.<subdomain>.workers.dev/health

# 2. Test Telegram alert
curl https://ymsa-financial-automation.<subdomain>.workers.dev/api/test-alert

# 3. Check logs
npx wrangler tail
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
| Browser Binding | `BROWSER` (Playwright for Finviz/Google scraping) |

### Planned Bindings (Commented Out — Phase 2)
- **KV Namespace** (`YMSA_CACHE`) — Caching API responses
- **R2 Bucket** (`YMSA_DATA`) — Historical data storage
- **D1 Database** (`DB`) — Trade history, performance tracking
- **Durable Objects** (`ORCHESTRATOR`, `PORTFOLIO`) — Persistent agent state

---

## 🐛 Known Issues & Gotchas

### 1. Alpha Vantage Rate Limits
- Free tier: 5 requests/minute, 500/day
- Solution: TAAPI.io is the primary indicator source; Alpha Vantage is backup only
- If hit, the 15-minute quick scans may fail silently

### 2. Yahoo Finance Unofficial API
- Uses `query1.finance.yahoo.com/v8/finance/chart/` — no official guarantee
- Works reliably but could break if Yahoo changes their API
- User-Agent header set to `YMSA-Financial-Bot/1.0`

### 3. Browser Rendering (Scrapers)
- Finviz and Google Finance scrapers require the `BROWSER` binding (Cloudflare Browser Rendering)
- If binding isn't configured, scrapers skip silently (graceful fallback in `runScraperScan()`)
- Browser Rendering requires Cloudflare Workers Paid Plan

### 4. EMA/MACD Crossover Detection
- Golden Cross / Death Cross detection requires `previousIndicators` parameter
- Currently `null` in most scans → crossovers only detected on subsequent runs
- Future: Store previous indicator values in KV/D1

### 5. Pairs Trading — Cointegration Test
- Uses simplified variance-ratio proxy — NOT the full Augmented Dickey-Fuller test
- Adequate for screening but should not be treated as statistically rigorous

### 6. Telegram Message Limits
- Max 4096 characters per message
- `splitMessage()` in `alert-router.ts` handles chunking automatically
- Rate limit: 30 messages per second per bot

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

### Local Development
```powershell
# Install dependencies
npm install

# Run dev server (starts local Worker — NOT recommended for cron debugging)
npm run dev

# TypeScript type checking
npx tsc --noEmit

# Run tests
npm test
```

### Making Changes
1. Edit source files in `src/`
2. Run `npx tsc --noEmit` to check types
3. Test individual endpoints via `npm run dev` + `curl`
4. Deploy with `npx wrangler deploy` (with user permission)
5. Verify with `npx wrangler tail` (live logs)

### Config Changes (No Deploy Needed After Initial Deploy)
- **Watchlist**: Edit `config/watchlist.json` (loaded at runtime from `wrangler.toml` `DEFAULT_WATCHLIST`)
  - Note: `watchlist.json` is a reference file; the active watchlist is `DEFAULT_WATCHLIST` in `wrangler.toml`
- **Alert Rules**: Edit `config/alert-rules.json` (reference only; logic is in `cron-handler.ts`)
- **Screening Rules**: Edit `config/screening-rules.json` (reference only; logic is in `signals.ts`)

> [!IMPORTANT]
> The JSON config files in `config/` are currently **documentation/reference files**. The actual logic is hard-coded in the TypeScript source. To change watchlist or thresholds, update `wrangler.toml` [vars] and redeploy.

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
- **Duplicate Suppression**: 60-minute window per symbol

---

## 🚨 Emergency Procedures

### Worker Not Sending Alerts
1. Check health: `curl https://ymsa-financial-automation.<subdomain>.workers.dev/health`
2. Test alert: `curl .../api/test-alert`
3. Check logs: `npx wrangler tail`
4. Verify secrets: `npx wrangler secret list`

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
npx wrangler deployments list

# Rollback to previous version
npx wrangler rollback
```

---

## 📋 Watchlist (Current)

| Symbol | Company | Sector |
|---|---|---|
| AAPL | Apple Inc. | Technology |
| MSFT | Microsoft Corp. | Technology |
| NVDA | NVIDIA Corp. | Technology |
| GOOGL | Alphabet Inc. | Technology |
| AMZN | Amazon.com Inc. | Consumer Cyclical |
| META | Meta Platforms | Technology |
| TSLA | Tesla Inc. | Consumer Cyclical |
| AMD | Advanced Micro Devices | Technology |
| AVGO | Broadcom Inc. | Technology |
| CRM | Salesforce Inc. | Technology |

### Crypto Watchlist
Bitcoin, Ethereum, Solana, Cardano, Polkadot

### Commodity Watchlist
Gold, Silver, Oil WTI, Oil Brent, Natural Gas, Copper, Platinum, Corn, Wheat, Soybean, Cocoa, Coffee, Sugar, Cotton

---

## 📝 Version History

| Date | Version | Changes |
|---|---|---|
| 2026-03-26 | v2.0.0 | Full 5-agent system, Hono framework, all API integrations, risk controller |
| 2026-03-27 | v2.0.0 | Memory Journal created, deployment documentation |

---

## 🧩 Planned Features (Phase 2)

- [ ] KV Namespace caching for API responses (reduce rate limit hits)
- [ ] D1 Database for trade history and performance tracking
- [ ] Durable Objects for persistent orchestrator state
- [ ] Full ADF cointegration test (replace variance ratio proxy)
- [ ] Previous indicator storage for accurate crossover detection
- [ ] WhatsApp and email alert channels
- [ ] Glassnode integration for on-chain crypto metrics (NVT, exchange flows)
- [ ] Custom watchlist management via Telegram bot commands
- [ ] Backtesting engine for signal validation

---

> **Note to AI Assistants**: When the user asks you to work on this project, READ THIS FILE FIRST. It contains everything you need to understand the system without reading every source file. If you need specific implementation details, the source file locations are mapped above.
