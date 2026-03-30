# 🦞 YMSA — Your Money, Smarter & Automated

**Enterprise Financial Automation** — OpenClaw + Cloudflare Workers

> Replaces 45+ minutes of daily manual market analysis with a 5-minute briefing.
> Scans 500+ stocks, monitors all technical indicators, pushes alerts to Telegram.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Cloudflare Workers Paid Plan (~$5/month)
- API keys (see below)

### 1. Install
```bash
npm install
npm install -g wrangler
wrangler login
```

### 2. Set API Keys
```bash
# Required
wrangler secret put ALPHA_VANTAGE_API_KEY    # Get from: alphavantage.co
wrangler secret put TAAPI_API_KEY            # Get from: taapi.io
wrangler secret put FINNHUB_API_KEY          # Get from: finnhub.io
wrangler secret put TELEGRAM_BOT_TOKEN       # Get from: @BotFather on Telegram
wrangler secret put TELEGRAM_CHAT_ID         # Get from: @userinfobot on Telegram
```

### 3. Deploy
```bash
wrangler deploy
```

### 4. Test
```bash
# Health check
curl https://ymsa-financial-automation.<your-subdomain>.workers.dev/health

# Test Telegram alert
curl https://ymsa-financial-automation.<your-subdomain>.workers.dev/api/test-alert

# Run a manual scan
curl https://ymsa-financial-automation.<your-subdomain>.workers.dev/api/scan
```

## 📊 API Endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | System health check |
| `GET /api/quote?symbol=AAPL` | Real-time quote |
| `GET /api/analysis?symbol=AAPL` | Full technical analysis (RSI, EMA, MACD, Fibonacci) |
| `GET /api/fibonacci?symbol=AAPL` | Fibonacci retracement levels |
| `GET /api/scan` | Full watchlist scan with signals |
| `GET /api/test-alert` | Send test Telegram alert |
| `GET /api/trigger?job=morning` | Manually trigger a cron job |

**Trigger Jobs**: `morning`, `open`, `quick`, `hourly`, `evening`, `afterhours`, `weekly`

## ⏰ Automated Schedule (IST)

| Time | Job | Description |
|---|---|---|
| 07:00 | Morning Briefing | Pre-market overview → Telegram |
| 16:30 | Market Open | Full indicator scan |
| Every 15min | Quick Scan | RSI + MACD monitoring (critical alerts only) |
| Every 1hr | Full Scan | All indicators + Fibonacci |
| 17:00 | Evening Summary | Day recap → Telegram |
| 20:00 | After Hours | Earnings + news scan |
| Sunday 09:00 | Weekly Review | Portfolio-level analysis |

## 📐 Technical Indicators

- **RSI(14)** — Oversold (<30) / Overbought (>70) alerts
- **EMA(50/200)** — Golden Cross / Death Cross detection
- **MACD(12,26,9)** — Signal line crossovers
- **Fibonacci** — Auto retracement levels (23.6%, 38.2%, 50%, 61.8%, 78.6%)
- **52-Week Range** — Proximity to highs/lows
- **Volume Spikes** — 1.5x+ average volume detection

## 📁 Project Structure

```
YMSA/
├── wrangler.toml              # Cloudflare config + cron schedules
├── src/
│   ├── index.ts               # Main Worker (HTTP + Cron handler)
│   ├── types.ts               # TypeScript type definitions
│   ├── cron-handler.ts        # Scheduled job implementations
│   ├── alert-router.ts        # Telegram alert formatting
│   ├── api/
│   │   ├── alpha-vantage.ts   # EMA, RSI, MACD, OHLCV data
│   │   ├── taapi.ts           # 200+ technical indicators
│   │   └── finnhub.ts         # Real-time quotes, news, earnings
│   └── analysis/
│       ├── fibonacci.ts       # Auto Fibonacci calculator
│       └── signals.ts         # Signal detection engine
├── skills/                    # OpenClaw skill definitions
│   ├── ymsa-stock-screener/
│   ├── ymsa-technical-analysis/
│   └── ymsa-fibonacci/
└── config/
    ├── watchlist.json         # Your stock watchlist
    ├── screening-rules.json   # Alert trigger rules
    └── alert-rules.json       # Alert routing config
```

## 💰 Cost

| Free Start | Full Production |
|---|---|
| **$5/month** (Cloudflare only) | **$65-85/month** |

## 📜 License

Private — Personal use only.
