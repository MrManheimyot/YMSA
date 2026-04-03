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
// 6. Trade Validation — Z.AI reviews data quality before execution
// ═══════════════════════════════════════════════════════════════

const VALIDATE_SYSTEM = `You are Z.AI, the risk validation officer of YMSA. You review trade setups BEFORE execution. Analyze the data quality and respond with EXACTLY this format:
VERDICT: APPROVE or REJECT
CONFIDENCE: 0-100
REASON: one sentence explanation

Only APPROVE if: data sources agree, indicators are consistent, risk:reward is sound, trade aligns with market regime. REJECT if any data looks stale, conflicting, or the setup has poor risk management. Be strict — false positives cost real money.`;

export interface ZAiValidation {
  verdict: 'APPROVE' | 'REJECT' | 'UNAVAILABLE';
  confidence: number;
  reason: string;
}

export async function validateTradeSetup(
  ai: any,
  trade: MergedTradeInfo,
  regime: MarketRegime | null,
  dataQuality: { overallScore: number; failCount: number; issues: string[] },
): Promise<ZAiValidation> {
  if (!ai) return { verdict: 'UNAVAILABLE', confidence: 0, reason: 'Z.AI not available' };

  const regimeCtx = regime
    ? `Regime: ${regime.regime}, VIX ${regime.vix.toFixed(0)}, ADX ${regime.adx?.toFixed(0) ?? '?'}, conf ${regime.confidence}%.`
    : 'Regime: unknown.';

  const prompt = `TRADE SETUP TO VALIDATE:
${trade.direction} ${trade.symbol} at $${trade.entry.toFixed(2)}
Engines: ${trade.engines.join(', ')} (${trade.engines.length} engines)
Confidence: ${trade.confidence}/100
SL: $${trade.stopLoss.toFixed(2)}, TP1: $${trade.tp1.toFixed(2)}
R:R: ${trade.stopLoss !== trade.entry ? (Math.abs(trade.tp1 - trade.entry) / Math.abs(trade.entry - trade.stopLoss)).toFixed(2) : 'N/A'}
Conflicting engines: ${trade.conflicting ? 'YES' : 'NO'}
${regimeCtx}

DATA QUALITY REPORT:
Overall score: ${dataQuality.overallScore}/100
Critical issues: ${dataQuality.failCount}
${dataQuality.issues.length > 0 ? 'Issues:\n' + dataQuality.issues.slice(0, 5).map(i => `- ${i}`).join('\n') : 'No issues found.'}

Reasons: ${trade.reasons.slice(0, 3).join(' | ')}`;

  const raw = await runLLM(ai, VALIDATE_SYSTEM, prompt);
  if (!raw) return { verdict: 'UNAVAILABLE', confidence: 0, reason: 'Z.AI returned empty response' };

  // Parse structured response
  const verdictMatch = raw.match(/VERDICT:\s*(APPROVE|REJECT)/i);
  const confMatch = raw.match(/CONFIDENCE:\s*(\d+)/i);
  const reasonMatch = raw.match(/REASON:\s*(.+)/i);

  const verdict = verdictMatch ? verdictMatch[1].toUpperCase() as 'APPROVE' | 'REJECT' : 'REJECT';
  const confidence = confMatch ? Math.min(100, Math.max(0, parseInt(confMatch[1], 10))) : 0;
  const reason = reasonMatch ? reasonMatch[1].trim() : raw.substring(0, 100);

  return { verdict, confidence, reason };
}

// ═══════════════════════════════════════════════════════════════
// 7. Data Anomaly Detection — Z.AI spots suspicious patterns
// ═══════════════════════════════════════════════════════════════

const ANOMALY_SYSTEM = `You are Z.AI, a data quality analyst. Given market data for a stock, identify anomalies. Respond with:
ANOMALIES: number found (0 if none)
For each anomaly:
- TYPE: STALE_DATA | PRICE_MISMATCH | VOLUME_ANOMALY | INDICATOR_CONFLICT | REGIME_MISMATCH
- DETAIL: brief explanation
Be concise. If data looks normal, say ANOMALIES: 0.`;

