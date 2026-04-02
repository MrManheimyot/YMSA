// ─── Alpaca Trading API Client ───────────────────────────────
// Paper and live trading via Alpaca Markets REST API
// Supports: orders, positions, account, bracket orders, bars

import type { Env } from '../types';

// ─── Constants ───────────────────────────────────────────────

const PAPER_URL = 'https://paper-api.alpaca.markets';
const LIVE_URL = 'https://api.alpaca.markets';
const DATA_URL = 'https://data.alpaca.markets';

// ─── Types ───────────────────────────────────────────────────

export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  equity: string;
  cash: string;
  buying_power: string;
  portfolio_value: string;
  last_equity: string;
  pattern_day_trader: boolean;
  trading_blocked: boolean;
  account_blocked: boolean;
}

export interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  qty: string;
  avg_entry_price: string;
  current_price: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  market_value: string;
  side: string;
}

export interface AlpacaOrder {
  id: string;
  symbol: string;
  qty: string;
  side: string;
  type: string;
  time_in_force: string;
  limit_price: string | null;
  stop_price: string | null;
  status: string;
  filled_at: string | null;
  filled_avg_price: string | null;
  created_at: string;
}

export interface OrderParams {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit' | 'trailing_stop';
  time_in_force: 'day' | 'gtc' | 'ioc';
  limit_price?: number;
  stop_price?: number;
  trail_percent?: number;
}

export interface BracketOrderParams {
  symbol: string;
  qty: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  time_in_force: 'day' | 'gtc';
  limit_price?: number;
  take_profit: { limit_price: number };
  stop_loss: { stop_price: number; limit_price?: number };
}

// ─── Helper Functions ────────────────────────────────────────

function getBaseUrl(env: Env): string {
  return env.ALPACA_PAPER_MODE === 'false' ? LIVE_URL : PAPER_URL;
}

async function alpacaFetch(
  path: string,
  env: Env,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${getBaseUrl(env)}/v2${path}`;
  return fetch(url, {
    ...options,
    headers: {
      'APCA-API-KEY-ID': env.ALPACA_API_KEY || '',
      'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY || '',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

async function alpacaDataFetch(
  path: string,
  env: Env
): Promise<Response> {
  return fetch(`${DATA_URL}/v2${path}`, {
    headers: {
      'APCA-API-KEY-ID': env.ALPACA_API_KEY || '',
      'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY || '',
    },
  });
}

// ─── Account ─────────────────────────────────────────────────

export async function getAccount(env: Env): Promise<AlpacaAccount | null> {
  try {
    const res = await alpacaFetch('/account', env);
    if (!res.ok) { console.error(`[Alpaca] Account error: ${res.status}`); return null; }
    return await res.json() as AlpacaAccount;
  } catch (err) { console.error('[Alpaca] Account error:', err); return null; }
}

// ─── Positions ───────────────────────────────────────────────

export async function getPositions(env: Env): Promise<AlpacaPosition[]> {
  try {
    const res = await alpacaFetch('/positions', env);
    if (!res.ok) return [];
    return await res.json() as AlpacaPosition[];
  } catch { return []; }
}

export async function getPosition(symbol: string, env: Env): Promise<AlpacaPosition | null> {
  try {
    const res = await alpacaFetch(`/positions/${encodeURIComponent(symbol)}`, env);
    if (!res.ok) return null;
    return await res.json() as AlpacaPosition;
  } catch { return null; }
}

export async function closePosition(symbol: string, env: Env): Promise<boolean> {
  try {
    const res = await alpacaFetch(`/positions/${encodeURIComponent(symbol)}`, env, { method: 'DELETE' });
    return res.ok;
  } catch { return false; }
}

export async function closeAllPositions(env: Env): Promise<boolean> {
  try {
    const res = await alpacaFetch('/positions', env, { method: 'DELETE' });
    return res.ok;
  } catch { return false; }
}

// ─── Orders ──────────────────────────────────────────────────

export async function submitOrder(params: OrderParams, env: Env): Promise<AlpacaOrder | null> {
  try {
    const body: Record<string, unknown> = {
      symbol: params.symbol,
      qty: params.qty.toString(),
      side: params.side,
      type: params.type,
      time_in_force: params.time_in_force,
    };
    if (params.limit_price !== undefined) body.limit_price = params.limit_price.toString();
    if (params.stop_price !== undefined) body.stop_price = params.stop_price.toString();
    if (params.trail_percent !== undefined) body.trail_percent = params.trail_percent.toString();

    const res = await alpacaFetch('/orders', env, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Alpaca] Order error ${res.status}: ${errText}`);
      return null;
    }
    return await res.json() as AlpacaOrder;
  } catch (err) { console.error('[Alpaca] Order error:', err); return null; }
}

