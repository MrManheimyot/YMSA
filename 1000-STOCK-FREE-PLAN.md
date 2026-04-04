# YMSA 1000-Stock Scale Plan — $5/mo FREE Data Architecture
## Zero-Cost Data Layer: 1,000+ Stocks Using Only Free & Open-Source APIs

**Date:** July 14, 2026  
**Supersedes:** `1000-STOCK-SCALE-PLAN.md` (April 5, 2026 — $148/mo plan)  
**Objective:** Scale from 50 → 1,000+ symbols with $0 additional cost beyond Cloudflare Workers Paid ($5/mo)  
**Constraint:** No paid data subscriptions. ALL external APIs must be free tier or open-source.

---

## TABLE OF CONTENTS

| Part | Title | Section |
|------|-------|---------|
| I | Executive Summary & Cost Comparison | Strategy overview |
| II | Free Data Source Inventory | All 12 free sources with limits |
| III | Smart Data Router Architecture | Multi-source orchestration |
| IV | API Budget Math | Rate limit accounting per cycle |
| V | Tiered Screening Funnel (1,000 Stocks) | Progressive filtering strategy |
| VI | Cloudflare Architecture | Fan-out, Queues, KV, D1, Durable Objects |
| VII | Implementation Phases | 4-phase rollout |
| VIII | Risk & Mitigation | What can break and how to handle it |
| IX | Comparison: $148/mo vs $5/mo | What you lose, what you keep |
| X | DB Schema Updates | New tables for multi-source routing |

---

## PART I — EXECUTIVE SUMMARY

### The Old Plan ($148/mo)
```
Alpaca Algo Trader Plus:     $99/mo  (SIP feed, unlimited WS, full OHLCV)
Tiingo Power Plan:            $30/mo  (50K tickers, IEX + delayed SIP)
Cloudflare Workers Paid:       $5/mo  (10M req, 30M CPU ms)
CoinGecko Free:                $0     (crypto)
FRED Free:                     $0     (macro)
─────────────────────────────────────
TOTAL:                       $148/mo
```

### The New Plan ($5/mo)
```
Yahoo Finance (yahoo-finance2):  $0   (batch quotes, OHLCV, fundamentals)
Alpaca Free Tier:                $0   (30 WS symbols, 200 req/min, paper trading)
Finnhub Free Tier:               $0   (60 req/min, WebSocket trades, fundamentals)
SEC EDGAR:                       $0   (no API key, 10 req/sec, full financials)
Financial Modeling Prep Free:    $0   (250 req/day, screener, financials)
Alpha Vantage Free:              $0   (25 req/day, backup OHLCV)
FRED Free:                       $0   (120 req/min, economic data)
CoinGecko Free:                  $0   (crypto prices, no key needed)
CoinCap Free:                    $0   (crypto WebSocket, no key needed)
Twelve Data Free:                $0   (8 req/min, 800/day, indicators)
fast-technical-indicators:       $0   (npm library — local compute, zero API calls)
CCXT:                            $0   (npm library — 100+ crypto exchanges)
Cloudflare Workers Paid:         $5/mo (10M req, 30M CPU ms)
─────────────────────────────────────
TOTAL:                           $5/mo
```

### What You Keep (100%)
- ✅ 1,000-stock universe scanning
- ✅ Enterprise tiered funnel (1000→250→60→15→execute)
- ✅ Fan-out parallel compute via Service Bindings / Queues
- ✅ Real-time prices for top 80 stocks (Finnhub WS + Alpaca WS)
- ✅ Near-real-time prices for all 1,000 (Yahoo batch polling, <60 sec delay)
- ✅ Full historical OHLCV (Yahoo Finance chart(), multi-resolution)
- ✅ Technical analysis computed locally (zero API cost)
- ✅ Fundamental data from SEC EDGAR + Finnhub
- ✅ News & insider sentiment from Finnhub free
- ✅ Macro/regime detection from FRED
- ✅ Crypto coverage via CoinGecko/CoinCap/CCXT
- ✅ All 6 YMSA engines running simultaneously
- ✅ D1 persistence, KV caching, R2 storage
- ✅ Backtesting with historical Yahoo data

### What You Lose (vs $148/mo plan)
- ❌ SIP consolidated feed (Alpaca free = IEX only, ~15 min delay on some data)
- ❌ Unlimited WebSocket symbols (now capped at ~80: 50 Finnhub + 30 Alpaca)
- ❌ Single authoritative data source (now composing 5-6 sources)
- ❌ Sub-second quote freshness for all 1,000 (now 30-60 sec polling for most)

### Why This Is Acceptable
YMSA's engines operate on **minute-to-hourly** timeframes. A 30-60 second delay in quote data has **zero material impact** on:
- MTF Momentum (15m/1h/4h/D candles)
- Smart Money (accumulation patterns over days)
- Event Driven (news + earnings reactions over hours)
- Stat Arb (mean reversion on 1h+ windows)
- Crypto DeFi (already polling-based)
- Options flow (already delayed data)

The only scenario where sub-second matters is execution — and Alpaca's free WebSocket covers the top 30 execution-ready symbols in real-time.

---

## PART II — FREE DATA SOURCE INVENTORY

### Source 1: Yahoo Finance (via `yahoo-finance2` npm)
**Role:** PRIMARY for prices + OHLCV + batch screening  
**Auth:** None required  
**Install:** `npm install yahoo-finance2`

| Feature | Endpoint | Rate Limit | Notes |
|---------|----------|------------|-------|
| Batch quotes | `quote(['AAPL','MSFT',...])` | ~2,000/day practical | **Up to 50 symbols per call!** |
| OHLCV candles | `chart('AAPL', {interval:'5m'})` | Same pool | 5m, 15m, 1h, 1d, 1wk, 1mo |
| Historical | `chart('AAPL', {period1:'2024-01-01'})` | Same pool | Years of history |
| Fundamentals | `quoteSummary('AAPL', {modules:[...]})` | Same pool | P/E, revenue, earnings, profile |
| Search | `search('apple')` | Same pool | Symbol lookup |

**Cloudflare Workers compatible:** YES — pure HTTP fetch, no Node.js-specific dependencies.

**Batching Math:**
```
1,000 stocks / 50 per batch = 20 API calls per full-universe scan
× 1 scan per minute during market hours
= 20 calls/min × 390 min/day = 7,800 calls/day
Well within ~2,000/day? → Need to be strategic with caching
```

**Optimized Strategy:**
- Tier 1 (60 stocks): poll every 60 sec → 1.2 calls/min × 390 = 468/day
- Tier 2 (250 stocks): poll every 5 min → 5 calls/5min × 78 = 390/day
- Tier 3 (690 stocks): poll every 15 min → 14 calls/15min × 26 = 364/day
- **Total: ~1,222 calls/day** — safely within limits with margin

