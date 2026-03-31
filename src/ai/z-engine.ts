// ─── Z.AI Engine — Runtime LLM Intelligence ─────────────────
// Uses Cloudflare Workers AI for:
//   1. Signal synthesis — explain WHY in 2 sentences
//   2. News sentiment — score headlines BULLISH/BEARISH/NEUTRAL
//   3. Trade review — post-trade analysis
//   4. Portfolio narrative — weekly human-readable summary
//
// Model: @cf/meta/llama-3.1-8b-instruct (free tier)

import type { Env } from '../types';
import type { MarketRegime } from '../analysis/regime';

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface MergedTradeInfo {
  symbol: string;
  direction: 'BUY' | 'SELL';
  confidence: number;
  engines: string[];
  reasons: string[];
  entry: number;
  stopLoss: number;
  tp1: number;
  conflicting: boolean;
}

export interface SentimentResult {
  headline: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  symbols: string[];
}

interface AiResponse {
  response?: string;
}

// ═══════════════════════════════════════════════════════════════
// Core LLM Call
// ═══════════════════════════════════════════════════════════════

async function runLLM(ai: any, systemPrompt: string, userPrompt: string): Promise<string> {
  try {
    const result: AiResponse = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 300,
      temperature: 0.3,
    });
    return result?.response?.trim() || '';
  } catch (err) {
    console.error('[Z.AI] LLM call failed:', err);
    return '';
  }
}

// ═══════════════════════════════════════════════════════════════
// 1. Signal Synthesis — Explain a merged trade in 2 sentences
// ═══════════════════════════════════════════════════════════════

const SIGNAL_SYSTEM = `You are Z.AI, the chief analyst of YMSA trading system. Write a 2-sentence trade rationale for a Telegram alert. Be specific about price levels and technical/institutional signals. Use trading jargon. No disclaimers. Keep under 150 chars total.`;

export async function synthesizeSignal(
  ai: any,
  trade: MergedTradeInfo,
  regime: MarketRegime | null,
): Promise<string> {
  if (!ai) return '';

  const regimeCtx = regime
    ? `Market: ${regime.regime.replace('_', ' ')}, VIX ${regime.vix.toFixed(0)}, ADX ${regime.adx?.toFixed(0) || '?'}.`
    : '';

  const prompt = `${trade.direction} ${trade.symbol} at $${trade.entry.toFixed(2)}.
Engines: ${trade.engines.join(', ')}.
Reasons: ${trade.reasons.slice(0, 2).join(' ')}
${trade.conflicting ? 'WARNING: Some engines disagree on direction.' : ''}
${regimeCtx}
SL $${trade.stopLoss.toFixed(2)}, TP1 $${trade.tp1.toFixed(2)}.
Confidence: ${trade.confidence}/100.`;

  return runLLM(ai, SIGNAL_SYSTEM, prompt);
}

// ═══════════════════════════════════════════════════════════════
// 2. News Sentiment — Score a batch of headlines
// ═══════════════════════════════════════════════════════════════

const SENTIMENT_SYSTEM = `You are Z.AI, a financial news sentiment classifier. For each headline, output ONE line: BULLISH|BEARISH|NEUTRAL <confidence 0-100> <ticker or NONE>.
Example:
BULLISH 85 AAPL
NEUTRAL 60 NONE
BEARISH 72 TSLA
No other text.`;

