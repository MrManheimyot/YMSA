// ─── RSS Feed Aggregator ─────────────────────────────────────
// Superpower Data Layer: 25+ free RSS feeds for real-time news
// Tier 1 = market-moving (15min), Tier 2 = important (30min), Tier 3 = background (60min)

import { createLogger } from '../utils/logger';

const logger = createLogger('RSSAggregator');

// ─── Types ───────────────────────────────────────────────────

export interface RSSItem {
  title: string;
  link: string;
  pubDate: Date;
  source: string;
  category: RSSCategory;
  symbols: string[];
  description?: string;
}

export type RSSCategory = 'market_news' | 'earnings' | 'economy' | 'sector' | 'filings' | 'social' | 'crypto';

export interface RSSFeedConfig {
  url: string;
  source: string;
  category: RSSCategory;
  tier: 1 | 2 | 3;
  parser: 'rss2' | 'atom';
  engines: string[];
}

// ─── Feed Registry ───────────────────────────────────────────

const FEEDS: RSSFeedConfig[] = [
  // ── Tier 1: Market-Moving (poll every 15 min) ──
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114', source: 'CNBC', category: 'market_news', tier: 1, parser: 'rss2', engines: ['MTF_MOMENTUM', 'EVENT_DRIVEN'] },
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135', source: 'CNBC', category: 'earnings', tier: 1, parser: 'rss2', engines: ['OPTIONS', 'EVENT_DRIVEN'] },
  { url: 'https://feeds.marketwatch.com/marketwatch/realtimeheadlines/', source: 'MarketWatch', category: 'market_news', tier: 1, parser: 'rss2', engines: ['MTF_MOMENTUM', 'EVENT_DRIVEN'] },
  { url: 'https://feeds.marketwatch.com/marketwatch/bulletins/', source: 'MarketWatch', category: 'market_news', tier: 1, parser: 'rss2', engines: ['EVENT_DRIVEN'] },

  // ── Tier 2: Important (poll every 30 min) ──
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258', source: 'CNBC', category: 'economy', tier: 2, parser: 'rss2', engines: ['EVENT_DRIVEN'] },
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664', source: 'CNBC', category: 'sector', tier: 2, parser: 'rss2', engines: ['MTF_MOMENTUM'] },
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19854910', source: 'CNBC', category: 'sector', tier: 2, parser: 'rss2', engines: ['MTF_MOMENTUM'] },
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19836768', source: 'CNBC', category: 'sector', tier: 2, parser: 'rss2', engines: ['EVENT_DRIVEN'] },
  { url: 'https://feeds.marketwatch.com/marketwatch/topstories/', source: 'MarketWatch', category: 'market_news', tier: 2, parser: 'rss2', engines: ['MTF_MOMENTUM'] },
  { url: 'https://fred.stlouisfed.org/feed/release', source: 'FRED', category: 'economy', tier: 2, parser: 'rss2', engines: ['EVENT_DRIVEN'] },

  // ── Tier 3: Background (poll every 60 min) ──
  { url: 'https://news.google.com/rss/search?q=stock+market+earnings&hl=en-US&gl=US&ceid=US:en', source: 'GoogleNews', category: 'market_news', tier: 3, parser: 'rss2', engines: ['EVENT_DRIVEN'] },
  { url: 'https://www.benzinga.com/feed', source: 'Benzinga', category: 'market_news', tier: 3, parser: 'rss2', engines: ['EVENT_DRIVEN'] },
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100727362', source: 'CNBC', category: 'market_news', tier: 3, parser: 'rss2', engines: ['EVENT_DRIVEN'] },
  { url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000113', source: 'CNBC', category: 'market_news', tier: 3, parser: 'rss2', engines: ['EVENT_DRIVEN'] },
  { url: 'https://www.reddit.com/r/wallstreetbets/.rss', source: 'Reddit', category: 'social', tier: 3, parser: 'atom', engines: ['SMART_MONEY'] },
  { url: 'https://www.reddit.com/r/stocks/.rss', source: 'Reddit', category: 'social', tier: 3, parser: 'atom', engines: [] },
];

// Known ticker symbols to filter noise from regex extraction
const COMMON_WORDS = new Set([
  'A', 'I', 'AM', 'PM', 'US', 'UK', 'EU', 'AI', 'CEO', 'CFO', 'CTO', 'IPO', 'ETF',
  'GDP', 'CPI', 'FED', 'SEC', 'FBI', 'CIA', 'NYSE', 'IT', 'IS', 'AT', 'BY', 'OR',
  'AN', 'AS', 'IN', 'ON', 'TO', 'UP', 'IF', 'OF', 'FOR', 'THE', 'AND', 'BUT', 'NOT',
  'ALL', 'NEW', 'TOP', 'BIG', 'LOW', 'OLD', 'RUN', 'SET', 'HOW', 'NOW', 'MAY', 'CAN',
  'SO', 'NO', 'DO', 'GO', 'HE', 'WE', 'BE', 'ME', 'MY', 'ALSO', 'JUST', 'MOST',
  'OUR', 'OUT', 'SAY', 'HAS', 'HIS', 'HER', 'ITS', 'WHO', 'OIL', 'GAS', 'RE', 'VS',
  'NBC', 'CNN', 'BBC', 'ABC', 'CBS', 'WSJ', 'DOW', 'IMF', 'ESG', 'NFT', 'EV', 'PR',
  'DJ', 'TV', 'PC', 'PP', 'EST', 'PST', 'UTC', 'LIVE', 'SAYS', 'SAID', 'WILL', 'MORE',
]);

// ─── Public API ──────────────────────────────────────────────

/**
 * Fetch all RSS feeds for a given tier (or all tiers).
 * Returns deduplicated items sorted by date (newest first).
 */
export async function fetchRSSFeeds(tier?: 1 | 2 | 3): Promise<RSSItem[]> {
  const targetFeeds = tier ? FEEDS.filter(f => f.tier <= tier) : FEEDS;

  const results = await Promise.allSettled(
    targetFeeds.map(feed => fetchSingleFeed(feed))
  );

  const items: RSSItem[] = [];
  const seenLinks = new Set<string>();

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const item of result.value) {
        if (!seenLinks.has(item.link)) {
          seenLinks.add(item.link);
          items.push(item);
        }
      }
    }
  }

  return items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
}

