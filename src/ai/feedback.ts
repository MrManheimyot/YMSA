// ─── Z.AI Feedback Loop — Learn From Trade Outcomes ──────────
// Fetches recent closed trades from D1 and builds few-shot examples
// for the validation prompt. Top false positives + correct rejections.

import { getClosedTradesSince } from '../db/queries';
import { setFeedbackExamples } from './z-engine';

/**
 * Load recent trade outcomes from D1 and inject them into Z.AI validation.
 * Call once per cron cycle start (before any flushCycle).
 */
export async function loadFeedbackFromD1(db: D1Database): Promise<void> {
  try {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const trades = await getClosedTradesSince(db, sevenDaysAgo);
    if (trades.length < 3) return;

    // Top 5 worst losses (false positives the system SHOULD HAVE rejected)
    const losses = trades
      .filter(t => t.pnl !== null && t.pnl < 0)
      .sort((a, b) => (a.pnl ?? 0) - (b.pnl ?? 0))
      .slice(0, 5);

    // Top 5 best wins (correct approvals)
    const wins = trades
      .filter(t => t.pnl !== null && t.pnl > 0)
      .sort((a, b) => (b.pnl ?? 0) - (a.pnl ?? 0))
      .slice(0, 5);

    const lines: string[] = [];

    if (losses.length > 0) {
      lines.push('RECENT LOSSES (should have been REJECTED):');
      for (const t of losses) {
        lines.push(`- ${t.side} ${t.symbol} by ${t.engine_id}: entry $${t.entry_price.toFixed(2)} → exit $${(t.exit_price ?? 0).toFixed(2)}, P&L ${(t.pnl_pct ?? 0).toFixed(1)}%`);
      }
    }

    if (wins.length > 0) {
      lines.push('RECENT WINS (correctly APPROVED):');
      for (const t of wins) {
        lines.push(`- ${t.side} ${t.symbol} by ${t.engine_id}: entry $${t.entry_price.toFixed(2)} → exit $${(t.exit_price ?? 0).toFixed(2)}, P&L +${(t.pnl_pct ?? 0).toFixed(1)}%`);
      }
    }

    if (lines.length > 0) {
      setFeedbackExamples(lines.join('\n'));
    }
  } catch (err) {
    console.error('[Z.AI Feedback] Failed to load trade outcomes:', err);
  }
}
