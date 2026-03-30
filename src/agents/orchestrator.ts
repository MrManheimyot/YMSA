// ─── Orchestrator ─────────────────────────────────────────────
// Aggregates signals from all 5 expert agents, weighs them by
// performance, allocates capital, and routes to risk controller.
// Runs as a Durable Object for persistent state.

import type {
  AgentId,
  AgentSignal,
  AgentPerformance,
  OrchestratorDecision,
  ProposedOrder,
  RejectedOrder,
  PortfolioState,
} from './types';
import { checkRisk, shouldActivateKillSwitch } from './risk-controller';

/**
 * Default agent weights (equal weight to start — calibrate from feedback loop)
 */
const DEFAULT_AGENT_WEIGHTS: Record<AgentId, number> = {
  STOCKS_TECHNICAL: 0.30,
  STOCKS_STAT_ARB: 0.20,
  CRYPTO: 0.15,
  POLYMARKET: 0.15,
  COMMODITIES: 0.20,
};

/**
 * Default capital allocation per arena (% of total equity)
 */
const DEFAULT_CAPITAL_ALLOCATION: Record<AgentId, number> = {
  STOCKS_TECHNICAL: 30,
  STOCKS_STAT_ARB: 20,
  CRYPTO: 15,
  POLYMARKET: 10,
  COMMODITIES: 25,
};

/**
 * Process signals from all agents and produce trading decisions
 */
export function orchestrate(
  agentSignals: AgentSignal[],
  portfolio: PortfolioState,
  agentPerformance: Record<AgentId, AgentPerformance> | null,
  capitalAllocation: Record<AgentId, number> = DEFAULT_CAPITAL_ALLOCATION
): OrchestratorDecision {
  const decisionId = `orch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Check kill switch first
  if (shouldActivateKillSwitch(portfolio)) {
    portfolio.killSwitchActive = true;
    return {
      id: decisionId,
      timestamp: Date.now(),
      agentSignals,
      approvedOrders: [],
      rejectedOrders: [],
      portfolioState: portfolio,
    };
  }

  // Calculate effective weights (default or performance-based)
  const weights = agentPerformance
    ? calibrateWeights(agentPerformance)
    : DEFAULT_AGENT_WEIGHTS;

  // Score and rank all signals
  const scoredSignals = agentSignals.map((as) => ({
    ...as,
    weightedScore: as.confidence * (weights[as.agentId] || 0),
  }));

  // Sort by weighted score (highest first)
  scoredSignals.sort((a, b) => b.weightedScore - a.weightedScore);

  // Generate proposed orders from signals
  const proposedOrders = generateOrders(scoredSignals, portfolio, capitalAllocation);

  // Run each order through risk controller
  const approvedOrders: ProposedOrder[] = [];
  const rejectedOrders: RejectedOrder[] = [];

  for (const order of proposedOrders) {
    const riskResult = checkRisk(order, portfolio);

    if (riskResult.approved) {
      approvedOrders.push(order);
    } else {
      rejectedOrders.push({
        ...order,
        rejectionReason: riskResult.violations.map((v) => v.message).join('; '),
        ruleViolated: riskResult.violations[0]?.rule || 'MAX_DAILY_DRAWDOWN',
      });
    }
  }

  return {
    id: decisionId,
    timestamp: Date.now(),
    agentSignals,
    approvedOrders,
    rejectedOrders,
    portfolioState: portfolio,
  };
}

/**
 * Calibrate agent weights based on historical performance
 * Better-performing agents get higher weight
 */
function calibrateWeights(
  performance: Record<AgentId, AgentPerformance>
): Record<AgentId, number> {
  const agents = Object.values(performance);

  // Use profit factor × win rate as the score
  const scores: Record<AgentId, number> = {} as Record<AgentId, number>;
  let totalScore = 0;

  for (const agent of agents) {
    // Minimum 10 trades before weighting changes
    if (agent.totalTrades < 10) {
      scores[agent.agentId] = DEFAULT_AGENT_WEIGHTS[agent.agentId];
    } else {
      const score = Math.max(0.1, agent.profitFactor * agent.winRate * (1 + agent.sharpeRatio));
      scores[agent.agentId] = score;
    }
    totalScore += scores[agent.agentId];
  }

  // Normalize to sum to 1.0
  const weights: Record<AgentId, number> = {} as Record<AgentId, number>;
  for (const agentId of Object.keys(scores) as AgentId[]) {
    weights[agentId] = scores[agentId] / totalScore;
  }

  return weights;
}

/**
 * Generate proposed orders from scored agent signals
 */
function generateOrders(
  scoredSignals: (AgentSignal & { weightedScore: number })[],
  portfolio: PortfolioState,
  capitalAllocation: Record<AgentId, number>
): ProposedOrder[] {
  const orders: ProposedOrder[] = [];
  const processedSymbols = new Set<string>();

  for (const agentSignal of scoredSignals) {
    // Skip low-confidence signals
    if (agentSignal.weightedScore < 20) continue;

    // Get capital available for this agent's arena
    const allocPct = capitalAllocation[agentSignal.agentId] || 10;
    const maxCapital = (portfolio.totalEquity * allocPct) / 100;

    for (const signal of agentSignal.signals) {
      // Skip if we already have an order for this symbol
      if (processedSymbols.has(signal.symbol)) continue;

      // Only CRITICAL and IMPORTANT signals generate orders
      if (signal.priority === 'INFO') continue;

      // Determine action from signal type
      const action = getActionFromSignal(signal.type);
      if (!action) continue;

      // Calculate position size (simple: use 5% of allocated capital per trade)
      const positionValue = maxCapital * 0.05;
      const price = signal.value || 100; // fallback
      const quantity = Math.floor(positionValue / price);

      if (quantity <= 0) continue;

      orders.push({
        id: `order_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        agentId: agentSignal.agentId,
        arena: agentSignal.arena,
        symbol: signal.symbol,
        action,
        orderType: 'LIMIT',
        quantity,
        limitPrice: price,
        confidence: agentSignal.weightedScore,
        reasoning: `${signal.title}: ${signal.description}`,
        timestamp: Date.now(),
      });

      processedSymbols.add(signal.symbol);
    }
  }

  return orders;
}

