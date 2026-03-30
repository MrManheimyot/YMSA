// ─── Cron Handler ─────────────────────────────────────────────
// Full 5-agent signal pipeline → Orchestrator → Risk → Telegram
// All signals, no execution — manual trading only

import type { Env, CronJobType, TechnicalIndicator } from './types';
import * as taapi from './api/taapi';
import * as finnhub from './api/finnhub';
import * as yahooFinance from './api/yahoo-finance';
import * as coingecko from './api/coingecko';
import * as dexscreener from './api/dexscreener';
import * as polymarket from './api/polymarket';
import * as fred from './api/fred';
import { calculateFibonacci } from './analysis/fibonacci';
import { detectSignals } from './analysis/signals';
import { sendTelegramAlert, sendDailyBriefing, sendTelegramMessage } from './alert-router';
import { scanPairs, findTradablePairs, formatPairAlert } from './agents/pairs-trading';
import { scrapeOversoldStocks, scrape52WeekHighs, formatFinvizAlert } from './scrapers/finviz';
import { scrapeMarketOverview, formatMarketOverview } from './scrapers/google-finance';

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
      case 'QUICK_SCAN_15MIN':
        await runQuickScan(env);
        break;
      case 'FULL_SCAN_HOURLY':
        await runFullScan(env, 'Hourly');
        break;
      case 'EVENING_SUMMARY':
        await runEveningSummary(env);
        break;
      case 'AFTER_HOURS_SCAN':
        await runAfterHoursScan(env);
        break;
      case 'WEEKLY_REVIEW':
        await runWeeklyReview(env);
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
  if (cron.startsWith('*/15')) return 'QUICK_SCAN_15MIN';
  if (cron === '0 15 * * 1-5') return 'EVENING_SUMMARY';
  if (cron === '0 18 * * 1-5') return 'AFTER_HOURS_SCAN';
  if (cron === '0 7 * * 0') return 'WEEKLY_REVIEW';
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
    const [quote, rsi, macd] = await Promise.all([
      yahooFinance.getQuote(symbol),
      taapi.getRSI(symbol, env),
      taapi.getMACD(symbol, env),
    ]);

    if (!quote) continue;

    const indicators: TechnicalIndicator[] = [];
    if (rsi) indicators.push(rsi);
    if (macd) indicators.push(...macd);

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
  // ── Agent 1: Stock Technical Scan ──
  await runStockTechnicalScan(env, label);

  // ── Agent 2: Statistical Arbitrage / Pairs Scan ──
  await runPairsScan(env);

  // ── Agent 3: Crypto Whale Scan ──
  await runCryptoWhaleScan(env);

  // ── Agent 4: Polymarket Value Bets ──
  await runPolymarketScan(env);

  // ── Agent 5: Commodity + Macro Scan ──
  await runCommodityScan(env);

  // ── Scrapers (Finviz/Google Finance) ──
  await runScraperScan(env);

  console.log(`[Cron] ${label}: Full multi-agent scan complete`);
}

async function runStockTechnicalScan(env: Env, label: string): Promise<void> {
  const watchlist = getWatchlist(env);
  let totalSignals = 0;

  for (const symbol of watchlist) {
    const [quote, rsi, macd, ema50, ema200, ohlcv] = await Promise.all([
      yahooFinance.getQuote(symbol),
      taapi.getRSI(symbol, env),
      taapi.getMACD(symbol, env),
      taapi.getEMA(symbol, 50, env),
      taapi.getEMA(symbol, 200, env),
      yahooFinance.getOHLCV(symbol, '6mo', '1d'),
    ]);

    if (!quote) continue;

    const indicators: TechnicalIndicator[] = [];
    if (rsi) indicators.push(rsi);
    if (macd) indicators.push(...macd);
    if (ema50) indicators.push(ema50);
    if (ema200) indicators.push(ema200);

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
    const rsi = await taapi.getRSI(quote.symbol, env);
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
