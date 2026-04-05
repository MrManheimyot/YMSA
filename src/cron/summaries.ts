// ─── Summary Reports ──────────────────────────────────────────
// Evening, Daily, Weekly, After-Hours, Midday summaries

import type { Env } from '../types';
import * as yahooFinance from '../api/yahoo-finance';
import { createLogger } from '../utils/logger';

const logger = createLogger('Summaries');
import * as coingecko from '../api/coingecko';
import * as polymarket from '../api/polymarket';
import * as fred from '../api/fred';
import { computeIndicators } from '../analysis/indicators';
import { detectRegime } from '../analysis/regime';
import { sendDailyBriefing, sendTelegramMessage } from '../alert-router';
import { fetchGoogleAlerts, storeNewsAlerts, formatNewsDigest } from '../api/google-alerts';
import { getPortfolioSnapshot, formatPortfolioSnapshot, getPerformanceMetrics, formatPerformanceReport } from '../execution/portfolio';
import { evaluateKillSwitch, formatRiskEvent, rebalanceEngineBudgets, formatBudgetRebalance } from '../agents/risk-controller';
import { insertRiskEvent, generateId, getClosedTradesSince, getOpenTrades } from '../db/queries';
import { sendRiskAlert } from '../broker-manager';
import { weeklyNarrative, isZAiAvailable } from '../ai/z-engine';
import { getWatchlist, getCryptoWatchlist } from './market-scans';

export async function runEveningSummary(env: Env): Promise<void> {
  const TRACKED_INDICES = ['^GSPC', '^IXIC', '^DJI'];
  const TRACKED_COMMODITIES = ['GC=F', 'CL=F'];
  const TRACKED_CRYPTO = ['bitcoin'];

  const openTrades = env.DB ? await getOpenTrades(env.DB) : [];
  const holdingSymbols = [...new Set(openTrades.filter((t) => t.side === 'BUY').map((t) => t.symbol))];
  const quotesToFetch = [...new Set([...TRACKED_COMMODITIES, ...holdingSymbols])];

  const [trackedQuotes, cryptoPrices, indices] = await Promise.all([
    quotesToFetch.length > 0 ? yahooFinance.getMultipleQuotes(quotesToFetch) : Promise.resolve([]),
    coingecko.getCryptoPrices(TRACKED_CRYPTO),
    yahooFinance.getMarketIndices(),
  ]);

  const lines: string[] = [`📋 <b>YMSA Evening Summary</b>`, `━━━━━━━━━━━━━━━━━━━━━━`];

  appendIndices(lines, indices, TRACKED_INDICES);
  appendCommodities(lines, trackedQuotes, TRACKED_COMMODITIES);
  appendBitcoin(lines, cryptoPrices);
  appendHoldings(lines, openTrades, trackedQuotes);

  try {
    const newsAlerts = await fetchGoogleAlerts();
    if (newsAlerts.length > 0) {
      if (env.DB) await storeNewsAlerts(newsAlerts, env.DB);
      const recent = newsAlerts.filter((n) => Date.now() - new Date(n.published).getTime() < 12 * 60 * 60 * 1000);
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

export async function runDailySummary(env: Env): Promise<void> {
  const lines: string[] = [
    `📊 <b>YMSA Daily Summary</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `<i>${new Date().toISOString().slice(0, 10)}</i>`,
  ];

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const closedToday = env.DB ? await getClosedTradesSince(env.DB, oneDayAgo) : [];
  const openTrades = env.DB ? await getOpenTrades(env.DB) : [];
  const openedToday = openTrades.filter((t) => t.opened_at >= oneDayAgo);

  if (openedToday.length > 0 || closedToday.length > 0) {
    lines.push(``, `⚡ <b>Today's Trades:</b>`);
    for (const t of openedToday) {
      const emoji = t.side === 'BUY' ? '🟢' : '🔴';
      lines.push(`  ${emoji} <b>${t.symbol}</b> — ${t.side} ${t.qty} @ $${t.entry_price.toFixed(2)}`);
    }
    for (const t of closedToday) {
      const pnl = t.pnl ?? 0;
      const emoji = pnl >= 0 ? '🟢' : '🔴';
      lines.push(`  ${emoji} <b>${t.symbol}</b> — SOLD ${t.qty} @ $${(t.exit_price ?? 0).toFixed(2)} → P/L: $${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`);
    }
  } else {
    lines.push(``, `⚡ <i>No trades executed today.</i>`);
  }

  if (openTrades.length > 0) {
    const symbols = [...new Set(openTrades.map((t) => t.symbol))];
    const quotes = await yahooFinance.getMultipleQuotes(symbols);
    const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));

    lines.push(``, `💼 <b>Holdings:</b>`);
    lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);

    let totalUnrealizedPnl = 0;
    for (const trade of openTrades) {
      if (trade.side !== 'BUY') continue;
      const quote = quoteMap.get(trade.symbol);
      const currentPrice = quote ? quote.price : trade.entry_price;
      const unrealizedPnl = (currentPrice - trade.entry_price) * trade.qty;
      const unrealizedPct = trade.entry_price > 0 ? ((currentPrice - trade.entry_price) / trade.entry_price) * 100 : 0;
      const tradeDate = new Date(trade.opened_at).toISOString().slice(0, 10);
      totalUnrealizedPnl += unrealizedPnl;
      const emoji = unrealizedPnl >= 0 ? '🟢' : '🔴';
      lines.push(``);
      lines.push(`  <b>${trade.symbol}</b> — ${trade.qty} shares`);
      lines.push(`  Bought: ${tradeDate} @ $${trade.entry_price.toFixed(2)}`);
      lines.push(`  ${emoji} P/L: $${unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnl.toFixed(2)} (${unrealizedPct >= 0 ? '+' : ''}${unrealizedPct.toFixed(1)}%)`);
    }

    if (openTrades.filter((t) => t.side === 'BUY').length > 1) {
      lines.push(``);
      lines.push(`  ─────────────────`);
      const emoji = totalUnrealizedPnl >= 0 ? '🟢' : '🔴';
      lines.push(`  ${emoji} <b>Total Unrealized P/L:</b> $${totalUnrealizedPnl >= 0 ? '+' : ''}${totalUnrealizedPnl.toFixed(2)}`);
    }
  } else {
    lines.push(``, `💼 <i>No open holdings.</i>`);
  }

  lines.push(``, `━━━━━━━━━━━━━━━━━━━━━━`);
  await sendTelegramMessage(lines.join('\n'), env);
  logger.info(`Daily Summary: ${openTrades.length} holdings, ${closedToday.length} closed today`);
}