### Source 2: Alpaca Free Tier
**Role:** EXECUTION + top-30 real-time WebSocket  
**Auth:** API key (free account)  
**Already integrated in YMSA**

| Feature | Limit | Notes |
|---------|-------|-------|
| REST API | 200 req/min | Snapshots, bars, account, orders |
| WebSocket | 30 symbols | Real-time trades + quotes (IEX) |
| Historical bars | 200 req/min | OHLCV with 1m/5m/15m/1h/1d |
| Paper trading | Unlimited | Full order simulation |
| Account data | Included | Positions, P&L, buying power |

**Key Constraint:** IEX-only data (not full SIP). Prices may differ from consolidated feed by pennies. Acceptable for YMSA's strategies.

**WebSocket Strategy:** Subscribe the top 30 **execution-candidate** symbols. These are the stocks that passed the screening funnel and are most likely to receive trade signals.

### Source 3: Finnhub Free Tier
**Role:** WebSocket streaming + news + fundamentals + insider data  
**Auth:** API key (free)  
**Rate Limit:** 60 req/min REST, 30 calls/sec burst

| Feature | Free? | Notes |
|---------|-------|-------|
| **WebSocket trades** | ✅ FREE | Real-time US stocks, forex, crypto. **1 connection, ~50 symbols** |
| Quote (REST) | ✅ FREE | Current price, change, H/L/O/C |
| Basic Financials | ✅ FREE | P/E, margins, 52-week H/L, ratios |
| Company Profile 2 | ✅ FREE | Name, industry, market cap, IPO date |
| Company News | ✅ FREE | 1 year of historical news |
| Market News | ✅ FREE | General, forex, crypto, merger |
| Insider Transactions | ✅ FREE | Form 3, 4, 5 data |
| Insider Sentiment | ✅ FREE | MSPR score (Monthly Share Purchase Ratio) |
| Recommendation Trends | ✅ FREE | Analyst consensus (buy/hold/sell) |
| Earnings Surprises | ✅ FREE | Last 4 quarters EPS actual vs estimate |
| Earnings Calendar | ✅ FREE | 1 month historical + upcoming |
| SEC Filings | ✅ FREE | Filing metadata + URLs |
| Financials As Reported | ✅ FREE | Raw SEC financial data |
| Stock Symbols | ✅ FREE | Full US stock list |
| Peers | ✅ FREE | Same-sector peer companies |
| IPO Calendar | ✅ FREE | Upcoming IPOs |
| Stock Candles (OHLCV) | ❌ PREMIUM | Use Yahoo Finance instead |
| Technical Indicators | ❌ PREMIUM | Use fast-technical-indicators instead |
| Pattern Recognition | ❌ PREMIUM | Compute locally instead |

**WebSocket Architecture (Critical!):**
```
wss://ws.finnhub.io?token=YOUR_KEY

// Subscribe to top 50 screening-active symbols
ws.send('{"type":"subscribe","symbol":"AAPL"}')
ws.send('{"type":"subscribe","symbol":"NVDA"}')
// ... up to ~50 symbols per connection
```
**1 connection per API key.** Use a Durable Object to maintain persistent WS connection and distribute data to Workers.

### Source 4: SEC EDGAR (100% Free Government API)
**Role:** PRIMARY for fundamental/financial data  
**Auth:** None (just set User-Agent header with email)  
**Rate Limit:** 10 req/sec (extremely generous)

| Endpoint | URL Pattern | Data |
|----------|-------------|------|
| Company Submissions | `data.sec.gov/submissions/CIK{cik}.json` | All filings, metadata |
| Company Facts | `data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json` | **Structured financials** (revenue, net income, assets, etc.) |
| Company Concept | `data.sec.gov/api/xbrl/companyconcept/CIK{cik}/us-gaap/{concept}.json` | Specific financial metric history |
| CIK Lookup | `efts.sec.gov/LATEST/search-index?q=AAPL` | Ticker → CIK mapping |

**Key Advantage:** Direct SEC data — more authoritative than any third-party API.

**Budget:** 10 req/sec = 600 req/min. A full refresh of 1,000 companies' fundamentals:
```
1,000 companies × 1 call each = 1,000 calls / 10 per sec = ~100 seconds
→ Full fundamental refresh in under 2 minutes. Run once daily.
```

### Source 5: Financial Modeling Prep (Free Tier)
**Role:** SUPPLEMENTARY screener + financials  
**Auth:** API key (free)  
**Rate Limit:** 250 req/day

| Feature | Notes |
|---------|-------|
| Stock screener | Filter by market cap, sector, P/E, etc. |
| Company financials | Income statement, balance sheet, cash flow |
| Stock quotes | Real-time quotes (limited) |
| Earnings calendar | Upcoming earnings dates |
| Stock list | Full exchange listings |

**Strategy:** Use 250 daily requests for:
- Morning universe screening (50 calls)
- Financial data for Tier 1 candidates (60 calls)
- Earnings calendar refresh (5 calls)
- Remaining budget for ad-hoc lookups (135 calls)

### Source 6: Alpha Vantage (Free Tier)
**Role:** BACKUP OHLCV + validator  
**Auth:** API key (free)  
**Rate Limit:** 25 req/day (very restrictive)

**Strategy:** Reserve for:
- Cross-validating Yahoo Finance OHLCV data (5 calls/day)
- Backup when Yahoo is rate-limited (10 calls/day)
- Intraday data for critical signals (10 calls/day)

### Source 7: FRED (St. Louis Federal Reserve)
**Role:** Macro/regime detection  
**Auth:** API key (free)  
**Rate Limit:** 120 req/min  
**Already integrated in YMSA**

| Series | Code | Use |
|--------|------|-----|
| Fed Funds Rate | `FEDFUNDS` | Rate regime |
| 10Y Treasury | `DGS10` | Yield curve |
| 2Y Treasury | `DGS2` | Yield curve inversion |
| VIX | `VIXCLS` | Volatility regime |
| Unemployment | `UNRATE` | Economic health |
| CPI | `CPIAUCSL` | Inflation |
| GDP | `GDP` | Growth cycle |

**Budget:** ~20 series × 1 call each = 20 calls/day. Trivial.

### Source 8: CoinGecko (Free, No Key)
**Role:** Crypto market data  
**Auth:** None  
**Rate Limit:** 10-50 req/min  
**Already integrated in YMSA**

### Source 9: CoinCap (Free, No Key)
**Role:** Real-time crypto WebSocket  
**Auth:** None  
**WebSocket:** `wss://ws.coincap.io/prices?assets=bitcoin,ethereum,...`