export async function submitBracketOrder(params: BracketOrderParams, env: Env): Promise<AlpacaOrder | null> {
  try {
    const body: Record<string, unknown> = {
      symbol: params.symbol,
      qty: params.qty.toString(),
      side: params.side,
      type: params.type,
      time_in_force: params.time_in_force,
      order_class: 'bracket',
      take_profit: { limit_price: params.take_profit.limit_price.toString() },
      stop_loss: {
        stop_price: params.stop_loss.stop_price.toString(),
        ...(params.stop_loss.limit_price ? { limit_price: params.stop_loss.limit_price.toString() } : {}),
      },
    };
    if (params.limit_price !== undefined) body.limit_price = params.limit_price.toString();

    const res = await alpacaFetch('/orders', env, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Alpaca] Bracket order error ${res.status}: ${errText}`);
      return null;
    }
    return await res.json() as AlpacaOrder;
  } catch (err) { console.error('[Alpaca] Bracket order error:', err); return null; }
}

export async function cancelOrder(orderId: string, env: Env): Promise<boolean> {
  try {
    const res = await alpacaFetch(`/orders/${encodeURIComponent(orderId)}`, env, { method: 'DELETE' });
    return res.ok;
  } catch { return false; }
}

export async function cancelAllOrders(env: Env): Promise<boolean> {
  try {
    const res = await alpacaFetch('/orders', env, { method: 'DELETE' });
    return res.ok;
  } catch { return false; }
}

export async function getOrders(status: string, env: Env): Promise<AlpacaOrder[]> {
  try {
    const res = await alpacaFetch(`/orders?status=${encodeURIComponent(status)}`, env);
    if (!res.ok) return [];
    return await res.json() as AlpacaOrder[];
  } catch { return []; }
}

// ─── Market Data ─────────────────────────────────────────────

export async function getBars(
  symbol: string,
  timeframe: string,
  start: string,
  end: string,
  env: Env
): Promise<Array<{ t: string; o: number; h: number; l: number; c: number; v: number }>> {
  try {
    const params = new URLSearchParams({ timeframe, start, end, limit: '1000' });
    const res = await alpacaDataFetch(`/stocks/${encodeURIComponent(symbol)}/bars?${params}`, env);
    if (!res.ok) return [];
    const data = await res.json() as { bars: Array<{ t: string; o: number; h: number; l: number; c: number; v: number }> };
    return data.bars || [];
  } catch { return []; }
}

// ─── Formatting ──────────────────────────────────────────────

export function formatAccountSummary(account: AlpacaAccount): string {
  const equity = parseFloat(account.equity);
  const cash = parseFloat(account.cash);
  const bp = parseFloat(account.buying_power);
  return [
    `💼 <b>Alpaca Account</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
    `💰 Equity: $${equity.toLocaleString()}`,
    `💵 Cash: $${cash.toLocaleString()}`,
    `🔥 Buying Power: $${bp.toLocaleString()}`,
    `📊 Status: ${account.status}`,
    `${account.trading_blocked ? '🚫 Trading BLOCKED' : '✅ Trading Active'}`,
    `${account.pattern_day_trader ? '⚠️ PDT Flag' : ''}`,
  ].filter(Boolean).join('\n');
}

export function formatOrderConfirmation(order: AlpacaOrder): string {
  const emoji = order.side === 'buy' ? '🟢' : '🔴';
  return [
    `${emoji} <b>Order ${order.status.toUpperCase()}</b>`,
    `${order.side.toUpperCase()} ${order.qty} × ${order.symbol}`,
    `Type: ${order.type} | TIF: ${order.time_in_force}`,
    order.limit_price ? `Limit: $${order.limit_price}` : '',
    order.stop_price ? `Stop: $${order.stop_price}` : '',
    order.filled_avg_price ? `Filled: $${order.filled_avg_price}` : '',
    `ID: ${order.id.slice(0, 8)}...`,
  ].filter(Boolean).join('\n');
}