export async function runAfterHoursScan(env: Env): Promise<void> {
  const watchlist = getWatchlist(env);
  const finnhub = await import('../api/finnhub');

  for (const symbol of watchlist) {
    const news = await finnhub.getCompanyNews(symbol, env, 1);
    if (news.length > 0) {
      const lines = [`📰 <b>After-Hours — ${symbol}</b>`, ``];
      for (const item of news.slice(0, 3)) {
        lines.push(`• ${item.headline}`);
        lines.push(`  <a href="${item.url}">Read more</a>`);
      }
      await sendTelegramMessage(lines.join('\n'), env);
    }
  }
}

export async function runWeeklyReview(env: Env): Promise<void> {
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

  const lines: string[] = [`📊 <b>YMSA Weekly Review</b>`, `━━━━━━━━━━━━━━━━━━━━━━`];

  lines.push(``, `📋 <b>Watchlist + RSI:</b>`);
  for (const quote of stockQuotes) {
    const ohlcv = await yahooFinance.getOHLCV(quote.symbol, '2y', '1d');
    const localInds = computeIndicators(quote.symbol, ohlcv);
    const rsi = localInds.find((i) => i.indicator === 'RSI') ?? null;
    const rsiLabel = rsi ? (rsi.value > 70 ? '⚠️ OB' : rsi.value < 30 ? '⚠️ OS' : `${rsi.value.toFixed(0)}`) : 'N/A';
    const w52 = await yahooFinance.getQuoteWith52WeekAnalysis(quote.symbol);
    const w52Label = w52 ? `${(w52.position52w * 100).toFixed(0)}%` : '';
    lines.push(`  <b>${quote.symbol}</b>: $${quote.price.toFixed(2)} | RSI: ${rsiLabel} | 52W: ${w52Label}`);
  }

  if (cryptoPrices.length > 0) {
    lines.push(``, `🪙 <b>Crypto:</b>`);
    for (const c of cryptoPrices) {
      lines.push(`  <b>${c.symbol}</b>: $${c.price.toLocaleString()} (7d: ${c.priceChange7d?.toFixed(1) || '?'}%)`);
    }
    if (cryptoGlobal) {
      lines.push(`  Market: $${(cryptoGlobal.totalMarketCap / 1e12).toFixed(2)}T | BTC: ${cryptoGlobal.btcDominance.toFixed(1)}%`);
    }
  }

  if (commodities.length > 0) {
    lines.push(``, `🛢️ <b>Commodities:</b>`);
    for (const c of commodities) {
      const name = Object.entries(yahooFinance.COMMODITY_SYMBOLS).find(([, v]) => v === c.symbol)?.[0] || c.symbol;
      lines.push(`  <b>${name}</b>: $${c.price.toFixed(2)} (${c.changePercent >= 0 ? '+' : ''}${c.changePercent.toFixed(1)}%)`);
    }
  }

  lines.push(``, `🏦 <b>Macro:</b>`);
  if (yieldCurve) lines.push(`  ${yieldCurve.signal} (${yieldCurve.spread.toFixed(2)}%)`);
  for (const m of macroDashboard.slice(0, 5)) {
    lines.push(`  ${m.id}: ${m.value.toFixed(2)} (${m.change >= 0 ? '+' : ''}${m.change.toFixed(2)})`);
  }

  if (topMarkets.length > 0) {
    lines.push(``, `🎯 <b>Prediction Markets:</b>`);
    for (const market of topMarkets.slice(0, 3)) {
      const outcome = market.outcomes[0];
      lines.push(`  • ${market.question.slice(0, 50)}... → ${outcome ? `${(outcome.price * 100).toFixed(0)}%` : '?'}`);
    }
  }
  lines.push(``, `━━━━━━━━━━━━━━━━━━━━━━`);

  if (isZAiAvailable(env)) {
    try {
      const metrics = await getPerformanceMetrics(env);
      const vixVal = macroDashboard.find((m) => m.id === 'VIXCLS')?.value || 0;
      const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const weekTrades = env.DB ? await getClosedTradesSince(env.DB, oneWeekAgo) : [];
      const weeklyPnl = weekTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
      const snapshot = await getPortfolioSnapshot(env);
      const equity = snapshot?.equity || 1;
      const weeklyPnlPct = equity > 0 ? (weeklyPnl / equity) * 100 : 0;
      const topWinner = weekTrades.length > 0 && (weekTrades[0].pnl ?? 0) > 0
        ? `${weekTrades[0].symbol} (+$${(weekTrades[0].pnl ?? 0).toFixed(0)})`
        : 'N/A';
      const topLoser = weekTrades.length > 0 && (weekTrades[weekTrades.length - 1].pnl ?? 0) < 0
        ? `${weekTrades[weekTrades.length - 1].symbol} (-$${Math.abs(weekTrades[weekTrades.length - 1].pnl ?? 0).toFixed(0)})`
        : 'N/A';

      let regimeLabel = 'unknown';
      try {
        const regime = await detectRegime(env);
        if (regime) regimeLabel = regime.regime.replace('_', ' ');
      } catch {}

      const narrative = await weeklyNarrative((env as any).AI, {
        weeklyPnl, weeklyPnlPct, winRate: metrics.winRate || 0,
        totalTrades: weekTrades.length, topWinner, topLoser, regime: regimeLabel, vix: vixVal,
      });
      if (narrative) {
        lines.push(``, `🧠 <b>Z.AI Weekly Summary:</b>`);
        lines.push(narrative);
      }
    } catch (err) {
      logger.error('Z.AI weekly narrative failed:', err);
    }
  }

  lines.push(`📌 <i>Review positions, adjust watchlist. Good week ahead!</i>`);
  await sendDailyBriefing(lines.join('\n'), env);
}

