// ─── Finviz Stock Screener Scraper ────────────────────────────
// Uses Cloudflare Browser Rendering (@cloudflare/playwright)
// Scrapes Finviz screener results — FREE, no API needed
// Supports 60+ screening filters from your manual workflow

import { createLogger } from '../utils/logger';

const logger = createLogger('Finviz');

interface BrowserBinding {
  launch(): Promise<any>;
}

export interface FinvizResult {
  ticker: string;
  company: string;
  sector: string;
  industry: string;
  country: string;
  marketCap: string;
  pe: string;
  price: number;
  change: number;
  volume: number;
}

export interface ScreenerFilter {
  rsi?: 'oversold' | 'overbought' | 'oversold30' | 'overbought70';
  ema?: 'above50' | 'below50' | 'above200' | 'below200' | 'cross50above' | 'cross50below';
  price?: 'under5' | 'under10' | 'under20' | 'over50' | 'over100';
  volume?: 'over200k' | 'over500k' | 'over1m' | 'over2m';
  change?: 'up' | 'up5' | 'up10' | 'down' | 'down5' | 'down10';
  performance?: 'gainers' | 'losers' | 'new_high' | 'new_low';
  sector?: string;
  marketCap?: 'mega' | 'large' | 'mid' | 'small' | 'micro';
}

// Finviz filter parameter mapping
const FILTER_MAP: Record<string, Record<string, string>> = {
  rsi: {
    oversold: 'ta_rsi_os',
    overbought: 'ta_rsi_ob',
    oversold30: 'ta_rsi_os30',
    overbought70: 'ta_rsi_ob70',
  },
  ema: {
    above50: 'ta_sma50_pa',
    below50: 'ta_sma50_pb',
    above200: 'ta_sma200_pa',
    below200: 'ta_sma200_pb',
    cross50above: 'ta_sma50_cross50a',
    cross50below: 'ta_sma50_cross50b',
  },
  price: {
    under5: 'sh_price_u5',
    under10: 'sh_price_u10',
    under20: 'sh_price_u20',
    over50: 'sh_price_o50',
    over100: 'sh_price_o100',
  },
  volume: {
    over200k: 'sh_avgvol_o200',
    over500k: 'sh_avgvol_o500',
    over1m: 'sh_avgvol_o1000',
    over2m: 'sh_avgvol_o2000',
  },
  change: {
    up: 'ta_change_u',
    up5: 'ta_change_u5',
    up10: 'ta_change_u10',
    down: 'ta_change_d',
    down5: 'ta_change_d5',
    down10: 'ta_change_d10',
  },
  performance: {
    gainers: 'ta_perf_1wup',
    losers: 'ta_perf_1wdown',
    new_high: 'ta_highlow52w_nh',
    new_low: 'ta_highlow52w_nl',
  },
  marketCap: {
    mega: 'cap_mega',
    large: 'cap_large',
    mid: 'cap_mid',
    small: 'cap_small',
    micro: 'cap_micro',
  },
};

/**
 * Build Finviz screener URL from filters
 */
export function buildScreenerUrl(filters: ScreenerFilter): string {
  const params: string[] = [];

  for (const [key, value] of Object.entries(filters)) {
    if (value && FILTER_MAP[key]?.[value as string]) {
      params.push(FILTER_MAP[key][value as string]);
    }
  }

  const filterStr = params.join(',');
  return `https://finviz.com/screener.ashx?v=111&f=${filterStr}&o=-change`;
}

/**
 * Scrape Finviz screener using Cloudflare Browser Rendering
 */
export async function scrapeScreener(
  browser: BrowserBinding,
  filters: ScreenerFilter
): Promise<FinvizResult[]> {
  const url = buildScreenerUrl(filters);
  logger.info(`Scraping: ${url}`);

  let browserInstance: any;

  try {
    browserInstance = await browser.launch();
    const page = await browserInstance.newPage();

    // Set realistic headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
    });

    await page.goto(url, { waitUntil: 'networkidle' });

    // Wait for screener table to load
    await page.waitForSelector('table.screener_table, #screener-content', { timeout: 10000 }).catch(() => {});

    // Extract data from the screener table
    const results = await page.evaluate(() => {
      const rows: any[] = [];
      // Finviz screener table rows
      const tableRows = document.querySelectorAll('table.screener_table tr, #screener-content table tr');

      for (let i = 1; i < tableRows.length && i <= 50; i++) { // Skip header, max 50
        const cells = tableRows[i].querySelectorAll('td');
        if (cells.length < 10) continue;

        rows.push({
          ticker: cells[1]?.textContent?.trim() || '',
          company: cells[2]?.textContent?.trim() || '',
          sector: cells[3]?.textContent?.trim() || '',
          industry: cells[4]?.textContent?.trim() || '',
          country: cells[5]?.textContent?.trim() || '',
          marketCap: cells[6]?.textContent?.trim() || '',
          pe: cells[7]?.textContent?.trim() || '',
          price: parseFloat(cells[8]?.textContent?.trim() || '0'),
          change: parseFloat((cells[9]?.textContent?.trim() || '0').replace('%', '')),
          volume: parseInt((cells[10]?.textContent?.trim() || '0').replace(/,/g, ''), 10),
        });
      }

      return rows;
    });

    await browserInstance.close();
    return results;
  } catch (err) {
    console.error('[Finviz] Scrape error:', err);
    if (browserInstance) await browserInstance.close().catch(() => {});
    return [];
  }
}