/**
 * Map signal types to buy/sell actions
 */
function getActionFromSignal(
  signalType: string
): 'BUY' | 'SELL' | null {
  const buySignals = [
    'RSI_OVERSOLD',
    'GOLDEN_CROSS',
    'MACD_BULLISH_CROSS',
    '52W_LOW_PROXIMITY',
    'FIBONACCI_LEVEL_HIT', // Assuming support bounce
  ];

  const sellSignals = [
    'RSI_OVERBOUGHT',
    'DEATH_CROSS',
    'MACD_BEARISH_CROSS',
    '52W_HIGH_PROXIMITY',
    '52W_BREAKOUT', // Take profits
  ];

  if (buySignals.includes(signalType)) return 'BUY';
  if (sellSignals.includes(signalType)) return 'SELL';
  return null;
}

/**
 * Format orchestrator decision for Telegram alert
 */
export function formatOrchestratorAlert(decision: OrchestratorDecision): string {
  const lines = [
    `🧠 <b>Orchestrator Decision</b>`,
    `━━━━━━━━━━━━━━━━━━━━━━`,
  ];

  if (decision.portfolioState.killSwitchActive) {
    lines.push(`🚨 <b>KILL SWITCH ACTIVE</b> — All trading halted!`);
    lines.push(`Daily PnL: ${decision.portfolioState.dailyPnLPct.toFixed(2)}%`);
    return lines.join('\n');
  }

  lines.push(`📊 Signals received from ${decision.agentSignals.length} agents`);
  lines.push(`✅ Approved: ${decision.approvedOrders.length} orders`);
  lines.push(`❌ Rejected: ${decision.rejectedOrders.length} orders`);

  if (decision.approvedOrders.length > 0) {
    lines.push(``, `<b>Approved Orders:</b>`);
    for (const order of decision.approvedOrders) {
      const emoji = order.action === 'BUY' ? '🟢' : '🔴';
      lines.push(`  ${emoji} ${order.action} ${order.symbol} (${order.agentId}) — ${order.confidence.toFixed(0)}% conf`);
    }
  }

  if (decision.rejectedOrders.length > 0) {
    lines.push(``, `<b>Rejected (Risk):</b>`);
    for (const order of decision.rejectedOrders) {
      lines.push(`  🛡️ ${order.symbol}: ${order.rejectionReason}`);
    }
  }

  lines.push(``, `💰 Exposure: ${decision.portfolioState.totalExposurePct.toFixed(1)}% | PnL: ${decision.portfolioState.dailyPnLPct.toFixed(2)}%`);

  return lines.join('\n');
}
