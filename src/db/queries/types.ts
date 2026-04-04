// ─── D1 Database Record Types ────────────────────────────────

export interface TradeRecord {
  id: string;
  engine_id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  entry_price: number;
  exit_price: number | null;
  stop_loss: number;
  take_profit: number;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
  pnl: number | null;
  pnl_pct: number | null;
  opened_at: number;
  closed_at: number | null;
  broker_order_id: string | null;
  trailing_state: string | null;
}

export interface PositionRecord {
  id: string;
  symbol: string;
  engine_id: string;
  side: 'LONG' | 'SHORT';
  qty: number;
  avg_entry: number;
  current_price: number;
  unrealized_pnl: number;
  stop_loss: number;
  take_profit: number;
  opened_at: number;
}

export interface SignalRecord {
  id: string;
  engine_id: string;
  signal_type: string;
  symbol: string;
  direction: 'BUY' | 'SELL' | 'HOLD';
  strength: number;
  metadata: string;
  created_at: number;
  acted_on: number;
}

export interface DailyPnlRecord {
  date: string;
  total_equity: number;
  daily_pnl: number;
  daily_pnl_pct: number;
  open_positions: number;
  trades_today: number;
  win_rate: number;
  sharpe_snapshot: number | null;
  max_drawdown: number | null;
}

export interface EnginePerformanceRecord {
  id: string;
  engine_id: string;
  date: string;
  signals_generated: number;
  trades_executed: number;
  win_rate: number;
  pnl: number;
  avg_rr: number | null;
  weight: number;
}

export interface KillSwitchState {
  tier: 'NONE' | 'REDUCE' | 'CLOSE_ALL' | 'HALT';
  activated_at: number | null;
  daily_pnl_pct: number | null;
  reason: string | null;
  updated_at: number;
}

export interface TelegramAlertRecord {
  id: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  engine_id: string;
  entry_price: number;
  stop_loss: number | null;
  take_profit_1: number | null;
  take_profit_2: number | null;
  confidence: number;
  alert_text: string;
  outcome: 'PENDING' | 'WIN' | 'LOSS' | 'BREAKEVEN' | 'EXPIRED';
  outcome_price: number | null;
  outcome_pnl: number | null;
  outcome_pnl_pct: number | null;
  outcome_notes: string | null;
  outcome_at: number | null;
  regime: string | null;
  metadata: string | null;
  sent_at: number;
}

// ─── Utility ─────────────────────────────────────────────────

export function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