/**
 * Scrape RSI oversold stocks from Finviz
 */
export async function scrapeOversoldStocks(browser: BrowserBinding): Promise<FinvizResult[]> {
  return scrapeScreener(browser, {
    rsi: 'oversold',
    volume: 'over500k',
    marketCap: 'large',
  });
}

/**
 * Scrape new 52-week highs from Finviz
 */
export async function scrape52WeekHighs(browser: BrowserBinding): Promise<FinvizResult[]> {
  return scrapeScreener(browser, {
    performance: 'new_high',
    volume: 'over500k',
  });
}

/**
 * Scrape new 52-week lows from Finviz
 */
export async function scrape52WeekLows(browser: BrowserBinding): Promise<FinvizResult[]> {
  return scrapeScreener(browser, {
    performance: 'new_low',
    volume: 'over500k',
  });
}

/**
 * Scrape today's top gainers from Finviz
 */
export async function scrapeTopGainers(browser: BrowserBinding): Promise<FinvizResult[]> {
  return scrapeScreener(browser, {
    change: 'up5',
    volume: 'over1m',
  });
}

/**
 * Scrape stocks with golden cross (EMA50 above EMA200)
 */
export async function scrapeGoldenCross(browser: BrowserBinding): Promise<FinvizResult[]> {
  return scrapeScreener(browser, {
    ema: 'cross50above',
    volume: 'over500k',
  });
}

/**
 * Format Finviz results for Telegram
 */
export function formatFinvizAlert(
  title: string,
  results: FinvizResult[]
): string {
  const lines = [
    `📊 <b>${title}</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
  ];

  for (const r of results.slice(0, 15)) {
    const emoji = r.change >= 0 ? '🟢' : '🔴';
    lines.push(
      `${emoji} <b>${r.ticker}</b> $${r.price.toFixed(2)} (${r.change >= 0 ? '+' : ''}${r.change.toFixed(1)}%) — ${r.sector}`
    );
  }

  lines.push(``, `🔗 <a href="https://finviz.com/screener.ashx">Open Finviz</a>`);
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// GAP-028: Fetch-based FinViz Screener (no Browser binding required)
// Uses HTML fetch + regex parsing instead of Playwright
// ═══════════════════════════════════════════════════════════════

/**
 * Fetch screener results via HTTP — no BROWSER binding needed.
 * Parses the overview table HTML with regex patterns.
 * Note: FinViz may block automated access; this is best-effort.
 */
export async function fetchScreenerResults(filters: ScreenerFilter): Promise<FinvizResult[]> {
  const url = buildScreenerUrl(filters);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!res.ok) {
      console.error(`[Finviz] Fetch failed: ${res.status}`);
      return [];
    }

    const html = await res.text();
    return parseFinvizHTML(html);
  } catch (err) {
    console.error('[Finviz] Fetch screener error:', err);
    return [];
  }
}

/**
 * Parse FinViz overview table from HTML using regex.
 * Extracts ticker, company, sector, price, change, volume from screener table.
 */
function parseFinvizHTML(html: string): FinvizResult[] {
  const results: FinvizResult[] = [];

  // Match table rows in the screener results
  // FinViz overview table: No. | Ticker | Company | Sector | Industry | Country | Market Cap | P/E | Price | Change | Volume
  const rowPattern = /<tr[^>]*class="screener-body-table-nw"[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;

  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(html)) !== null && results.length < 50) {
    const rowHtml = rowMatch[1];
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;

    const cellRe = new RegExp(cellPattern.source, cellPattern.flags);
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      // Strip HTML tags
      const text = cellMatch[1].replace(/<[^>]+>/g, '').trim();
      cells.push(text);
    }

    if (cells.length >= 10) {
      const changeStr = cells[9]?.replace('%', '') || '0';
      const volumeStr = cells[10]?.replace(/,/g, '') || '0';

      results.push({
        ticker: cells[1] || '',
        company: cells[2] || '',
        sector: cells[3] || '',
        industry: cells[4] || '',
        country: cells[5] || '',
        marketCap: cells[6] || '',
        pe: cells[7] || '',
        price: parseFloat(cells[8] || '0') || 0,
        change: parseFloat(changeStr) || 0,
        volume: parseInt(volumeStr, 10) || 0,
      });
    }
  }

  return results;
}

/**
 * Fetch-based versions of common screener presets.
 * These work without the BROWSER binding.
 */
export async function fetchOversoldStocks(): Promise<FinvizResult[]> {
  return fetchScreenerResults({ rsi: 'oversold', volume: 'over500k', marketCap: 'large' });
}

export async function fetch52WeekHighs(): Promise<FinvizResult[]> {
  return fetchScreenerResults({ performance: 'new_high', volume: 'over500k' });
}

export async function fetchTopGainers(): Promise<FinvizResult[]> {
  return fetchScreenerResults({ change: 'up5', volume: 'over1m' });
}
