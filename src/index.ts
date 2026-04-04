// ─── YMSA Financial Automation — Main Entry Point ─────────────
// Cloudflare Worker: 6-engine trading system → Execution → Telegram
// v3.0: Signal generation + execution via Alpaca

import type { Env } from './types';
import { handleCronEvent } from './cron-handler';
import { renderDashboard, getSystemStatus } from './dashboard';
import { isAuthenticated } from './auth';
import { ensureEnv } from './utils/env-validator';
import { log } from './utils/logger';
import { jsonResponse } from './routes/helpers';
import { handlePublicRoutes } from './routes/public';
import { handleMarketDataRoutes } from './routes/market-data';
import { handleTradingRoutes } from './routes/trading';
import { handleAnalyticsRoutes } from './routes/analytics';
import { handleTelegramRoutes } from './routes/telegram';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Env validation (logged once per isolate)
    ensureEnv(env);

    // CORS headers
    const origin = request.headers.get('Origin') || '';
    const corsHeaders: Record<string, string> = {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
      'Access-Control-Allow-Credentials': 'true',
    };
    // Allow same-origin + localhost for dev
    const allowedOrigins = [url.origin, 'http://localhost:8787'];
    corsHeaders['Access-Control-Allow-Origin'] = allowedOrigins.includes(origin) ? origin : url.origin;

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      // ─── Public routes (no auth) ───────────────────
      const publicResponse = await handlePublicRoutes(path, url, request, env, corsHeaders);
      if (publicResponse) return publicResponse;

      // ─── Auth Check — everything below requires auth ─────
      const auth = await isAuthenticated(request, env);
      if (!auth.ok) {
        if (path === '/dashboard') {
          const html = renderDashboard(url.origin, false);
          return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...corsHeaders },
          });
        }
        return jsonResponse({ error: 'Unauthorized — sign in at /dashboard or provide X-API-Key' }, 401, corsHeaders);
      }
      log.info('auth', `Authenticated: ${auth.email}`, { path });

      // ─── SRE Dashboard (authed) ─────────────────────
      if (path === '/dashboard') {
        const html = renderDashboard(url.origin, true);
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...corsHeaders },
        });
      }

      // ─── System Status (authed) ─────────────────────
      if (path === '/api/system-status') {
        const status = getSystemStatus(env);
        return jsonResponse(status, 200, corsHeaders);
      }

      // ─── Route Dispatch ────────────────────────────
      const response = await handleMarketDataRoutes(path, url, request, env, corsHeaders)
        ?? await handleTradingRoutes(path, url, request, env, corsHeaders)
        ?? await handleAnalyticsRoutes(path, url, request, env, corsHeaders)
        ?? await handleTelegramRoutes(path, url, request, env, corsHeaders);
      if (response) return response;

      // ─── 404 ───────────────────────────────────────
      return jsonResponse({
        error: 'Not found',
        endpoints: [
          'GET /health',
          'GET /dashboard',
          'GET /api/system-status',
          'GET /api/quote?symbol=AAPL',
          'GET /api/analysis?symbol=AAPL',
          'GET /api/fibonacci?symbol=AAPL',
          'GET /api/scan',
          'GET /api/crypto',
          'GET /api/polymarket',
          'GET /api/commodities',
          'GET /api/indices',
          'GET /api/portfolio',
          'GET /api/performance',
          'GET /api/account',
          'GET /api/positions',
          'GET /api/trades?status=open&limit=20',
          'GET /api/d1-positions',
          'GET /api/signals?limit=50',
          'GET /api/regime',
          'GET /api/risk-events',
          'GET /api/daily-pnl?days=14',
          'GET /api/engine-stats',
          'GET /api/news?category=&limit=30&fresh=true',
          'GET /api/test-alert',
          'GET /api/telegram-alerts?limit=50',
          'GET /api/telegram-alert?id=',
          'GET /api/telegram-alert-stats',
          'POST /api/telegram-alert-outcome',
          'GET /api/pnl-dashboard',
          'GET /api/dashboard-data',
          'GET /api/trigger?job=morning|open|opening_range|quick|pulse|hourly|midday|evening|overnight|weekly|retrain|monthly',
          'GET /api/simulate',
        ],
      }, 404);
    } catch (err) {
      console.error('[YMSA] Request error:', err);
      return jsonResponse({ error: 'Internal server error' }, 500);
    }
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(handleCronEvent(controller.cron, env));
  },
};
