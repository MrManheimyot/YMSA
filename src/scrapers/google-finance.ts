// ─── Google Finance Scraper ───────────────────────────────────
// Uses Cloudflare Browser Rendering (@cloudflare/playwright)
// Scrapes Google Finance for market overview — FREE

interface BrowserBinding {
  launch(): Promise<any>;
}

export interface MarketOverview {
  indices: MarketIndex[];
  trending: TrendingStock[];
  news: NewsItem[];
  timestamp: number;
}

export interface MarketIndex {
  name: string;
  value: number;
  change: number;
  changePct: number;
}

export interface TrendingStock {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
}

export interface NewsItem {
  title: string;
  source: string;
  url: string;
  timeAgo: string;
}

/**
 * Scrape Google Finance market overview
 */
export async function scrapeMarketOverview(
  browser: BrowserBinding
): Promise<MarketOverview> {
  let browserInstance: any;

  try {
    browserInstance = await browser.launch();
    const page = await browserInstance.newPage();

    await page.goto('https://www.google.com/finance/', {
      waitUntil: 'networkidle',
    });

    // Wait for market data to load
    await page.waitForSelector('[data-tab-id], .gyFHrc, .sbnBtf', { timeout: 10000 }).catch(() => {});

    const data = await page.evaluate(() => {
      const indices: any[] = [];
      const trending: any[] = [];
      const news: any[] = [];

      // Extract market indices (S&P 500, NASDAQ, DOW, etc.)
      const indexElements = document.querySelectorAll('.gyFHrc, [data-index]');
      indexElements.forEach((el: Element) => {
        const name = el.querySelector('.ZvmM7, .rPF6Lc')?.textContent?.trim() || '';
        const value = el.querySelector('.YMlKec, .xVyTdb')?.textContent?.trim() || '';
        const changeEl = el.querySelector('.JwB6zf, .P2Luy');
        const changeText = changeEl?.textContent?.trim() || '0';

        if (name && value) {
          const numValue = parseFloat(value.replace(/[,$]/g, ''));
          const numChange = parseFloat(changeText.replace(/[%+$,]/g, ''));
          indices.push({
            name,
            value: numValue || 0,
            change: numChange || 0,
            changePct: 0,
          });
        }
      });

      // Extract trending/most active stocks
      const stockElements = document.querySelectorAll('.sbnBtf [data-entity-type="3"], .SxcTic');
      stockElements.forEach((el: Element) => {
        const symbol = el.querySelector('.COaKTb, .ZvmM7')?.textContent?.trim() || '';
        const name = el.querySelector('.RfDO0c, .Q8lakc')?.textContent?.trim() || '';
        const price = el.querySelector('.YMlKec, .xVyTdb')?.textContent?.trim() || '';
        const changeEl = el.querySelector('.JwB6zf, .P2Luy');
        const changeText = changeEl?.textContent?.trim() || '0';

        if (symbol) {
          trending.push({
            symbol,
            name,
            price: parseFloat(price.replace(/[,$]/g, '')) || 0,
            change: parseFloat(changeText.replace(/[%+$,]/g, '')) || 0,
            changePct: 0,
          });
        }
      });

      // Extract top news
      const newsElements = document.querySelectorAll('.yY3Lee a, [data-news-id]');
      newsElements.forEach((el: Element) => {
        const anchor = el as HTMLAnchorElement;
        const title = anchor.querySelector('.Yfwt5, .mRjSYb')?.textContent?.trim() ||
          anchor.textContent?.trim() || '';
        const source = el.querySelector('.sfyJob, .AYBNIb')?.textContent?.trim() || '';
        const timeAgo = el.querySelector('.Adak, .eIGwhe')?.textContent?.trim() || '';

        if (title && title.length > 10) {
          news.push({
            title: title.slice(0, 120),
            source,
            url: anchor.href || '',
            timeAgo,
          });
        }
      });

      return { indices, trending, news };
    });

    await browserInstance.close();

    return {
      indices: data.indices.slice(0, 10),
      trending: data.trending.slice(0, 15),
      news: data.news.slice(0, 10),
      timestamp: Date.now(),
    };
  } catch (err) {
    console.error('[Google Finance] Scrape error:', err);
    if (browserInstance) await browserInstance.close().catch(() => {});
    return { indices: [], trending: [], news: [], timestamp: Date.now() };
  }
}

