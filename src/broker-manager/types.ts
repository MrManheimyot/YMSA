// ─── Broker Manager Types ─────────────────────────────────────

export interface EngineOutput {
  engine: string;
  symbol: string;
  direction: 'BUY' | 'SELL' | 'HOLD' | 'NEUTRAL';
  confidence: number;       // 0–100
  entry?: number;
  stopLoss?: number;
  tp1?: number;
  tp2?: number;
  reason: string;           // 1-2 sentence explanation
  signals: string[];        // supporting bullet points
  meta?: Record<string, unknown>;
}

export interface MessagePlan {
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  text: string;
  silent: boolean;          // disable_notification
}

export interface MergedTrade {
  symbol: string;
  direction: 'BUY' | 'SELL';
  confidence: number;
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  engines: string[];
  reasons: string[];
  signals: string[];
  conflicting: boolean;
}
