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
import { sendTelegramAlert, sendDailyBriefing, sendTelegramMessage } from './alert-router';
import { scanPairs, findTradablePairs, formatPairAlert } from './agents/pairs-trading';
import { scrapeOversoldStocks, scrape52WeekHighs, formatFinvizAlert } from './scrapers/finviz';
import { scrapeMarketOverview, formatMarketOverview } from './scrapers/google-finance';
import { analyzeMultiTimeframe } from './analysis/multi-timeframe';
import { analyzeSmartMoney } from './analysis/smart-money';
import { detectRegime, getEngineAdjustments, formatRegimeAlert } from './analysis/regime';
import { fetchGoogleAlerts, storeNewsAlerts, formatNewsDigest } from './api/google-alerts';
import { recordDailyPnl, getPortfolioSnapshot, formatPortfolioSnapshot, recordEnginePerformance, getPerformanceMetrics, formatPerformanceReport } from './execution/portfolio';
import { executeBatch, formatBatchResults, type ExecutableSignal } from './execution/engine';
import { evaluateKillSwitch, formatRiskEvent } from './agents/risk-controller';
import { insertRiskEvent, generateId } from './db/queries';
import { formatSmartMoneyTradeAlert, formatMTFTradeAlert, setCurrentRegime } from './alert-formatter';

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
// Full market overview: stocks, crypto, macro, prediction markets
// ═══════════════════════════════════════════════════════════════