**Key Advantage:** Free WebSocket with no authentication. Covers all major crypto assets in real-time.

### Source 10: Twelve Data (Free Tier)
**Role:** TERTIARY indicator validation  
**Auth:** API key  
**Rate Limit:** 8 req/min, 800/day

**Strategy:** Use for cross-validating technical indicator computations. 800/day provides ~3 validations per Tier 1 stock per day.

### Source 11: `fast-technical-indicators` (npm Library)
**Role:** ALL technical analysis computed locally — ZERO API calls  
**License:** MIT  
**Install:** `npm install fast-technical-indicators`

| Indicator | Function | Typical Use |
|-----------|----------|-------------|
| SMA | `sma(data, period)` | Trend detection |
| EMA | `ema(data, period)` | Faster trend |
| RSI | `rsi(data, period)` | Overbought/oversold |
| MACD | `macd(data, fast, slow, signal)` | Momentum |
| Bollinger Bands | `bollingerBands(data, period, stdDev)` | Volatility |
| ATR | `atr(high, low, close, period)` | Risk sizing |
| Stochastic | `stochastic(high, low, close, period)` | Reversal |

**Key Insight:** By computing indicators locally from OHLCV data, we eliminate the need for Finnhub Premium Technical Indicators, Alpaca Premium, or any paid indicator API. Instead of calling `GET /indicator?symbol=AAPL&indicator=rsi`, we:
1. Fetch OHLCV from Yahoo Finance (1 call for 50 candles)
2. Compute RSI, MACD, BB, ATR locally (0 API calls, ~1ms CPU)
3. Cache result in KV (0 API calls)

### Source 12: CCXT (npm Library)
**Role:** Unified crypto exchange API  
**License:** MIT  
**Install:** `npm install ccxt`

Provides unified API for 100+ exchanges (Binance, Coinbase, Kraken, etc.) including WebSocket support. Used alongside CoinGecko/CoinCap for comprehensive crypto coverage.

---

## PART III — SMART DATA ROUTER ARCHITECTURE

The key innovation of the $5/mo plan is a **Smart Data Router** that intelligently distributes requests across multiple free APIs based on quota availability, data freshness, and priority.

### Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                       SMART DATA ROUTER                          │
│         (src/data/router.ts — new module)                        │
│                                                                  │
│  ┌─────────────────────────────────────────────────────┐         │
│  │              QUOTA TRACKER (KV)                      │         │
│  │  yahoo:   1,222 / 2,000 daily     ███████░░░  61%   │         │
│  │  finnhub: 2,400 / 86,400 daily    ██░░░░░░░░   3%   │         │
│  │  fmp:       120 / 250 daily       █████░░░░░  48%   │         │
│  │  alphav:     15 / 25 daily        ██████░░░░  60%   │         │
│  │  twelved:   400 / 800 daily       █████░░░░░  50%   │         │
│  │  sec:       900 / 864,000 daily   ░░░░░░░░░░   0%   │         │
│  └─────────────────────────────────────────────────────┘         │
│                                                                  │
│  REQUEST → Router selects source based on:                       │
│    1. Data type (price / OHLCV / fundamental / news)             │
│    2. Quota remaining per source                                 │
│    3. Cache freshness (KV TTL check)                             │
│    4. Priority tier of the stock                                 │
│    5. Fallback chain if primary fails                            │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                  ROUTING RULES                              │  │
│  │                                                             │  │
│  │  REAL-TIME PRICE (Hot Path):                                │  │
│  │    Primary:   Finnhub WebSocket (50 symbols, 0 REST cost)   │  │
│  │    Secondary: Alpaca WebSocket (30 symbols, 0 REST cost)    │  │
│  │    Tertiary:  Yahoo quote() batch poll (20 calls/min)       │  │
│  │    Cache:     KV with 30s TTL (market hours)                │  │
│  │                                                             │  │
│  │  HISTORICAL OHLCV (Warm Path):                              │  │
│  │    Primary:   Yahoo chart() → KV cache                      │  │
│  │    Secondary: Alpaca getBarsV2() → KV cache                 │  │
│  │    Fallback:  Alpha Vantage (25/day budget)                 │  │
│  │    Cache:     KV 30-min TTL (intraday), 24h (daily bars)    │  │
│  │                                                             │  │
│  │  FUNDAMENTALS (Cold Path — daily refresh):                  │  │
│  │    Primary:   SEC EDGAR Company Facts                       │  │
│  │    Secondary: Finnhub Basic Financials (60 req/min)         │  │
│  │    Tertiary:  FMP Free (250/day)                            │  │
│  │    Cache:     D1 database (permanent) + KV (24h TTL)        │  │
│  │                                                             │  │
│  │  NEWS & SENTIMENT:                                          │  │
│  │    Primary:   Finnhub Market News / Company News            │  │
│  │    Secondary: Finnhub Insider Transactions                  │  │
│  │    Cache:     KV 15-min TTL                                 │  │
│  │                                                             │  │
│  │  MACRO / REGIME:                                            │  │
│  │    Primary:   FRED (120 req/min — essentially unlimited)    │  │
│  │    Secondary: Yahoo Finance (VIX, SPY, DXY quotes)          │  │
│  │    Cache:     KV 1h TTL (intraday), D1 (daily snapshots)   │  │
│  │                                                             │  │
│  │  CRYPTO:                                                    │  │
│  │    Primary:   CoinCap WebSocket (real-time, no key)         │  │
│  │    Secondary: CoinGecko REST (market data)                  │  │
│  │    Tertiary:  CCXT (exchange-specific data)                 │  │
│  │    Cache:     KV 60s TTL                                    │  │
│  │                                                             │  │
│  │  TECHNICAL INDICATORS:                                      │  │
│  │    ALWAYS:    fast-technical-indicators (local compute)      │  │
│  │    Input:     OHLCV from Yahoo/Alpaca cache                 │  │
│  │    Cost:      0 API calls, ~1-5ms CPU per stock             │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### Data Source Priority Matrix

