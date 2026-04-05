// ─── Morning Briefing — 07:00 IST ─────────────────────────────
// Premium institutional-grade market intelligence report (3 messages)

import type { Env } from '../types';
import * as yahooFinance from '../api/yahoo-finance';
import { createLogger } from '../utils/logger';

const logger = createLogger('MorningBrief');
import * as polymarket from '../api/polymarket';
import * as fred from '../api/fred';
import * as finnhub from '../api/finnhub';
import { computeIndicators } from '../analysis/indicators';
import { sendDailyBriefing } from '../alert-router';
import { fetchGoogleAlerts, storeNewsAlerts } from '../api/google-alerts';
import { scoreNewsSentiment, isZAiAvailable } from '../ai/z-engine';

// ── Formatting helpers ──
const fmtChg = (pct: number): string => `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
const fmtPrice = (p: number, decimals = 2): string =>
  p >= 10000 ? p.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : p.toFixed(decimals);
const arrow = (pct: number): string => (pct >= 0 ? '▲' : '▼');
const dot = (pct: number): string => (pct >= 0 ? '🟢' : '🔴');

export async function runMorningBriefing(env: Env): Promise<void> {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });

  const [allQuotes, cryptoBTC, macroDashboard, yieldCurve, moversResult, unusualResult, newsAlerts, _marketNews, _earningsToday] =
    await Promise.all([
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

  const quoteOf = (sym: string) => allQuotes.find((q) => q.symbol === sym);
  const indexQuotes = ['^GSPC', '^IXIC', '^DJI'].map((s) => quoteOf(s)).filter(Boolean) as any[];
  const commodityQuotes = ['GC=F', 'CL=F'].map((s) => quoteOf(s)).filter(Boolean) as any[];
  const coreQuotes = ['AAPL', 'GOOGL', 'NVDA', 'MSFT', 'AMZN'].map((s) => quoteOf(s)).filter(Boolean) as any[];

  // ── Message 1: Header + Indices + Core Holdings ──
  await sendMessage1(env, dateStr, timeStr, indexQuotes, commodityQuotes, coreQuotes, cryptoBTC, macroDashboard, yieldCurve);

  // ── Message 2: Unusual Movers + Technical Picks ──
  await sendMessage2(env, moversResult);

  // ── Message 3: Prediction Markets + News + Footer ──
  await sendMessage3(env, unusualResult, newsAlerts, timeStr);
}

async function sendMessage1(
  env: Env,
  dateStr: string,
  timeStr: string,
  indexQuotes: any[],
  commodityQuotes: any[],
  coreQuotes: any[],
  cryptoBTC: any,
  macroDashboard: any[],
  yieldCurve: any,
): Promise<void> {
  const msg: string[] = [];
  msg.push(`Yigal the man, may you have a magical morning, from Tamir and Yotam.`);
  msg.push(``);
  msg.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  msg.push(`📋 <b>YMSA MORNING INTELLIGENCE BRIEF</b>`);
  msg.push(`${dateStr} · ${timeStr} IST`);
  msg.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  msg.push(``);
  msg.push(`<b>§1  MARKET PULSE — Key Benchmarks</b>`);
  msg.push(`───────────────────────────`);

  const idxMap: Record<string, string> = { '^GSPC': 'S&P 500', '^IXIC': 'NASDAQ', '^DJI': 'DOW JONES' };
  for (const q of indexQuotes) {
    const name = idxMap[q.symbol] || q.symbol;
    msg.push(`${dot(q.changePercent)} <b>${name}</b>`);
    msg.push(`    ${fmtPrice(q.price)} ${arrow(q.changePercent)} ${fmtChg(q.changePercent)}`);
  }

  const gold = commodityQuotes.find((q: any) => q.symbol === 'GC=F');
  if (gold) {
    msg.push(`${dot(gold.changePercent)} <b>GOLD</b>`);
    msg.push(`    $${fmtPrice(gold.price)} ${arrow(gold.changePercent)} ${fmtChg(gold.changePercent)}`);
  }
  const oil = commodityQuotes.find((q: any) => q.symbol === 'CL=F');
  if (oil) {
    msg.push(`${dot(oil.changePercent)} <b>OIL (WTI)</b>`);
    msg.push(`    $${fmtPrice(oil.price)} ${arrow(oil.changePercent)} ${fmtChg(oil.changePercent)}`);
  }
  if (cryptoBTC) {
    msg.push(`${dot(cryptoBTC.changePercent)} <b>BITCOIN</b>`);
    msg.push(`    $${fmtPrice(cryptoBTC.price, 0)} ${arrow(cryptoBTC.changePercent)} ${fmtChg(cryptoBTC.changePercent)}`);
  }

  const vix = macroDashboard.find((m: any) => m.id === 'VIXCLS');
  if (vix) {
    const vixEmoji = vix.value >= 25 ? '🔴' : vix.value >= 18 ? '🟡' : '🟢';
    msg.push(``);
    msg.push(`${vixEmoji} <b>VIX</b>: ${vix.value.toFixed(1)}${vix.change ? ` (${vix.change >= 0 ? '+' : ''}${vix.change.toFixed(1)})` : ''}`);
  }
  if (yieldCurve) {
    const ycEmoji = yieldCurve.inverted ? '⚠️' : '✅';
    msg.push(`${ycEmoji} <b>Yield Curve</b>: ${yieldCurve.spread.toFixed(2)}% spread${yieldCurve.inverted ? ' — INVERTED' : ''}`);
  }

  msg.push(``);
  msg.push(`<b>§2  CORE HOLDINGS — Last Trading Day</b>`);
  msg.push(`───────────────────────────`);

  for (const q of coreQuotes) {
    const volRatio = q.avgVolume > 0 ? q.volume / q.avgVolume : 0;
    const volFlag = volRatio >= 1.5 ? ' 📊' : '';
    msg.push(`${dot(q.changePercent)} <b>${q.symbol}</b>  $${fmtPrice(q.price)}  ${arrow(q.changePercent)} ${fmtChg(q.changePercent)}${volFlag}`);
  }

  await sendDailyBriefing(msg.join('\n'), env);
}

async function sendMessage2(env: Env, moversResult: any[]): Promise<void> {
  const msg: string[] = [];

  msg.push(`<b>§3  UNUSUAL MOVERS — 10%+ Change, 2x+ Volume</b>`);
  msg.push(`───────────────────────────`);

  try {
    if (moversResult.length > 0) {
      for (const q of moversResult) {
        const volRatio = q.avgVolume > 0 ? (q.volume / q.avgVolume).toFixed(1) : '?';
        msg.push(`${dot(q.changePercent)} <b>${q.symbol}</b>  $${fmtPrice(q.price)}  ${arrow(q.changePercent)} ${fmtChg(q.changePercent)}`);
        msg.push(`    Vol: ${(q.volume / 1e6).toFixed(1)}M (${volRatio}x avg) — Requires attention`);
      }
    } else {
      msg.push(`  No Russell 1000 stocks met the 10%+ / 2x volume threshold today.`);
      msg.push(`  <i>Market volatility is contained.</i>`);
    }
  } catch {
    msg.push(`  <i>Screener data unavailable.</i>`);
  }

  msg.push(``);
  msg.push(`<b>§4  TECHNICAL CONVICTION — Multi-Indicator Screen</b>`);
  msg.push(`───────────────────────────`);
  msg.push(`<i>Stocks scoring on ≥3 indicators (RSI, MACD, EMA, BB, ATR)</i>`);
  msg.push(``);

  try {
    const topPicks = await scanTechnicalConviction(env);
    if (topPicks.length > 0) {
      for (let i = 0; i < topPicks.length; i++) {
        const p = topPicks[i];
        const dirEmoji = p.direction === 'BULLISH' ? '🟢' : '🔴';
        msg.push(`${dirEmoji} <b>${i + 1}. ${p.symbol}</b>  $${fmtPrice(p.price)}  ${arrow(p.changePct)} ${fmtChg(p.changePct)}`);
        msg.push(`    ${p.direction} · ${p.score} indicators: ${p.signals.join(' · ')}`);
      }
    } else {
      msg.push(`  No stocks met the 3+ indicator threshold.`);
      msg.push(`  <i>Market in low-conviction state — reduce exposure.</i>`);
    }
  } catch {
    msg.push(`  <i>Technical scan unavailable.</i>`);
  }

  await sendDailyBriefing(msg.join('\n'), env);
}

interface TechPick {
  symbol: string;
  price: number;
  changePct: number;
  score: number;
  signals: string[];
  direction: 'BULLISH' | 'BEARISH';
}

async function scanTechnicalConviction(env: Env): Promise<TechPick[]> {
  const envSymbols = (env.TIER1_WATCHLIST || env.DEFAULT_WATCHLIST || '').split(',').map((s) => s.trim()).filter(Boolean);
  const tier2 = (env.TIER2_WATCHLIST || '').split(',').map((s) => s.trim()).filter(Boolean);
  const allSymbols = [...new Set([...envSymbols, ...tier2])].slice(0, 50);
  if (allSymbols.length === 0) {
    throw new Error('Missing TIER1_WATCHLIST/DEFAULT_WATCHLIST and TIER2_WATCHLIST — no symbols to scan for morning briefing');
  }

  const picks: TechPick[] = [];
  const allQuotes = await yahooFinance.getMultipleQuotes(allSymbols);
  const quoteMap = new Map(allQuotes.map((q) => [q.symbol, q]));

  const BATCH_SIZE = 8;
  for (let b = 0; b < allSymbols.length; b += BATCH_SIZE) {
    const batch = allSymbols.slice(b, b + BATCH_SIZE);
    const ohlcvResults = await Promise.all(batch.map((sym) => yahooFinance.getOHLCV(sym, '6mo', '1d').catch(() => [])));

    for (let i = 0; i < batch.length; i++) {
      const pick = scoreSingleStock(batch[i], quoteMap.get(batch[i]), ohlcvResults[i]);
      if (pick) picks.push(pick);
    }
  }

  picks.sort((a, b) => b.score - a.score);
  return picks.slice(0, 10);
}

function scoreSingleStock(symbol: string, quote: any, ohlcv: any[]): TechPick | null {
  if (!quote || ohlcv.length < 50) return null;

  const indicators = computeIndicators(symbol, ohlcv);
  const rsi = indicators.find((ind) => ind.indicator === 'RSI')?.value;
  const macd = indicators.find((ind) => ind.indicator === 'MACD')?.value;
  const macdSig = indicators.find((ind) => ind.indicator === 'MACD_SIGNAL')?.value;
  const ema50 = indicators.find((ind) => ind.indicator === 'EMA_50')?.value;
  const ema200 = indicators.find((ind) => ind.indicator === 'EMA_200')?.value;
  const sma50 = indicators.find((ind) => ind.indicator === 'SMA_50')?.value;
  const atr = indicators.find((ind) => ind.indicator === 'ATR')?.value;

  const chronological = [...ohlcv].reverse();
  const closes = chronological.map((c: any) => c.close);
  let bbLower = 0, bbUpper = 0;
  if (closes.length >= 20) {
    const slice = closes.slice(closes.length - 20);
    const mean = slice.reduce((s: number, p: number) => s + p, 0) / 20;
    const stdDev = Math.sqrt(slice.reduce((s: number, p: number) => s + (p - mean) ** 2, 0) / 20);
    bbLower = mean - 2 * stdDev;
    bbUpper = mean + 2 * stdDev;
  }

  const bullSignals: string[] = [];
  const bearSignals: string[] = [];

  if (rsi != null) {
    if (rsi <= 35) bullSignals.push(`RSI ${rsi.toFixed(0)} (oversold)`);
    else if (rsi >= 65) bearSignals.push(`RSI ${rsi.toFixed(0)} (overbought)`);
  }
  if (macd != null && macdSig != null) {
    if (macd > macdSig && macd > 0) bullSignals.push(`MACD bullish cross`);
    else if (macd < macdSig && macd < 0) bearSignals.push(`MACD bearish cross`);
  }
  if (ema50 != null && ema200 != null) {
    if (quote.price > ema50 && ema50 > ema200) bullSignals.push(`EMA 50>200 aligned`);
    else if (quote.price < ema50 && ema50 < ema200) bearSignals.push(`EMA 50<200 aligned`);
  }
  if (bbLower > 0) {
    if (quote.price <= bbLower * 1.01) bullSignals.push(`BB lower band touch`);
    else if (quote.price >= bbUpper * 0.99) bearSignals.push(`BB upper band touch`);
  }
  if (atr != null && quote.price > 0 && atr / quote.price >= 0.03) {
    const sig = `ATR ${((atr / quote.price) * 100).toFixed(1)}% (expanded)`;
    if (bullSignals.length >= bearSignals.length) bullSignals.push(sig);
    else bearSignals.push(sig);
  }
  if (sma50 != null && quote.price > 0) {
    const distPct = ((quote.price - sma50) / sma50) * 100;
    if (distPct >= -3 && distPct <= 3) {
      if (quote.price > sma50) bullSignals.push(`At SMA50 support`);
      else bearSignals.push(`At SMA50 resistance`);
    }
  }
  if (quote.avgVolume > 0 && quote.volume / quote.avgVolume >= 1.8) {
    const vr = (quote.volume / quote.avgVolume).toFixed(1);
    if (quote.changePercent >= 0) bullSignals.push(`Vol spike ${vr}x avg`);
    else bearSignals.push(`Vol spike ${vr}x avg`);
  }

  const isBullish = bullSignals.length >= bearSignals.length;
  const signals = isBullish ? bullSignals : bearSignals;
  if (signals.length < 3) return null;

  return {
    symbol,
    price: quote.price,
    changePct: quote.changePercent,
    score: signals.length,
    signals,
    direction: isBullish ? 'BULLISH' : 'BEARISH',
  };
}

async function sendMessage3(env: Env, unusualResult: any[], newsAlerts: any[], timeStr: string): Promise<void> {
  const msg: string[] = [];

  msg.push(`<b>§5  PREDICTION MARKETS — Insider-Driven Positioning</b>`);
  msg.push(`───────────────────────────`);
  msg.push(`<i>Low-prob bets · ≤2 weeks · concentrated volume</i>`);
  msg.push(``);

  try {
    if (unusualResult.length > 0) {
      for (const u of unusualResult) {
        const sevEmoji = u.severity === 'HIGH' ? '🚨' : '⚠️';
        msg.push(`${sevEmoji} <b>${u.market.question.slice(0, 65)}${u.market.question.length > 65 ? '...' : ''}</b>`);
        msg.push(`    ${u.reason}`);
        const topOutcome = u.market.outcomes[0];
        if (topOutcome) {
          msg.push(`    → ${topOutcome.name}: ${(topOutcome.price * 100).toFixed(0)}% | Vol: $${(u.market.volume / 1000).toFixed(0)}K`);
        }
        msg.push(``);
      }
    } else {
      msg.push(`  No unusual activity detected across active markets.`);
      msg.push(`  <i>Prediction market positioning appears normal.</i>`);
    }
  } catch {
    msg.push(`  <i>Polymarket data unavailable.</i>`);
  }

  msg.push(`<b>§6  NEWS INTELLIGENCE — Google Alerts</b>`);
  msg.push(`───────────────────────────`);

  try {
    if (env.DB && newsAlerts.length > 0) await storeNewsAlerts(newsAlerts, env.DB);
    const recent = newsAlerts.filter((n: any) => Date.now() - new Date(n.published).getTime() < 24 * 60 * 60 * 1000);
    if (recent.length > 0) {
      const diversified = diversifyNewsAlerts(recent);
      const catNameMap: Record<string, string> = {
        'mega-tech': 'TECH', 'more-tech': 'TECH', 'mna': 'M&A',
        'short-squeeze': 'FLOW', 'fed-rates': 'FED', 'earnings': 'EARN',
        'sec-13f': '13F', 'crypto': 'CRYPTO', 'banks': 'BANKS',
        'semis': 'SEMIS', 'buybacks': 'BUYBACK', 'crash-signals': 'RISK',
      };
      msg.push(`<i>${recent.length} alerts in last 24h · showing ${diversified.length} diversified</i>`);
      msg.push(``);
      for (let i = 0; i < diversified.length; i++) {
        const item = diversified[i];
        const catLabel = catNameMap[item.category] || item.category.toUpperCase();
        msg.push(`${i + 1}. [${catLabel}] ${item.title.slice(0, 75)}${item.title.length > 75 ? '...' : ''}`);
      }
    } else {
      msg.push(`  No new alerts in the last 24 hours.`);
    }
  } catch {
    msg.push(`  <i>Google Alerts unavailable.</i>`);
  }

  try {
    if (isZAiAvailable(env)) {
      const marketNews = await finnhub.getMarketNews(env);
      if (marketNews.length > 0) {
        const headlines = marketNews.slice(0, 8).map((n: any) => n.headline);
        const sentiment = await scoreNewsSentiment((env as any).AI, headlines);
        if (sentiment.length > 0) {
          const bullish = sentiment.filter((s) => s.sentiment === 'BULLISH').length;
          const bearish = sentiment.filter((s) => s.sentiment === 'BEARISH').length;
          const neutral = sentiment.length - bullish - bearish;
          const overall = bullish > bearish ? '🟢 BULLISH' : bearish > bullish ? '🔴 BEARISH' : '⚪ NEUTRAL';
          msg.push(``);
          msg.push(`<b>🧠 Z.AI SENTIMENT</b>: ${overall} (${bullish}↑ ${bearish}↓ ${neutral}→)`);
        }
      }
    }
  } catch (err) {
    logger.warn('Z.AI sentiment scoring failed:', { error: err });
  }

  msg.push(``);
  msg.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  msg.push(`<i>YMSA Intelligence · Automated · Confidential</i>`);
  msg.push(`<i>Data as of ${timeStr} IST — Pre-market conditions may vary</i>`);

  await sendDailyBriefing(msg.join('\n'), env);
}

function diversifyNewsAlerts(recent: any[]): any[] {
  const byCategory = new Map<string, any[]>();
  for (const item of recent) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category)!.push(item);
  }
  const diversified: any[] = [];
  let round = 0;
  while (diversified.length < 10 && round < 5) {
    for (const [, items] of byCategory) {
      if (round < items.length && diversified.length < 10) {
        diversified.push(items[round]);
      }
    }
    round++;
  }
  return diversified;
}
