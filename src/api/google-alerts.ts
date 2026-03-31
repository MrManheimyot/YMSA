// ─── Google Alerts RSS Feed Parser ───────────────────────────
// Fetches and parses 12 RSS feeds for real-time news intelligence
// Maps feeds to engines for targeted catalyst detection

// ─── Types ───────────────────────────────────────────────────

export interface NewsItem {
  category: string;
  title: string;
  url: string;
  published: string;
  snippet?: string;
}

interface AlertFeed {
  id: string;
  name: string;
  feedId: string;
  engines: string[];
}

// ─── Feed Configuration ──────────────────────────────────────

const BASE_URL = 'https://www.google.com/alerts/feeds/06848252681093017981';

const FEEDS: AlertFeed[] = [
  { id: 'mega-tech', name: 'Mega Tech Earnings', feedId: '6901773025916462726', engines: ['MTF_MOMENTUM'] },
  { id: 'more-tech', name: 'More Tech Earnings', feedId: '7474253027077514119', engines: ['MTF_MOMENTUM'] },
  { id: 'mna', name: 'M&A Deals', feedId: '2830240277168549326', engines: ['STAT_ARB', 'EVENT_DRIVEN'] },
  { id: 'short-squeeze', name: 'Short Squeeze / Options Flow', feedId: '7958317856286447665', engines: ['SMART_MONEY', 'OPTIONS'] },
  { id: 'fed-rates', name: 'Fed / Rate Decisions', feedId: '17133247196091448819', engines: ['EVENT_DRIVEN', 'RISK'] },
  { id: 'earnings', name: 'Earnings Beat/Miss', feedId: '5081257511531522414', engines: ['OPTIONS', 'EVENT_DRIVEN'] },
  { id: 'sec-13f', name: 'SEC 13F Filings', feedId: '11133225676798148886', engines: ['SMART_MONEY'] },
  { id: 'crypto', name: 'Crypto Regulation/ETF', feedId: '12127202496566810889', engines: ['CRYPTO_DEFI'] },
  { id: 'banks', name: 'Bank Earnings', feedId: '8450950994453056585', engines: ['MTF_MOMENTUM'] },
  { id: 'semis', name: 'Semiconductor Earnings', feedId: '14651396047479077800', engines: ['MTF_MOMENTUM', 'STAT_ARB'] },
  { id: 'buybacks', name: 'Buybacks/Dividends', feedId: '14632073281308566125', engines: ['OPTIONS'] },
  { id: 'crash-signals', name: 'Market Crash Signals', feedId: '3519822132556371923', engines: ['EVENT_DRIVEN', 'RISK'] },
];

// ─── Fetch Functions ─────────────────────────────────────────

/**
 * Fetch all 12 Google Alerts RSS feeds in parallel.
 * Parses Atom XML via regex (no XML parser needed in Workers).
 */
export async function fetchGoogleAlerts(): Promise<NewsItem[]> {
  const results = await Promise.allSettled(
    FEEDS.map(async (feed) => {
      try {
        const res = await fetch(`${BASE_URL}/${feed.feedId}`, {
          headers: { 'User-Agent': 'YMSA/3.0' },
        });
        if (!res.ok) return [];
        const xml = await res.text();
        return parseAtomEntries(xml, feed.id);
      } catch {
        return [];
      }
    })
  );

  const items: NewsItem[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    }
  }

  return items.sort((a, b) =>
    new Date(b.published).getTime() - new Date(a.published).getTime()
  );
}

/**
 * Fetch only feeds relevant to a specific engine.
 */
export async function fetchFeedsByEngine(engineId: string): Promise<NewsItem[]> {
  const relevantFeeds = FEEDS.filter(f => f.engines.includes(engineId));

  const results = await Promise.allSettled(
    relevantFeeds.map(async (feed) => {
      try {
        const res = await fetch(`${BASE_URL}/${feed.feedId}`, {
          headers: { 'User-Agent': 'YMSA/3.0' },
        });
        if (!res.ok) return [];
        const xml = await res.text();
        return parseAtomEntries(xml, feed.id);
      } catch {
        return [];
      }
    })
  );

  const items: NewsItem[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    }
  }

  return items.sort((a, b) =>
    new Date(b.published).getTime() - new Date(a.published).getTime()
  );
}

/**
 * Store news alerts in D1, deduplicating by URL hash.
 * Returns count of newly inserted items.
 */
export async function storeNewsAlerts(
  items: NewsItem[],
  db: D1Database
): Promise<number> {
  let inserted = 0;

  for (const item of items) {
    const id = simpleHash(item.url);
    try {
      await db.prepare(
        `INSERT OR IGNORE INTO news_alerts (id, category, title, url, published_at, processed, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)`
      ).bind(
        id,
        item.category,
        item.title,
        item.url,
        new Date(item.published).getTime(),
        Date.now()
      ).run();

      inserted++;
    } catch {
      // duplicate, skip
    }
  }

  return inserted;
}

/**
 * Format news items as Telegram digest.
 */
export function formatNewsDigest(items: NewsItem[], limit: number = 10): string {
  const limited = items.slice(0, limit);
  if (limited.length === 0) return '📰 No new alerts.';

  const lines = [
    `📰 <b>Google Alerts Digest (${limited.length} items)</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
  ];

  for (const item of limited) {
    const ago = getTimeAgo(new Date(item.published));
    lines.push(`  • [${item.category}] ${item.title.slice(0, 80)}`);
    lines.push(`    <a href="${item.url}">Read</a> — ${ago}`);
  }

  return lines.join('\n');
}

/**
 * Get the list of available feed categories and their engine mappings.
 */
export function getFeedConfig(): AlertFeed[] {
  return FEEDS;
}

// ─── Internal Helpers ────────────────────────────────────────

function parseAtomEntries(xml: string, category: string): NewsItem[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  return entries.map(entry => {
    const title = decodeHtmlEntities(
      entry.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]?.trim() || ''
    );
    const url = entry.match(/<link[^>]*href="([^"]*?)"/)?.[1] || '';
    const published = entry.match(/<published>(.*?)<\/published>/)?.[1]
      || entry.match(/<updated>(.*?)<\/updated>/)?.[1]
      || new Date().toISOString();
    const snippet = entry.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1]?.trim();

    return { category, title, url, published, snippet };
  }).filter(item => item.title && item.url);
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, ''); // strip HTML tags
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `news_${Math.abs(hash).toString(36)}`;
}

function getTimeAgo(date: Date): string {
  const ms = Date.now() - date.getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
