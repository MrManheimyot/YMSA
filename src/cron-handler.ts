// ─── Cron Handler ─────────────────────────────────────────────
// Full 6-engine trading pipeline: Scan → Analyze → Risk → Execute → Record
// v3: Autonomous execution via Alpaca (paper mode by default)

import type { Env, CronJobType } from './types';
import * as finnhub from './api/finnhub';
import * as yahooFinance from './api/yahoo-finance';
import * as coingecko from './api/coingecko';
import * as dexscreener from './api/dexscreener';
import * as polymarket from './api/polymarket';
import * as fred from './api/fred';
import { calculateFibonacci } from './analysis/fibonacci';
import { detectSignals } from './analysis/signals';
import { computeIndicators } from './analysis/indicators';
import { sendDailyBriefing, sendTelegramMessage } from './alert-router';
import { scanPairs, findTradablePairs } from './agents/pairs-trading';
import { scrapeOversoldStocks, scrape52WeekHighs, formatFinvizAlert } from './scrapers/finviz';
import { scrapeMarketOverview, formatMarketOverview } from './scrapers/google-finance';
import { analyzeMultiTimeframe } from './analysis/multi-timeframe';
import { analyzeSmartMoney } from './analysis/smart-money';
import { detectRegime, getEngineAdjustments, formatRegimeAlert } from './analysis/regime';
import { fetchGoogleAlerts, storeNewsAlerts, formatNewsDigest } from './api/google-alerts';
import { recordDailyPnl, getPortfolioSnapshot, formatPortfolioSnapshot, recordEnginePerformance, getPerformanceMetrics, formatPerformanceReport } from './execution/portfolio';
import { executeBatch, formatBatchResults, type ExecutableSignal } from './execution/engine';
import { evaluateKillSwitch, formatRiskEvent } from './agents/risk-controller';
import { insertRiskEvent, generateId, getClosedTradesSince, getOpenTrades, getPendingTelegramAlerts, updateTelegramAlertOutcome, expireOldTelegramAlerts } from './db/queries';
import { setCurrentRegime } from './alert-formatter';
import { beginCycle, flushCycle, setRegime, addContext, pushSmartMoney, pushMTF, pushTechnical, pushStatArb, pushCryptoDefi, pushEventDriven, pushOptions, sendRiskAlert, sendExecutionAlert } from './broker-manager';
import { scoreNewsSentiment, weeklyNarrative, isZAiAvailable } from './ai/z-engine';

/**
 * Main cron event handler — routes to appropriate job type
 */
export async function handleCronEvent(
  cron: string,
  env: Env
): Promise<void> {
  const jobType = identifyCronJob(cron);
  console.log(`[Cron] Running job: ${jobType} (cron: ${cron})`);

  try {
    switch (jobType) {
      case 'MORNING_BRIEFING':
        await runMorningBriefing(env);
        break;
      case 'MARKET_OPEN_SCAN':
        await runFullScan(env, 'Market Open');
        break;
      case 'OPENING_RANGE_BREAK':
        await runOpeningRangeBreak(env);
        break;
      case 'QUICK_PULSE_5MIN':
        await runQuickPulse(env);
        break;
      case 'QUICK_SCAN_15MIN':
        await runQuickScan(env);
        break;
      case 'FULL_SCAN_HOURLY':
        await runFullScan(env, 'Hourly');
        break;
      case 'MIDDAY_REBALANCE':
        await runMiddayRebalance(env);
        break;
      case 'EVENING_SUMMARY':
        await runEveningSummary(env);
        break;
      case 'OVERNIGHT_SETUP':
        await runOvernightSetup(env);
        break;
      case 'AFTER_HOURS_SCAN':
        await runAfterHoursScan(env);
        break;
      case 'WEEKLY_REVIEW':
        await runWeeklyReview(env);
        break;
      case 'ML_RETRAIN':
        await runMLRetrain(env);
        break;
      case 'MONTHLY_PERFORMANCE':
        await runMonthlyPerformance(env);
        break;
    }
  } catch (err) {
    console.error(`[Cron] Job ${jobType} failed:`, err);
    await sendTelegramMessage(`⚠️ YMSA Cron Error: ${jobType}\n${err}`, env);
  }
}

function identifyCronJob(cron: string): CronJobType {
  if (cron === '0 5 * * 1-5') return 'MORNING_BRIEFING';
  if (cron === '30 14 * * 1-5') return 'MARKET_OPEN_SCAN';
  if (cron === '45 14 * * 1-5') return 'OPENING_RANGE_BREAK';
  if (cron.startsWith('*/5')) return 'QUICK_PULSE_5MIN';
  if (cron.startsWith('*/15')) return 'QUICK_SCAN_15MIN';
  if (cron === '0 18 * * 1-5') return 'MIDDAY_REBALANCE';
  if (cron === '0 15 * * 1-5') return 'EVENING_SUMMARY';
  if (cron === '30 21 * * 1-5') return 'OVERNIGHT_SETUP';
  if (cron === '0 7 * * SUN' || cron === '0 7 * * 0') return 'WEEKLY_REVIEW';
  if (cron === '0 3 * * SAT' || cron === '0 3 * * 6') return 'ML_RETRAIN';
  if (cron === '0 0 1 * *') return 'MONTHLY_PERFORMANCE';
  return 'FULL_SCAN_HOURLY';
}

function getWatchlist(env: Env): string[] {
  return env.DEFAULT_WATCHLIST.split(',').map((s) => s.trim());
}

function getCryptoWatchlist(env: Env): string[] {
  return (env.CRYPTO_WATCHLIST || 'bitcoin,ethereum,solana').split(',').map((s) => s.trim());
}

// ═══════════════════════════════════════════════════════════════
// MORNING BRIEFING — 07:00 IST
// Premium institutional-grade market intelligence report
// ═══════════════════════════════════════════════════════════════