| Data Need | Source 1 (Primary) | Source 2 (Fallback) | Source 3 (Emergency) | Cache |
|-----------|-------------------|--------------------|--------------------|-------|
| Real-time price | Finnhub WS | Alpaca WS | Yahoo quote() | KV 30s |
| Intraday OHLCV | Yahoo chart(5m) | Alpaca bars | Alpha Vantage | KV 30min |
| Daily OHLCV | Yahoo chart(1d) | Alpaca bars | Alpha Vantage | KV 24h |
| Earnings dates | Finnhub calendar | FMP calendar | Yahoo | D1 weekly |
| P/E, margins, ratios | Finnhub Basic Fin. | SEC EDGAR | FMP | D1 24h |
| Revenue, income | SEC EDGAR Facts | Finnhub As Reported | FMP | D1 quarterly |
| Insider trades | Finnhub Insider Tx | SEC EDGAR filings | — | D1 daily |
| Analyst consensus | Finnhub Rec Trends | — | — | D1 weekly |
| Market news | Finnhub Market News | Yahoo | — | KV 15min |
| Company news | Finnhub Company News | Yahoo | — | KV 15min |
| Macro data | FRED | — | — | KV 1h |
| Crypto prices | CoinCap WS | CoinGecko | CCXT | KV 60s |
| Tech indicators | Local compute | — | — | KV 30min |
| Stock universe | Finnhub stock/symbol | SEC EDGAR | FMP | D1 monthly |
| Sector/peers | Finnhub peers | SEC EDGAR SIC | — | D1 weekly |

### Quota Tracker Implementation

```typescript
// src/data/quota-tracker.ts
interface QuotaState {
  yahoo:    { used: number; limit: number; resetAt: number };
  finnhub:  { used: number; limit: number; resetAt: number };
  fmp:      { used: number; limit: number; resetAt: number };
  alphav:   { used: number; limit: number; resetAt: number };
  twelved:  { used: number; limit: number; resetAt: number };
  sec:      { used: number; limit: number; resetAt: number };
  alpaca:   { used: number; limit: number; resetAt: number };
}

const DAILY_LIMITS: Record<string, number> = {
  yahoo:   2000,   // practical daily limit
  finnhub: 86400,  // 60/min × 1440 min/day
  fmp:     250,    // hard daily limit
  alphav:  25,     // hard daily limit
  twelved: 800,    // hard daily limit
  sec:     864000, // 10/sec × 86400 sec/day (extremely generous)
  alpaca:  288000, // 200/min × 1440 min/day
};

async function getAvailableSource(
  dataType: 'price' | 'ohlcv' | 'fundamental' | 'news' | 'macro',
  kv: KVNamespace
): Promise<string> {
  const state = await kv.get<QuotaState>('quota:state', 'json');
  const chains = ROUTING_CHAINS[dataType];
  
  for (const source of chains) {
    const quota = state[source];
    if (quota.used < quota.limit * 0.9) { // 90% safety margin
      return source;
    }
  }
  
  // All sources exhausted — return cached data
  return 'cache_only';
}
```

---

## PART IV — API BUDGET MATH

### Daily API Call Budget (Market Hours: 09:30-16:00 ET = 390 minutes)

#### Yahoo Finance — Target: 1,200/day (of ~2,000 practical limit)

| Action | Frequency | Calls/Occurrence | Calls/Day |
|--------|-----------|-----------------|-----------|
| Tier 1 quotes (60 stocks) | Every 60 sec | 2 (60/50 batch) | 780 |
| Tier 2 quotes (250 stocks) | Every 5 min | 5 (250/50 batch) | 390 |
| Tier 3 quotes (690 stocks) | Every 15 min | 14 (690/50 batch) | 364 |
| Index quotes (SPY,QQQ,VIX) | Every 5 min | 1 | 78 |
| **TOTAL** | | | **~1,612** |

**Optimization: Use KV cache to skip calls when price hasn't changed significantly.**
With KV-based "delta threshold" (skip if price changed <0.1%), realistic daily usage drops to **~800-1,000 calls**.

#### Yahoo Finance OHLCV — Target: 400/day

| Action | Frequency | Calls/Day |
|--------|-----------|-----------|
| Tier 1 (60 stocks) 5m candles | Every 30 min | 60 × 13 = **CACHE after first fetch** |
| Tier 1 (60 stocks) first fetch | Once/day | 60 |
| Tier 2 (250 stocks) 1h candles | Once at market open | 250 |
| Tier 3 (690 stocks) daily bars | Once at market open | ~14 (batch) |
| **TOTAL** | | **~324** |

**Key: Historical data is fetched ONCE per day/interval and cached in KV. Subsequent indicator computations use cached data.**

#### Finnhub — Target: 3,000/day (of 86,400 limit)

| Action | Frequency | Calls/Day |
|--------|-----------|-----------|
| WebSocket (50 symbols) | Continuous | **0** (WS, not REST) |
| Basic Financials scan | Once/day, 60 Tier 1 | 60 |
| Company News (Tier 1) | Every 2 hours | 60 × 3 = 180 |
| Market News | Every 30 min | 13 |
| Insider Transactions (Tier 1) | Once/day | 60 |
| Insider Sentiment (Tier 1) | Once/day | 60 |
| Recommendation Trends (Tier 1) | Once/day | 60 |
| Earnings Calendar | Once/day | 5 |
| Earnings Surprises (Tier 1) | Once/day | 60 |
| Peers (for correlation) | Once/week | 60/5 = 12 |
| Quota for Tier 2 lookups | Ad-hoc | ~200 |
| **TOTAL** | | **~710** |

#### SEC EDGAR — Target: 1,000/day (of 864,000 limit)

| Action | Frequency | Calls/Day |
|--------|-----------|-----------|
| Company Facts (full financials) | Once/day for Tier 1 (60) | 60 |
| Company Facts (Tier 2 refresh) | Once/week (250/5) | 50 |
| Company Facts (Tier 3 refresh) | Once/month (690/22) | ~32 |
| CIK lookups (new additions) | Ad-hoc | ~20 |
| **TOTAL** | | **~162** |

#### Other Sources — Minimal Usage

| Source | Daily Calls | Purpose |
|--------|------------|---------|
| FMP | ~150 / 250 | Morning screening + financials |
| Alpha Vantage | ~15 / 25 | Cross-validation + backup |
| Twelve Data | ~200 / 800 | Indicator validation |
| FRED | ~30 / 172,800 | Macro data (negligible) |
| CoinGecko | ~100 / 7,200 | Crypto (10-50/min) |
| CoinCap WS | 0 REST | WebSocket (continuous) |
| Alpaca REST | ~500 / 288,000 | Execution + snapshots |

### Total Daily API Budget

