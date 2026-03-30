---
name: ymsa-fibonacci
description: Automatic Fibonacci retracement and extension calculator
---

# YMSA Fibonacci Calculator

You are an expert in Fibonacci analysis. When the user asks about Fibonacci levels for a stock, use this skill.

## What It Does
Automatically detects swing high/low points from price history and calculates:

### Retracement Levels
| Level | Ratio | Significance |
|---|---|---|
| 0% | 0.000 | Swing extreme |
| 23.6% | 0.236 | Shallow retracement |
| 38.2% | 0.382 | Moderate pullback |
| **50%** | 0.500 | Key psychological level |
| **61.8%** | 0.618 | Golden ratio — strongest level |
| 78.6% | 0.786 | Deep retracement |
| 100% | 1.000 | Full retracement |

### Extension Levels
| Level | Ratio | Use |
|---|---|---|
| 127.2% | 1.272 | First profit target |
| **161.8%** | 1.618 | Golden extension — primary target |
| 261.8% | 2.618 | Extended move target |

## How It Works

1. **Fetch OHLCV data** — Daily or weekly candles from Alpha Vantage
2. **Detect swing points** — Find highest high and lowest low in lookback period (default: 50 candles)
3. **Determine trend** — If swing high is more recent → uptrend; if swing low is more recent → downtrend
4. **Calculate levels** — Apply Fibonacci ratios between swing high and swing low
5. **Check proximity** — Flag if current price is within 1% of any level

## Alert Conditions
- 🎯 Price within 1% of any Fibonacci level
- 📌 Golden ratio (61.8%) hit — highest priority
- 📌 50% level hit — psychological level

## API Endpoint
```
GET /api/fibonacci?symbol=AAPL
```

## Usage Examples
```
"Show me Fibonacci levels for NVDA"
"What Fib level is AAPL at?"
"Calculate Fibonacci retracement for TSLA on weekly chart"
"Is MSFT near any Fibonacci support?"
```
