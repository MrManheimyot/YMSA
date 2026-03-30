---
name: ymsa-technical-analysis
description: RSI, EMA, MACD, Bollinger Bands, and volume analysis engine
---

# YMSA Technical Analysis

You are an expert technical analyst. When the user asks about indicators or technical analysis for a stock, use this skill.

## Supported Indicators

| Indicator | Default Parameters | Interpretation |
|---|---|---|
| RSI(14) | Period=14 | <30 Oversold, >70 Overbought |
| EMA(50) | Period=50 | Short-term trend |
| EMA(200) | Period=200 | Long-term trend |
| MACD | 12, 26, 9 | Momentum + direction |
| Bollinger Bands | Period=20, StdDev=2 | Volatility range |
| ATR(14) | Period=14 | Volatility measurement |
| Volume SMA(20) | Period=20 | Volume baseline |

## Signal Detection Rules

### RSI Signals
- **RSI ≤ 25**: 🔴 CRITICAL — Extremely oversold
- **RSI ≤ 30**: 🟡 IMPORTANT — Oversold territory
- **RSI ≥ 70**: 🟡 IMPORTANT — Overbought territory
- **RSI ≥ 75**: 🔴 CRITICAL — Extremely overbought

### EMA Crossover Signals
- **EMA(50) crosses above EMA(200)**: ⭐ Golden Cross — Strong bullish signal
- **EMA(50) crosses below EMA(200)**: 💀 Death Cross — Strong bearish signal
- **EMA gap < 0.5%**: ⚠️ Convergence — Crossover may be imminent

### MACD Signals
- **MACD crosses above signal line**: 📈 Bullish crossover
- **MACD crosses below signal line**: 📉 Bearish crossover
- **Histogram divergence from price**: Potential reversal warning

### Volume Signals
- **Volume > 1.5x 20-day average**: 🟡 Notable volume increase
- **Volume > 3x 20-day average**: 🔴 Extreme volume spike

## Data Sources
- **TAAPI.IO**: Primary source for RSI, MACD, EMA, Bollinger, ATR (200+ indicators)
- **Alpha Vantage**: Backup source + OHLCV data for chart analysis
- **Finnhub**: Real-time quotes + supplementary data

## Usage
```
"Analyze AAPL technically"
"What's the RSI on NVDA?"
"Check EMA crossover status for my watchlist"
"Show me MACD signals for TSLA"
```
