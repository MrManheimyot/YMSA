// ─── Public Routes (no auth required) ────────────────────────

import type { Env } from '../types';
import { handleGoogleAuth, handleLogout, handleAuthMe } from '../auth';
import { jsonResponse, addHeaders } from './helpers';
import { getRecentErrors } from '../utils/logger';
import { getZAiHealthStats } from '../ai/z-engine';

export async function handlePublicRoutes(
  path: string, _url: URL, request: Request, env: Env, corsHeaders: Record<string, string>
): Promise<Response | null> {
  // ─── Health Check ──────────────────────────────
  if (path === '/' || path === '/health') {
    const errors = getRecentErrors();
    const aiHealth = getZAiHealthStats();
    return jsonResponse({
      status: errors.length > 10 ? 'degraded' : 'ok',
      service: 'YMSA Multi-Engine Trading System',
      version: '3.3.0',
      engines: ['MTF_MOMENTUM', 'SMART_MONEY', 'STAT_ARB', 'OPTIONS', 'CRYPTO_DEFI', 'EVENT_DRIVEN'],
      mode: !(env as any).ALPACA_API_KEY ? 'SIGNALS ONLY' : env.ALPACA_PAPER_MODE === 'false' ? 'LIVE TRADING' : 'PAPER TRADING',
      timestamp: new Date().toISOString(),
      watchlist: env.DEFAULT_WATCHLIST.split(','),
      cryptoWatchlist: (env.CRYPTO_WATCHLIST || '').split(','),
      ai: !!(env as any).AI ? 'Z.AI enabled' : 'Z.AI unavailable',
      aiHealth,
      recentErrors: errors.length,
      lastError: errors.length > 0 ? errors[errors.length - 1] : null,
    }, 200, corsHeaders);
  }

  // ─── Auth Routes ───────────────────────────────
  if (path === '/auth/google' && request.method === 'POST') {
    const res = await handleGoogleAuth(request, env);
    return addHeaders(res, corsHeaders);
  }
  if (path === '/auth/logout' && request.method === 'POST') {
    return addHeaders(handleLogout(), corsHeaders);
  }
  if (path === '/auth/me') {
    const res = await handleAuthMe(request, env);
    return addHeaders(res, corsHeaders);
  }

  return null;
}