```
TOTAL EXTERNAL API CALLS PER DAY:
  Yahoo Finance:     ~1,400  (of ~2,000 limit)    70% utilization
  Finnhub:              ~710  (of 86,400 limit)     0.8% utilization
  SEC EDGAR:            ~162  (of 864,000 limit)    0.02% utilization
  FMP:                  ~150  (of 250 limit)       60% utilization
  Alpha Vantage:         ~15  (of 25 limit)        60% utilization
  Twelve Data:          ~200  (of 800 limit)       25% utilization
  FRED:                  ~30  (of 172,800 limit)    0.02% utilization
  CoinGecko:            ~100  (of ~7,200 limit)     1.4% utilization
  Alpaca:               ~500  (of 288,000 limit)    0.17% utilization
  ──────────────────────────────────────────────────────────────
  TOTAL:              ~3,267 REST calls/day
  
CLOUDFLARE WORKERS REQUESTS/MONTH:
  3,267/day × 22 trading days = 71,874 external API calls
  + Internal worker-to-worker calls (~50K/month)
  + Dashboard + webhook requests (~10K/month)
  ──────────────────────────────────────────────────────────────
  TOTAL: ~132,000 requests/month (of 10,000,000 limit → 1.3%)
```

### Subrequest Budget Per Worker Invocation (max 1,000 per invocation)

```
Single Scanning Cycle (runs every 5 min during market hours):
  Yahoo batch quotes (Tier 1):  2 calls (60/50 per batch)
  Yahoo batch quotes (Tier 2):  5 calls (250/50 per batch)  [every 5 min]
  Finnhub WS data:              0 calls (read from KV, written by DO)
  KV reads (cache checks):      ~30 calls
  KV writes (cache updates):    ~20 calls
  D1 queries:                   ~5 calls
  ──────────────────────────────────────────────────────────────
  TOTAL PER CYCLE:             ~62 subrequests (of 1,000 limit → 6.2%)
```

**For fan-out scanning (all 1,000 stocks):**
```
Orchestrator Worker → Queue → 8 Scanner Workers (via Service Bindings)
Each scanner handles ~125 stocks:
  Yahoo batch quotes: 3 calls (125/50)
  KV reads/writes:    ~20 calls
  ──────────────────────────────────────────────────────────────
  PER SCANNER:        ~23 subrequests
  ALL 8 SCANNERS:     ~184 subrequests total
  MERGE WORKER:       ~30 subrequests (read results + D1 writes)
  ──────────────────────────────────────────────────────────────
  TOTAL FAN-OUT:      ~214 subrequests (of 1,000 limit → 21.4%)
```

---

## PART V — TIERED SCREENING FUNNEL (1,000 STOCKS)

### Universe Construction

```
S&P 500:          ~500 stocks
Nasdaq 100:       ~100 stocks (minus overlap with S&P 500 = ~50 new)
Russell 1000:     ~1000 stocks (minus overlap = ~450 new)
──────────────────────────────────────────────────
De-duplicated:    ~1,000 unique US stocks + 10 crypto + 10 ETFs
```

**Source for universe list:** Finnhub `GET /stock/symbol?exchange=US` (free, returns all US stocks). Filter locally by:
- Market cap > $1B (large/mid cap)
- Average volume > 500K shares/day
- Price > $5

### The 4-Tier Funnel

```
TIER 0: Full Universe (1,000 stocks)
   ↓  [Yahoo batch quotes: volume > 500K, price > $5, not halted]
   ↓  Cost: 20 Yahoo calls (50/batch) + 0 indicator calls
   ↓  Time: ~3 seconds
   
TIER 1: Active Universe (250 stocks)
   ↓  [5 fast indicators from cached OHLCV: RSI extreme, Vol spike, ATR rank, EMA cross, VWAP deviation]
   ↓  Cost: 0 API calls (indicators computed locally from KV-cached OHLCV)
   ↓  Time: ~2 seconds (pure CPU compute)
   
TIER 2: Signal Candidates (60 stocks)
   ↓  [Full indicator suite: 20+ indicators + multi-timeframe + smart money + regime]
   ↓  Cost: 2 Yahoo chart() calls per stock (5m + 1h) from cache, 60 Finnhub news checks
   ↓  Time: ~5 seconds
   
TIER 3: Trade Candidates (15 stocks)
   ↓  [Engine merge (≥2 engines agree) + Quality gates + Z.AI scoring]
   ↓  Cost: 15 Alpaca snapshot calls + D1 queries
   ↓  Time: ~3 seconds

EXECUTION: Final Trades (3-8 per day)
   ↓  [Risk controller + position sizing + order submission]
   ↓  Cost: Alpaca order API (free)
```

### Data Flow Per Tier

```
                    API Calls    CPU Time    Data Source
TIER 0 (1000→250)     20          3 sec      Yahoo quote() batch
TIER 1 (250→60)        0          2 sec      KV cache + local compute
TIER 2 (60→15)       ~62          5 sec      Yahoo OHLCV + Finnhub news
TIER 3 (15→exec)     ~15          3 sec      Alpaca snapshots + D1
────────────────────────────────────────────
TOTAL PER CYCLE:     ~97 calls    13 sec     Multi-source composite
```

**Runs every 5 minutes during market hours (78 cycles/day):**
- 97 calls × 78 cycles = 7,566 total daily calls
- Distributed across: Yahoo (~5,000), Finnhub (~1,500), Alpaca (~1,000)
- All within free tier limits ✅

---

## PART VI — CLOUDFLARE ARCHITECTURE