export async function scoreNewsSentiment(
  ai: any,
  headlines: string[],
): Promise<SentimentResult[]> {
  if (!ai || headlines.length === 0) return [];

  const prompt = headlines.slice(0, 10).map((h, i) => `${i + 1}. ${h}`).join('\n');
  const raw = await runLLM(ai, SENTIMENT_SYSTEM, prompt);
  if (!raw) return [];

  const results: SentimentResult[] = [];
  const lines = raw.split('\n').filter(l => l.trim());
  for (let i = 0; i < Math.min(lines.length, headlines.length); i++) {
    const match = lines[i].match(/(BULLISH|BEARISH|NEUTRAL)\s+(\d+)\s*(.*)/i);
    if (match) {
      const sentiment = match[1].toUpperCase() as SentimentResult['sentiment'];
      const conf = Math.min(100, Math.max(0, parseInt(match[2], 10)));
      const sym = match[3]?.trim();
      results.push({
        headline: headlines[i],
        sentiment,
        confidence: conf,
        symbols: sym && sym !== 'NONE' ? [sym.toUpperCase()] : [],
      });
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════
// 3. Trade Review — After trade closes, was signal good?
// ═══════════════════════════════════════════════════════════════

const REVIEW_SYSTEM = `You are Z.AI reviewing a closed trade. In 2-3 sentences: was the signal correct? What should the system learn? Be specific. No disclaimers.`;

export async function reviewTrade(
  ai: any,
  trade: { symbol: string; side: string; entry: number; exit: number; pnl: number; pnlPct: number; engine: string; reason: string },
): Promise<string> {
  if (!ai) return '';
  const outcome = trade.pnl >= 0 ? 'WIN' : 'LOSS';
  const prompt = `${outcome}: ${trade.side} ${trade.symbol} by ${trade.engine}.
Entry $${trade.entry.toFixed(2)} → Exit $${trade.exit.toFixed(2)}.
P&L: $${trade.pnl.toFixed(2)} (${trade.pnlPct >= 0 ? '+' : ''}${trade.pnlPct.toFixed(1)}%).
Reason: ${trade.reason}.`;
  return runLLM(ai, REVIEW_SYSTEM, prompt);
}

// ═══════════════════════════════════════════════════════════════
// 4. Portfolio Narrative — Weekly summary in plain English
// ═══════════════════════════════════════════════════════════════

const NARRATIVE_SYSTEM = `You are Z.AI writing a weekly portfolio summary for Telegram. Use 3-5 bullet points. Be concise, data-driven, actionable. Mention winners, losers, regime, and what to watch next week. No disclaimers. Use emoji sparingly.`;

export async function weeklyNarrative(
  ai: any,
  data: {
    weeklyPnl: number;
    weeklyPnlPct: number;
    winRate: number;
    totalTrades: number;
    topWinner: string;
    topLoser: string;
    regime: string;
    vix: number;
  },
): Promise<string> {
  if (!ai) return '';
  const prompt = `Weekly P&L: $${data.weeklyPnl.toFixed(2)} (${data.weeklyPnlPct >= 0 ? '+' : ''}${data.weeklyPnlPct.toFixed(1)}%).
Win rate: ${(data.winRate * 100).toFixed(0)}% across ${data.totalTrades} trades.
Top winner: ${data.topWinner}. Top loser: ${data.topLoser}.
Market regime: ${data.regime}. VIX: ${data.vix.toFixed(1)}.`;
  return runLLM(ai, NARRATIVE_SYSTEM, prompt);
}

// ═══════════════════════════════════════════════════════════════
// 5. Smart Alert Composition — Decide message format
// ═══════════════════════════════════════════════════════════════

const COMPOSE_SYSTEM = `You are Z.AI composing a Telegram alert. Given multiple signals, write one concise mobile-friendly message (under 800 chars). Use HTML tags: <b>bold</b>, <i>italic</i>. Include entry, SL, TP. Be actionable — the user reads this on their phone and needs to decide in seconds.`;

export async function composeAlert(
  ai: any,
  trades: MergedTradeInfo[],
  regime: MarketRegime | null,
): Promise<string> {
  if (!ai || trades.length === 0) return '';
  const regimeCtx = regime ? `Regime: ${regime.regime}, VIX ${regime.vix.toFixed(0)}.` : '';
  const tradeLines = trades.slice(0, 3).map(t =>
    `${t.direction} ${t.symbol} at $${t.entry.toFixed(2)}, SL $${t.stopLoss.toFixed(2)}, TP1 $${t.tp1.toFixed(2)}, conf ${t.confidence}, engines: ${t.engines.join('+')}, reason: ${t.reasons[0]}`
  ).join('\n');
  const prompt = `${regimeCtx}\n${tradeLines}`;
  return runLLM(ai, COMPOSE_SYSTEM, prompt);
}

// ═══════════════════════════════════════════════════════════════
// Check if Z.AI is available
// ═══════════════════════════════════════════════════════════════

export function isZAiAvailable(env: Env): boolean {
  return !!(env as any).AI;
}
