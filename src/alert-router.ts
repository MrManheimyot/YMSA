// ─── Alert Router ─────────────────────────────────────────────
// Routes signals to Telegram, WhatsApp, and Email
// Handles priority batching and rate limiting

import type { Env, Signal, AlertPriority, StockQuote, TechnicalIndicator, FibonacciResult } from './types';

// ─── Telegram ────────────────────────────────────────────────

const TELEGRAM_API = 'https://api.telegram.org';

/**
 * Send a formatted alert message to Telegram
 */
export async function sendTelegramAlert(
  signals: Signal[],
  quote: StockQuote,
  indicators: TechnicalIndicator[],
  fibonacci: FibonacciResult | null,
  env: Env
): Promise<boolean> {
  const message = formatAlertMessage(signals, quote, indicators, fibonacci);

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
 * Format a rich alert message with all signal data
 */
function formatAlertMessage(
  signals: Signal[],
  quote: StockQuote,
  indicators: TechnicalIndicator[],
  fibonacci: FibonacciResult | null
): string {
  const priorityEmoji: Record<AlertPriority, string> = {
    CRITICAL: '🔴',
    IMPORTANT: '🟡',
    INFO: '🟢',
  };

  const topPriority = signals.reduce<AlertPriority>(
    (highest, s) =>
      s.priority === 'CRITICAL' ? 'CRITICAL' :
        s.priority === 'IMPORTANT' && highest !== 'CRITICAL' ? 'IMPORTANT' :
          highest,
    'INFO'
  );

  const lines: string[] = [
    `${priorityEmoji[topPriority]} <b>${topPriority} ALERT — ${quote.symbol}</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
  ];

  // Signals
  for (const signal of signals) {
    lines.push(`${priorityEmoji[signal.priority]} <b>${signal.title}</b>`);
    lines.push(`  ${signal.description}`);
  }

  // Price info
  const changeEmoji = quote.changePercent >= 0 ? '📈' : '📉';
  lines.push(``);
  lines.push(`${changeEmoji} <b>Price:</b> $${quote.price.toFixed(2)} (${quote.changePercent >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%)`);

  // Indicators summary
  const rsi = indicators.find((i) => i.indicator === 'RSI');
  const ema50 = indicators.find((i) => i.indicator === 'EMA_50');
  const ema200 = indicators.find((i) => i.indicator === 'EMA_200');
  const macd = indicators.find((i) => i.indicator === 'MACD');

  if (rsi) lines.push(`📊 RSI(14): ${rsi.value.toFixed(1)}`);
  if (ema50 && ema200) lines.push(`📊 EMA: 50=${ema50.value.toFixed(2)} | 200=${ema200.value.toFixed(2)}`);
  if (macd) {
    const macdSignal = indicators.find((i) => i.indicator === 'MACD_SIGNAL');
    if (macdSignal) {
      lines.push(`📊 MACD: ${macd.value.toFixed(3)} (Signal: ${macdSignal.value.toFixed(3)})`);
    }
  }

  // 52-week range
  if (quote.week52High > 0 && quote.week52Low > 0) {
    const position = ((quote.price - quote.week52Low) / (quote.week52High - quote.week52Low)) * 100;
    lines.push(`📊 52W: $${quote.week52Low.toFixed(2)} - $${quote.week52High.toFixed(2)} (${position.toFixed(1)}%)`);
  }

  // Fibonacci summary
  if (fibonacci?.nearestLevel) {
    lines.push(``);
    lines.push(`📐 <b>Fibonacci:</b>`);
    for (const level of fibonacci.levels.slice(1, -1)) { // Skip 0% and 100%
      const marker = Math.abs(level.distancePercent) < 1 ? '🎯' : ' ';
      lines.push(`  ${marker} ${level.label}: $${level.price.toFixed(2)}`);
    }
  }

  // Quick links
  lines.push(``);
  lines.push(
    `🔗 <a href="https://finance.yahoo.com/quote/${quote.symbol}">Yahoo</a>` +
    ` | <a href="https://finviz.com/quote.ashx?t=${quote.symbol}">Finviz</a>` +
    ` | <a href="https://tradingview.com/symbols/${quote.symbol}">TradingView</a>`
  );

  // Timestamp
  const now = new Date();
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`⏰ ${now.toISOString().replace('T', ' ').slice(0, 19)} UTC`);

  return lines.join('\n');
}

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
