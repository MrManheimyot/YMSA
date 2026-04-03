// ─── Stress Testing Suite (P4) ───────────────────────────────
// Simulates extreme market scenarios to verify all safety systems:
// Kill switch, risk limits, data quality gates, engine budgets.

import { describe, it, expect } from 'vitest';
import {
  checkRisk,
  evaluateKillSwitch,
  vixRiskAdjustment,
  checkEngineBudget,
  correlationCheck,
} from '../agents/risk-controller';
import type { ProposedOrder, PortfolioState } from '../agents/types';

// ═══════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════

const stablePortfolio: PortfolioState = {
  totalEquity: 100_000,
  cashBalance: 30_000,
  dailyPnL: -200,
  dailyPnLPct: -0.2,
  totalExposurePct: 60,
  sectorExposure: { Technology: 15, Finance: 10, Healthcare: 5 },
  positions: [],
  killSwitchActive: false,
  lastUpdated: Date.now(),
};

const standardOrder: ProposedOrder = {
  id: 'stress-test-1',
  action: 'BUY',
  symbol: 'AAPL',
  quantity: 10,
  limitPrice: 150,
  agentId: 'STOCKS_TECHNICAL',
  arena: 'stocks',
  orderType: 'LIMIT',
  confidence: 0.8,
  reasoning: 'Stress test signal',
  timestamp: Date.now(),
};

// ═══════════════════════════════════════════════════════════════
// Scenario 1: FLASH CRASH — Portfolio drops 10%+ in one day
// ═══════════════════════════════════════════════════════════════