/**
 * Scrape a specific stock page on Google Finance
 */
export async function scrapeStockPage(
  browser: BrowserBinding,
  symbol: string
): Promise<{
  price: number;
  change: number;
  changePct: number;
  about: string;
  stats: Record<string, string>;
} | null> {
  let browserInstance: any;

  try {
    browserInstance = await browser.launch();
    const page = await browserInstance.newPage();

    await page.goto(`https://www.google.com/finance/quote/${symbol}:NASDAQ`, {
      waitUntil: 'networkidle',
    });

    // Try NYSE if NASDAQ fails (redirect detection)
    const currentUrl = page.url();
    if (currentUrl.includes('search') || currentUrl.includes('error')) {
      await page.goto(`https://www.google.com/finance/quote/${symbol}:NYSE`, {
        waitUntil: 'networkidle',
      });
    }

    await page.waitForSelector('.YMlKec, .fxKbKc', { timeout: 8000 }).catch(() => {});

    const data = await page.evaluate(() => {
      const price = parseFloat(
        (document.querySelector('.YMlKec.fxKbKc, [data-last-price]')?.textContent?.trim() || '0')
          .replace(/[,$]/g, '')
      );

      const changeEl = document.querySelector('.JwB6zf, .P2Luy');
      const change = parseFloat((changeEl?.textContent?.trim() || '0').replace(/[+$,]/g, ''));

      const about = document.querySelector('.bLLb2d, [data-about]')?.textContent?.trim() || '';

      const stats: Record<string, string> = {};
      document.querySelectorAll('.gyFHrc .mfs7Fc, [data-stat]').forEach((el: Element) => {
        const label = el.querySelector('.mfs7Fc div:first-child, .rPF6Lc')?.textContent?.trim() || '';
        const value = el.querySelector('.mfs7Fc div:last-child, .P6K39c')?.textContent?.trim() || '';
        if (label) stats[label] = value;
      });

      return { price, change, changePct: 0, about, stats };
    });

    await browserInstance.close();
    return data.price > 0 ? data : null;
  } catch (err) {
    console.error(`[Google Finance] Stock scrape error for ${symbol}:`, err);
    if (browserInstance) await browserInstance.close().catch(() => {});
    return null;
  }
}

/**
 * Format market overview for Telegram
 */
export function formatMarketOverview(overview: MarketOverview): string {
  const lines = [
    `🌍 <b>Market Overview</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
  ];

  if (overview.indices.length > 0) {
    lines.push(``, `📊 <b>Indices:</b>`);
    for (const idx of overview.indices) {
      const emoji = idx.change >= 0 ? '🟢' : '🔴';
      lines.push(`  ${emoji} ${idx.name}: ${idx.value.toLocaleString()} (${idx.change >= 0 ? '+' : ''}${idx.change})`);
    }
  }

  if (overview.trending.length > 0) {
    lines.push(``, `🔥 <b>Trending:</b>`);
    for (const stock of overview.trending.slice(0, 8)) {
      const emoji = stock.change >= 0 ? '📈' : '📉';
      lines.push(`  ${emoji} <b>${stock.symbol}</b> $${stock.price} (${stock.change >= 0 ? '+' : ''}${stock.change})`);
    }
  }

  if (overview.news.length > 0) {
    lines.push(``, `📰 <b>Top News:</b>`);
    for (const item of overview.news.slice(0, 5)) {
      lines.push(`  • ${item.title}`);
    }
  }

  return lines.join('\n');
}