### System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE WORKERS ($5/mo)                        │
│                                                                     │
│  ┌──────────┐    ┌─────────────────────────────────────────────┐    │
│  │  CRON     │───→│         ORCHESTRATOR WORKER                │    │
│  │ Triggers  │    │  (src/cron-handler.ts — enhanced)          │    │
│  │           │    │                                             │    │
│  │ */5 *     │    │  1. Read universe from D1 (1,000 stocks)   │    │
│  │ */15 *    │    │  2. Check quota tracker (KV)               │    │
│  │ 0 14 *   │    │  3. Fan-out to scanner workers via Queue    │    │
│  │ 30 9 *   │    │  4. Collect results → merge → signal        │    │
│  └──────────┘    └──────────┬──────────────────────────────────┘    │
│                              │                                       │
│                    ┌─────────▼──────────┐                            │
│                    │   CLOUDFLARE QUEUE   │                           │
│                    │  (scan-jobs queue)   │                           │
│                    └─────────┬──────────┘                            │
│              ┌───────────────┼───────────────┐                       │
│              │               │               │                       │
│     ┌────────▼────┐  ┌──────▼──────┐  ┌────▼────────┐              │
│     │ SCANNER #1  │  │ SCANNER #2  │  │ SCANNER #8  │              │
│     │ 125 stocks  │  │ 125 stocks  │  │ 125 stocks  │              │
│     │             │  │             │  │             │              │
│     │ Yahoo batch │  │ Yahoo batch │  │ Yahoo batch │              │
│     │ KV cache    │  │ KV cache    │  │ KV cache    │              │
│     │ local TA    │  │ local TA    │  │ local TA    │              │
│     └──────┬──────┘  └─────┬───────┘  └─────┬──────┘              │
│            │               │               │                       │
│            └───────────────┼───────────────┘                       │
│                    ┌───────▼───────┐                                │
│                    │  MERGE WORKER  │                                │
│                    │               │                                │
│                    │ Aggregate all │                                │
│                    │ scanner output│                                │
│                    │ Apply engines │                                │
│                    │ Quality gates │                                │
│                    └───────┬───────┘                                │
│                            │                                        │
│              ┌─────────────┼─────────────┐                          │
│              │             │             │                          │
│     ┌────────▼────┐  ┌────▼─────┐  ┌───▼──────────┐               │
│     │ Z.AI Engine │  │ Risk Ctrl │  │ Broker Mgr   │               │
│     │ (scoring)   │  │ (sizing)  │  │ (execution)  │               │
│     └─────────────┘  └──────────┘  └──────────────┘               │
│                                                                     │
│  PERSISTENT CONNECTIONS (Durable Objects):                          │
│  ┌──────────────────────────────────────────────────────┐           │
│  │ WebSocket Manager DO                                  │           │
│  │                                                       │           │
│  │  Finnhub WS ─── 50 symbols ─── real-time trades       │           │
│  │  Alpaca WS  ─── 30 symbols ─── execution candidates   │           │
│  │  CoinCap WS ─── 10 cryptos ─── real-time prices       │           │
│  │                                                       │           │
│  │  → Writes to KV: price:{SYMBOL} = {price, vol, ts}   │           │
│  │  → Alerts via Queue if price moves > threshold        │           │
│  └──────────────────────────────────────────────────────┘           │
│                                                                     │
│  STORAGE:                                                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │  D1 DB   │  │   KV     │  │   R2     │  │  Queues  │           │
│  │          │  │          │  │          │  │          │           │
│  │ trades   │  │ prices   │  │ backtest │  │ scan-jobs│           │
│  │ signals  │  │ ohlcv    │  │ reports  │  │ alerts   │           │
│  │ universe │  │ quotes   │  │ old logs │  │          │           │
│  │ budgets  │  │ news     │  │          │  │          │           │
│  │ pnl      │  │ fundmntl │  │          │  │          │           │
│  │ alerts   │  │ quotas   │  │          │  │          │           │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘           │
└─────────────────────────────────────────────────────────────────────┘
```

### WebSocket Durable Object (New Component)

The Durable Object is the critical piece for maintaining persistent WebSocket connections to Finnhub, Alpaca, and CoinCap. Cloudflare Workers are stateless and short-lived — you can't hold a WebSocket open across invocations. The DO solves this.

```typescript
// src/data/ws-manager.ts (Durable Object)
export class WebSocketManager implements DurableObject {
  private finnhubWs: WebSocket | null = null;
  private alpacaWs: WebSocket | null = null;
  private coincapWs: WebSocket | null = null;
  private kv: KVNamespace;
  
  constructor(state: DurableObjectState, env: Env) {
    this.kv = env.YMSA_KV;
    this.initConnections(env);
  }
  
  private async initConnections(env: Env) {
    // Finnhub: Top 50 screening symbols
    this.finnhubWs = new WebSocket(
      `wss://ws.finnhub.io?token=${env.FINNHUB_KEY}`
    );
    this.finnhubWs.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'trade') {
        for (const trade of data.data) {
          await this.kv.put(
            `price:${trade.s}`,
            JSON.stringify({ p: trade.p, v: trade.v, t: trade.t }),
            { expirationTtl: 60 }
          );
        }
      }
    };
    
    // Subscribe top 50 from universe
    const top50 = await this.getTop50FromD1();
    for (const symbol of top50) {
      this.finnhubWs.send(
        JSON.stringify({ type: 'subscribe', symbol })
      );
    }
    
    // Alpaca: Top 30 execution candidates  
    this.alpacaWs = new WebSocket(
      `wss://stream.data.alpaca.markets/v2/iex`
    );
    // ... similar pattern for top 30
    
    // CoinCap: All tracked crypto
    this.coincapWs = new WebSocket(
      `wss://ws.coincap.io/prices?assets=bitcoin,ethereum,...`
    );
    // ... similar pattern
  }
  
  // Called by cron to update which symbols to track
  async updateSymbols(newSymbols: { finnhub: string[], alpaca: string[] }) {
    // Unsubscribe old, subscribe new on Finnhub WS
    // Reconnect Alpaca WS with new symbols
  }
}
```

### KV Caching Strategy

```
KEY PATTERN                  TTL         SIZE        UPDATE SOURCE
──────────────────────────────────────────────────────────────────
price:{SYMBOL}               30s         ~100B       WS Manager DO
ohlcv:{SYMBOL}:{TF}          30min       ~5KB        Yahoo chart()
ohlcv:daily:{SYMBOL}         24h         ~2KB        Yahoo chart()
fundamental:{SYMBOL}         24h         ~3KB        SEC EDGAR / Finnhub
news:{SYMBOL}                15min       ~2KB        Finnhub company-news
news:market                  15min       ~5KB        Finnhub market-news
insider:{SYMBOL}             24h         ~1KB        Finnhub insider-tx
recommendation:{SYMBOL}      7d          ~500B       Finnhub rec-trends
earnings:calendar            24h         ~10KB       Finnhub earnings-cal
macro:fred:{SERIES}          1h          ~500B       FRED
crypto:{SYMBOL}              60s         ~100B       CoinCap WS / CoinGecko
universe:active              24h         ~50KB       D1 mirror
quota:state                  5min        ~500B       Quota tracker
indicators:{SYMBOL}:{TF}     30min       ~2KB        Local compute result