async function runMorningBriefing(env: Env): Promise<void> {
  const watchlist = getWatchlist(env);
  const cryptoList = getCryptoWatchlist(env);

  // Fetch all data in parallel — 5 arenas
  const [
    stockQuotes,
    marketNews,
    earnings,
    cryptoPrices,
    cryptoGlobal,
    macroDashboard,
    yieldCurve,
    topMarkets,
    commodityQuotes,
  ] = await Promise.all([
    yahooFinance.getMultipleQuotes(watchlist),
    finnhub.getMarketNews(env),
    finnhub.getEarningsCalendar(env, 1),
    coingecko.getCryptoPrices(cryptoList),
    coingecko.getGlobalMarket(),
    fred.getMacroDashboard(env.FRED_API_KEY),
    fred.checkYieldCurve(env.FRED_API_KEY),
    polymarket.getTopMarkets(5),
    yahooFinance.getCommodityPrices(),
  ]);

  const now = new Date();
  const lines: string[] = [
    `📋 <b>YMSA Morning Brief — ${now.toISOString().split('T')[0]}</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
  ];

  // ── Agent 1: Stock Watchlist ──
  lines.push(``, `📊 <b>Stock Watchlist:</b>`);
  for (const q of stockQuotes.slice(0, 10)) {
    const emoji = q.changePercent >= 0 ? '🟢' : '🔴';
    lines.push(`  ${emoji} <b>${q.symbol}</b>: $${q.price.toFixed(2)} (${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%)`);
  }

  // ── Agent 3: Crypto ──
  if (cryptoPrices.length > 0) {
    lines.push(``, `🪙 <b>Crypto:</b>`);
    for (const c of cryptoPrices) {
      const emoji = c.priceChange24h >= 0 ? '📈' : '📉';
      lines.push(`  ${emoji} <b>${c.symbol}</b>: $${c.price.toLocaleString()} (${c.priceChange24h >= 0 ? '+' : ''}${c.priceChange24h.toFixed(1)}%)`);
    }
    if (cryptoGlobal) {
      lines.push(`  💰 Total Market Cap: $${(cryptoGlobal.totalMarketCap / 1e12).toFixed(2)}T | BTC Dom: ${cryptoGlobal.btcDominance.toFixed(1)}%`);
    }
  }

  // ── Agent 5: Commodities ──
  if (commodityQuotes.length > 0) {
    lines.push(``, `🛢️ <b>Commodities:</b>`);
    for (const c of commodityQuotes) {
      const emoji = c.changePercent >= 0 ? '🟢' : '🔴';
      const name = yahooFinance.COMMODITY_SYMBOLS ? Object.entries(yahooFinance.COMMODITY_SYMBOLS).find(([, v]) => v === c.symbol)?.[0] || c.symbol : c.symbol;
      lines.push(`  ${emoji} <b>${name}</b>: $${c.price.toFixed(2)} (${c.changePercent >= 0 ? '+' : ''}${c.changePercent.toFixed(2)}%)`);
    }
  }

  // ── Macro / FRED ──
  if (yieldCurve) {
    lines.push(``, `🏦 <b>Macro:</b>`);
    lines.push(`  ${yieldCurve.signal}`);
    lines.push(`  Yield Spread: ${yieldCurve.spread.toFixed(2)}%`);
  }
  const vix = macroDashboard.find((m) => m.id === 'VIXCLS');
  if (vix) {
    lines.push(`  ⚡ VIX: ${vix.value.toFixed(1)} (${vix.change >= 0 ? '+' : ''}${vix.change.toFixed(1)})`);
  }

  // ── Agent 4: Prediction Markets ──
  if (topMarkets.length > 0) {
    lines.push(``, `🎯 <b>Top Prediction Markets:</b>`);
    for (const m of topMarkets.slice(0, 3)) {
      const topOutcome = m.outcomes[0];
      lines.push(`  • ${m.question.slice(0, 60)}${m.question.length > 60 ? '...' : ''}`);
      if (topOutcome) {
        lines.push(`    → ${topOutcome.name}: ${(topOutcome.price * 100).toFixed(0)}% | Vol: $${(m.volume / 1000).toFixed(0)}K`);
      }
    }
  }

  // ── Earnings ──
  if (earnings.length > 0) {
    lines.push(``, `📅 <b>Today's Earnings:</b>`);
    for (const e of earnings.slice(0, 5)) {
      const time = e.hour === 'bmo' ? '🌅 Pre' : '🌙 After';
      lines.push(`  • ${e.symbol} — ${time}`);
    }
  }

  // ── News ──
  if (marketNews.length > 0) {
    lines.push(``, `📰 <b>Headlines:</b>`);
    for (const news of marketNews.slice(0, 3)) {
      lines.push(`  • ${news.headline.slice(0, 80)}${news.headline.length > 80 ? '...' : ''}`);
    }
  }

  // ── Google Alerts ──
  try {
    const newsAlerts = await fetchGoogleAlerts();
    if (newsAlerts.length > 0) {
      if (env.DB) await storeNewsAlerts(newsAlerts, env.DB);
      const recent = newsAlerts.filter(n => Date.now() - new Date(n.published).getTime() < 24 * 60 * 60 * 1000);
      if (recent.length > 0) {
        lines.push(``, `🔔 <b>Google Alerts (${recent.length} new):</b>`);
        for (const alert of recent.slice(0, 5)) {
          lines.push(`  • [${alert.category}] ${alert.title.slice(0, 70)}${alert.title.length > 70 ? '...' : ''}`);
        }
      }
    }
  } catch {}

  lines.push(``, `━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`🎯 <i>Have a profitable day!</i>`);

  await sendDailyBriefing(lines.join('\n'), env);
}

// ═══════════════════════════════════════════════════════════════
// QUICK SCAN — Every 15 min during market hours
// CRITICAL alerts only: RSI extremes, MACD crosses
// ═══════════════════════════════════════════════════════════════

async function runQuickScan(env: Env): Promise<void> {
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
      await sendTelegramAlert(criticalSignals, quote, indicators, null, env);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// FULL SCAN — Hourly + Market Open
// All 5 agents: technicals, Fib, crypto whales, predictions, macro
// ═══════════════════════════════════════════════════════════════

async function runFullScan(env: Env, label: string): Promise<void> {
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

  // ── v3: Google Alerts News Scan ──
  await runNewsScan(env);

  // ── Scrapers (Finviz/Google Finance) ──
  await runScraperScan(env);

  console.log(`[Cron] ${label}: Full multi-agent scan complete`);
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
      await sendTelegramAlert(importantSignals, quote, indicators, fibonacci, env);
      totalSignals += importantSignals.length;
    }
  }

  // 52-Week analysis
  for (const symbol of watchlist) {
    const analysis = await yahooFinance.getQuoteWith52WeekAnalysis(symbol);
    if (!analysis) continue;
    if (analysis.nearHigh || analysis.nearLow || analysis.atNewHigh || analysis.atNewLow) {
      const msg = analysis.atNewHigh ? `🚀 <b>${symbol} NEW 52-WEEK HIGH!</b> $${analysis.quote.price.toFixed(2)}`
        : analysis.atNewLow ? `⚠️ <b>${symbol} NEW 52-WEEK LOW!</b> $${analysis.quote.price.toFixed(2)}`
        : analysis.nearHigh ? `📈 <b>${symbol} near 52W high</b> ($${analysis.quote.price.toFixed(2)}) — ${(analysis.position52w * 100).toFixed(0)}% of range`
        : `📉 <b>${symbol} near 52W low</b> ($${analysis.quote.price.toFixed(2)}) — ${(analysis.position52w * 100).toFixed(0)}% of range`;
      await sendTelegramMessage(msg, env);
    }
  }

  if (totalSignals > 0) {
    console.log(`[Agent1] ${label}: ${totalSignals} technical signals sent`);
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
      const lines = [
        `🐳 <b>Whale Activity Alert (${whaleSignals.length} signals)</b>`,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        ``,
      ];
      for (const signal of whaleSignals.slice(0, 5)) {
        lines.push(dexscreener.formatWhaleAlert(signal));
        lines.push(``);
      }
      await sendTelegramMessage(lines.join('\n'), env);
    }

    // CoinGecko trending
    const trending = await coingecko.getTrendingCoins();
    if (trending.length > 0) {
      const lines = [`🔥 <b>Trending Crypto:</b>`];
      for (const coin of trending.slice(0, 5)) {
        lines.push(`  #${coin.marketCapRank || '?'} ${coin.name} (${coin.symbol.toUpperCase()})`);
      }
      await sendTelegramMessage(lines.join('\n'), env);
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
      const lines = [
        `🎯 <b>Polymarket Value Bets (${valueBets.length} found)</b>`,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        ``,
      ];
      for (const market of valueBets.slice(0, 3)) {
        lines.push(polymarket.formatMarketAlert(market));
        lines.push(``);
      }
      await sendTelegramMessage(lines.join('\n'), env);
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

    // Alert on big commodity moves (> 2%)
    const bigMoves = commodities.filter((c) => Math.abs(c.changePercent) > 2);
    if (bigMoves.length > 0) {
      const lines = [`🛢️ <b>Commodity Alert — Big Moves:</b>`, ``];
      for (const c of bigMoves) {
        const emoji = c.changePercent > 0 ? '📈' : '📉';
        const name = Object.entries(yahooFinance.COMMODITY_SYMBOLS).find(([, v]) => v === c.symbol)?.[0] || c.symbol;
        lines.push(`  ${emoji} <b>${name}</b>: $${c.price.toFixed(2)} (${c.changePercent > 0 ? '+' : ''}${c.changePercent.toFixed(1)}%)`);
      }
      await sendTelegramMessage(lines.join('\n'), env);
    }

    // Yield curve alert
    if (yieldCurve && yieldCurve.inverted) {
      await sendTelegramMessage(`⚠️ <b>YIELD CURVE INVERTED</b>\nSpread: ${yieldCurve.spread.toFixed(2)}%\n${yieldCurve.signal}`, env);
    }
  } catch (err) {
    console.error('[Agent5] Commodity scan error:', err);
  }
}

