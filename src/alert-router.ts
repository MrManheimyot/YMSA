// ─── Alert Router ─────────────────────────────────────────────
// Routes signals to Telegram
// Uses alert-formatter for actionable trade alert formatting
// Logs every sent alert to D1 telegram_alerts table for win/loss tracking

import type { Env, Signal, AlertPriority, StockQuote, TechnicalIndicator, FibonacciResult } from './types';
import { formatTechnicalAlert } from './alert-formatter';
import { insertTelegramAlert, generateId, getLatestRegime } from './db/queries';

// ─── Telegram ────────────────────────────────────────────────

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * Send a formatted trade alert to Telegram and log to D1
 */
export async function sendTelegramAlert(
  signals: Signal[],
  quote: StockQuote,
  indicators: TechnicalIndicator[],
  fibonacci: FibonacciResult | null,
  env: Env
): Promise<boolean> {
  const message = formatTechnicalAlert(signals, quote, indicators, fibonacci);

  // Empty string means dedup suppressed or no actionable signals
  if (!message) return true;

  try {
    const res = await fetch(
      `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error(`[Telegram] Send failed: ${err}`);
      return false;
    }

    // Log alert to D1 for win/loss tracking
    if (env.DB) {
      try {
        const action = deriveActionFromMessage(message);
        const entryPrice = extractPrice(message, 'Entry');
        const stopLoss = extractPrice(message, 'Stop Loss');
        const tp1 = extractPrice(message, 'TP1');
        const tp2 = extractPrice(message, 'TP2');
        const confidence = extractConfidence(message);
        const engineId = signals[0]?.type?.includes('MTF') ? 'MTF_MOMENTUM'
          : signals[0]?.type?.includes('ORDER_BLOCK') || signals[0]?.type?.includes('LIQUIDITY') ? 'SMART_MONEY'
          : signals[0]?.type?.includes('PAIR') ? 'STAT_ARB'
          : signals[0]?.type?.includes('CRYPTO') || signals[0]?.type?.includes('WHALE') ? 'CRYPTO_DEFI'
          : signals[0]?.type?.includes('EARNINGS') || signals[0]?.type?.includes('NEWS') ? 'EVENT_DRIVEN'
          : 'TECHNICAL';
        // Fetch latest regime from D1
        let currentRegime: string | null = null;
        try {
          const regimeData = await getLatestRegime(env.DB);
          currentRegime = regimeData?.regime ?? null;
        } catch { /* regime lookup is best-effort */ }
        await insertTelegramAlert(env.DB, {
          id: generateId('tga'),
          symbol: quote.symbol,
          action,
          engine_id: engineId,
          entry_price: entryPrice || quote.price,
          stop_loss: stopLoss,
          take_profit_1: tp1,
          take_profit_2: tp2,
          confidence,
          alert_text: message,
          regime: currentRegime,
          metadata: JSON.stringify({ signals: signals.map(s => ({ type: s.type, priority: s.priority, title: s.title })) }),
          sent_at: Date.now(),
          gate_status: 'APPROVED',
        });
      } catch (logErr) {
        console.error('[Telegram] Alert log to D1 failed:', logErr);
      }
    }

    return true;
  } catch (err) {
    console.error(`[Telegram] Error:`, err);
    return false;
  }
}

// ─── Helper: extract info from alert text ────────────────────
function deriveActionFromMessage(msg: string): 'BUY' | 'SELL' {
  if (msg.includes('Action: BUY') || msg.includes('<b>Action: BUY</b>')) return 'BUY';
  return 'SELL';
}

function extractPrice(msg: string, label: string): number | null {
  const regex = new RegExp(label + ':\\s*\\$([\\d,.]+)');
  const match = msg.match(regex);
  return match ? parseFloat(match[1].replace(',', '')) : null;
}

function extractConfidence(msg: string): number {
  const match = msg.match(/Confidence:<\/b>\s*(\d+)\/100/);
  return match ? parseInt(match[1]) : 0;
}

/**
 * Send a simple text message to Telegram
 */
export async function sendTelegramMessage(text: string, env: Env): Promise<boolean> {
  try {
    const res = await fetch(
      `${TELEGRAM_API}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_CHAT_ID,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      }
    );
    return res.ok;
  } catch (err) {
    console.error(`[Telegram] Error:`, err);
    return false;
  }
}

/**
 * Send a daily briefing to Telegram
 */
export async function sendDailyBriefing(briefing: string, env: Env): Promise<boolean> {
  // Telegram has a 4096 char limit per message
  const chunks = splitMessage(briefing, 4000);

  for (const chunk of chunks) {
    const success = await sendTelegramMessage(chunk, env);
    if (!success) return false;
    // Small delay between chunks
    await new Promise((r) => setTimeout(r, 100));
  }

  return true;
}

// ─── Message Formatting ──────────────────────────────────────

/**
 * Split long messages for Telegram's character limit
 */
function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let current = '';

  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > maxLength) {
      chunks.push(current);
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

/**
 * Batch signals by priority for digest sending
 */
export function batchSignalsByPriority(
  signals: Signal[]
): Record<AlertPriority, Signal[]> {
  return {
    CRITICAL: signals.filter((s) => s.priority === 'CRITICAL'),
    IMPORTANT: signals.filter((s) => s.priority === 'IMPORTANT'),
    INFO: signals.filter((s) => s.priority === 'INFO'),
  };
}