describe('Stress Test: Flash Crash', () => {
  it('triggers HALT kill switch at -10% daily loss', () => {
    const ks = evaluateKillSwitch(-10);
    expect(ks.level).toBe('HALT');
    expect(ks.action).toContain('HALT');
  });

  it('triggers CLOSE_ALL at -5% daily loss', () => {
    const ks = evaluateKillSwitch(-5);
    expect(ks.level).toBe('CLOSE_ALL');
  });

  it('triggers REDUCE at -3% daily loss', () => {
    const ks = evaluateKillSwitch(-3);
    expect(ks.level).toBe('REDUCE');
  });

  it('blocks ALL new orders when kill switch active', () => {
    const crashPortfolio: PortfolioState = {
      ...stablePortfolio,
      killSwitchActive: true,
      dailyPnL: -10_000,
      dailyPnLPct: -10,
    };
    const result = checkRisk(standardOrder, crashPortfolio);
    expect(result.approved).toBe(false);
    expect(result.violations.some(v => v.rule === 'KILL_SWITCH')).toBe(true);
  });

  it('blocks orders at daily drawdown limit', () => {
    const portfolio: PortfolioState = {
      ...stablePortfolio,
      dailyPnLPct: -3.5,
    };
    const result = checkRisk(standardOrder, portfolio);
    expect(result.approved).toBe(false);
    expect(result.violations.some(v => v.rule === 'MAX_DAILY_DRAWDOWN')).toBe(true);
  });

  it('blocks orders at absolute $ loss limit', () => {
    const portfolio: PortfolioState = {
      ...stablePortfolio,
      dailyPnL: -5500,
    };
    const result = checkRisk(standardOrder, portfolio);
    expect(result.approved).toBe(false);
    expect(result.violations.some(v => v.rule === 'DAILY_LOSS_LIMIT')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Scenario 2: VIX SPIKE TO 80 — Extreme volatility
// ═══════════════════════════════════════════════════════════════

describe('Stress Test: VIX Spike to 80', () => {
  it('reduces position size to 25% at VIX >= 35', () => {
    const adj = vixRiskAdjustment(80);
    expect(adj.positionSizeMultiplier).toBe(0.25);
    expect(adj.maxExposurePct).toBe(30);
  });

  it('tightens stops to 50% at extreme VIX', () => {
    const adj = vixRiskAdjustment(80);
    expect(adj.stopMultiplier).toBe(0.5);
  });

  it('reduces position size to 50% at VIX 25-35', () => {
    const adj = vixRiskAdjustment(30);
    expect(adj.positionSizeMultiplier).toBe(0.5);
    expect(adj.maxExposurePct).toBe(50);
  });

  it('moderate reduction at VIX 18-25', () => {
    const adj = vixRiskAdjustment(20);
    expect(adj.positionSizeMultiplier).toBe(0.75);
    expect(adj.maxExposurePct).toBe(70);
  });

  it('no adjustment at VIX < 18', () => {
    const adj = vixRiskAdjustment(15);
    expect(adj.positionSizeMultiplier).toBe(1.0);
    expect(adj.maxExposurePct).toBe(80);
  });
});

// ═══════════════════════════════════════════════════════════════
// Scenario 3: CORRELATION BREAKDOWN — All positions correlated
// ═══════════════════════════════════════════════════════════════

describe('Stress Test: Correlation Breakdown', () => {
  it('blocks new positions with >0.85 correlation', () => {
    const correlationMatrix: Record<string, Record<string, number>> = {
      AAPL: { MSFT: 0.92 },
      MSFT: { AAPL: 0.92 },
    };
    const result = correlationCheck('AAPL', ['MSFT'], correlationMatrix);
    expect(result.approved).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0]).toContain('0.92');
  });

  it('allows uncorrelated positions', () => {
    const correlationMatrix: Record<string, Record<string, number>> = {
      AAPL: { XOM: 0.3 },
      XOM: { AAPL: 0.3 },
    };
    const result = correlationCheck('AAPL', ['XOM'], correlationMatrix);
    expect(result.approved).toBe(true);
    expect(result.violations.length).toBe(0);
  });

  it('blocks when multiple correlated positions exist', () => {
    const matrix: Record<string, Record<string, number>> = {
      NVDA: { AAPL: 0.88, AMD: 0.91 },
      AAPL: { NVDA: 0.88 },
      AMD: { NVDA: 0.91 },
    };
    const result = correlationCheck('NVDA', ['AAPL', 'AMD'], matrix);
    expect(result.approved).toBe(false);
    expect(result.violations.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// Scenario 4: ENGINE BUDGET OVERRUN — Single engine max exposure
// ═══════════════════════════════════════════════════════════════

describe('Stress Test: Engine Budget Overrun', () => {
  it('blocks when engine exceeds its capital budget', () => {
    const result = checkEngineBudget('MTF_MOMENTUM', 35_000, 100_000);
    // MTF_MOMENTUM budget is 30% = $30,000
    expect(result.approved).toBe(false);
    expect(result.message).toContain('exceeds budget');
  });

  it('approves when within budget', () => {
    const result = checkEngineBudget('MTF_MOMENTUM', 25_000, 100_000);
    expect(result.approved).toBe(true);
  });

  it('uses default 10% for unknown engines', () => {
    const result = checkEngineBudget('UNKNOWN_ENGINE', 15_000, 100_000);
    expect(result.approved).toBe(false);
  });

  it('approves unknown engine within 10% default', () => {
    const result = checkEngineBudget('UNKNOWN_ENGINE', 8_000, 100_000);
    expect(result.approved).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Scenario 5: POSITION LIMITS — Max open positions
// ═══════════════════════════════════════════════════════════════

describe('Stress Test: Position Limits', () => {
  it('blocks new BUY when max open positions reached', () => {
    const maxedPortfolio: PortfolioState = {
      ...stablePortfolio,
      positions: Array(20).fill(null).map((_, i) => ({
        symbol: `STOCK${i}`,
        arena: 'stocks' as const,
        agentId: 'STOCKS_TECHNICAL' as const,
        quantity: 10,
        entryPrice: 95,
        currentPrice: 100,
        unrealizedPnL: 50,
        unrealizedPnLPct: 5.26,
        side: 'LONG' as const,
        sector: 'Technology',
        openedAt: Date.now(),
      })),
    };
    const result = checkRisk(standardOrder, maxedPortfolio);
    expect(result.approved).toBe(false);
    expect(result.violations.some(v => v.rule === 'MAX_OPEN_POSITIONS')).toBe(true);
  });

  it('allows SELL when max positions reached', () => {
    const maxedPortfolio: PortfolioState = {
      ...stablePortfolio,
      positions: Array(20).fill(null).map((_, i) => ({
        symbol: `STOCK${i}`,
        arena: 'stocks' as const,
        agentId: 'STOCKS_TECHNICAL' as const,
        quantity: 10,
        entryPrice: 95,
        currentPrice: 100,
        unrealizedPnL: 50,
        unrealizedPnLPct: 5.26,
        side: 'LONG' as const,
        sector: 'Technology',
        openedAt: Date.now(),
      })),
    };
    const sellOrder: ProposedOrder = { ...standardOrder, action: 'SELL' };
    const result = checkRisk(sellOrder, maxedPortfolio);
    // SELL should not be blocked by max positions
    expect(result.violations.some(v => v.rule === 'MAX_OPEN_POSITIONS')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Scenario 6: TOTAL EXPOSURE MAX — Portfolio fully invested
// ═══════════════════════════════════════════════════════════════

describe('Stress Test: Total Exposure Cap', () => {
  it('blocks new buys when 80% invested', () => {
    const maxExposurePortfolio: PortfolioState = {
      ...stablePortfolio,
      totalExposurePct: 82,
    };
    const result = checkRisk(standardOrder, maxExposurePortfolio);
    expect(result.approved).toBe(false);
    expect(result.violations.some(v => v.rule === 'MAX_TOTAL_EXPOSURE')).toBe(true);
  });

  it('allows sales when max exposure reached', () => {
    const maxExposurePortfolio: PortfolioState = {
      ...stablePortfolio,
      totalExposurePct: 82,
    };
    const sellOrder: ProposedOrder = { ...standardOrder, action: 'SELL' };
    const result = checkRisk(sellOrder, maxExposurePortfolio);
    expect(result.violations.some(v => v.rule === 'MAX_TOTAL_EXPOSURE')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Scenario 7: KILL SWITCH TIERS — Progressive response
// ═══════════════════════════════════════════════════════════════

describe('Stress Test: Kill Switch Tiers', () => {
  it('normal at -1%', () => {
    expect(evaluateKillSwitch(-1).level).toBe('NONE');
  });

  it('normal at -2.9%', () => {
    expect(evaluateKillSwitch(-2.9).level).toBe('NONE');
  });

  it('REDUCE at exactly -3%', () => {
    expect(evaluateKillSwitch(-3).level).toBe('REDUCE');
  });

  it('REDUCE at -4%', () => {
    expect(evaluateKillSwitch(-4).level).toBe('REDUCE');
  });

  it('CLOSE_ALL at -5%', () => {
    expect(evaluateKillSwitch(-5).level).toBe('CLOSE_ALL');
  });

  it('CLOSE_ALL at -8%', () => {
    expect(evaluateKillSwitch(-8).level).toBe('CLOSE_ALL');
  });

  it('HALT at -10%', () => {
    expect(evaluateKillSwitch(-10).level).toBe('HALT');
  });

  it('HALT at -50%', () => {
    expect(evaluateKillSwitch(-50).level).toBe('HALT');
  });
});

// ═══════════════════════════════════════════════════════════════
// Scenario 8: COMBINED STRESS — Multiple violations simultaneously
// ═══════════════════════════════════════════════════════════════

describe('Stress Test: Combined Crisis', () => {
  it('reports all violations in a combined crash scenario', () => {
    const crisisPortfolio: PortfolioState = {
      ...stablePortfolio,
      killSwitchActive: true,
      dailyPnL: -8_000,
      dailyPnLPct: -8,
      totalExposurePct: 90,
      positions: Array(25).fill(null).map((_, i) => ({
        symbol: `STOCK${i}`,
        arena: 'stocks' as const,
        agentId: 'STOCKS_TECHNICAL' as const,
        quantity: 10,
        entryPrice: 110,
        currentPrice: 100,
        unrealizedPnL: -100,
        unrealizedPnLPct: -9.09,
        side: 'LONG' as const,
        sector: 'Technology',
        openedAt: Date.now(),
      })),
      sectorExposure: { Technology: 60 },
    };

    const bigOrder: ProposedOrder = {
      ...standardOrder,
      quantity: 1000,
      limitPrice: 150,  // $150K order = 150% of equity
    };

    const result = checkRisk(bigOrder, crisisPortfolio);
    expect(result.approved).toBe(false);
    // Should have multiple violations
    expect(result.violations.length).toBeGreaterThanOrEqual(3);

    const rules = result.violations.map(v => v.rule);
    expect(rules).toContain('KILL_SWITCH');
    expect(rules).toContain('MAX_DAILY_DRAWDOWN');
    expect(rules).toContain('DAILY_LOSS_LIMIT');
  });
});

// ═══════════════════════════════════════════════════════════════
// Scenario 9: SECTOR CONCENTRATION — Single sector overexposure
// ═══════════════════════════════════════════════════════════════

describe('Stress Test: Sector Concentration', () => {
  it('blocks buy when sector at 25% limit', () => {
    const techHeavy: PortfolioState = {
      ...stablePortfolio,
      sectorExposure: { Technology: 26 },
    };
    const techOrder: ProposedOrder = {
      ...standardOrder,
      symbol: 'NVDA', // Technology sector
    };
    const result = checkRisk(techOrder, techHeavy);
    expect(result.approved).toBe(false);
    expect(result.violations.some(v => v.rule === 'MAX_SECTOR_EXPOSURE')).toBe(true);
  });
});