async function runMorningBriefing(env: Env): Promise<void> {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });

  // ── Parallel data fetch — all sources at once ──
  const [
    allQuotes,
    cryptoBTC,
    macroDashboard,
    yieldCurve,
    moversResult,
    unusualResult,
    newsAlerts,
    marketNews,
    earningsToday,
  ] = await Promise.all([
    yahooFinance.getMultipleQuotes(['^GSPC', '^IXIC', '^DJI', 'GC=F', 'CL=F', 'AAPL', 'GOOGL', 'NVDA', 'MSFT', 'AMZN']),
    yahooFinance.getQuote('BTC-USD'),
    fred.getMacroDashboard(env.FRED_API_KEY),
    fred.checkYieldCurve(env.FRED_API_KEY),
    yahooFinance.screenUnusualMovers(10, 2.0, 6).catch(() => [] as any[]),
    polymarket.detectUnusualActivity(50).catch(() => [] as any[]),
    fetchGoogleAlerts().catch(() => [] as any[]),
    finnhub.getMarketNews(env).catch(() => [] as any[]),
    finnhub.getEarningsCalendar(env, 1).catch(() => [] as any[]),
  ]);

  // Split quotes into groups
  const quoteOf = (sym: string) => allQuotes.find(q => q.symbol === sym);
  const indexQuotes = ['^GSPC', '^IXIC', '^DJI'].map(s => quoteOf(s)).filter(Boolean) as any[];
  const commodityQuotes = ['GC=F', 'CL=F'].map(s => quoteOf(s)).filter(Boolean) as any[];
  const coreQuotes = ['AAPL', 'GOOGL', 'NVDA', 'MSFT', 'AMZN'].map(s => quoteOf(s)).filter(Boolean) as any[];

  // ── Helper formatting functions ──
  const fmtChg = (pct: number): string => {
    const sign = pct >= 0 ? '+' : '';
    return `${sign}${pct.toFixed(2)}%`;
  };
  const fmtPrice = (p: number, decimals = 2): string => {
    if (p >= 10000) return p.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return p.toFixed(decimals);
  };
  const arrow = (pct: number): string => pct >= 0 ? '▲' : '▼';
  const dot = (pct: number): string => pct >= 0 ? '🟢' : '🔴';

  // ════════════════════════════════════════════════
  // MESSAGE 1: Header + Section 1 (Indices) + Section 2 (Core Holdings)
  // ════════════════════════════════════════════════

  const msg1: string[] = [];

  // Header
  msg1.push(`Yigal the man, may you have a magical morning, from Tamir and Yotam.`);
  msg1.push(``);
  msg1.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  msg1.push(`📋 <b>YMSA MORNING INTELLIGENCE BRIEF</b>`);
  msg1.push(`${dateStr} · ${timeStr} IST`);
  msg1.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  // ── SECTION 1: Market Pulse ──
  msg1.push(``);
  msg1.push(`<b>§1  MARKET PULSE — Key Benchmarks</b>`);
  msg1.push(`───────────────────────────`);

  const idxMap: Record<string, string> = { '^GSPC': 'S&P 500', '^IXIC': 'NASDAQ', '^DJI': 'DOW JONES' };
  for (const q of indexQuotes) {
    const name = idxMap[q.symbol] || q.symbol;
    msg1.push(`${dot(q.changePercent)} <b>${name}</b>`);
    msg1.push(`    ${fmtPrice(q.price)} ${arrow(q.changePercent)} ${fmtChg(q.changePercent)} (${q.change >= 0 ? '+' : ''}${fmtPrice(q.change)})`);
  }

  // Gold
  const gold = commodityQuotes.find(q => q.symbol === 'GC=F');
  if (gold) {
    msg1.push(`${dot(gold.changePercent)} <b>GOLD</b>`);
    msg1.push(`    $${fmtPrice(gold.price)} ${arrow(gold.changePercent)} ${fmtChg(gold.changePercent)}`);
  }

  // Oil WTI
  const oil = commodityQuotes.find(q => q.symbol === 'CL=F');
  if (oil) {
    msg1.push(`${dot(oil.changePercent)} <b>OIL (WTI)</b>`);
    msg1.push(`    $${fmtPrice(oil.price)} ${arrow(oil.changePercent)} ${fmtChg(oil.changePercent)}`);
  }

  // Bitcoin
  if (cryptoBTC) {
    msg1.push(`${dot(cryptoBTC.changePercent)} <b>BITCOIN</b>`);
    msg1.push(`    $${fmtPrice(cryptoBTC.price, 0)} ${arrow(cryptoBTC.changePercent)} ${fmtChg(cryptoBTC.changePercent)}`);
  }

  // VIX + Yield
  const vix = macroDashboard.find(m => m.id === 'VIXCLS');
  if (vix) {
    const vixEmoji = vix.value >= 25 ? '🔴' : vix.value >= 18 ? '🟡' : '🟢';
    msg1.push(``);
    msg1.push(`${vixEmoji} <b>VIX</b>: ${vix.value.toFixed(1)}${vix.change ? ` (${vix.change >= 0 ? '+' : ''}${vix.change.toFixed(1)})` : ''}`);
  }
  if (yieldCurve) {
    const ycEmoji = yieldCurve.inverted ? '⚠️' : '✅';
    msg1.push(`${ycEmoji} <b>Yield Curve</b>: ${yieldCurve.spread.toFixed(2)}% spread${yieldCurve.inverted ? ' — INVERTED' : ''}`);
  }

  // ── SECTION 2: Core Holdings ──
  msg1.push(``);
  msg1.push(`<b>§2  CORE HOLDINGS — Daily Performance</b>`);
  msg1.push(`───────────────────────────`);

  for (const q of coreQuotes) {
    const volRatio = q.avgVolume > 0 ? (q.volume / q.avgVolume) : 0;
    const volFlag = volRatio >= 1.5 ? ' 📊' : '';
    msg1.push(`${dot(q.changePercent)} <b>${q.symbol}</b>  $${fmtPrice(q.price)}  ${arrow(q.changePercent)} ${fmtChg(q.changePercent)}${volFlag}`);
  }

  // ── MARKET INSIGHTS — data-driven commentary ──
  msg1.push(``);
  msg1.push(`<b>📌 KEY INSIGHTS</b>`);
  msg1.push(`───────────────────────────`);

  const spx = quoteOf('^GSPC');
  const ndx = quoteOf('^IXIC');
  const insights: string[] = [];

  // Insight 1: Market regime from VIX + indices
  if (vix && spx) {
    if (vix.value >= 25) {
      insights.push(`Fear is elevated — VIX at ${vix.value.toFixed(1)} signals hedging demand. Volatility-adjusted sizing recommended.`);
    } else if (vix.value <= 14 && spx.changePercent > 0) {
      insights.push(`Complacency watch — VIX sub-15 with equity drift higher. Low-vol regimes tend to end abruptly.`);
    } else if (spx.changePercent > 1) {
      insights.push(`Broad risk-on — S&P up ${fmtChg(spx.changePercent)} with VIX at ${vix.value.toFixed(1)}. Momentum favors longs but watch for mean reversion.`);
    } else if (spx.changePercent < -1) {
      insights.push(`Risk-off tone — S&P down ${fmtChg(spx.changePercent)}. Wait for stabilization before adding exposure.`);
    } else {
      insights.push(`Markets range-bound — S&P ${fmtChg(spx.changePercent)}, VIX ${vix.value.toFixed(1)}. Selective stock-picking favored over broad bets.`);
    }
  }

  // Insight 2: Tech vs. broad market divergence
  if (spx && ndx) {
    const divergence = ndx.changePercent - spx.changePercent;
    if (divergence > 0.8) {
      insights.push(`Tech outperformance — NASDAQ leading by ${divergence.toFixed(1)}pp. Growth/AI names remain the preferred vehicle.`);
    } else if (divergence < -0.8) {
      insights.push(`Rotation out of tech — NASDAQ lagging by ${Math.abs(divergence).toFixed(1)}pp. Value and cyclicals attracting flows.`);
    }
  }

  // Insight 3: Yield curve / macro
  if (yieldCurve && yieldCurve.inverted) {
    insights.push(`Yield curve inverted at ${yieldCurve.spread.toFixed(2)}% — historically a recession precursor. Defensive positioning warranted.`);
  } else if (gold && gold.changePercent > 1.5) {
    insights.push(`Gold surging ${fmtChg(gold.changePercent)} — safe-haven demand rising. Monitor for geopolitical escalation or dollar weakness.`);
  } else if (cryptoBTC && cryptoBTC.changePercent > 3) {
    insights.push(`Bitcoin up ${fmtChg(cryptoBTC.changePercent)} — risk appetite extends to digital assets. Institutional flows may be accelerating.`);
  } else if (oil && Math.abs(oil.changePercent) > 2) {
    insights.push(`Oil ${oil.changePercent > 0 ? 'spiking' : 'sliding'} ${fmtChg(oil.changePercent)} — energy sector ${oil.changePercent > 0 ? 'catching a bid' : 'under pressure'}. Watch for inflation implications.`);
  }

  // Ensure at least 2 insights
  if (insights.length < 2 && moversResult.length > 0) {
    insights.push(`${moversResult.length} unusual movers detected — elevated single-stock volatility signals active catalysts in play.`);
  }
  if (insights.length < 2) {
    insights.push(`Quiet tape — no major dislocations. Focus on technical setups with defined risk.`);
  }

  for (const insight of insights.slice(0, 3)) {
    msg1.push(`• ${insight}`);
  }

  await sendDailyBriefing(msg1.join('\n'), env);

  // ════════════════════════════════════════════════
  // MESSAGE 2: Section 3 (Unusual Movers) + Section 4 (Technical Picks)
  // ════════════════════════════════════════════════

  const msg2: string[] = [];

  // ── SECTION 3: Unusual Movers ──
  msg2.push(`<b>§3  UNUSUAL MOVERS — 10%+ Change, 2x+ Volume</b>`);
  msg2.push(`───────────────────────────`);

  try {
    const movers = moversResult;
    if (movers.length > 0) {
      for (const q of movers) {
        const volRatio = q.avgVolume > 0 ? (q.volume / q.avgVolume).toFixed(1) : '?';
        msg2.push(`${dot(q.changePercent)} <b>${q.symbol}</b>  $${fmtPrice(q.price)}  ${arrow(q.changePercent)} ${fmtChg(q.changePercent)}`);
        msg2.push(`    Vol: ${(q.volume / 1e6).toFixed(1)}M (${volRatio}x avg) — Requires attention`);
      }
    } else {
      msg2.push(`  No Russell 1000 stocks met the 10%+ / 2x volume threshold today.`);
      msg2.push(`  <i>Market volatility is contained.</i>`);
    }
  } catch {
    msg2.push(`  <i>Screener data unavailable.</i>`);
  }

  // ── SECTION 4: Technical Conviction Picks ──
  msg2.push(``);
  msg2.push(`<b>§4  TECHNICAL CONVICTION — Multi-Indicator Screen</b>`);
  msg2.push(`───────────────────────────`);
  msg2.push(`<i>Stocks scoring on ≥3 indicators (RSI, MACD, EMA, BB, ATR)</i>`);
  msg2.push(``);

  try {
    // Broad 50-stock universe for reliable 10-pick output
    const hardcodedUniverse = [
      'AAPL','MSFT','GOOGL','AMZN','NVDA','META','TSLA','NFLX','AMD','AVGO',
      'CRM','INTC','QCOM','PANW','CRWD','PLTR','COIN','SMCI','ARM','MRVL',
      'JPM','GS','BAC','V','MA','UNH','LLY','JNJ','PFE','MRNA',
      'XOM','CVX','BA','CAT','GE','DE','RTX','LMT','HD','WMT',
      'UBER','ABNB','SHOP','DASH','NET','DDOG','SNOW','SQ','RIVN','ENPH',
    ];
    const envSymbols = (env.TIER1_WATCHLIST || env.DEFAULT_WATCHLIST || '').split(',').map(s => s.trim()).filter(Boolean);
    const tier2 = (env.TIER2_WATCHLIST || '').split(',').map(s => s.trim()).filter(Boolean);
    const allSymbols = [...new Set([...envSymbols, ...tier2, ...hardcodedUniverse])].slice(0, 50);

    interface TechPick {
      symbol: string;
      price: number;
      changePct: number;
      score: number;
      signals: string[];
      direction: 'BULLISH' | 'BEARISH';
    }

    const picks: TechPick[] = [];

    // Pre-fetch all quotes in one batch call
    const allQuotes = await yahooFinance.getMultipleQuotes(allSymbols);
    const quoteMap = new Map(allQuotes.map(q => [q.symbol, q]));

    // Fetch OHLCV in parallel batches of 8
    const BATCH_SIZE = 8;
    for (let b = 0; b < allSymbols.length; b += BATCH_SIZE) {
      const batch = allSymbols.slice(b, b + BATCH_SIZE);
      const ohlcvResults = await Promise.all(
        batch.map(sym => yahooFinance.getOHLCV(sym, '6mo', '1d').catch(() => []))
      );

      for (let i = 0; i < batch.length; i++) {
        const symbol = batch[i];
        const quote = quoteMap.get(symbol);
        const ohlcv = ohlcvResults[i];
        if (!quote || ohlcv.length < 50) continue;

        const indicators = computeIndicators(symbol, ohlcv);
        const rsi = indicators.find(ind => ind.indicator === 'RSI')?.value;
        const macd = indicators.find(ind => ind.indicator === 'MACD')?.value;
        const macdSig = indicators.find(ind => ind.indicator === 'MACD_SIGNAL')?.value;
        const ema50 = indicators.find(ind => ind.indicator === 'EMA_50')?.value;
        const ema200 = indicators.find(ind => ind.indicator === 'EMA_200')?.value;
        const sma50 = indicators.find(ind => ind.indicator === 'SMA_50')?.value;
        const atr = indicators.find(ind => ind.indicator === 'ATR')?.value;

        // Bollinger Bands (from OHLCV)
        const chronological = [...ohlcv].reverse();
        const closes = chronological.map(c => c.close);
        let bbLower = 0, bbUpper = 0;
        if (closes.length >= 20) {
          const slice = closes.slice(closes.length - 20);
          const mean = slice.reduce((s, p) => s + p, 0) / 20;
          const stdDev = Math.sqrt(slice.reduce((s, p) => s + (p - mean) ** 2, 0) / 20);
          bbLower = mean - 2 * stdDev;
          bbUpper = mean + 2 * stdDev;
        }

        const bullSignals: string[] = [];
        const bearSignals: string[] = [];

        // RSI (relaxed to 35/65 for broader coverage)
        if (rsi != null) {
          if (rsi <= 35) bullSignals.push(`RSI ${rsi.toFixed(0)} (oversold)`);
          else if (rsi >= 65) bearSignals.push(`RSI ${rsi.toFixed(0)} (overbought)`);
        }

        // MACD crossover
        if (macd != null && macdSig != null) {
          if (macd > macdSig && macd > 0) bullSignals.push(`MACD bullish cross`);
          else if (macd < macdSig && macd < 0) bearSignals.push(`MACD bearish cross`);
        }

        // EMA alignment
        if (ema50 != null && ema200 != null) {
          if (quote.price > ema50 && ema50 > ema200) bullSignals.push(`EMA 50>200 aligned`);
          else if (quote.price < ema50 && ema50 < ema200) bearSignals.push(`EMA 50<200 aligned`);
        }

        // Bollinger Band touch
        if (bbLower > 0) {
          if (quote.price <= bbLower * 1.01) bullSignals.push(`BB lower band touch`);
          else if (quote.price >= bbUpper * 0.99) bearSignals.push(`BB upper band touch`);
        }

        // ATR expansion (high volatility = opportunity)
        if (atr != null && quote.price > 0 && (atr / quote.price) >= 0.03) {
          const sig = `ATR ${((atr / quote.price) * 100).toFixed(1)}% (expanded)`;
          if (bullSignals.length >= bearSignals.length) bullSignals.push(sig);
          else bearSignals.push(sig);
        }

        // Price near SMA 50 support/resistance (relaxed to 3%)
        if (sma50 != null && quote.price > 0) {
          const distPct = ((quote.price - sma50) / sma50) * 100;
          if (distPct >= -3 && distPct <= 3) {
            if (quote.price > sma50) bullSignals.push(`At SMA50 support`);
            else bearSignals.push(`At SMA50 resistance`);
          }
        }

        // Volume spike (today vs. avg)
        if (quote.avgVolume > 0 && (quote.volume / quote.avgVolume) >= 1.8) {
          const vr = (quote.volume / quote.avgVolume).toFixed(1);
          if (quote.changePercent >= 0) bullSignals.push(`Vol spike ${vr}x avg`);
          else bearSignals.push(`Vol spike ${vr}x avg`);
        }

        const isBullish = bullSignals.length >= bearSignals.length;
        const signals = isBullish ? bullSignals : bearSignals;
        const score = signals.length;

        if (score >= 3) {
          picks.push({
            symbol,
            price: quote.price,
            changePct: quote.changePercent,
            score,
            signals,
            direction: isBullish ? 'BULLISH' : 'BEARISH',
          });
        }
      }
    }

    picks.sort((a, b) => b.score - a.score);
    const topPicks = picks.slice(0, 10);

    if (topPicks.length > 0) {
      for (let i = 0; i < topPicks.length; i++) {
        const p = topPicks[i];
        const dirEmoji = p.direction === 'BULLISH' ? '🟢' : '🔴';
        msg2.push(`${dirEmoji} <b>${i + 1}. ${p.symbol}</b>  $${fmtPrice(p.price)}  ${arrow(p.changePct)} ${fmtChg(p.changePct)}`);
        msg2.push(`    ${p.direction} · ${p.score} indicators: ${p.signals.join(' · ')}`);
      }
    } else {
      msg2.push(`  No stocks met the 3+ indicator threshold.`);
      msg2.push(`  <i>Market in low-conviction state — reduce exposure.</i>`);
    }
  } catch {
    msg2.push(`  <i>Technical scan unavailable.</i>`);
  }

  await sendDailyBriefing(msg2.join('\n'), env);

  // ════════════════════════════════════════════════
  // MESSAGE 3: Section 5 (Prediction Markets) + Section 6 (Google Alerts) + Footer
  // ════════════════════════════════════════════════

  const msg3: string[] = [];

  // ── SECTION 5: Prediction Markets — Unusual Activity Only ──
  msg3.push(`<b>§5  PREDICTION MARKETS — Unusual Activity Scan</b>`);
  msg3.push(`───────────────────────────`);
  msg3.push(`<i>Scanning for potential insider-driven positioning</i>`);
  msg3.push(``);

  try {
    const unusual = unusualResult;
    if (unusual.length > 0) {
      for (const u of unusual) {
        const sevEmoji = u.severity === 'HIGH' ? '🚨' : '⚠️';
        msg3.push(`${sevEmoji} <b>${u.market.question.slice(0, 65)}${u.market.question.length > 65 ? '...' : ''}</b>`);
        msg3.push(`    ${u.reason}`);
        const topOutcome = u.market.outcomes[0];
        if (topOutcome) {
          msg3.push(`    → ${topOutcome.name}: ${(topOutcome.price * 100).toFixed(0)}% | Vol: $${(u.market.volume / 1000).toFixed(0)}K`);
        }
        msg3.push(``);
      }
    } else {
      msg3.push(`  No unusual activity detected across active markets.`);
      msg3.push(`  <i>Prediction market positioning appears normal.</i>`);
    }
  } catch {
    msg3.push(`  <i>Polymarket data unavailable.</i>`);
  }

  // ── SECTION 6: Google Alerts Intelligence ──
  msg3.push(`<b>§6  NEWS INTELLIGENCE — Google Alerts</b>`);
  msg3.push(`───────────────────────────`);

  try {
    if (env.DB && newsAlerts.length > 0) await storeNewsAlerts(newsAlerts, env.DB);
    const recent = newsAlerts.filter((n: any) => Date.now() - new Date(n.published).getTime() < 24 * 60 * 60 * 1000);

    if (recent.length > 0) {
      // Diversify: pick from different categories, max 2 per category
      const byCategory = new Map<string, typeof recent>();
      for (const item of recent) {
        const cat = item.category;
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat)!.push(item);
      }

      const diversified: typeof recent = [];
      let round = 0;
      while (diversified.length < 10 && round < 5) {
        for (const [, items] of byCategory) {
          if (round < items.length && diversified.length < 10) {
            diversified.push(items[round]);
          }
        }
        round++;
      }

      const catNameMap: Record<string, string> = {
        'mega-tech': 'TECH', 'more-tech': 'TECH', 'mna': 'M&A',
        'short-squeeze': 'FLOW', 'fed-rates': 'FED', 'earnings': 'EARN',
        'sec-13f': '13F', 'crypto': 'CRYPTO', 'banks': 'BANKS',
        'semis': 'SEMIS', 'buybacks': 'BUYBACK', 'crash-signals': 'RISK',
      };

      msg3.push(`<i>${recent.length} alerts in last 24h · showing ${diversified.length} diversified</i>`);
      msg3.push(``);

      for (let i = 0; i < diversified.length; i++) {
        const item = diversified[i];
        const catLabel = catNameMap[item.category] || item.category.toUpperCase();
        msg3.push(`${i + 1}. [${catLabel}] ${item.title.slice(0, 75)}${item.title.length > 75 ? '...' : ''}`);
      }
    } else {
      msg3.push(`  No new alerts in the last 24 hours.`);
    }
  } catch {
    msg3.push(`  <i>Google Alerts unavailable.</i>`);
  }

  // ── Z.AI Market Sentiment (if available) ──
  try {
    if (isZAiAvailable(env)) {
      const marketNews = await finnhub.getMarketNews(env);
      if (marketNews.length > 0) {
        const headlines = marketNews.slice(0, 8).map(n => n.headline);
        const sentiment = await scoreNewsSentiment((env as any).AI, headlines);
        if (sentiment.length > 0) {
          const bullish = sentiment.filter(s => s.sentiment === 'BULLISH').length;
          const bearish = sentiment.filter(s => s.sentiment === 'BEARISH').length;
          const neutral = sentiment.length - bullish - bearish;
          const overall = bullish > bearish ? '🟢 BULLISH' : bearish > bullish ? '🔴 BEARISH' : '⚪ NEUTRAL';
          msg3.push(``);
          msg3.push(`<b>🧠 Z.AI SENTIMENT</b>: ${overall} (${bullish}↑ ${bearish}↓ ${neutral}→)`);
        }
      }
    }
  } catch {}

  // ── SECTION 7: What to Watch Today ──
  msg3.push(``);
  msg3.push(`<b>§7  WHAT TO WATCH TODAY</b>`);
  msg3.push(`───────────────────────────`);

  const watchItems: string[] = [];

  // Earnings to watch
  if (earningsToday.length > 0) {
    const notable = earningsToday.slice(0, 4).map((e: any) => {
      const time = e.hour === 'bmo' ? 'pre' : e.hour === 'amc' ? 'post' : '';
      return `${e.symbol}${time ? ' (' + time + ')' : ''}`;
    }).join(', ');
    watchItems.push(`📅 <b>Earnings:</b> ${notable}`);
  }

  // Fed / macro events from Google Alerts
  const fedAlerts = newsAlerts.filter((n: any) => n.category === 'fed-rates');
  if (fedAlerts.length > 0) {
    watchItems.push(`🏦 <b>Fed/Macro:</b> ${fedAlerts[0].title.slice(0, 70)}${fedAlerts[0].title.length > 70 ? '...' : ''}`);
  }

  // Risk flags
  if (vix && vix.value >= 22) {
    watchItems.push(`⚡ <b>Risk:</b> VIX elevated at ${vix.value.toFixed(1)} — size down, widen stops`);
  }
  if (moversResult.length >= 3) {
    watchItems.push(`⚠️ <b>Risk:</b> ${moversResult.length} stocks with 10%+ moves — sector contagion possible`);
  }
  if (yieldCurve && yieldCurve.inverted) {
    watchItems.push(`📉 <b>Risk:</b> Inverted yield curve — recession signal active`);
  }

  // Opportunities
  if (spx && spx.changePercent < -1.5) {
    watchItems.push(`🎯 <b>Opportunity:</b> Broad selloff may offer dip-buy entries in quality names`);
  }
  if (cryptoBTC && cryptoBTC.changePercent > 4) {
    watchItems.push(`🎯 <b>Opportunity:</b> BTC momentum — watch for altcoin follow-through`);
  }
  const crashAlerts = newsAlerts.filter((n: any) => n.category === 'short-squeeze' || n.category === 'crash-signals');
  if (crashAlerts.length > 0) {
    watchItems.push(`🔍 <b>Monitor:</b> ${crashAlerts[0].title.slice(0, 65)}${crashAlerts[0].title.length > 65 ? '...' : ''}`);
  }

  // Key headline from market news
  if (marketNews.length > 0) {
    watchItems.push(`📰 <b>Top Story:</b> ${marketNews[0].headline.slice(0, 70)}${marketNews[0].headline.length > 70 ? '...' : ''}`);
  }

  if (watchItems.length === 0) {
    watchItems.push(`No major catalysts on the calendar. Standard risk management applies.`);
  }

  for (const item of watchItems.slice(0, 5)) {
    msg3.push(item);
  }

  // ── Footer ──
  msg3.push(``);
  msg3.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  msg3.push(`<i>YMSA Intelligence · Automated · Confidential</i>`);
  msg3.push(`<i>Data as of ${timeStr} IST — Pre-market conditions may vary</i>`);

  await sendDailyBriefing(msg3.join('\n'), env);
}