export interface DataAnomaly {
  type: string;
  detail: string;
}

export async function detectDataAnomalies(
  ai: any,
  symbol: string,
  data: {
    price: number;
    volume: number;
    avgVolume: number;
    rsi?: number;
    macd?: number;
    atr?: number;
    ema50?: number;
    ema200?: number;
    regime?: string;
    vix?: number;
    changePercent: number;
  },
): Promise<DataAnomaly[]> {
  if (!ai) return [];

  const prompt = `${symbol} data snapshot:
Price: $${data.price.toFixed(2)}, Change: ${data.changePercent >= 0 ? '+' : ''}${data.changePercent.toFixed(2)}%
Volume: ${data.volume.toLocaleString()} (avg: ${data.avgVolume.toLocaleString()}, ratio: ${data.avgVolume > 0 ? (data.volume / data.avgVolume).toFixed(1) : '?'}x)
RSI: ${data.rsi?.toFixed(1) ?? 'N/A'}, MACD: ${data.macd?.toFixed(4) ?? 'N/A'}, ATR: ${data.atr?.toFixed(2) ?? 'N/A'}
EMA50: ${data.ema50 ? '$' + data.ema50.toFixed(2) : 'N/A'}, EMA200: ${data.ema200 ? '$' + data.ema200.toFixed(2) : 'N/A'}
Regime: ${data.regime ?? 'N/A'}, VIX: ${data.vix?.toFixed(1) ?? 'N/A'}`;

  const raw = await runLLM(ai, ANOMALY_SYSTEM, prompt);
  if (!raw) return [];

  const anomalies: DataAnomaly[] = [];
  const typeMatches = raw.matchAll(/TYPE:\s*(\S+)/gi);
  const detailMatches = raw.matchAll(/DETAIL:\s*(.+)/gi);

  const types = [...typeMatches].map(m => m[1]);
  const details = [...detailMatches].map(m => m[1].trim());

  for (let i = 0; i < types.length; i++) {
    anomalies.push({ type: types[i], detail: details[i] ?? 'No detail' });
  }

  return anomalies;
}

// ═══════════════════════════════════════════════════════════════
// Check if Z.AI is available
// ═══════════════════════════════════════════════════════════════

export function isZAiAvailable(env: Env): boolean {
  return !!(env as any).AI;
}

// ═══════════════════════════════════════════════════════════════
// P6: Z.AI HEALTH MONITORING — Track availability + quality
// ═══════════════════════════════════════════════════════════════

export interface ZAiHealthStats {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  failureRate: number;          // 0-1
  approvals: number;
  rejections: number;
  unavailable: number;
  approvalRate: number;         // 0-1
  rejectionRate: number;        // 0-1
  avgResponseLength: number;
  lastResetAt: number;
  alerts: string[];             // Warning messages
}

// In-memory stats — resets each Worker lifecycle (typically per cron cycle)
const healthStats = {
  totalCalls: 0,
  successfulCalls: 0,
  failedCalls: 0,
  approvals: 0,
  rejections: 0,
  unavailable: 0,
  responseLengths: [] as number[],
  lastResetAt: Date.now(),
};

/**
 * Record a Z.AI LLM call result for health monitoring.
 * Call this after any runLLM / validateTradeSetup invocation.
 */
export function recordZAiCall(success: boolean, responseLength: number = 0): void {
  healthStats.totalCalls++;
  if (success && responseLength > 0) {
    healthStats.successfulCalls++;
    healthStats.responseLengths.push(responseLength);
  } else {
    healthStats.failedCalls++;
  }
}

/**
 * Record a trade validation result for bias tracking.
 */
export function recordValidationResult(verdict: 'APPROVE' | 'REJECT' | 'UNAVAILABLE'): void {
  if (verdict === 'APPROVE') healthStats.approvals++;
  else if (verdict === 'REJECT') healthStats.rejections++;
  else healthStats.unavailable++;
}