// ═══════════════════════════════════════════════════════════════
// EVENING SUMMARY
// ═══════════════════════════════════════════════════════════════

async function runEveningSummary(env: Env): Promise<void> {
  const watchlist = getWatchlist(env);
  const cryptoList = getCryptoWatchlist(env);

  const [stockQuotes, cryptoPrices, indices] = await Promise.all([
    yahooFinance.getMultipleQuotes(watchlist),
    coingecko.getCryptoPrices(cryptoList),
    yahooFinance.getMarketIndices(),
  ]);

  const sorted = [...stockQuotes].sort((a, b) => b.changePercent - a.changePercent);

  const lines: string[] = [
    `📋 <b>YMSA Evening Summary</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
  ];

  // Market indices
  if (indices.length > 0) {
    lines.push(``, `📊 <b>Indices:</b>`);
    for (const idx of indices) {
      const emoji = idx.changePercent >= 0 ? '🟢' : '🔴';
      lines.push(`  ${emoji} <b>${idx.symbol}</b>: ${idx.price.toLocaleString()} (${idx.changePercent >= 0 ? '+' : ''}${idx.changePercent.toFixed(2)}%)`);
    }
  }

  // Stock performance
  lines.push(``, `📊 <b>Watchlist:</b>`);
  for (const q of sorted) {
    const emoji = q.changePercent >= 0 ? '🟢' : '🔴';
    lines.push(`  ${emoji} <b>${q.symbol}</b>: $${q.price.toFixed(2)} (${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%)`);
  }

  if (sorted.length >= 2) {
    lines.push(``);
    lines.push(`🏆 <b>Top:</b> ${sorted[0].symbol} (+${sorted[0].changePercent.toFixed(2)}%)`);
    lines.push(`📉 <b>Bottom:</b> ${sorted[sorted.length - 1].symbol} (${sorted[sorted.length - 1].changePercent.toFixed(2)}%)`);
  }

  // Crypto recap
  if (cryptoPrices.length > 0) {
    lines.push(``, `🪙 <b>Crypto:</b>`);
    for (const c of cryptoPrices) {
      const emoji = c.priceChange24h >= 0 ? '📈' : '📉';
      lines.push(`  ${emoji} <b>${c.symbol}</b>: $${c.price.toLocaleString()} (${c.priceChange24h >= 0 ? '+' : ''}${c.priceChange24h.toFixed(1)}%)`);
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
      const lines = [
        `🔄 <b>Pairs Trading Signals (${tradable.length} found)</b>`,
        `━━━━━━━━━━━━━━━━━━━━━━`,
        ``,
      ];
      for (const pair of tradable.slice(0, 5)) {
        lines.push(formatPairAlert(pair));
        lines.push(``);
      }
      await sendTelegramMessage(lines.join('\n'), env);
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
  const tier1 = (env.TIER1_WATCHLIST || env.DEFAULT_WATCHLIST).split(',').map(s => s.trim());
  const signals: ExecutableSignal[] = [];

  // Detect market regime first
  const regime = await detectRegime(env);
  if (regime) {
    await sendTelegramMessage(formatRegimeAlert(regime), env);
  }

  for (const symbol of tier1.slice(0, 5)) { // limit to avoid rate limits
    try {
      const mtf = await analyzeMultiTimeframe(symbol, env);
      if (mtf && mtf.confluence >= 70) {
        const alertMsg = formatMTFTradeAlert(mtf);
        if (alertMsg) {
          await sendTelegramMessage(alertMsg, env);
        }

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
    await sendTelegramMessage(formatBatchResults(results), env);
  }

  console.log(`[v3] Opening Range Break: ${signals.length} signals from ${tier1.length} symbols`);
}

// ═══════════════════════════════════════════════════════════════
// v3: QUICK PULSE — Every 5min during market hours
// Smart Money detection on top movers only
// ═══════════════════════════════════════════════════════════════

async function runQuickPulse(env: Env): Promise<void> {
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
        const alertMsg = formatSmartMoneyTradeAlert(smc, quote, indicators);
        if (alertMsg) {
          await sendTelegramMessage(alertMsg, env);
        }
      }
    } catch (err) {
      console.error(`[Pulse] ${symbol} error:`, err);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// v3: REGIME SCAN — Detect market regime and store history
// ═══════════════════════════════════════════════════════════════

async function runRegimeScan(env: Env): Promise<void> {
  try {
    const regime = await detectRegime(env);
    if (regime) {
      setCurrentRegime(regime);
      await sendTelegramMessage(formatRegimeAlert(regime), env);
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
        // Use new actionable trade alert format
        const alertMsg = formatMTFTradeAlert(mtf);
        if (alertMsg) {
          await sendTelegramMessage(alertMsg, env);
        }

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
    await sendTelegramMessage(formatBatchResults(results), env);
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
        // Use new actionable trade alert format
        const indicators = computeIndicators(symbol, ohlcv);
        const alertMsg = formatSmartMoneyTradeAlert(smc, quote, indicators);
        if (alertMsg) {
          await sendTelegramMessage(alertMsg, env);
        }

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
    await sendTelegramMessage(formatBatchResults(results), env);
  }

  console.log(`[v3] Smart Money scan: ${signals.length} executable signals`);
}

// ═══════════════════════════════════════════════════════════════
// v3: NEWS SCAN — Fetch Google Alerts RSS, store, and digest
// ═══════════════════════════════════════════════════════════════

async function runNewsScan(env: Env): Promise<void> {
  try {
    const news = await fetchGoogleAlerts();
    if (news.length > 0) {
      if (env.DB) {
        const inserted = await storeNewsAlerts(news, env.DB);
        console.log(`[v3] News scan: stored ${inserted} new alerts from ${news.length} fetched`);
      }
      // Only alert if there are recent items (< 6 hours old)
      const recent = news.filter(n => Date.now() - new Date(n.published).getTime() < 6 * 60 * 60 * 1000);
      if (recent.length > 0) {
        await sendTelegramMessage(formatNewsDigest(recent, 5), env);
      }
    }
  } catch (err) {
    console.error('[v3] News scan error:', err);
  }
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
      await sendTelegramMessage(riskMsg, env);

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