// ═══════════════════════════════════════════════════════════════
// QUICK SCAN — Every 15 min during market hours
// CRITICAL alerts only: RSI extremes, MACD crosses
// ═══════════════════════════════════════════════════════════════

async function runQuickScan(env: Env): Promise<void> {
  beginCycle();
  const watchlist = getWatchlist(env);

  for (const symbol of watchlist) {
    const [quote, ohlcv] = await Promise.all([
      yahooFinance.getQuote(symbol),
      yahooFinance.getOHLCV(symbol, '2y', '1d'),
    ]);

    if (!quote) continue;

    const indicators = computeIndicators(symbol, ohlcv);
    const signals = detectSignals(quote, indicators, null, env);
    const criticalSignals = signals.filter((s) => s.priority === 'CRITICAL');

    if (criticalSignals.length > 0) {
      pushTechnical(criticalSignals, quote, indicators, null);
    }
  }

  await flushCycle(env);
}

// ═══════════════════════════════════════════════════════════════
// FULL SCAN — Hourly + Market Open
// All 5 agents: technicals, Fib, crypto whales, predictions, macro
// ═══════════════════════════════════════════════════════════════

async function runFullScan(env: Env, label: string): Promise<void> {
  // ── Broker Manager: begin cycle (collect all, decide once) ──
  beginCycle();

  // ── v3: Detect Market Regime First ──
  await runRegimeScan(env);

  // ── Agent 1: Stock Technical Scan ──
  await runStockTechnicalScan(env, label);

  // ── v3 Engine 1: Multi-Timeframe Momentum ──
  await runMTFScan(env);

  // ── v3 Engine 2: Smart Money Concepts ──
  await runSmartMoneyScan(env);

  // ── Agent 2: Statistical Arbitrage / Pairs Scan ──
  await runPairsScan(env);

  // ── Agent 3: Crypto Whale Scan ──
  await runCryptoWhaleScan(env);

  // ── Agent 4: Polymarket Value Bets ──
  await runPolymarketScan(env);

  // ── Agent 5: Commodity + Macro Scan ──
  await runCommodityScan(env);

  // ── v3 Engine 4: Options-Grade Setups ──
  await runOptionsScan(env);

  // ── v3 Engine 6: Event-Driven (News + Earnings) ──
  await runEventDrivenScan(env);

  // ── Scrapers (Finviz/Google Finance) ──
  await runScraperScan(env);

  // ── Broker Manager: decide and send ──
  const sent = await flushCycle(env);

  // ── Update engine performance stats from today's signals ──
  try {
    if (env.DB) {
      const today = new Date().toISOString().split('T')[0];
      const todayStart = new Date(today).getTime();
      const rows = await env.DB.prepare(
        `SELECT engine_id, COUNT(*) as cnt FROM signals WHERE created_at >= ? GROUP BY engine_id`
      ).bind(todayStart).all();
      const counts: Record<string, number> = {};
      for (const r of (rows.results || []) as any[]) {
        counts[r.engine_id] = r.cnt;
      }
      const engines = ['MTF_MOMENTUM', 'SMART_MONEY', 'STAT_ARB', 'OPTIONS', 'CRYPTO_DEFI', 'EVENT_DRIVEN'];
      for (const engine of engines) {
        await recordEnginePerformance(engine, counts[engine] || 0, 0, 0, 1.0, env);
      }
    }
  } catch (e) {
    console.log('[Cron] Engine stats update failed:', e);
  }

  console.log(`[Cron] ${label}: Full scan complete — Broker sent ${sent} messages`);
}