export async function runMiddayRebalance(env: Env): Promise<void> {
  const snapshot = await getPortfolioSnapshot(env);
  if (snapshot) {
    await sendTelegramMessage(formatPortfolioSnapshot(snapshot), env);
    const ks = evaluateKillSwitch(snapshot.dailyPnlPct);
    if (ks.level !== 'NONE') {
      const riskMsg = formatRiskEvent('KILL_SWITCH', 'CRITICAL', `Daily PnL: ${snapshot.dailyPnlPct.toFixed(2)}%`, ks.action);
      await sendRiskAlert(riskMsg, env);
      if (env.DB) {
        await insertRiskEvent(env.DB, generateId('risk'), 'KILL_SWITCH', 'CRITICAL', `Daily PnL: ${snapshot.dailyPnlPct.toFixed(2)}%`, ks.action);
      }
    }
  }

  try {
    const news = await fetchGoogleAlerts();
    if (news.length > 0) {
      if (env.DB) {
        const inserted = await storeNewsAlerts(news, env.DB);
        logger.info(`Stored ${inserted} news alerts`);
      }
      await sendTelegramMessage(formatNewsDigest(news, 5), env);
    }
  } catch (err) {
      logger.error('News scan error:', err);
  }
}

export async function runMonthlyPerformance(env: Env): Promise<void> {
  const metrics = await getPerformanceMetrics(env);
  await sendTelegramMessage(formatPerformanceReport(metrics), env);

  const snapshot = await getPortfolioSnapshot(env);
  if (snapshot) {
    await sendTelegramMessage(formatPortfolioSnapshot(snapshot), env);
  }

  if (env.DB) {
    try {
      const changes = await rebalanceEngineBudgets(env.DB);
      const report = formatBudgetRebalance(changes);
      await sendTelegramMessage(report, env);
      logger.info(`Budget rebalance: ${changes.length} engines adjusted`);
    } catch (e) {
      logger.error('Budget rebalance error:', e);
    }
  }
  logger.info('Monthly performance report sent');
}

