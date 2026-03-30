import { describe, it, expect } from 'vitest';
import { checkRisk, DEFAULT_RISK_LIMITS } from '../agents/risk-controller';
import type { ProposedOrder, PortfolioState } from '../agents/types';

const basePortfolio: PortfolioState = {
  totalEquity: 100_000,
  cashBalance: 30_000,
  dailyPnL: -500,
  dailyPnLPct: -0.5,
  totalExposurePct: 70,
  sectorExposure: {},
  positions: [],
  killSwitchActive: false,
  lastUpdated: Date.now(),
};

const baseBuyOrder: ProposedOrder = {
  id: 'test-order-1',
  action: 'BUY',
  symbol: 'AAPL',
  quantity: 10,
  limitPrice: 150,
  agentId: 'STOCKS_TECHNICAL',
  arena: 'stocks',
  orderType: 'LIMIT',
  confidence: 0.8,
  reasoning: 'RSI oversold bounce',
  timestamp: Date.now(),
};

describe('checkRisk', () => {
  it('approves a valid small order', () => {
    const result = checkRisk(baseBuyOrder, basePortfolio);
    expect(result.approved).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('rejects when kill switch is active', () => {
    const portfolio = { ...basePortfolio, killSwitchActive: true };
    const result = checkRisk(baseBuyOrder, portfolio);
    expect(result.approved).toBe(false);
    const killViolation = result.violations.find((v) => v.rule === 'KILL_SWITCH');
    expect(killViolation).toBeDefined();
  });

  it('rejects when daily drawdown exceeds limit', () => {
    const portfolio = { ...basePortfolio, dailyPnLPct: -4 };
    const result = checkRisk(baseBuyOrder, portfolio);
    expect(result.approved).toBe(false);
    expect(result.violations.some((v) => v.rule === 'MAX_DAILY_DRAWDOWN')).toBe(true);
  });

  it('rejects oversized position', () => {
    const bigOrder = { ...baseBuyOrder, quantity: 100, limitPrice: 150 }; // $15,000 = 15% of $100k
    const result = checkRisk(bigOrder, basePortfolio);
    expect(result.approved).toBe(false);
    expect(result.violations.some((v) => v.rule === 'MAX_POSITION_SIZE')).toBe(true);
  });

  it('rejects when daily loss limit hit', () => {
    const portfolio = { ...basePortfolio, dailyPnL: -6000 };
    const result = checkRisk(baseBuyOrder, portfolio);
    expect(result.approved).toBe(false);
    expect(result.violations.some((v) => v.rule === 'DAILY_LOSS_LIMIT')).toBe(true);
  });

  it('uses custom risk limits when provided', () => {
    const tightLimits = { ...DEFAULT_RISK_LIMITS, maxPositionSizePct: 1 };
    const result = checkRisk(baseBuyOrder, basePortfolio, tightLimits);
    expect(result.approved).toBe(false);
  });
});