/**
 * Fetch feeds mapped to a specific engine.
 */
export async function fetchFeedsByEngine(engineId: string): Promise<RSSItem[]> {
  const engineFeeds = FEEDS.filter(f => f.engines.includes(engineId));

  const results = await Promise.allSettled(
    engineFeeds.map(feed => fetchSingleFeed(feed))
  );

  const items: RSSItem[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') items.push(...result.value);
  }

  return items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
}

/**
 * Fetch Yahoo Finance per-symbol RSS (batch via comma-separated).
 */
export async function fetchYahooSymbolNews(symbols: string[]): Promise<RSSItem[]> {
  const batchSize = 10;
  const batches: string[][] = [];
  for (let i = 0; i < symbols.length; i += batchSize) {
    batches.push(symbols.slice(i, i + batchSize));
  }

  const results = await Promise.allSettled(
    batches.map(async (batch) => {
      const symbolStr = batch.join(',');
      const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${symbolStr}&region=US&lang=en-US`;
      return fetchSingleFeed({
        url, source: 'Yahoo', category: 'market_news',
        tier: 2, parser: 'rss2', engines: ['MTF_MOMENTUM', 'EVENT_DRIVEN'],
      });
    })
  );

  const items: RSSItem[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') items.push(...result.value);
  }

  return items.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
}

/**
 * Store RSS items to D1, deduplicating by link hash. Returns new item count.
 */
export async function storeRSSItems(items: RSSItem[], db: D1Database): Promise<number> {
  let inserted = 0;

  for (const item of items) {
    const id = hashString(item.link);
    try {
      await db.prepare(
        `INSERT OR IGNORE INTO rss_items (id, source, category, title, link, pub_date, symbols, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id, item.source, item.category, item.title,
        item.link, item.pubDate.toISOString(),
        JSON.stringify(item.symbols), Date.now()
      ).run();
      inserted++;
    } catch {
      // duplicate — skip
    }
  }

  return inserted;
}

/**
 * Get recent RSS items from D1 for a set of symbols.
 */
export async function getRecentRSSForSymbols(
  db: D1Database,
  symbols: string[],
  hoursBack: number = 24
): Promise<Array<{ title: string; source: string; symbols: string; sentiment: number | null; pub_date: string }>> {
  const since = new Date(Date.now() - hoursBack * 3600000).toISOString();
  // SQLite LIKE for each symbol in the JSON array
  const clauses = symbols.map(() => `symbols LIKE ?`).join(' OR ');
  const binds = symbols.map(s => `%"${s}"%`);

  const result = await db.prepare(
    `SELECT title, source, symbols, sentiment, pub_date FROM rss_items
     WHERE pub_date > ? AND (${clauses})
     ORDER BY pub_date DESC LIMIT 50`
  ).bind(since, ...binds).all();

  return (result.results || []) as any[];
}

/**
 * Update sentiment score for an RSS item.
 */
export async function updateRSSSentiment(db: D1Database, id: string, sentiment: number): Promise<void> {
  await db.prepare(
    `UPDATE rss_items SET sentiment = ? WHERE id = ?`
  ).bind(sentiment, id).run();
}

/**
 * Get feed registry for dashboard/debugging.
 */
export function getFeedRegistry(): RSSFeedConfig[] {
  return FEEDS;
}

// ─── Internal ────────────────────────────────────────────────

async function fetchSingleFeed(feed: RSSFeedConfig): Promise<RSSItem[]> {
  try {
    const res = await fetch(feed.url, {
      headers: { 'User-Agent': 'YMSA/3.3' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      logger.error(`RSS ${feed.source} HTTP ${res.status}`);
      return [];
    }

    const xml = await res.text();
    const items = feed.parser === 'atom' ? parseAtom(xml) : parseRSS2(xml);

    return items.map(raw => ({
      ...raw,
      source: feed.source,
      category: feed.category,
      symbols: extractSymbols(raw.title + ' ' + (raw.description || '')),
    }));
  } catch (err) {
    logger.error(`RSS ${feed.source} fetch error`, err);
    return [];
  }
}

function parseRSS2(xml: string): Array<{ title: string; link: string; pubDate: Date; description?: string }> {
  const items: Array<{ title: string; link: string; pubDate: Date; description?: string }> = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate');
    const description = extractTag(block, 'description');

    if (title && link) {
      items.push({
        title: decodeEntities(title),
        link,
        pubDate: pubDate ? new Date(pubDate) : new Date(),
        description: description ? decodeEntities(description) : undefined,
      });
    }
  }

  return items;
}

function parseAtom(xml: string): Array<{ title: string; link: string; pubDate: Date; description?: string }> {
  const items: Array<{ title: string; link: string; pubDate: Date; description?: string }> = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, 'title');
    const link = block.match(/<link[^>]*href="([^"]*?)"/)?.[1] || extractTag(block, 'link');
    const pubDate = extractTag(block, 'published') || extractTag(block, 'updated');
    const description = extractTag(block, 'content') || extractTag(block, 'summary');

    if (title && link) {
      items.push({
        title: decodeEntities(title),
        link,
        pubDate: pubDate ? new Date(pubDate) : new Date(),
        description: description ? decodeEntities(description) : undefined,
      });
    }
  }

  return items;
}

function extractTag(xml: string, tag: string): string | null {
  const cdata = xml.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`))?.[1];
  if (cdata) return cdata;

  return xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1]?.trim() || null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, '');
}

/**
 * Extract probable ticker symbols from text.
 * Filters common English words, keeps 1-5 uppercase letter sequences
 * that could be tickers ($AAPL or standalone AAPL).
 */
function extractSymbols(text: string): string[] {
  const dollarTickers = text.match(/\$([A-Z]{1,5})\b/g)?.map(t => t.slice(1)) || [];
  const capWords = text.match(/\b([A-Z]{2,5})\b/g)?.filter(w => !COMMON_WORDS.has(w)) || [];
  return [...new Set([...dollarTickers, ...capWords])].slice(0, 10);
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `rss_${Math.abs(hash).toString(36)}`;
}