// ─── Internal formatting helpers ──────────────────────────────

function appendIndices(lines: string[], indices: any[], tracked: string[]): void {
  const trackedIndices = indices.filter((idx: any) => tracked.includes(idx.symbol));
  if (trackedIndices.length > 0) {
    lines.push(``, `📊 <b>Market Indices:</b>`);
    for (const idx of trackedIndices) {
      const emoji = idx.changePercent >= 0 ? '🟢' : '🔴';
      const name = idx.symbol === '^GSPC' ? 'S&P 500' : idx.symbol === '^IXIC' ? 'NASDAQ' : idx.symbol === '^DJI' ? 'DOW JONES' : idx.symbol;
      lines.push(`  ${emoji} <b>${name}</b>: ${idx.price.toLocaleString()} (${idx.changePercent >= 0 ? '+' : ''}${idx.changePercent.toFixed(2)}%)`);
    }
  }
}

function appendCommodities(lines: string[], trackedQuotes: any[], tracked: string[]): void {
  const commodityQuotes = trackedQuotes.filter((q: any) => tracked.includes(q.symbol));
  if (commodityQuotes.length > 0) {
    lines.push(``, `🛢️ <b>Commodities:</b>`);
    for (const q of commodityQuotes) {
      const emoji = q.changePercent >= 0 ? '🟢' : '🔴';
      const name = q.symbol === 'GC=F' ? 'GOLD' : q.symbol === 'CL=F' ? 'Oil (WTI)' : q.symbol;
      lines.push(`  ${emoji} <b>${name}</b>: $${q.price.toFixed(2)} (${q.changePercent >= 0 ? '+' : ''}${q.changePercent.toFixed(2)}%)`);
    }
  }
}

function appendBitcoin(lines: string[], cryptoPrices: any[]): void {
  if (cryptoPrices.length > 0) {
    lines.push(``, `₿ <b>Bitcoin:</b>`);
    for (const c of cryptoPrices) {
      const emoji = c.priceChange24h >= 0 ? '📈' : '📉';
      lines.push(`  ${emoji} <b>BTC</b>: $${c.price.toLocaleString()} (${c.priceChange24h >= 0 ? '+' : ''}${c.priceChange24h.toFixed(1)}%)`);
    }
  }
}

function appendHoldings(lines: string[], openTrades: any[], trackedQuotes: any[]): void {
  if (openTrades.length === 0) return;
  const holdingQuoteMap = new Map(trackedQuotes.map((q: any) => [q.symbol, q]));

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
    const dailyPnl = quote ? (quote.changePercent / 100) * closingPrice * qty : 0;
    const accPnl = (closingPrice - entryPrice) * qty;
    totalDailyPnl += dailyPnl;
    totalAccPnl += accPnl;

    lines.push(``);
    lines.push(`  <b>${trade.symbol}</b>`);
    lines.push(`  Closing: $${closingPrice.toFixed(2)} | Entry: $${entryPrice.toFixed(2)}`);
    lines.push(`  Date: ${tradeDate} | Qty: ${qty}`);
    lines.push(`  ${dailyPnl >= 0 ? '🟢' : '🔴'} Daily P/L: $${dailyPnl >= 0 ? '+' : ''}${dailyPnl.toFixed(2)}`);
    lines.push(`  ${accPnl >= 0 ? '🟢' : '🔴'} Accum P/L: $${accPnl >= 0 ? '+' : ''}${accPnl.toFixed(2)} (${((accPnl / (entryPrice * qty)) * 100).toFixed(1)}%)`);
  }

  if (openTrades.filter((t: any) => t.side === 'BUY').length > 1) {
    lines.push(``);
    lines.push(`  ─────────────────`);
    lines.push(`  ${totalDailyPnl >= 0 ? '🟢' : '🔴'} <b>Total Daily P/L:</b> $${totalDailyPnl >= 0 ? '+' : ''}${totalDailyPnl.toFixed(2)}`);
    lines.push(`  ${totalAccPnl >= 0 ? '🟢' : '🔴'} <b>Total Accum P/L:</b> $${totalAccPnl >= 0 ? '+' : ''}${totalAccPnl.toFixed(2)}`);
  }
}