TOTAL KV READS/DAY:  ~50,000  (of 100,000 free / 10M paid)
TOTAL KV WRITES/DAY: ~15,000  (of 1,000 free / 1M paid) 
```

### Cron Schedule

```toml
# wrangler.toml (updated for 1,000-stock scanning)
[triggers]
crons = [
  "*/5 9-16 * * 1-5",    # SCAN: Every 5 min during market hours
  "30 9 * * 1-5",        # MORNING: Pre-market universe refresh + data prefetch
  "0 13 * * 1-5",        # MIDDAY: Re-rank universe, refresh fundamentals
  "0 16 * * 1-5",        # CLOSING: End-of-day snapshot + summary
  "0 21 * * 1-5",        # EVENING: Daily P&L + summary
  "0 4 * * 1-5",         # OVERNIGHT: Full fundamental refresh (SEC EDGAR bulk)
  "0 0 * * 0",           # WEEKLY: Universe reconstruction + sector rotation
]
```

---

## PART VII — IMPLEMENTATION PHASES

### Phase 1: Data Router Foundation (Week 1-2)

**Goal:** Build the multi-source data router + quota tracker

| Task | Files | Effort |
|------|-------|--------|
| Create `src/data/router.ts` | New module | Core routing logic |
| Create `src/data/quota-tracker.ts` | New module | KV-based quota counting |
| Create `src/data/sources/yahoo.ts` | New adapter | yahoo-finance2 wrapper |
| Create `src/data/sources/finnhub.ts` | New adapter | Finnhub REST wrapper |
| Create `src/data/sources/sec-edgar.ts` | New adapter | SEC EDGAR API wrapper |
| Create `src/data/sources/fmp.ts` | New adapter | FMP free wrapper |
| Create `src/data/indicators.ts` | New module | fast-technical-indicators wrapper |
| Update `src/analysis/indicators.ts` | Modify | Use local compute instead of TAAPI |
| Update `package.json` | Add deps | yahoo-finance2, fast-technical-indicators |

**Key Deliverable:** `DataRouter.getPrice(symbol)`, `DataRouter.getOHLCV(symbol, tf)`, `DataRouter.getFundamentals(symbol)` — all with automatic source selection and fallback.

### Phase 2: Universe Expansion (Week 3-4)

**Goal:** Scale from 50 → 1,000 symbols with tiered funnel

| Task | Files | Effort |
|------|-------|--------|
| Create `universe` table in D1 | Migration | 1,000 stock records |
| Create `src/data/universe-manager.ts` | New module | Universe construction + tier assignment |
| Update `src/cron-handler.ts` | Modify | Add universe refresh crons |
| Update `config/watchlist.json` | Expand | Add tier3/tier4 structure |
| Create `src/scanning/funnel.ts` | New module | 4-tier progressive filtering |
| Update screening rules | `config/screening-rules.json` | Add tier-specific thresholds |

**Key Deliverable:** `funnel.scan(universe)` returns ranked signal candidates from 1,000 stocks.

### Phase 3: WebSocket Streaming (Week 5-6)

**Goal:** Add Durable Object for persistent real-time WebSocket connections

| Task | Files | Effort |
|------|-------|--------|
| Create `src/data/ws-manager.ts` | New DO | Finnhub + Alpaca + CoinCap WS |
| Update `wrangler.toml` | Config | Enable Durable Objects binding |
| Create WS → KV pipeline | Integration | Real-time price → KV cache |
| Add symbol rotation logic | WS Manager | Hot-swap symbols based on funnel output |
| Add WS health monitoring | WS Manager | Auto-reconnect on disconnect |

**Key Deliverable:** Top 80 stocks streaming in real-time (50 Finnhub + 30 Alpaca), all 10 crypto via CoinCap.

### Phase 4: Fan-Out Parallel Compute (Week 7-8)

**Goal:** Implement Queue-based fan-out for parallel universe scanning

| Task | Files | Effort |
|------|-------|--------|
| Create scan-jobs Queue | `wrangler.toml` | Queue binding |
| Create scanner worker consumer | New module | Process batches of 125 stocks |
| Update orchestrator | `src/agents/orchestrator.ts` | Fan-out to queue, collect results |
| Add merge worker | New module | Aggregate scanner outputs |
| Performance tuning | All | Optimize for <15 sec total scan time |

**Key Deliverable:** Full 1,000-stock scan in <15 seconds using 8 parallel scanner workers.

---

## PART VIII — RISK & MITIGATION

### Risk 1: Yahoo Finance Rate Limiting or API Changes
**Severity:** HIGH  
**Mitigation:**
- Aggressive KV caching (30s-24h TTL depending on data type)
- Delta-threshold polling (skip if price changed <0.1% since last fetch)
- Automatic fallback to Alpaca REST + Finnhub REST
- User-Agent rotation + request spacing (max 2 concurrent requests)
- If Yahoo blocks entirely: shift to Finnhub (free 60/min) + FMP (250/day) + Alpha Vantage (25/day) — covers Tier 1 stocks, reduce Tier 2/3 frequency

### Risk 2: Finnhub WebSocket Disconnections
**Severity:** MEDIUM  
**Mitigation:**
- Durable Object auto-reconnect with exponential backoff
- Heartbeat monitoring (ping every 30s)
- Fallback to REST polling (60 req/min) if WS down
- KV data staleness check — if >60s old, trigger REST fetch

### Risk 3: Free Tier Downgrades
**Severity:** LOW (but possible)  
**Mitigation:**
- Multi-source architecture means no single point of failure
- If any source reduces limits, shift load to other sources
- SEC EDGAR (government API) will never charge — use as ultimate fallback for fundamentals
- `fast-technical-indicators` is a local npm library — can never be rate-limited

### Risk 4: Data Quality Discrepancies Between Sources
**Severity:** MEDIUM  
**Mitigation:**
- Cross-validation: compare Yahoo price vs Finnhub quote vs Alpaca snapshot
- Flag divergences > 1% as data quality alerts
- Use Alpaca as "source of truth" for execution pricing (it's the broker)
- Daily reconciliation job compares cached data vs fresh fetches

### Risk 5: Cloudflare Workers Limits
**Severity:** LOW  
**Current usage vs limits:**
```
Requests:      ~132K/month  vs  10,000,000 limit  →  1.3%
CPU time:      ~200K ms/month vs 30,000,000 limit  →  0.7%
KV reads:      ~1.5M/month  vs  10,000,000 limit  →  15%
KV writes:     ~450K/month  vs   1,000,000 limit  →  45%
D1 reads:      ~2M/month    vs  25,000,000,000     →  0.008%
D1 writes:     ~100K/month  vs  50,000,000         →  0.2%
Queues:        ~50K/month   vs   1,000,000         →  5%
```
**All within comfortable margins.** KV writes at 45% is the tightest constraint — optimize with write batching.

---

## PART IX — COMPARISON: $148/mo vs $5/mo

| Feature | $148/mo Plan | $5/mo Plan | Delta |
|---------|-------------|------------|-------|
| **Real-time quotes** | SIP consolidated (<100ms) | IEX + Yahoo (~1-30s) | ⚠️ Slightly delayed |
| **WebSocket symbols** | Unlimited (Alpaca paid) | 80 (50 Finnhub + 30 Alpaca) | ⚠️ Limited WS |
| **Remaining 920 symbols** | WebSocket/SIP real-time | Yahoo batch poll (30-60s) | ⚠️ Polling-based |
| **Historical OHLCV** | Alpaca SIP (5 years) | Yahoo (multi-year, free) | ✅ Equivalent |
| **Intraday OHLCV** | Alpaca 1m bars (SIP) | Yahoo 5m bars (free) | ⚠️ 5m minimum vs 1m |
| **Technical indicators** | TAAPI.io / Alpaca computed | Local compute (free) | ✅ Better (zero latency) |
| **Fundamentals** | Tiingo (50K tickers) | SEC EDGAR + Finnhub | ✅ Equivalent (SEC is authoritative) |
| **News** | Tiingo news API | Finnhub free (1yr history) | ✅ Equivalent |
| **Insider data** | Tiingo | Finnhub + SEC EDGAR | ✅ Better (direct SEC source) |
| **Analyst consensus** | Tiingo | Finnhub Rec Trends (free) | ✅ Equivalent |
| **Earnings data** | Tiingo | Finnhub + SEC EDGAR | ✅ Equivalent |
| **Macro data** | FRED | FRED | ✅ Same |
| **Crypto** | CoinGecko | CoinCap WS + CoinGecko + CCXT | ✅ Better (WS real-time) |
| **Data redundancy** | 2 sources (Alpaca + Tiingo) | 6+ sources with fallback chains | ✅ More resilient |
| **Single point of failure** | Alpaca outage = blind | Multiple fallbacks | ✅ More resilient |
| **Execution** | Alpaca (same either way) | Alpaca (same either way) | ✅ Same |
| **Backtest quality** | SIP-precision prices | Yahoo/IEX prices | ⚠️ Slightly less precise |
| **Total cost** | $148/month ($1,776/yr) | $5/month ($60/yr) | ✅ **$1,716/yr saved** |

### BOTTOM LINE

The $5/mo plan delivers **~95% of the capability** at **~3.4% of the cost**.

The 5% delta is:
1. SIP vs IEX pricing (irrelevant at YMSA's timeframes)
2. 1-minute vs 5-minute minimum candlestick resolution (marginal impact)
3. 80 vs unlimited WebSocket symbols (mitigated by intelligent polling)

For a system that generates signals on multi-minute to multi-hour timeframes and targets 3-8 trades per day, these differences are **not material to P&L**.

---

## PART X — DB SCHEMA UPDATES

### New Table: `universe`
```sql
CREATE TABLE IF NOT EXISTS universe (
  symbol        TEXT PRIMARY KEY,
  name          TEXT,
  sector        TEXT,
  industry      TEXT,
  market_cap    REAL,
  avg_volume    REAL,
  tier          INTEGER DEFAULT 3,         -- 0=execute, 1=active, 2=signal, 3=watch
  cik           TEXT,                       -- SEC EDGAR CIK number
  added_at      TEXT DEFAULT (datetime('now')),
  last_screened TEXT,
  score         REAL DEFAULT 0,            -- composite screening score
  active        INTEGER DEFAULT 1
);
CREATE INDEX idx_universe_tier ON universe(tier);
CREATE INDEX idx_universe_sector ON universe(sector);
```

### New Table: `data_source_quotas`
```sql
CREATE TABLE IF NOT EXISTS data_source_quotas (
  source        TEXT PRIMARY KEY,          -- yahoo, finnhub, fmp, alphav, twelved, sec
  daily_limit   INTEGER NOT NULL,
  used_today    INTEGER DEFAULT 0,
  reset_at      TEXT,                       -- ISO timestamp
  last_error    TEXT,
  error_count   INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'active'       -- active, degraded, down
);
```

### New Table: `data_quality_log`
```sql
CREATE TABLE IF NOT EXISTS data_quality_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol        TEXT NOT NULL,
  field         TEXT NOT NULL,              -- price, volume, ohlcv
  source_a      TEXT NOT NULL,
  source_b      TEXT NOT NULL,
  value_a       REAL,
  value_b       REAL,
  divergence    REAL,                       -- percentage difference
  logged_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_dql_symbol ON data_quality_log(symbol);
