// ─── Analytics, Backtest & System Routes ─────────────────────

import type { Env } from '../types';
import { getRecentRiskEvents, getRecentDailyPnl, getAllLatestEnginePerformance, getRecentNewsAlerts, getNewsAlertsByCategory, getRecentRSSItems, getLatestTVSnapshot, getRecentSentimentAll, getFeedHealthReport, getCandidateStats } from '../db/queries';
import { fetchGoogleAlerts, storeNewsAlerts, getFeedConfig } from '../api/google-alerts';
import { jsonResponse } from './helpers';

export async function handleAnalyticsRoutes(
  path: string, url: URL, request: Request, env: Env, corsHeaders: Record<string, string>
): Promise<Response | null> {
  // ─── Backtest (P1) ─────────────────────────────
  if (path === '/api/backtest' && request.method === 'POST') {
    const { runBacktest, formatBacktestReport } = await import('../backtesting/engine');
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const result = await runBacktest(env, body as any);
    return jsonResponse({
      report: formatBacktestReport(result),
      metrics: result.metrics,
      byEngine: result.byEngine,
      tradeCount: result.trades.length,
      equityCurve: result.equityCurve,
    }, 200, corsHeaders);
  }

  // ─── Z.AI Health (P6) ─────────────────────────
  if (path === '/api/ai-health') {
    const { getZAiHealthStats } = await import('../ai/z-engine');
    const stats = getZAiHealthStats();
    return jsonResponse(stats, 200, corsHeaders);
  }

  // ─── Risk Events ──────────────────────────────
  if (path === '/api/risk-events') {
    const events = await getRecentRiskEvents(env.DB!, 20);
    return jsonResponse({ events, count: events.length });
  }

  // ─── Daily P&L History ─────────────────────────
  if (path === '/api/daily-pnl') {
    const days = parseInt(url.searchParams.get('days') || '14', 10);
    const pnl = await getRecentDailyPnl(env.DB!, days);
    return jsonResponse({ pnl, count: pnl.length });
  }

  // ─── Engine Performance Stats ──────────────────
  if (path === '/api/engine-stats') {
    const latest = await getAllLatestEnginePerformance(env.DB!);
    // Merge live signal counts + real-time win rates from trades table
    try {
      const todayStart = new Date(new Date().toISOString().split('T')[0]).getTime();
      const [sigRows, tradeRows] = await Promise.all([
        env.DB!.prepare(
          `SELECT engine_id, COUNT(*) as cnt FROM signals WHERE created_at >= ? GROUP BY engine_id`
        ).bind(todayStart).all(),
        env.DB!.prepare(
          `SELECT engine_id, COUNT(*) as total, SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins, SUM(COALESCE(pnl, 0)) as total_pnl FROM trades WHERE status = 'CLOSED' GROUP BY engine_id`
        ).all(),
      ]);
      const liveCounts: Record<string, number> = {};
      for (const r of (sigRows.results || []) as any[]) {
        liveCounts[r.engine_id] = r.cnt;
      }
      const liveTradeStats: Record<string, { wins: number; total: number; pnl: number }> = {};
      for (const r of (tradeRows.results || []) as any[]) {
        liveTradeStats[r.engine_id] = { wins: r.wins || 0, total: r.total || 0, pnl: r.total_pnl || 0 };
      }
      for (const eng of latest) {
        if (liveCounts[eng.engine_id] && liveCounts[eng.engine_id] > eng.signals_generated) {
          eng.signals_generated = liveCounts[eng.engine_id];
          eng.date = new Date().toISOString().split('T')[0];
        }
        // Override with real-time win rate and P&L from closed trades
        const ts = liveTradeStats[eng.engine_id];
        if (ts && ts.total > 0) {
          eng.win_rate = ts.wins / ts.total;
          eng.pnl = ts.pnl;
          eng.trades_executed = ts.total;
        }
      }
    } catch {}
    return jsonResponse({ engines: latest, count: latest.length });
  }

  // ─── Google Alerts News ────────────────────────
  if (path === '/api/news') {
    const category = url.searchParams.get('category');
    const limit = parseInt(url.searchParams.get('limit') || '30', 10);
    const fresh = url.searchParams.get('fresh') === 'true';

    // Optionally fetch live from RSS feeds
    if (fresh) {
      try {
        const liveNews = await fetchGoogleAlerts();
        if (liveNews.length > 0 && env.DB) {
          await storeNewsAlerts(liveNews, env.DB);
        }
      } catch {}
    }

    // Return from D1 (cached)
    if (env.DB) {
      const alerts = category
        ? await getNewsAlertsByCategory(env.DB, category, limit)
        : await getRecentNewsAlerts(env.DB, limit);
      return jsonResponse({ alerts, count: alerts.length, feeds: getFeedConfig().map(f => ({ id: f.id, name: f.name, engines: f.engines })) });
    }

    // No D1 — fetch live
    const liveNews = await fetchGoogleAlerts();
    return jsonResponse({ alerts: liveNews.slice(0, limit), count: liveNews.length, live: true });
  }

  // ─── Superpower: RSS Feed ─────────────────────
  if (path === '/api/rss-feed') {
    if (!env.DB) return jsonResponse({ items: [], count: 0 });
    const hours = parseInt(url.searchParams.get('hours') || '24', 10);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const items = await getRecentRSSItems(env.DB, hours, limit);
    return jsonResponse({ items, count: items.length });
  }

  // ─── Superpower: Social Sentiment ─────────────
  if (path === '/api/social-sentiment') {
    if (!env.DB) return jsonResponse({ sentiment: [], count: 0 });
    const limit = parseInt(url.searchParams.get('limit') || '30', 10);
    const sentiment = await getRecentSentimentAll(env.DB, limit);
    return jsonResponse({ sentiment, count: sentiment.length });
  }

  // ─── Superpower: TradingView Scanner ──────────
  if (path === '/api/tv-snapshots') {
    if (!env.DB) return jsonResponse({ scanTypes: {} });
    const types = ['top_gainers', 'top_losers', 'most_volatile', 'oversold', 'high_volume'];
    const results: Record<string, unknown[]> = {};
    await Promise.all(types.map(async (t) => {
      results[t] = await getLatestTVSnapshot(env.DB!, t, 10);
    }));
    return jsonResponse({ scanTypes: results });
  }

  // ─── Superpower: Feed Health ──────────────────
  if (path === '/api/feed-health') {
    if (!env.DB) return jsonResponse({ feeds: [], count: 0 });
    const feeds = await getFeedHealthReport(env.DB);
    return jsonResponse({ feeds, count: feeds.length });
  }

  // ─── v3.6: Universe Discovery / Candidate Pipeline ──
  if (path === '/api/candidates') {
    if (!env.DB) return jsonResponse({ total: 0, promoted: 0, evaluated: 0, bySources: {}, topScorers: [] });
    const stats = await getCandidateStats(env.DB);
    return jsonResponse(stats);
  }

  return null;
}
