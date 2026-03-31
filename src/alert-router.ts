// ─── Alert Router ─────────────────────────────────────────────
// Routes signals to Telegram
// Uses alert-formatter for actionable trade alert formatting

import type { Env, Signal, AlertPriority, StockQuote, TechnicalIndicator, FibonacciResult } from './types';
import { formatTechnicalAlert } from './alert-formatter';

// ─── Telegram ────────────────────────────────────────────────

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * Send a formatted trade alert to Telegram
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

    return true;
  } catch (err) {
    console.error(`[Telegram] Error:`, err);
    return false;
  }
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