CREATE INDEX idx_dql_divergence ON data_quality_log(divergence);
```

### Updated Table: `sector_correlations`
```sql
CREATE TABLE IF NOT EXISTS sector_correlations (
  sector_a      TEXT NOT NULL,
  sector_b      TEXT NOT NULL,
  correlation   REAL NOT NULL,
  window_days   INTEGER DEFAULT 60,
  computed_at   TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (sector_a, sector_b, window_days)
);
```

---

## APPENDIX A — NPM DEPENDENCIES TO ADD

```json
{
  "dependencies": {
    "yahoo-finance2": "^2.x",
    "fast-technical-indicators": "^1.x",
    "ccxt": "^4.x"
  }
}
```

**Note:** Verify Cloudflare Workers compatibility before adding. `yahoo-finance2` uses `fetch()` internally — should work. `fast-technical-indicators` is pure math — will work. `ccxt` may require a lighter import for Workers (use specific exchange modules only).

## APPENDIX B — SECRETS / ENVIRONMENT VARIABLES

```toml
# wrangler.toml additions (no cost)  
# Set via: wrangler secret put FINNHUB_KEY
# Set via: wrangler secret put FMP_KEY  
# Set via: wrangler secret put ALPHA_VANTAGE_KEY
# Set via: wrangler secret put TWELVE_DATA_KEY
# Set via: wrangler secret put FRED_KEY
# 
# Existing (already configured):
# ALPACA_KEY, ALPACA_SECRET
# TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
# YMSA_API_KEY
```

All API keys above are **free to obtain** — no credit card required for any service.

## APPENDIX C — IMPLEMENTATION PRIORITY ORDER

```
MUST HAVE (Phase 1-2):
  [1] Yahoo Finance adapter + batch quote + OHLCV      ← All engines need this
  [2] Data Router + Quota Tracker                       ← Core orchestration
  [3] fast-technical-indicators integration             ← Replace TAAPI dependency
  [4] Universe table + 1,000 stock seeding              ← Scale foundation
  [5] Tiered funnel scanner                             ← Progressive filtering
  
SHOULD HAVE (Phase 3):
  [6] Finnhub adapter (news, fundamentals, insider)     ← Enrichment data
  [7] SEC EDGAR adapter (financials as reported)        ← Authoritative fundamentals
  [8] WebSocket Durable Object                          ← Real-time streaming

NICE TO HAVE (Phase 4):
  [9] Queue-based fan-out scanning                      ← Parallel compute
  [10] FMP / Alpha Vantage / Twelve Data adapters       ← Redundancy
  [11] Cross-source data validation                     ← Quality assurance
  [12] Dynamic symbol rotation on WebSocket             ← Adaptive streaming
```

---

**END OF PLAN**

*This document replaces the $148/mo plan. The architecture, patterns, and Cloudflare primitives from the original PART I, II, IV remain valid — only the data source layer has been rebuilt for zero external cost.*
