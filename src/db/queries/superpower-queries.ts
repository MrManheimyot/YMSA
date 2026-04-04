// ─── Superpower Data Layer Queries ───────────────────────────
// D1 CRUD for rss_items, tv_scanner_snapshots, social_sentiment, feed_health

// ─── RSS Items ───────────────────────────────────────────────

export async function insertRSSItem(
  db: D1Database,
  id: string,
  source: string,
  category: string,
  title: string,
  link: string,
  pubDate: string,
  symbols: string[],
): Promise<void> {
  await db.prepare(
    `INSERT OR IGNORE INTO rss_items (id, source, category, title, link, pub_date, symbols, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, source, category, title, link, pubDate, JSON.stringify(symbols), Date.now()).run();
}

export async function updateRSSSentiment(
  db: D1Database,
  id: string,
  sentiment: number,
  eventType?: string,
): Promise<void> {
  if (eventType) {
    await db.prepare(`UPDATE rss_items SET sentiment = ?, event_type = ? WHERE id = ?`)
      .bind(sentiment, eventType, id).run();
  } else {
    await db.prepare(`UPDATE rss_items SET sentiment = ? WHERE id = ?`)
      .bind(sentiment, id).run();
  }
}

export async function getRecentRSSItems(
  db: D1Database,
  hoursBack: number = 24,
  limit: number = 50,
): Promise<Array<{
  id: string; source: string; category: string; title: string;
  link: string; pub_date: string; symbols: string; sentiment: number | null;
}>> {
  const since = new Date(Date.now() - hoursBack * 3600000).toISOString();
  const result = await db.prepare(
    `SELECT id, source, category, title, link, pub_date, symbols, sentiment
     FROM rss_items WHERE pub_date > ? ORDER BY pub_date DESC LIMIT ?`
  ).bind(since, limit).all();
  return (result.results || []) as any[];
}

export async function getRSSItemsForSymbol(
  db: D1Database,
  symbol: string,
  hoursBack: number = 48,
): Promise<Array<{ title: string; source: string; sentiment: number | null; pub_date: string }>> {
  const since = new Date(Date.now() - hoursBack * 3600000).toISOString();
  const result = await db.prepare(
    `SELECT title, source, sentiment, pub_date FROM rss_items
     WHERE symbols LIKE ? AND pub_date > ?
     ORDER BY pub_date DESC LIMIT 20`
  ).bind(`%"${symbol}"%`, since).all();
  return (result.results || []) as any[];
}

// ─── TradingView Scanner Snapshots ───────────────────────────

export async function insertTVScannerSnapshot(
  db: D1Database,
  id: string,
  scanType: string,
  symbol: string,
  close: number,
  changePct: number,
  volume: number,
  relativeVolume: number,
  rsi: number,
  marketCap: number,
  sector: string,
  recommendation: string,
): Promise<void> {
  await db.prepare(
    `INSERT OR REPLACE INTO tv_scanner_snapshots
     (id, scan_type, symbol, close, change_pct, volume, relative_volume, rsi, market_cap, sector, recommendation, scanned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, scanType, symbol, close, changePct, volume, relativeVolume, rsi, marketCap, sector, recommendation, Date.now()).run();
}

export async function getLatestTVSnapshot(
  db: D1Database,
  scanType: string,
  limit: number = 20,
): Promise<Array<{
  symbol: string; close: number; change_pct: number;
  volume: number; rsi: number; sector: string;
}>> {
  const result = await db.prepare(
    `SELECT symbol, close, change_pct, volume, rsi, sector
     FROM tv_scanner_snapshots WHERE scan_type = ?
     ORDER BY scanned_at DESC LIMIT ?`
  ).bind(scanType, limit).all();
  return (result.results || []) as any[];
}

// ─── Social Sentiment ────────────────────────────────────────

export async function insertSocialSentiment(
  db: D1Database,
  id: string,
  symbol: string,
  source: string,
  bullish: number,
  bearish: number,
  totalMessages: number,
  sentimentScore: number,
  watchlistCount: number,
): Promise<void> {
  await db.prepare(
    `INSERT OR REPLACE INTO social_sentiment
     (id, symbol, source, bullish, bearish, total_messages, sentiment_score, watchlist_count, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, symbol, source, bullish, bearish, totalMessages, sentimentScore, watchlistCount, Date.now()).run();
}

export async function getLatestSentiment(
  db: D1Database,
  symbol: string,
): Promise<{ sentiment_score: number; source: string; recorded_at: number } | null> {
  const result = await db.prepare(
    `SELECT sentiment_score, source, recorded_at FROM social_sentiment
     WHERE symbol = ? ORDER BY recorded_at DESC LIMIT 1`
  ).bind(symbol).first();
  return result as any;
}

export async function getRecentSentimentAll(
  db: D1Database,
  limit: number = 30,
): Promise<Array<{
  symbol: string; source: string; bullish: number; bearish: number;
  total_messages: number; sentiment_score: number; watchlist_count: number; recorded_at: number;
}>> {
  const result = await db.prepare(
    `SELECT symbol, source, bullish, bearish, total_messages, sentiment_score, watchlist_count, recorded_at
     FROM social_sentiment ORDER BY recorded_at DESC LIMIT ?`
  ).bind(limit).all();
  return (result.results || []) as any[];
}

// ─── Feed Health ─────────────────────────────────────────────

export async function updateFeedHealth(
  db: D1Database,
  source: string,
  success: boolean,
  itemCount: number,
): Promise<void> {
  if (success) {
    await db.prepare(
      `INSERT INTO feed_health (source, total_fetches, successful_fetches, avg_items_per_fetch, last_success_at, consecutive_failures, updated_at)
       VALUES (?, 1, 1, ?, ?, 0, ?)
       ON CONFLICT(source) DO UPDATE SET
         total_fetches = total_fetches + 1,
         successful_fetches = successful_fetches + 1,
         avg_items_per_fetch = (avg_items_per_fetch * successful_fetches + ?) / (successful_fetches + 1),
         last_success_at = ?,
         consecutive_failures = 0,
         updated_at = ?`
    ).bind(source, itemCount, Date.now(), Date.now(), itemCount, Date.now(), Date.now()).run();
  } else {
    await db.prepare(
      `INSERT INTO feed_health (source, total_fetches, successful_fetches, avg_items_per_fetch, last_failure_at, consecutive_failures, updated_at)
       VALUES (?, 1, 0, 0, ?, 1, ?)
       ON CONFLICT(source) DO UPDATE SET
         total_fetches = total_fetches + 1,
         last_failure_at = ?,
         consecutive_failures = consecutive_failures + 1,
         updated_at = ?`
    ).bind(source, Date.now(), Date.now(), Date.now(), Date.now()).run();
  }
}

export async function getFeedHealthReport(
  db: D1Database,
): Promise<Array<{
  source: string; total_fetches: number; successful_fetches: number;
  avg_items_per_fetch: number; consecutive_failures: number;
}>> {
  const result = await db.prepare(
    `SELECT source, total_fetches, successful_fetches, avg_items_per_fetch, consecutive_failures
     FROM feed_health ORDER BY source`
  ).all();
  return (result.results || []) as any[];
}
