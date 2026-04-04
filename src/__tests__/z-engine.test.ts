import { describe, it, expect, vi } from 'vitest';
import {
  synthesizeSignal,
  scoreNewsSentiment,
  reviewTrade,
  weeklyNarrative,
  composeAlert,
  isZAiAvailable,
} from '../ai/z-engine';
import type { MergedTradeInfo } from '../ai/z-engine';
import type { MarketRegime } from '../analysis/regime';

// ─── Mock AI Binding ─────────────────────────────────────────

function createMockAI(response: string) {
  return {
    run: vi.fn().mockResolvedValue({ response }),
  };
}

function createFailingAI() {
  return {
    run: vi.fn().mockRejectedValue(new Error('AI unavailable')),
  };
}

const baseTrade: MergedTradeInfo = {
  symbol: 'AAPL',
  direction: 'BUY',
  confidence: 85,
  engines: ['Smart Money', 'MTF Momentum'],
  reasons: ['Order block detected', 'Multi-timeframe confluence'],
  entry: 180.50,
  stopLoss: 175.00,
  tp1: 190.00,
  conflicting: false,
};

const baseRegime: MarketRegime = {
  regime: 'TRENDING_UP',
  confidence: 78,
  vix: 15.3,
  adx: 28,
  emaGap: 2.5,
  bollingerWidth: 4.2,
  suggestedEngines: [],
  timestamp: Date.now(),
};

// ═══════════════════════════════════════════════════════════════
// isZAiAvailable
// ═══════════════════════════════════════════════════════════════