/**
 * Get current health stats with alerting thresholds.
 * Alerts trigger when:
 *   - >10% calls fail in current scan cycle
 *   - Approve rate >95% (rubber-stamping bias)
 *   - Reject rate >80% (over-conservative bias)
 */
export function getZAiHealthStats(): ZAiHealthStats {
  const total = healthStats.totalCalls;
  const failureRate = total > 0 ? healthStats.failedCalls / total : 0;
  const validationTotal = healthStats.approvals + healthStats.rejections + healthStats.unavailable;
  const approvalRate = validationTotal > 0 ? healthStats.approvals / validationTotal : 0;
  const rejectionRate = validationTotal > 0 ? healthStats.rejections / validationTotal : 0;
  const avgLen = healthStats.responseLengths.length > 0
    ? healthStats.responseLengths.reduce((s, l) => s + l, 0) / healthStats.responseLengths.length
    : 0;

  const alerts: string[] = [];

  // Alert: High failure rate
  if (total >= 3 && failureRate > 0.10) {
    alerts.push(`⚠️ Z.AI failure rate ${(failureRate * 100).toFixed(0)}% (${healthStats.failedCalls}/${total} calls failed)`);
  }

  // Alert: Rubber-stamping bias (approve >95%)
  if (validationTotal >= 5 && approvalRate > 0.95) {
    alerts.push(`⚠️ Z.AI approval bias: ${(approvalRate * 100).toFixed(0)}% approved (${healthStats.approvals}/${validationTotal}) — possible rubber-stamping`);
  }

  // Alert: Over-conservative bias (reject >80%)
  if (validationTotal >= 5 && rejectionRate > 0.80) {
    alerts.push(`⚠️ Z.AI rejection bias: ${(rejectionRate * 100).toFixed(0)}% rejected (${healthStats.rejections}/${validationTotal}) — may be blocking valid trades`);
  }

  // Alert: Complete unavailability
  if (total >= 3 && healthStats.unavailable === validationTotal && validationTotal > 0) {
    alerts.push(`🚨 Z.AI completely unavailable for all ${validationTotal} validation calls`);
  }

  return {
    totalCalls: total,
    successfulCalls: healthStats.successfulCalls,
    failedCalls: healthStats.failedCalls,
    failureRate,
    approvals: healthStats.approvals,
    rejections: healthStats.rejections,
    unavailable: healthStats.unavailable,
    approvalRate,
    rejectionRate,
    avgResponseLength: avgLen,
    lastResetAt: healthStats.lastResetAt,
    alerts,
  };
}

/**
 * Reset health stats (call at start of each scan cycle).
 */
export function resetZAiHealthStats(): void {
  healthStats.totalCalls = 0;
  healthStats.successfulCalls = 0;
  healthStats.failedCalls = 0;
  healthStats.approvals = 0;
  healthStats.rejections = 0;
  healthStats.unavailable = 0;
  healthStats.responseLengths = [];
  healthStats.lastResetAt = Date.now();
}

/**
 * Format Z.AI health report for Telegram.
 */
export function formatZAiHealthReport(stats: ZAiHealthStats): string {
  const lines = [
    `🤖 <b>Z.AI Health Report</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `Calls: ${stats.totalCalls} (✅ ${stats.successfulCalls} | ❌ ${stats.failedCalls})`,
    `Failure rate: ${(stats.failureRate * 100).toFixed(1)}%`,
    `Validations: ✅ ${stats.approvals} approved | ❌ ${stats.rejections} rejected | ⏭️ ${stats.unavailable} unavailable`,
    `Approval rate: ${(stats.approvalRate * 100).toFixed(0)}% | Rejection rate: ${(stats.rejectionRate * 100).toFixed(0)}%`,
    `Avg response: ${stats.avgResponseLength.toFixed(0)} chars`,
  ];

  if (stats.alerts.length > 0) {
    lines.push(``, `<b>Alerts:</b>`);
    for (const alert of stats.alerts) {
      lines.push(`  ${alert}`);
    }
  }

  return lines.join('\n');
}