async function runStockTechnicalScan(env: Env, label: string): Promise<void> {
  const watchlist = getWatchlist(env);
  let totalSignals = 0;

  for (const symbol of watchlist) {
    const [quote, ohlcv] = await Promise.all([
      yahooFinance.getQuote(symbol),
      yahooFinance.getOHLCV(symbol, '2y', '1d'),
    ]);

    if (!quote) continue;

    const indicators = computeIndicators(symbol, ohlcv);
    const fibonacci = ohlcv.length > 0 ? calculateFibonacci(symbol, ohlcv, quote.price) : null;
    const signals = detectSignals(quote, indicators, fibonacci, env);

    const importantSignals = signals.filter((s) => s.priority === 'CRITICAL' || s.priority === 'IMPORTANT');
    if (importantSignals.length > 0) {
      // Push to broker manager instead of direct Telegram send
      pushTechnical(importantSignals, quote, indicators, fibonacci);
      totalSignals += importantSignals.length;
    }
  }

  // 52-Week analysis → push as context, not separate messages
  for (const symbol of watchlist) {
    const analysis = await yahooFinance.getQuoteWith52WeekAnalysis(symbol);
    if (!analysis) continue;
    if (analysis.nearHigh || analysis.nearLow || analysis.atNewHigh || analysis.atNewLow) {
      const label52 = analysis.atNewHigh ? `🚀 ${symbol} NEW 52W HIGH $${analysis.quote.price.toFixed(2)}`
        : analysis.atNewLow ? `⚠️ ${symbol} NEW 52W LOW $${analysis.quote.price.toFixed(2)}`
        : analysis.nearHigh ? `📈 ${symbol} near 52W high (${(analysis.position52w * 100).toFixed(0)}%)`
        : `📉 ${symbol} near 52W low (${(analysis.position52w * 100).toFixed(0)}%)`;
      addContext(label52);
    }
  }

  if (totalSignals > 0) {
    console.log(`[Agent1] ${label}: ${totalSignals} technical signals pushed to broker`);
  }
}

async function runCryptoWhaleScan(env: Env): Promise<void> {
  try {
    // Check top pairs for whale activity
    const ethPairs = await dexscreener.searchPairs('WETH');
    const solPairs = await dexscreener.searchPairs('SOL');
    const allPairs = [...ethPairs, ...solPairs];

    const whaleSignals = dexscreener.detectWhaleActivity(allPairs);

    if (whaleSignals.length > 0) {
      for (const signal of whaleSignals.slice(0, 5)) {
        await pushCryptoDefi({
          symbol: signal.pair,
          type: signal.type,
          volume: signal.volume24h,
          priceChange: signal.priceChange24h,
          liquidity: signal.liquidity,
        }, Math.min(90, 50 + (signal.volume24h / 1e6) * 5), env.DB);
      }
    } else {
      // Fallback: top-volume DEX pairs with significant moves (> 5%)
      const movers = allPairs
        .filter(p => p.volume24h > 100_000 && Math.abs(p.priceChange24h) > 5)
        .sort((a, b) => b.volume24h - a.volume24h)
        .slice(0, 3);
      for (const p of movers) {
        await pushCryptoDefi({
          symbol: `${p.baseTokenSymbol}/${p.quoteTokenSymbol}`,
          type: p.priceChange24h > 0 ? 'DEX_MOVER_UP' : 'DEX_MOVER_DOWN',
          volume: p.volume24h,
          priceChange: p.priceChange24h,
          liquidity: p.liquidity,
        }, Math.min(80, 50 + Math.abs(p.priceChange24h) * 1.5), env.DB);
      }
    }

    // CoinGecko trending
    const trending = await coingecko.getTrendingCoins();
    if (trending.length > 0) {
      for (const coin of trending.slice(0, 3)) {
        await pushCryptoDefi({
          symbol: coin.symbol.toUpperCase(),
          type: 'TRENDING',
          volume: 0,
          priceChange: 0,
          liquidity: 0,
        }, 55, env.DB);
      }
    }
  } catch (err) {
    console.error('[Agent3] Crypto scan error:', err);
  }
}

async function runPolymarketScan(env: Env): Promise<void> {
  try {
    const markets = await polymarket.getActiveMarkets(20);
    const valueBets = polymarket.findValueBets(markets, 10000, [0.15, 0.85]);

    if (valueBets.length > 0) {
      for (const market of valueBets.slice(0, 3)) {
        const topOutcome = market.outcomes[0];
        const direction: 'BUY' | 'SELL' = topOutcome && topOutcome.price > 0.5 ? 'BUY' : 'SELL';
        const conf = Math.min(85, 50 + (market.volume / 100000) * 5);
        await pushEventDriven(
          market.id || 'POLYMARKET',
          'VALUE_BET',
          direction,
          conf,
          `Polymarket value bet: ${market.question.slice(0, 60)} | Vol: $${(market.volume / 1000).toFixed(0)}K`,
          [`Outcome: ${topOutcome?.name || '?'} (${((topOutcome?.price || 0) * 100).toFixed(0)}%)`, `Volume: $${(market.volume / 1000).toFixed(0)}K`],
          undefined,
          env.DB,
        );
      }
    }
  } catch (err) {
    console.error('[Agent4] Polymarket scan error:', err);
  }
}