describe('isZAiAvailable', () => {
  it('returns true when AI binding exists', () => {
    const env = { AI: {} } as any;
    expect(isZAiAvailable(env)).toBe(true);
  });

  it('returns false when AI binding is missing', () => {
    const env = {} as any;
    expect(isZAiAvailable(env)).toBe(false);
  });

  it('returns false when AI is null', () => {
    const env = { AI: null } as any;
    expect(isZAiAvailable(env)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// synthesizeSignal
// ═══════════════════════════════════════════════════════════════

describe('synthesizeSignal', () => {
  it('returns LLM reasoning for a trade', async () => {
    const ai = createMockAI('Institutional buying at key order block. Strong multi-engine confluence supports entry.');
    const result = await synthesizeSignal(ai, baseTrade, baseRegime);
    expect(result).toContain('Institutional buying');
    expect(ai.run).toHaveBeenCalledTimes(1);
    expect(ai.run).toHaveBeenCalledWith('@cf/meta/llama-3.1-8b-instruct-fast', expect.objectContaining({
      max_tokens: 300,
      temperature: 0.3,
    }));
  });

  it('includes regime context in prompt', async () => {
    const ai = createMockAI('Trend-aligned entry.');
    await synthesizeSignal(ai, baseTrade, baseRegime);
    const prompt = ai.run.mock.calls[0][1].messages[1].content;
    expect(prompt).toContain('VIX');
    expect(prompt).toContain('ADX');
  });

  it('works without regime', async () => {
    const ai = createMockAI('Buy signal.');
    const result = await synthesizeSignal(ai, baseTrade, null);
    expect(result).toBe('Buy signal.');
  });

  it('flags conflicting signals in prompt', async () => {
    const ai = createMockAI('Despite disagreement...');
    const conflictTrade = { ...baseTrade, conflicting: true };
    await synthesizeSignal(ai, conflictTrade, null);
    const prompt = ai.run.mock.calls[0][1].messages[1].content;
    expect(prompt).toContain('disagree');
  });

  it('returns empty string when AI is null', async () => {
    const result = await synthesizeSignal(null, baseTrade, baseRegime);
    expect(result).toBe('');
  });

  it('returns empty string on AI failure', async () => {
    const ai = createFailingAI();
    const result = await synthesizeSignal(ai, baseTrade, baseRegime);
    expect(result).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════
// scoreNewsSentiment
// ═══════════════════════════════════════════════════════════════

describe('scoreNewsSentiment', () => {
  it('parses structured sentiment response', async () => {
    const aiResponse = `BULLISH 85 AAPL\nBEARISH 72 TSLA\nNEUTRAL 60 NONE`;
    const ai = createMockAI(aiResponse);
    const headlines = [
      'Apple reports record iPhone sales',
      'Tesla recalls 500k vehicles',
      'Fed holds rates steady',
    ];

    const results = await scoreNewsSentiment(ai, headlines);
    expect(results).toHaveLength(3);
    expect(results[0].sentiment).toBe('BULLISH');
    expect(results[0].confidence).toBe(85);
    expect(results[0].symbols).toEqual(['AAPL']);
    expect(results[1].sentiment).toBe('BEARISH');
    expect(results[1].confidence).toBe(72);
    expect(results[1].symbols).toEqual(['TSLA']);
    expect(results[2].sentiment).toBe('NEUTRAL');
    expect(results[2].symbols).toEqual([]);
  });

  it('clamps confidence to 0-100', async () => {
    const ai = createMockAI('BULLISH 150 AAPL');
    const results = await scoreNewsSentiment(ai, ['Some headline']);
    expect(results[0].confidence).toBe(100);
  });

  it('returns empty array when no AI', async () => {
    const results = await scoreNewsSentiment(null, ['headline']);
    expect(results).toEqual([]);
  });

  it('returns empty array for empty headlines', async () => {
    const ai = createMockAI('');
    const results = await scoreNewsSentiment(ai, []);
    expect(results).toEqual([]);
  });

  it('handles malformed AI response gracefully', async () => {
    const ai = createMockAI('I think the market is bullish overall.');
    const results = await scoreNewsSentiment(ai, ['headline1']);
    expect(results).toHaveLength(0); // no parseable lines
  });

  it('limits to 10 headlines', async () => {
    const ai = createMockAI('BULLISH 80 NONE');
    const headlines = Array.from({ length: 15 }, (_, i) => `Headline ${i}`);
    await scoreNewsSentiment(ai, headlines);
    const prompt = ai.run.mock.calls[0][1].messages[1].content;
    const lineCount = prompt.split('\n').length;
    expect(lineCount).toBeLessThanOrEqual(10);
  });

  it('returns empty on AI failure', async () => {
    const ai = createFailingAI();
    const results = await scoreNewsSentiment(ai, ['headline']);
    expect(results).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// reviewTrade
// ═══════════════════════════════════════════════════════════════

describe('reviewTrade', () => {
  it('generates review for a winning trade', async () => {
    const ai = createMockAI('Excellent entry at order block. Signal confirmed by volume. Continue weighting Smart Money signals.');
    const result = await reviewTrade(ai, {
      symbol: 'AAPL',
      side: 'BUY',
      entry: 180.00,
      exit: 190.00,
      pnl: 500,
      pnlPct: 5.5,
      engine: 'Smart Money',
      reason: 'Order block bounce',
    });
    expect(result).toContain('order block');
    const prompt = ai.run.mock.calls[0][1].messages[1].content;
    expect(prompt).toContain('WIN');
    expect(prompt).toContain('$500.00');
  });

  it('generates review for a losing trade', async () => {
    const ai = createMockAI('False breakout. Consider adding volume confirmation.');
    const result = await reviewTrade(ai, {
      symbol: 'TSLA',
      side: 'SELL',
      entry: 250.00,
      exit: 260.00,
      pnl: -500,
      pnlPct: -2.0,
      engine: 'MTF_MOMENTUM',
      reason: 'Bearish divergence',
    });
    expect(result).toContain('False breakout');
    const prompt = ai.run.mock.calls[0][1].messages[1].content;
    expect(prompt).toContain('LOSS');
  });

  it('returns empty string when AI is null', async () => {
    const result = await reviewTrade(null, {
      symbol: 'AAPL', side: 'BUY', entry: 180, exit: 190,
      pnl: 500, pnlPct: 5.5, engine: 'x', reason: 'y',
    });
    expect(result).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════
// weeklyNarrative
// ═══════════════════════════════════════════════════════════════

describe('weeklyNarrative', () => {
  it('generates narrative with real data', async () => {
    const ai = createMockAI('• Portfolio up 3.5% this week\n• AAPL was top performer\n• VIX low, stay risk-on');
    const result = await weeklyNarrative(ai, {
      weeklyPnl: 3500,
      weeklyPnlPct: 3.5,
      winRate: 0.65,
      totalTrades: 12,
      topWinner: 'AAPL (+$1200)',
      topLoser: 'TSLA (-$400)',
      regime: 'TRENDING UP',
      vix: 14.5,
    });
    expect(result).toContain('Portfolio up');
    const prompt = ai.run.mock.calls[0][1].messages[1].content;
    expect(prompt).toContain('$3500.00');
    expect(prompt).toContain('65%');
    expect(prompt).toContain('AAPL');
    expect(prompt).toContain('VIX: 14.5');
  });

  it('handles zero trades week', async () => {
    const ai = createMockAI('Quiet week with no trades executed.');
    const result = await weeklyNarrative(ai, {
      weeklyPnl: 0, weeklyPnlPct: 0, winRate: 0, totalTrades: 0,
      topWinner: 'N/A', topLoser: 'N/A', regime: 'RANGE_BOUND', vix: 20,
    });
    expect(result).toContain('Quiet week');
  });

  it('returns empty string when AI is null', async () => {
    const result = await weeklyNarrative(null, {
      weeklyPnl: 0, weeklyPnlPct: 0, winRate: 0, totalTrades: 0,
      topWinner: 'N/A', topLoser: 'N/A', regime: 'unknown', vix: 0,
    });
    expect(result).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════
// composeAlert
// ═══════════════════════════════════════════════════════════════

describe('composeAlert', () => {
  it('composes multi-trade alert', async () => {
    const ai = createMockAI('<b>🟢 BUY AAPL</b> at $180.50, SL $175, TP $190\n<b>🔴 SELL TSLA</b> at $250, SL $260, TP $240');
    const trades: MergedTradeInfo[] = [
      baseTrade,
      { ...baseTrade, symbol: 'TSLA', direction: 'SELL', entry: 250, stopLoss: 260, tp1: 240 },
    ];
    const result = await composeAlert(ai, trades, baseRegime);
    expect(result).toContain('AAPL');
    expect(result).toContain('TSLA');
    const prompt = ai.run.mock.calls[0][1].messages[1].content;
    expect(prompt).toContain('Regime');
  });

  it('limits to 3 trades', async () => {
    const ai = createMockAI('composed');
    const trades = Array.from({ length: 5 }, (_, i) => ({
      ...baseTrade, symbol: `SYM${i}`,
    }));
    await composeAlert(ai, trades, null);
    const prompt = ai.run.mock.calls[0][1].messages[1].content;
    // Should only contain 3 symbols
    expect(prompt).toContain('SYM0');
    expect(prompt).toContain('SYM1');
    expect(prompt).toContain('SYM2');
    expect(prompt).not.toContain('SYM3');
  });

  it('returns empty string for empty trades', async () => {
    const ai = createMockAI('');
    const result = await composeAlert(ai, [], null);
    expect(result).toBe('');
  });

  it('returns empty string when AI is null', async () => {
    const result = await composeAlert(null, [baseTrade], baseRegime);
    expect(result).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════
// LLM robustness: empty/whitespace responses
// ═══════════════════════════════════════════════════════════════

describe('LLM edge cases', () => {
  it('handles empty LLM response', async () => {
    const ai = createMockAI('');
    const result = await synthesizeSignal(ai, baseTrade, null);
    expect(result).toBe('');
  });

  it('handles whitespace-only LLM response', async () => {
    const ai = createMockAI('   \n  ');
    const result = await synthesizeSignal(ai, baseTrade, null);
    expect(result).toBe('');
  });

  it('handles undefined response field', async () => {
    const ai = { run: vi.fn().mockResolvedValue({}) };
    const result = await synthesizeSignal(ai, baseTrade, null);
    expect(result).toBe('');
  });

  it('handles null response from AI', async () => {
    const ai = { run: vi.fn().mockResolvedValue(null) };
    const result = await synthesizeSignal(ai, baseTrade, null);
    expect(result).toBe('');
  });
});
