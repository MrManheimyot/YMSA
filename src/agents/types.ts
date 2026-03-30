// ─── Multi-Agent Types ────────────────────────────────────────
// Type definitions for the 5-agent trading system

import type { Signal } from '../types';

// ─── Agent Identity ──────────────────────────────────────────

export type AgentId =
  | 'STOCKS_TECHNICAL'   // Agent 1: Technical analysis (YMSA Phase 1 ✅)
  | 'STOCKS_STAT_ARB'    // Agent 2: Statistical arbitrage / pairs trading
  | 'CRYPTO'             // Agent 3: Crypto + on-chain analysis
  | 'POLYMARKET'         // Agent 4: Prediction / event markets
  | 'COMMODITIES';       // Agent 5: Commodities + macro

/**
 * v3: Engine identifiers for the 6-engine system
 */
export type EngineId =
  | 'MTF_MOMENTUM'      // Engine 1: Multi-Timeframe Momentum & Mean Reversion
  | 'SMART_MONEY'       // Engine 2: Smart Money + Institutional Flow
  | 'STAT_ARB'          // Engine 3: Statistical Arbitrage + Pairs
  | 'OPTIONS'           // Engine 4: Options Income (Premium Selling)
  | 'CRYPTO_DEFI'       // Engine 5: Crypto Swing + DeFi Yield
  | 'EVENT_DRIVEN';     // Engine 6: Event-Driven + Prediction Markets

/**
 * v3: Market regime for strategy adaptation
 */
export type RegimeType = 'TRENDING_UP' | 'TRENDING_DOWN' | 'RANGING' | 'VOLATILE';

export type Arena = 'stocks' | 'crypto' | 'prediction_markets' | 'commodities';

// ─── Agent Signal (Output of each agent) ─────────────────────

export interface AgentSignal {
  agentId: AgentId;
  arena: Arena;
  signals: Signal[];
  confidence: number;          // 0-100: agent self-assessed confidence
  timestamp: number;
  metadata: Record<string, unknown>;
}

// ─── Orchestrator Types ──────────────────────────────────────

export interface OrchestratorDecision {
  id: string;
  timestamp: number;
  agentSignals: AgentSignal[];     // Raw signals from all agents
  approvedOrders: ProposedOrder[]; // Orders passing risk check
  rejectedOrders: RejectedOrder[]; // Orders failing risk check
  portfolioState: PortfolioState;
}

export interface ProposedOrder {
  id: string;
  agentId: AgentId;
  arena: Arena;
  symbol: string;
  action: 'BUY' | 'SELL' | 'SHORT' | 'COVER';
  orderType: 'MARKET' | 'LIMIT' | 'STOP' | 'TRAILING_STOP';
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  confidence: number;
  reasoning: string;
  timestamp: number;
}

export interface RejectedOrder extends ProposedOrder {
  rejectionReason: string;
  ruleViolated: RiskRule;
}

// ─── Risk Controller Types ───────────────────────────────────

export type RiskRule =
  | 'MAX_DAILY_DRAWDOWN'
  | 'MAX_POSITION_SIZE'
  | 'MAX_SECTOR_EXPOSURE'
  | 'MAX_TOTAL_EXPOSURE'
  | 'MIN_LIQUIDITY_RATIO'
  | 'KILL_SWITCH'
  | 'CORRELATION_LIMIT'
  | 'MAX_OPEN_POSITIONS'
  | 'DAILY_LOSS_LIMIT';

export interface RiskLimits {
  maxDailyDrawdownPct: number;      // 3% default
  maxPositionSizePct: number;       // 10% default
  maxSectorExposurePct: number;     // 25% default
  maxTotalExposurePct: number;      // 80% default (20% always cash)
  minLiquidityRatio: number;        // position < 1% daily volume
  killSwitchDrawdownPct: number;    // 5% → halt all trading 24h
  maxCorrelation: number;           // 0.85 — no two positions r > 0.85
  maxOpenPositions: number;         // 20 default
  dailyLossLimitUSD: number;        // Absolute $ loss limit per day
}

export interface RiskCheckResult {
  approved: boolean;
  order: ProposedOrder;
  violations: RiskViolation[];
}

export interface RiskViolation {
  rule: RiskRule;
  message: string;
  currentValue: number;
  limit: number;
}

// ─── Portfolio State ─────────────────────────────────────────

export interface PortfolioState {
  totalEquity: number;
  cashBalance: number;
  positions: Position[];
  dailyPnL: number;
  dailyPnLPct: number;
  totalExposurePct: number;
  sectorExposure: Record<string, number>;
  killSwitchActive: boolean;
  lastUpdated: number;
}

export interface Position {
  symbol: string;
  arena: Arena;
  agentId: AgentId;
  side: 'LONG' | 'SHORT';
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPct: number;
  sector?: string;
  openedAt: number;
}

// ─── Feedback / PnL ──────────────────────────────────────────

export interface TradeResult {
  orderId: string;
  agentId: AgentId;
  arena: Arena;
  symbol: string;
  action: 'BUY' | 'SELL' | 'SHORT' | 'COVER';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  realizedPnL: number;
  realizedPnLPct: number;
  holdingPeriodHours: number;
  timestamp: number;
}

export interface AgentPerformance {
  agentId: AgentId;
  totalTrades: number;
  winRate: number;           // 0-1
  avgPnLPct: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
  profitFactor: number;      // gross profit / gross loss
  currentWeight: number;     // 0-1, used by orchestrator
  lastCalibrated: number;
}

// ─── Crypto-Specific ─────────────────────────────────────────

export interface CryptoMetrics {
  symbol: string;
  price: number;
  volume24h: number;
  marketCap: number;
  circulatingSupply: number;
  priceChange24h: number;
  priceChange7d: number;
  // On-chain (Glassnode)
  activeAddresses?: number;
  exchangeInflow?: number;
  exchangeOutflow?: number;
  whaleTransactions?: number;
  nvtRatio?: number;
}

// ─── Polymarket-Specific ─────────────────────────────────────

export interface PredictionMarket {
  id: string;
  question: string;
  category: string;
  endDate: string;
  outcomes: PredictionOutcome[];
  volume: number;
  liquidity: number;
  createdAt: string;
}

export interface PredictionOutcome {
  name: string;
  price: number;          // 0-1 (probability)
  volume: number;
}

// ─── Commodities-Specific ────────────────────────────────────

export interface CommodityData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  unit: string;            // 'barrel', 'ounce', 'bushel', etc.
  source: string;
}

export interface MacroIndicator {
  id: string;
  name: string;
  value: number;
  previousValue: number;
  change: number;
  unit: string;
  date: string;
  source: 'FRED' | 'EIA' | 'BLS';
}

// ─── Pairs / Stat-Arb ───────────────────────────────────────

export interface PairCorrelation {
  symbolA: string;
  symbolB: string;
  correlation: number;        // -1 to 1
  cointegrationPValue: number; // < 0.05 = cointegrated
  halfLife: number;           // mean-reversion half-life in days
  currentZScore: number;      // current spread z-score
  spreadMean: number;
  spreadStd: number;
  lookbackDays: number;
}