async function runCommodityScan(env: Env): Promise<void> {
  try {
    const [commodities, yieldCurve] = await Promise.all([
      yahooFinance.getCommodityPrices(),
      fred.checkYieldCurve(env.FRED_API_KEY),
      fred.getCommodityPrices(env.FRED_API_KEY),
    ]);

    // Yield curve alert — route through broker as event-driven
    if (yieldCurve && yieldCurve.inverted) {
      await pushEventDriven(
        'MACRO',
        'YIELD_CURVE_INVERSION',
        'SELL',
        75,
        `Yield curve inverted: spread ${yieldCurve.spread.toFixed(2)}%. ${yieldCurve.signal}`,
        [`Spread: ${yieldCurve.spread.toFixed(2)}%`, yieldCurve.signal],
        undefined,
        env.DB,
      );
    }

    // Big commodity price moves (> 3% daily change)
    if (commodities && commodities.length > 0) {
      for (const c of commodities) {
        if (Math.abs(c.changePercent) >= 3) {
          const direction: 'BUY' | 'SELL' = c.changePercent > 0 ? 'BUY' : 'SELL';
          const conf = Math.min(85, 55 + Math.abs(c.changePercent) * 3);
          const name = c.symbol === 'GC=F' ? 'Gold' : c.symbol === 'SI=F' ? 'Silver' : c.symbol === 'CL=F' ? 'Oil (WTI)' : c.symbol === 'BZ=F' ? 'Oil (Brent)' : c.symbol === 'NG=F' ? 'Natural Gas' : c.symbol === 'HG=F' ? 'Copper' : c.symbol === 'PL=F' ? 'Platinum' : c.symbol;
          await pushEventDriven(
            c.symbol,
            'COMMODITY_MOVE',
            direction,
            conf,
            `${name} ${direction === 'BUY' ? 'surging' : 'plunging'} ${c.changePercent > 0 ? '+' : ''}${c.changePercent.toFixed(1)}% — $${c.price.toFixed(2)}`,
            [
              `Price: $${c.price.toFixed(2)}`,
              `Change: ${c.changePercent > 0 ? '+' : ''}${c.changePercent.toFixed(1)}%`,
              `Volume: ${c.volume.toLocaleString()}`,
            ],
            undefined,
            env.DB,
          );
        }
      }
    }
  } catch (err) {
    console.error('[Agent5] Commodity scan error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════
// EVENING SUMMARY
// ═══════════════════════════════════════════════════════════════

async function runEveningSummary(env: Env): Promise<void> {
  // ── Tracked instruments ──
  const TRACKED_INDICES = ['^GSPC', '^IXIC', '^DJI'];
  const TRACKED_COMMODITIES = ['GC=F', 'CL=F'];
  const TRACKED_CRYPTO = ['bitcoin'];

  // Get open holdings so we include their symbols too
  const openTrades = env.DB ? await getOpenTrades(env.DB) : [];
  const holdingSymbols = [...new Set(openTrades.filter(t => t.side === 'BUY').map(t => t.symbol))];

  // Fetch data for tracked investments only
  const quotesToFetch = [...new Set([...TRACKED_COMMODITIES, ...holdingSymbols])];

  const [trackedQuotes, cryptoPrices, indices] = await Promise.all([
    quotesToFetch.length > 0 ? yahooFinance.getMultipleQuotes(quotesToFetch) : Promise.resolve([]),
    coingecko.getCryptoPrices(TRACKED_CRYPTO),
    yahooFinance.getMarketIndices(),
  ]);

  const lines: string[] = [
    `📋 <b>YMSA Evening Summary</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
  ];

  // Market indices (S&P 500, NASDAQ, DOW JONES)
  const trackedIndices = indices.filter(idx => TRACKED_INDICES.includes(idx.symbol));
  if (trackedIndices.length > 0) {
    lines.push(``, `📊 <b>Market Indices:</b>`);
    for (const idx of trackedIndices) {
      const emoji = idx.changePercent >= 0 ? '🟢' : '🔴';
      const name = idx.symbol === '^GSPC' ? 'S&P 500' : idx.symbol === '^IXIC' ? 'NASDAQ' : idx.symbol === '^DJI' ? 'DOW JONES' : idx.symbol;
      lines.push(`  ${emoji} <b>${name}</b>: ${idx.price.toLocaleString()} (${idx.changePercent >= 0 ? '+' : ''}${idx.changePercent.toFixed(2)}%)`);
    }
  }

  // Gold & Oil
  const commodityQuotes = trackedQuotes.filter(q => TRACKED_COMMODITIES.includes(q.symbol));
  if (commodityQuotes.length > 0) {
    lines.push(``, `🛢️ <b>Commodities:</b>`);
    for (const q of commodityQuotes) {
      const emoji = q.changePercent >= 0 ? '🟢' : '🔴';
      const name = q.symbol === 'GC=F' ? 'GOLD' : q.symbol === 'CL=F' ? 'Oil (WTI)' : q.symbol;
      lines.push(`  ${emoji} <b>${name}</b>: $${q.price.toFixed(2)} (${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%)`);
    }
  }

  // Bitcoin
  if (cryptoPrices.length > 0) {
    lines.push(``, `₿ <b>Bitcoin:</b>`);
    for (const c of cryptoPrices) {
      const emoji = c.priceChange24h >= 0 ? '📈' : '📉';
      lines.push(`  ${emoji} <b>BTC</b>: $${c.price.toLocaleString()} (${c.priceChange24h >= 0 ? '+' : ''}${c.priceChange24h.toFixed(1)}%)`);
    }
  }

  // ── Holdings Report ──
  if (openTrades.length > 0) {
    const holdingQuoteMap = new Map(trackedQuotes.map(q => [q.symbol, q]));

    lines.push(``, `💼 <b>Holdings Summary:</b>`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);

    let totalDailyPnl = 0;
    let totalAccPnl = 0;

    for (const trade of openTrades) {
      if (trade.side !== 'BUY') continue;
      const quote = holdingQuoteMap.get(trade.symbol);
      const closingPrice = quote ? quote.price : 0;
      const entryPrice = trade.entry_price;
      const qty = trade.qty;
      const tradeDate = new Date(trade.opened_at).toISOString().slice(0, 10);

      // Daily P/L: today's change * qty
      const dailyPnl = quote ? (quote.changePercent / 100) * closingPrice * qty : 0;
      // Accumulated P/L: (current - entry) * qty
      const accPnl = (closingPrice - entryPrice) * qty;

      totalDailyPnl += dailyPnl;
      totalAccPnl += accPnl;

      const dailyEmoji = dailyPnl >= 0 ? '🟢' : '🔴';
      const accEmoji = accPnl >= 0 ? '🟢' : '🔴';

      lines.push(``);
      lines.push(`  <b>${trade.symbol}</b>`);
      lines.push(`  Closing: $${closingPrice.toFixed(2)} | Entry: $${entryPrice.toFixed(2)}`);
      lines.push(`  Date: ${tradeDate} | Qty: ${qty}`);
      lines.push(`  ${dailyEmoji} Daily P/L: $${dailyPnl >= 0 ? '+' : ''}${dailyPnl.toFixed(2)}`);
      lines.push(`  ${accEmoji} Accum P/L: $${accPnl >= 0 ? '+' : ''}${accPnl.toFixed(2)} (${((accPnl / (entryPrice * qty)) * 100).toFixed(1)}%)`);
    }

    if (openTrades.filter(t => t.side === 'BUY').length > 1) {
      lines.push(``);
      lines.push(`  ─────────────────`);
      const tDailyEmoji = totalDailyPnl >= 0 ? '🟢' : '🔴';
      const tAccEmoji = totalAccPnl >= 0 ? '🟢' : '🔴';
      lines.push(`  ${tDailyEmoji} <b>Total Daily P/L:</b> $${totalDailyPnl >= 0 ? '+' : ''}${totalDailyPnl.toFixed(2)}`);
      lines.push(`  ${tAccEmoji} <b>Total Accum P/L:</b> $${totalAccPnl >= 0 ? '+' : ''}${totalAccPnl.toFixed(2)}`);
    }
  }

  // Google Alerts digest
  try {
    const newsAlerts = await fetchGoogleAlerts();
    if (newsAlerts.length > 0) {
      if (env.DB) await storeNewsAlerts(newsAlerts, env.DB);
      const recent = newsAlerts.filter(n => Date.now() - new Date(n.published).getTime() < 12 * 60 * 60 * 1000);
      if (recent.length > 0) {
        lines.push(``, `🔔 <b>Today's Google Alerts (${recent.length}):</b>`);
        for (const alert of recent.slice(0, 8)) {
          lines.push(`  • [${alert.category}] ${alert.title.slice(0, 70)}${alert.title.length > 70 ? '...' : ''}`);
        }
      }
    }
  } catch {}

  lines.push(``, `━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`🌙 <i>See you tomorrow!</i>`);

  await sendDailyBriefing(lines.join('\n'), env);
}

// ═══════════════════════════════════════════════════════════════
// AFTER-HOURS SCAN — Earnings + News
// ═══════════════════════════════════════════════════════════════

async function runAfterHoursScan(env: Env): Promise<void> {
  const watchlist = getWatchlist(env);

  for (const symbol of watchlist) {
    const news = await finnhub.getCompanyNews(symbol, env, 1);
    if (news.length > 0) {
      const lines = [
        `📰 <b>After-Hours — ${symbol}</b>`,
        ``,
      ];
      for (const item of news.slice(0, 3)) {
        lines.push(`• ${item.headline}`);
        lines.push(`  <a href="${item.url}">Read more</a>`);
      }
      await sendTelegramMessage(lines.join('\n'), env);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// WEEKLY REVIEW — Sunday 09:00 IST
// Full portfolio + all arenas overview + macro
// ═══════════════════════════════════════════════════════════════

async function runWeeklyReview(env: Env): Promise<void> {
  const watchlist = getWatchlist(env);
  const cryptoList = getCryptoWatchlist(env);

  const [stockQuotes, cryptoPrices, cryptoGlobal, macroDashboard, yieldCurve, topMarkets, commodities] = await Promise.all([
    yahooFinance.getMultipleQuotes(watchlist),
    coingecko.getCryptoPrices(cryptoList),
    coingecko.getGlobalMarket(),
    fred.getMacroDashboard(env.FRED_API_KEY),
    fred.checkYieldCurve(env.FRED_API_KEY),
    polymarket.getTopMarkets(5),
    yahooFinance.getCommodityPrices(),
  ]);

  const lines: string[] = [
    `📊 <b>YMSA Weekly Review</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
  ];

  // Stocks with RSI
  lines.push(``, `📋 <b>Watchlist + RSI:</b>`);
  for (const quote of stockQuotes) {
    const ohlcv = await yahooFinance.getOHLCV(quote.symbol, '2y', '1d');
    const localInds = computeIndicators(quote.symbol, ohlcv);
    const rsi = localInds.find((i) => i.indicator === 'RSI') ?? null;
    const rsiLabel = rsi
      ? rsi.value > 70 ? '⚠️ OB'
        : rsi.value < 30 ? '⚠️ OS'
          : `${rsi.value.toFixed(0)}`
      : 'N/A';
    const w52 = await yahooFinance.getQuoteWith52WeekAnalysis(quote.symbol);
    const w52Label = w52 ? `${(w52.position52w * 100).toFixed(0)}%` : '';
    lines.push(`  <b>${quote.symbol}</b>: $${quote.price.toFixed(2)} | RSI: ${rsiLabel} | 52W: ${w52Label}`);
  }

  // Crypto
  if (cryptoPrices.length > 0) {
    lines.push(``, `🪙 <b>Crypto:</b>`);
    for (const c of cryptoPrices) {
      lines.push(`  <b>${c.symbol}</b>: $${c.price.toLocaleString()} (7d: ${c.priceChange7d?.toFixed(1) || '?'}%)`);
    }
    if (cryptoGlobal) {
      lines.push(`  Market: $${(cryptoGlobal.totalMarketCap / 1e12).toFixed(2)}T | BTC: ${cryptoGlobal.btcDominance.toFixed(1)}%`);
    }
  }

  // Commodities
  if (commodities.length > 0) {
    lines.push(``, `🛢️ <b>Commodities:</b>`);
    for (const c of commodities) {
      const name = Object.entries(yahooFinance.COMMODITY_SYMBOLS).find(([, v]) => v === c.symbol)?.[0] || c.symbol;
      lines.push(`  <b>${name}</b>: $${c.price.toFixed(2)} (${c.changePercent >= 0 ? '+' : ''}${c.changePercent.toFixed(1)}%)`);
    }
  }

  // Macro
  lines.push(``, `🏦 <b>Macro:</b>`);
  if (yieldCurve) lines.push(`  ${yieldCurve.signal} (${yieldCurve.spread.toFixed(2)}%)`);
  for (const m of macroDashboard.slice(0, 5)) {
    lines.push(`  ${m.id}: ${m.value.toFixed(2)} (${m.change >= 0 ? '+' : ''}${m.change.toFixed(2)})`);
  }

  // Polymarket
  if (topMarkets.length > 0) {
    lines.push(``, `🎯 <b>Prediction Markets:</b>`);
    for (const market of topMarkets.slice(0, 3)) {
      const outcome = market.outcomes[0];
      lines.push(`  • ${market.question.slice(0, 50)}... → ${outcome ? `${(outcome.price * 100).toFixed(0)}%` : '?'}`);
    }
  }

  lines.push(``, `━━━━━━━━━━━━━━━━━━━━━━`);

  // Z.AI Weekly Narrative
  if (isZAiAvailable(env)) {
    try {
      const metrics = await getPerformanceMetrics(env);
      const vixVal = macroDashboard.find((m) => m.id === 'VIXCLS')?.value || 0;

      // Compute real weekly P&L from closed trades in last 7 days
      const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const weekTrades = env.DB ? await getClosedTradesSince(env.DB, oneWeekAgo) : [];
      const weeklyPnl = weekTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
      const snapshot = await getPortfolioSnapshot(env);
      const equity = snapshot?.equity || 1;
      const weeklyPnlPct = equity > 0 ? (weeklyPnl / equity) * 100 : 0;
      // weekTrades already sorted by pnl DESC from query
      const topWinner = weekTrades.length > 0 && (weekTrades[0].pnl ?? 0) > 0
        ? `${weekTrades[0].symbol} (+$${(weekTrades[0].pnl ?? 0).toFixed(0)})`
        : 'N/A';
      const topLoser = weekTrades.length > 0 && (weekTrades[weekTrades.length - 1].pnl ?? 0) < 0
        ? `${weekTrades[weekTrades.length - 1].symbol} (-$${Math.abs(weekTrades[weekTrades.length - 1].pnl ?? 0).toFixed(0)})`
        : 'N/A';

      // Get current regime
      let regimeLabel = 'unknown';
      try {
        const regime = await detectRegime(env);
        if (regime) regimeLabel = regime.regime.replace('_', ' ');
      } catch { /* regime optional */ }

      const narrative = await weeklyNarrative((env as any).AI, {
        weeklyPnl,
        weeklyPnlPct,
        winRate: metrics.winRate || 0,
        totalTrades: weekTrades.length,
        topWinner,
        topLoser,
        regime: regimeLabel,
        vix: vixVal,
      });
      if (narrative) {
        lines.push(``, `🧠 <b>Z.AI Weekly Summary:</b>`);
        lines.push(narrative);
      }
    } catch (err) { console.error('[Z.AI] Weekly narrative failed:', err); }
  }

  lines.push(`📌 <i>Review positions, adjust watchlist. Good week ahead!</i>`);

  await sendDailyBriefing(lines.join('\n'), env);
}

// ═══════════════════════════════════════════════════════════════
// PAIRS / STAT-ARB SCAN — Agent 2
// Compares watchlist pairs for z-score divergence
// ═══════════════════════════════════════════════════════════════

async function runPairsScan(env: Env): Promise<void> {
  try {
    const watchlist = getWatchlist(env);
    if (watchlist.length < 2) return;

    // Fetch closing prices for all watchlist stocks
    const priceData: Record<string, number[]> = {};
    for (const symbol of watchlist) {
      const ohlcv = await yahooFinance.getOHLCV(symbol, '3mo', '1d');
      if (ohlcv.length > 0) {
        priceData[symbol] = ohlcv.map((c) => c.close);
      }
    }

    // Scan all pairs and find tradable opportunities
    const allPairs = scanPairs(Object.keys(priceData), priceData);
    const tradable = findTradablePairs(allPairs);

    if (tradable.length > 0) {
      // Route through broker manager with STAT_ARB engine ID
      for (const pair of tradable.slice(0, 5)) {
        const quoteA = await yahooFinance.getQuote(pair.symbolA);
        const quoteB = await yahooFinance.getQuote(pair.symbolB);
        if (quoteA && quoteB) {
          const direction = pair.currentZScore > 0 ? 'LONG_B_SHORT_A' : 'LONG_A_SHORT_B';
          await pushStatArb(
            { symbolA: pair.symbolA, symbolB: pair.symbolB, zScore: pair.currentZScore, direction, halfLife: pair.halfLife, correlation: pair.correlation },
            { a: quoteA, b: quoteB },
            env.DB,
          );
        }
      }
    }

    console.log(`[Agent2] Pairs scan: ${allPairs.length} pairs analyzed, ${tradable.length} tradable`);
  } catch (err) {
    console.error('[Agent2] Pairs scan error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════
// SCRAPER SCAN — Finviz + Google Finance via Playwright
// Uses Cloudflare Browser Rendering binding
// ═══════════════════════════════════════════════════════════════

async function runScraperScan(env: Env): Promise<void> {
  // Only run if BROWSER binding is available
  if (!env.BROWSER) {
    console.log('[Scrapers] BROWSER binding not available — skipping');
    return;
  }

  try {
    // Finviz: RSI oversold stocks (stock discovery beyond watchlist)
    const oversold = await scrapeOversoldStocks(env.BROWSER);
    if (oversold.length > 0) {
      const alert = formatFinvizAlert('Finviz: RSI Oversold Stocks', oversold);
      await sendTelegramMessage(alert, env);
    }

    // Finviz: New 52-week highs (momentum)
    const newHighs = await scrape52WeekHighs(env.BROWSER);
    if (newHighs.length > 0) {
      const alert = formatFinvizAlert('Finviz: New 52-Week Highs', newHighs);
      await sendTelegramMessage(alert, env);
    }

    console.log(`[Scrapers] Finviz: ${oversold.length} oversold, ${newHighs.length} new highs`);
  } catch (err) {
    console.error('[Scrapers] Finviz error:', err);
  }

  try {
    // Google Finance: Market overview (for morning/evening briefings)
    const overview = await scrapeMarketOverview(env.BROWSER);
    if (overview.indices.length > 0 || overview.trending.length > 0) {
      const alert = formatMarketOverview(overview);
      await sendTelegramMessage(alert, env);
    }

    console.log(`[Scrapers] Google Finance: ${overview.indices.length} indices, ${overview.trending.length} trending`);
  } catch (err) {
    console.error('[Scrapers] Google Finance error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════
// v3: OPENING RANGE BREAK — 15min after market open
// Scans Tier 1 watchlist for MTF + Smart Money confluence
// ═══════════════════════════════════════════════════════════════

async function runOpeningRangeBreak(env: Env): Promise<void> {
  beginCycle();
  const tier1 = (env.TIER1_WATCHLIST || env.DEFAULT_WATCHLIST).split(',').map(s => s.trim());
  const signals: ExecutableSignal[] = [];

  // Detect market regime first
  const regime = await detectRegime(env);
  if (regime) {
    setCurrentRegime(regime);
    setRegime(regime);
    addContext(formatRegimeAlert(regime));
  }

  for (const symbol of tier1.slice(0, 5)) { // limit to avoid rate limits
    try {
      const mtf = await analyzeMultiTimeframe(symbol, env);
      if (mtf && mtf.confluence >= 70) {
        pushMTF(mtf);

        const quote = await yahooFinance.getQuote(symbol);
        if (quote) {
          signals.push({
            engineId: 'MTF_MOMENTUM',
            symbol,
            direction: mtf.suggestedAction === 'WAIT' ? 'BUY' : mtf.suggestedAction,
            strength: mtf.confluence,
            signalType: mtf.suggestedAction === 'BUY' ? 'MTF_CONFLUENCE_BUY' : 'MTF_CONFLUENCE_SELL',
            entryPrice: quote.price,
            atr: quote.price * 0.02,
          });
        }
      }
    } catch (err) {
      console.error(`[ORB] ${symbol} error:`, err);
    }
  }

  // Execute batch if any signals found
  if (signals.length > 0) {
    const results = await executeBatch(signals, env);
    await sendExecutionAlert(formatBatchResults(results), env);
  }

  // Broker manager decides what trade alerts to send
  const sent = await flushCycle(env);
  console.log(`[v3] Opening Range Break: ${signals.length} signals, Broker sent ${sent} messages`);
}

// ═══════════════════════════════════════════════════════════════
// v3: QUICK PULSE — Every 5min during market hours
// Smart Money detection on top movers only
// ═══════════════════════════════════════════════════════════════

async function runQuickPulse(env: Env): Promise<void> {
  beginCycle();
  const watchlist = getWatchlist(env);

  for (const symbol of watchlist.slice(0, 3)) { // rate limit: only top 3
    try {
      const ohlcv = await yahooFinance.getOHLCV(symbol, '1mo', '1d');
      if (ohlcv.length < 20) continue;

      const candles = ohlcv.map(c => ({ open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, timestamp: c.timestamp }));
      const quote = await yahooFinance.getQuote(symbol);
      if (!quote) continue;
      const smc = analyzeSmartMoney(symbol, candles, quote.price);

      if (smc.score >= 70) {
        const indicators = computeIndicators(symbol, ohlcv);
        const atr = indicators.find(i => i.indicator === 'ATR')?.value ?? null;
        pushSmartMoney(smc, quote, atr, indicators);
      }
    } catch (err) {
      console.error(`[Pulse] ${symbol} error:`, err);
    }
  }

  await flushCycle(env);
}

// ═══════════════════════════════════════════════════════════════
// v3: REGIME SCAN — Detect market regime and store history
// ═══════════════════════════════════════════════════════════════

async function runRegimeScan(env: Env): Promise<void> {
  try {
    const regime = await detectRegime(env);
    if (regime) {
      setCurrentRegime(regime);
      // Push to broker manager instead of direct Telegram
      setRegime(regime);
      addContext(formatRegimeAlert(regime));
      const adjustments = getEngineAdjustments(regime);
      console.log(`[v3] Regime: ${regime.regime} | Adjustments: ${JSON.stringify(adjustments)}`);
    }
  } catch (err) {
    console.error('[v3] Regime scan error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════
// v3: MTF SCAN — Multi-Timeframe Momentum (Engine 1)
// Scans Tier 1 watchlist for MTF confluence signals
// ═══════════════════════════════════════════════════════════════

async function runMTFScan(env: Env): Promise<void> {
  const tier1 = (env.TIER1_WATCHLIST || env.DEFAULT_WATCHLIST).split(',').map(s => s.trim());
  const signals: ExecutableSignal[] = [];

  for (const symbol of tier1.slice(0, 8)) { // rate limit aware
    try {
      const mtf = await analyzeMultiTimeframe(symbol, env);
      if (mtf && mtf.confluence >= 65) {
        // Push to broker manager instead of direct Telegram send
        pushMTF(mtf);

        if (mtf.confluence >= 70) {
          const quote = await yahooFinance.getQuote(symbol);
          if (quote) {
            signals.push({
              engineId: 'MTF_MOMENTUM',
              symbol,
              direction: mtf.suggestedAction === 'WAIT' ? 'BUY' : mtf.suggestedAction,
              strength: mtf.confluence,
              signalType: mtf.suggestedAction === 'BUY' ? 'MTF_CONFLUENCE_BUY' : 'MTF_CONFLUENCE_SELL',
              entryPrice: quote.price,
              atr: quote.price * 0.02,
            });
          }
        }
      }
    } catch (err) {
      console.error(`[MTF] ${symbol} error:`, err);
    }
  }

  if (signals.length > 0) {
    const results = await executeBatch(signals, env);
    await sendExecutionAlert(formatBatchResults(results), env);
  }

  console.log(`[v3] MTF scan: ${signals.length} executable signals from ${tier1.length} symbols`);
}

// ═══════════════════════════════════════════════════════════════
// v3: SMART MONEY SCAN — Order Blocks, FVGs, Sweeps (Engine 2)
// ═══════════════════════════════════════════════════════════════

async function runSmartMoneyScan(env: Env): Promise<void> {
  const tier1 = (env.TIER1_WATCHLIST || env.DEFAULT_WATCHLIST).split(',').map(s => s.trim());
  const signals: ExecutableSignal[] = [];

  for (const symbol of tier1.slice(0, 8)) {
    try {
      const ohlcv = await yahooFinance.getOHLCV(symbol, '3mo', '1d');
      if (ohlcv.length < 20) continue;

      const candles = ohlcv.map(c => ({ open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, timestamp: c.timestamp }));
      const quote = await yahooFinance.getQuote(symbol);
      if (!quote) continue;

      const smc = analyzeSmartMoney(symbol, candles, quote.price);
      if (smc.score >= 60) {
        // Push to broker manager instead of direct Telegram send
        const indicators = computeIndicators(symbol, ohlcv);
        const atr = indicators.find(i => i.indicator === 'ATR')?.value ?? null;
        pushSmartMoney(smc, quote, atr, indicators);

        if (smc.score >= 75 && smc.overallBias !== 'NEUTRAL') {
          signals.push({
            engineId: 'SMART_MONEY',
            symbol,
            direction: smc.overallBias === 'BULLISH' ? 'BUY' : 'SELL',
            strength: smc.score,
            signalType: smc.signals[0]?.type === 'ORDER_BLOCK' ? 'ORDER_BLOCK' : smc.signals[0]?.type === 'FVG' ? 'FAIR_VALUE_GAP' : 'LIQUIDITY_SWEEP',
            entryPrice: quote.price,
            atr: quote.price * 0.02,
          });
        }
      }
    } catch (err) {
      console.error(`[SMC] ${symbol} error:`, err);
    }
  }

  if (signals.length > 0) {
    const results = await executeBatch(signals, env);
    await sendExecutionAlert(formatBatchResults(results), env);
  }

  console.log(`[v3] Smart Money scan: ${signals.length} executable signals`);
}

// ═══════════════════════════════════════════════════════════════
// v3 Engine 4: OPTIONS — High-IV / BB Squeeze / RSI Extreme setups
// Scans for options-grade entries: high volatility + directional bias
// ═══════════════════════════════════════════════════════════════

async function runOptionsScan(env: Env): Promise<void> {
  const watchlist = getWatchlist(env);

  for (const symbol of watchlist) {
    try {
      const [quote, ohlcv] = await Promise.all([
        yahooFinance.getQuote(symbol),
        yahooFinance.getOHLCV(symbol, '6mo', '1d'),
      ]);
      if (!quote || ohlcv.length < 30) continue;

      const indicators = computeIndicators(symbol, ohlcv);
      const rsi = indicators.find(i => i.indicator === 'RSI')?.value;
      const atr = indicators.find(i => i.indicator === 'ATR')?.value;
      if (!rsi || !atr) continue;

      // Options-grade signal: BB squeeze + RSI extreme → directional play
      // High relative ATR (volatility proxy) = good for options premium
      const relativeATR = atr / quote.price;
      const isHighVol = relativeATR > 0.025; // >2.5% ATR relative to price
      const isRSIExtreme = rsi < 25 || rsi > 75;
      const isRSIOversold = rsi < 30;
      // RSI > 70 overbought already handled by isRSIExtreme above

      if (isHighVol && isRSIExtreme) {
        const direction: 'BUY' | 'SELL' = isRSIOversold ? 'BUY' : 'SELL';
        const conf = Math.min(90, 55 + (isRSIOversold ? (30 - rsi) * 2 : (rsi - 70) * 2) + (relativeATR > 0.04 ? 10 : 0));
        const signalType = isRSIOversold ? 'PUT_SELL_OPPORTUNITY' : 'CALL_SELL_OPPORTUNITY';
        await pushOptions(symbol, signalType, direction, conf, quote, indicators, env.DB);
      } else if (isHighVol && Math.abs(quote.changePercent) > 3) {
        // Large move + high vol → momentum options play
        const direction: 'BUY' | 'SELL' = quote.changePercent > 0 ? 'BUY' : 'SELL';
        const conf = Math.min(85, 55 + Math.abs(quote.changePercent) * 3);
        await pushOptions(symbol, 'MOMENTUM_OPTIONS', direction, conf, quote, indicators, env.DB);
      }
    } catch (err) {
      console.error(`[Options] ${symbol} error:`, err);
    }
  }

  console.log(`[v3] Options scan complete`);
}

// ═══════════════════════════════════════════════════════════════
// v3 Engine 6: EVENT_DRIVEN — News sentiment + Earnings catalysts
// Generates signals from Google Alerts news and earnings data
// ═══════════════════════════════════════════════════════════════

async function runEventDrivenScan(env: Env): Promise<void> {
  try {
    // Google Alerts news scan
    const news = await fetchGoogleAlerts();
    if (news.length > 0) {
      if (env.DB) {
        const inserted = await storeNewsAlerts(news, env.DB);
        console.log(`[v3] Event scan: stored ${inserted} new alerts`);
      }

      // Recent items (< 6 hours) — generate event-driven signals
      const recent = news.filter(n => Date.now() - new Date(n.published).getTime() < 6 * 60 * 60 * 1000);

      // Z.AI sentiment analysis for event-driven signals
      if (isZAiAvailable(env) && recent.length > 0) {
        try {
          const headlines = recent.slice(0, 10).map(n => n.title);
          const sentiment = await scoreNewsSentiment((env as any).AI, headlines);
          const strong = sentiment.filter(s => s.confidence >= 70);

          for (const s of strong.slice(0, 3)) {
            // Try to match headlines to watchlist symbols
            const watchlist = getWatchlist(env);
            const matchedSymbol = watchlist.find(sym =>
              s.headline.toUpperCase().includes(sym) ||
              s.headline.toUpperCase().includes(sym.replace('.', ''))
            );
            if (matchedSymbol) {
              const quote = await yahooFinance.getQuote(matchedSymbol);
              await pushEventDriven(
                matchedSymbol,
                `NEWS_${s.sentiment}`,
                s.sentiment === 'BULLISH' ? 'BUY' : 'SELL',
                s.confidence,
                `Z.AI news sentiment: ${s.headline.slice(0, 80)}`,
                [`Sentiment: ${s.sentiment} (${s.confidence}%)`, `Source: Google Alerts`],
                quote || undefined,
                env.DB,
              );
            }
          }
        } catch (err) {
          console.error('[Event] Z.AI sentiment error:', err);
        }
      }

      // Send news digest (non-trade alert) via context
      if (recent.length > 0) {
        addContext(formatNewsDigest(recent, 5));
      }
    }
  } catch (err) {
    console.error('[Event] News scan error:', err);
  }

  // Earnings-based event signals
  try {
    const earnings = await finnhub.getEarningsCalendar(env, 1);
    const watchlist = getWatchlist(env);
    for (const e of earnings) {
      if (watchlist.includes(e.symbol)) {
        const quote = await yahooFinance.getQuote(e.symbol);
        if (quote && Math.abs(quote.changePercent) > 3) {
          // Post-earnings move > 3% → event-driven signal
          const direction: 'BUY' | 'SELL' = quote.changePercent > 0 ? 'BUY' : 'SELL';
          const conf = Math.min(85, 55 + Math.abs(quote.changePercent) * 3);
          await pushEventDriven(
            e.symbol,
            'EARNINGS_REACTION',
            direction,
            conf,
            `Earnings reaction: ${e.symbol} moved ${quote.changePercent > 0 ? '+' : ''}${quote.changePercent.toFixed(1)}% post-earnings`,
            [`Move: ${quote.changePercent > 0 ? '+' : ''}${quote.changePercent.toFixed(1)}%`, `Time: ${e.hour === 'bmo' ? 'Pre-market' : 'After-hours'}`],
            quote,
            env.DB,
          );
        }
      }
    }
  } catch (err) {
    console.error('[Event] Earnings scan error:', err);
  }

  console.log(`[v3] Event-driven scan complete`);
}

// ═══════════════════════════════════════════════════════════════
// v3: MIDDAY REBALANCE — Check positions, adjust stops, news scan
// ═══════════════════════════════════════════════════════════════

async function runMiddayRebalance(env: Env): Promise<void> {
  // Portfolio check
  const snapshot = await getPortfolioSnapshot(env);
  if (snapshot) {
    await sendTelegramMessage(formatPortfolioSnapshot(snapshot), env);

    // Check kill switch
    const ks = evaluateKillSwitch(snapshot.dailyPnlPct);
    if (ks.level !== 'NONE') {
      const riskMsg = formatRiskEvent('KILL_SWITCH', 'CRITICAL', `Daily PnL: ${snapshot.dailyPnlPct.toFixed(2)}%`, ks.action);
      await sendRiskAlert(riskMsg, env);

      if (env.DB) {
        await insertRiskEvent(env.DB, generateId('risk'), 'KILL_SWITCH', 'CRITICAL', `Daily PnL: ${snapshot.dailyPnlPct.toFixed(2)}%`, ks.action);
      }
    }
  }

  // Google Alerts news scan
  try {
    const news = await fetchGoogleAlerts();
    if (news.length > 0) {
      if (env.DB) {
        const inserted = await storeNewsAlerts(news, env.DB);
        console.log(`[Midday] Stored ${inserted} news alerts`);
      }
      await sendTelegramMessage(formatNewsDigest(news, 5), env);
    }
  } catch (err) {
    console.error('[Midday] News scan error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════
// v3: OVERNIGHT SETUP — After-hours analysis + next-day prep
// ═══════════════════════════════════════════════════════════════

async function runOvernightSetup(env: Env): Promise<void> {
  // Record daily P&L
  await recordDailyPnl(env);

  // ── Auto-resolve PENDING Telegram alerts ──
  if (env.DB) {
    try {
      // 1. Expire alerts older than 7 days
      const expired = await expireOldTelegramAlerts(env.DB, 7 * 24 * 60 * 60 * 1000);
      if (expired > 0) console.log(`[Overnight] Auto-expired ${expired} old alerts`);

      // 2. Check pending alerts against current market prices
      const pending = await getPendingTelegramAlerts(env.DB);
      if (pending.length > 0) {
        const symbols = [...new Set(pending.map(a => a.symbol))];
        const quotes = await yahooFinance.getMultipleQuotes(symbols);
        const priceMap = new Map(quotes.map(q => [q.symbol, q.price]));

        let resolved = 0;
        for (const alert of pending) {
          const currentPrice = priceMap.get(alert.symbol);
          if (!currentPrice) continue;

          const entry = alert.entry_price;
          const sl = alert.stop_loss;
          const tp1 = alert.take_profit_1;
          const tp2 = alert.take_profit_2;
          const isBuy = alert.action === 'BUY';

          // Skip if entry_price is 0 or missing — can't calculate P&L
          if (!entry || entry <= 0) {
            // Auto-expire bad-data alerts after 5 days
            if ((Date.now() - alert.sent_at) > 5 * 24 * 60 * 60 * 1000) {
              await updateTelegramAlertOutcome(env.DB, alert.id, 'EXPIRED', currentPrice, null, null, 'Auto-expired: missing entry price');
              resolved++;
            }
            continue;
          }

          // Check stop loss hit
          if (sl && ((isBuy && currentPrice <= sl) || (!isBuy && currentPrice >= sl))) {
            const pnl = isBuy ? (currentPrice - entry) : (entry - currentPrice);
            const pnlPct = (pnl / entry) * 100;
            await updateTelegramAlertOutcome(env.DB, alert.id, 'LOSS', currentPrice, pnl, pnlPct, `Auto-resolved: SL hit at ${currentPrice.toFixed(2)}`);
            resolved++;
            continue;
          }

          // Check TP2 hit first (bigger win)
          if (tp2 && ((isBuy && currentPrice >= tp2) || (!isBuy && currentPrice <= tp2))) {
            const pnl = isBuy ? (currentPrice - entry) : (entry - currentPrice);
            const pnlPct = (pnl / entry) * 100;
            await updateTelegramAlertOutcome(env.DB, alert.id, 'WIN', currentPrice, pnl, pnlPct, `Auto-resolved: TP2 reached at ${currentPrice.toFixed(2)}`);
            resolved++;
            continue;
          }

          // Check TP1 hit
          if (tp1 && ((isBuy && currentPrice >= tp1) || (!isBuy && currentPrice <= tp1))) {
            const pnl = isBuy ? (currentPrice - entry) : (entry - currentPrice);
            const pnlPct = (pnl / entry) * 100;
            await updateTelegramAlertOutcome(env.DB, alert.id, 'WIN', currentPrice, pnl, pnlPct, `Auto-resolved: TP1 reached at ${currentPrice.toFixed(2)}`);
            resolved++;
            continue;
          }

          // Breakeven: price within 0.5% of entry AND >3 days old
          const moveFromEntry = isBuy ? (currentPrice - entry) / entry : (entry - currentPrice) / entry;
          if (Math.abs(moveFromEntry) < 0.005 && (Date.now() - alert.sent_at) > 3 * 24 * 60 * 60 * 1000) {
            await updateTelegramAlertOutcome(env.DB, alert.id, 'BREAKEVEN', currentPrice, 0, 0, 'Auto-resolved: price stagnant after 3 days');
            resolved++;
          }
        }
        if (resolved > 0) console.log(`[Overnight] Auto-resolved ${resolved} alerts`);
      }
    } catch (err) {
      console.error('[Overnight] Alert resolution error:', err);
    }
  }

  // Full news digest
  try {
    const news = await fetchGoogleAlerts();
    if (news.length > 0) {
      if (env.DB) await storeNewsAlerts(news, env.DB);
      await sendTelegramMessage(formatNewsDigest(news, 15), env);
    }
  } catch {}

  // Regime detection for next day planning
  const regime = await detectRegime(env);
  if (regime) {
    const adjustments = getEngineAdjustments(regime);
    const lines = [
      formatRegimeAlert(regime),
      '',
      '<b>Tomorrow\'s Engine Weights:</b>',
      ...Object.entries(adjustments).map(([engine, mult]) =>
        `  ${engine}: ${(mult * 100).toFixed(0)}%`
      ),
    ];
    await sendTelegramMessage(lines.join('\n'), env);
  }

  console.log('[v3] Overnight setup complete');
}

// ═══════════════════════════════════════════════════════════════
// v3: ML RETRAIN — Saturday: recalibrate pairs, update weights
// ═══════════════════════════════════════════════════════════════

async function runMLRetrain(env: Env): Promise<void> {
  // Recalibrate pairs trading
  await runPairsScan(env);

  // Record engine performance
  const engines = ['MTF_MOMENTUM', 'SMART_MONEY', 'STAT_ARB', 'OPTIONS', 'CRYPTO_DEFI', 'EVENT_DRIVEN'];
  for (const engine of engines) {
    try {
      await recordEnginePerformance(engine, 0, 0, 0, 1.0, env);
    } catch {}
  }

  await sendTelegramMessage('🤖 <b>ML Retrain Complete</b>\nPairs recalibrated. Engine weights updated.', env);
  console.log('[v3] ML retrain complete');
}

// ═══════════════════════════════════════════════════════════════
// v3: MONTHLY PERFORMANCE — 1st of month
// Full performance report with Sharpe, drawdown, per-engine breakdown
// ═══════════════════════════════════════════════════════════════

async function runMonthlyPerformance(env: Env): Promise<void> {
  const metrics = await getPerformanceMetrics(env);
  await sendTelegramMessage(formatPerformanceReport(metrics), env);

  const snapshot = await getPortfolioSnapshot(env);
  if (snapshot) {
    await sendTelegramMessage(formatPortfolioSnapshot(snapshot), env);
  }

  console.log('[v3] Monthly performance report sent');
}
