// ─── Telegram Sender ──────────────────────────────────────────

import type { Env } from '../types';

export async function sendTelegramMessageEx(text: string, env: Env, silent: boolean): Promise<void> {
  const res = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        disable_notification: silent,
      }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    console.error(`[Broker Telegram] ${res.status}: ${err}`);
  }
}

export async function sendRiskAlert(text: string, env: Env): Promise<void> {
  await sendTelegramMessageEx(`🔴 <b>RISK ALERT</b>\n\n${text}`, env, false);
}

export async function sendExecutionAlert(text: string, env: Env): Promise<void> {
  if (!text) return;
  await sendTelegramMessageEx(`📊 <b>DAILY SUMMARY</b>\n\n${text}`, env, false);
}
