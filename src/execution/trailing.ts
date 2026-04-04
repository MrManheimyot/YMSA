// ─── Trailing Stop System ─────────────────────────────────────
// 3-tier trailing stop: Fixed SL → Breakeven → ATR Trail
// Lets winners run instead of fixed take-profit exits.
//
// Phase 1 (Initial):     Entry → 1R profit → fixed SL holds
// Phase 2 (Breakeven):   > 1R profit → SL moves to entry (eliminates risk)
// Phase 3 (Trailing):    > 1.5R profit → ATR-based chandelier trail
//
// R = initial risk = |entry - original SL|

// ─── Types ───────────────────────────────────────────────────

export type TrailPhase = 'INITIAL' | 'BREAKEVEN' | 'TRAILING';

export interface TrailingState {
  phase: TrailPhase;
  entryPrice: number;
  originalStopLoss: number;
  currentStopLoss: number;
  highWaterMark: number;       // highest price since entry (longs) / lowest (shorts)
  atr: number;                 // ATR at entry, used for trail distance
  direction: 'BUY' | 'SELL';
  /** Partial TP levels already triggered (indices into PARTIAL_TP_LEVELS) */
  partialTpTriggered: number[];
}

export interface TrailingResult {
  newStopLoss: number;
  phase: TrailPhase;
  highWaterMark: number;
  shouldClose: boolean;
  closeReason?: string;
  /** Partial TP to execute: { levelIndex, fraction } or null */
  partialTp: { levelIndex: number; fraction: number } | null;
}

// ─── Constants ───────────────────────────────────────────────

/** At what R-multiple the SL moves to breakeven */
const BREAKEVEN_TRIGGER_R = 1.0;

/** At what R-multiple the ATR trail activates */
const TRAIL_TRIGGER_R = 1.5;

/** ATR multiplier for chandelier trailing distance */
const TRAIL_ATR_MULTIPLIER = 2.0;

/** Partial take-profit levels: [R-multiple, fraction-to-sell] */
export const PARTIAL_TP_LEVELS: Array<{ rMultiple: number; fraction: number }> = [
  { rMultiple: 1.5, fraction: 0.33 },   // TP1: sell 33% at 1.5R
  { rMultiple: 2.5, fraction: 0.33 },   // TP2: sell 33% at 2.5R
  // Remaining 34% rides the trail
];

// ─── Core Logic ──────────────────────────────────────────────

/**
 * Create initial trailing state when a trade is opened.
 */
export function createTrailingState(
  entryPrice: number,
  stopLoss: number,
  atr: number,
  direction: 'BUY' | 'SELL',
): TrailingState {
  return {
    phase: 'INITIAL',
    entryPrice,
    originalStopLoss: stopLoss,
    currentStopLoss: stopLoss,
    highWaterMark: entryPrice,
    atr,
    direction,
    partialTpTriggered: [],
  };
}

/**
 * Update trailing state with a new price tick.
 * Returns the updated stop loss, phase, and whether trade should close.
 *
 * The stop loss only ratchets in the favorable direction — never moves
 * back toward entry.
 */
export function updateTrailingStop(
  state: TrailingState,
  currentPrice: number,
): TrailingResult {
  const { entryPrice, originalStopLoss, direction, atr } = state;
  const isBuy = direction === 'BUY';

  // Calculate R (initial risk distance)
  const R = Math.abs(entryPrice - originalStopLoss);
  if (R <= 0) {
    return {
      newStopLoss: state.currentStopLoss,
      phase: state.phase,
      highWaterMark: state.highWaterMark,
      shouldClose: false,
      partialTp: null,
    };
  }

  // Update high water mark
  const hwm = isBuy
    ? Math.max(state.highWaterMark, currentPrice)
    : Math.min(state.highWaterMark, currentPrice);

  // Calculate current profit in R-multiples
  const profitR = isBuy
    ? (currentPrice - entryPrice) / R
    : (entryPrice - currentPrice) / R;

  // Check if SL hit
  const slHit = isBuy
    ? currentPrice <= state.currentStopLoss
    : currentPrice >= state.currentStopLoss;

  if (slHit) {
    return {
      newStopLoss: state.currentStopLoss,
      phase: state.phase,
      highWaterMark: hwm,
      shouldClose: true,
      closeReason: state.phase === 'INITIAL'
        ? 'Stop loss hit'
        : state.phase === 'BREAKEVEN'
          ? 'Breakeven stop hit'
          : 'Trailing stop hit',
      partialTp: null,
    };
  }

  // Determine phase and compute new SL
  let newPhase: TrailPhase = state.phase;
  let newSL = state.currentStopLoss;

  if (profitR >= TRAIL_TRIGGER_R) {
    // Phase 3: Trailing — Chandelier exit based on ATR
    newPhase = 'TRAILING';
    const trailDistance = atr * TRAIL_ATR_MULTIPLIER;
    const trailSL = isBuy ? hwm - trailDistance : hwm + trailDistance;

    // Ratchet: only move SL in favorable direction
    newSL = isBuy
      ? Math.max(state.currentStopLoss, trailSL)
      : Math.min(state.currentStopLoss, trailSL);

  } else if (profitR >= BREAKEVEN_TRIGGER_R) {
    // Phase 2: Breakeven — move SL to entry price
    newPhase = 'BREAKEVEN';
    newSL = isBuy
      ? Math.max(state.currentStopLoss, entryPrice)
      : Math.min(state.currentStopLoss, entryPrice);
  }
  // else Phase 1: INITIAL — keep original SL

  // Check partial take-profit triggers
  let partialTp: TrailingResult['partialTp'] = null;
  for (let i = 0; i < PARTIAL_TP_LEVELS.length; i++) {
    if (state.partialTpTriggered.includes(i)) continue;
    if (profitR >= PARTIAL_TP_LEVELS[i].rMultiple) {
      partialTp = { levelIndex: i, fraction: PARTIAL_TP_LEVELS[i].fraction };
      break; // one partial TP per tick
    }
  }

  return {
    newStopLoss: newSL,
    phase: newPhase,
    highWaterMark: hwm,
    shouldClose: false,
    partialTp,
  };
}

/**
 * Serialize trailing state to JSON for D1 storage.
 */
export function serializeTrailingState(state: TrailingState): string {
  return JSON.stringify(state);
}

/**
 * Deserialize trailing state from D1 JSON string.
 * Returns null if invalid or missing.
 */
export function deserializeTrailingState(json: string | null | undefined): TrailingState | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (!parsed.phase || !parsed.entryPrice || !parsed.direction) return null;
    return {
      phase: parsed.phase,
      entryPrice: parsed.entryPrice,
      originalStopLoss: parsed.originalStopLoss,
      currentStopLoss: parsed.currentStopLoss,
      highWaterMark: parsed.highWaterMark,
      atr: parsed.atr ?? 0,
      direction: parsed.direction,
      partialTpTriggered: parsed.partialTpTriggered ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * Calculate the initial R-value (risk per share) for a trade.
 */
export function calculateR(entryPrice: number, stopLoss: number): number {
  return Math.abs(entryPrice - stopLoss);
}

/**
 * Compute profit in R-multiples for display/logging.
 */
export function profitInR(
  entryPrice: number,
  currentPrice: number,
  stopLoss: number,
  direction: 'BUY' | 'SELL',
): number {
  const R = calculateR(entryPrice, stopLoss);
  if (R <= 0) return 0;
  return direction === 'BUY'
    ? (currentPrice - entryPrice) / R
    : (entryPrice - currentPrice) / R;
}
