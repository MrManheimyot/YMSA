// ─── News Signal Booster ─────────────────────────────────────
// Enhances trade signal confidence based on correlated RSS news sentiment.
// Called from the merge pipeline before Z.AI gating.
// Boost range: -20 to +20 confidence points.

import { createLogger } from '../utils/logger';

const logger = createLogger('NewsBoost');

interface NewsBoostResult {
  symbol: string;
  boost: number;
  reasons: string[];
  newsCount: number;
}

/**
 * Calculate news sentiment boost for a symbol.
 * Queries D1 for recent RSS items matching the symbol.
 * Returns confidence adjustment (-20 to +20).
 */
export async function getNewsBoost(
  db: D1Database,
  symbol: string,
  direction: 'BUY' | 'SELL'
): Promise<NewsBoostResult> {
  try {
    const since = new Date(Date.now() - 12 * 3600000).toISOString(); // 12 hours
    const result = await db.prepare(
      `SELECT title, source, sentiment FROM rss_items
       WHERE symbols LIKE ? AND pub_date > ? AND sentiment IS NOT NULL
       ORDER BY pub_date DESC LIMIT 10`
    ).bind(`%"${symbol}"%`, since).all();

    const items = (result.results || []) as Array<{ title: string; source: string; sentiment: number }>;

    if (items.length === 0) {
      return { symbol, boost: 0, reasons: [], newsCount: 0 };
    }

    // Calculate average sentiment
    const avgSentiment = items.reduce((sum, i) => sum + i.sentiment, 0) / items.length;

    // Boost calculation: sentiment aligned with direction gets positive boost
    const directionMultiplier = direction === 'BUY' ? 1 : -1;
    const rawBoost = (avgSentiment / 100) * 20 * directionMultiplier;
    const boost = Math.round(Math.max(-20, Math.min(20, rawBoost)));

    const reasons: string[] = [];
    if (boost > 5) reasons.push(`${items.length} recent news items support ${direction}`);
    else if (boost < -5) reasons.push(`${items.length} recent news items contradict ${direction}`);

    // Volume of coverage boost (more articles = more significant)
    const coverageBoost = Math.min(5, Math.floor(items.length / 2));
    const totalBoost = Math.max(-20, Math.min(20, boost + (boost > 0 ? coverageBoost : -coverageBoost)));

    return {
      symbol,
      boost: totalBoost,
      reasons,
      newsCount: items.length,
    };
  } catch (err) {
    logger.error(`News boost error for ${symbol}`, err);
    return { symbol, boost: 0, reasons: [], newsCount: 0 };
  }
}

/**
 * Check social sentiment for a symbol (from social_sentiment table).
 * Returns additional boost -10 to +10 based on crowd sentiment.
 */
export async function getSocialBoost(
  db: D1Database,
  symbol: string,
  direction: 'BUY' | 'SELL'
): Promise<number> {
  try {
    const result = await db.prepare(
      `SELECT sentiment_score, total_messages FROM social_sentiment
       WHERE symbol = ? ORDER BY recorded_at DESC LIMIT 1`
    ).bind(symbol).first() as { sentiment_score: number; total_messages: number } | null;

    if (!result || result.total_messages < 5) return 0;

    const directionMultiplier = direction === 'BUY' ? 1 : -1;
    // Contrarian: extreme social agreement = slight negative
    // Moderate agreement = positive
    if (Math.abs(result.sentiment_score) > 80) {
      // Crowd too bullish/bearish = contrarian signal
      return Math.round((result.sentiment_score / 100) * -5 * directionMultiplier);
    }
    return Math.round((result.sentiment_score / 100) * 10 * directionMultiplier);
  } catch {
    return 0;
  }
}

/**
 * Combined news + social boost for a trade signal.
 */
export async function getCombinedBoost(
  db: D1Database,
  symbol: string,
  direction: 'BUY' | 'SELL'
): Promise<{ boost: number; reasons: string[] }> {
  const [news, social] = await Promise.all([
    getNewsBoost(db, symbol, direction),
    getSocialBoost(db, symbol, direction),
  ]);

  const totalBoost = Math.max(-25, Math.min(25, news.boost + social));
  const reasons = [...news.reasons];
  if (social !== 0) {
    reasons.push(`Social sentiment: ${social > 0 ? '+' : ''}${social}`);
  }

  return { boost: totalBoost, reasons };
}
