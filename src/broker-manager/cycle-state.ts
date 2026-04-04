// ─── Cycle State — per-cycle accumulator + dedup + rate limiting ──

import type { TechnicalIndicator } from '../types';
import type { MarketRegime } from '../analysis/regime';
import { getEngineAdjustments } from '../analysis/regime';
import type { EngineOutput } from './types';

// ═══════════════════════════════════════════════════════════════
// Mutable state — scoped to a single Worker invocation cycle
// ═══════════════════════════════════════════════════════════════

let cycleOutputs: EngineOutput[] = [];
let cycleRegime: MarketRegime | null = null;
let cycleContext: string[] = [];
let cyclePending = false;
let cycleIndicators: Map<string, TechnicalIndicator[]> = new Map();

// Hourly alert budget
const alertHistory: number[] = [];
const MAX_TRADE_ALERTS_PER_HOUR = 3;

// Cross-cycle dedup (24 hour window)
const sentKeys = new Map<string, number>();
const DEDUP_MS = 24 * 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════
// Accessors
// ═══════════════════════════════════════════════════════════════

export function getCycleOutputs(): EngineOutput[] { return cycleOutputs; }
export function getCycleRegime(): MarketRegime | null { return cycleRegime; }
export function getCycleContext(): string[] { return cycleContext; }
export function getCycleIndicators(): Map<string, TechnicalIndicator[]> { return cycleIndicators; }
export function isCyclePending(): boolean { return cyclePending; }

// ═══════════════════════════════════════════════════════════════
// Cycle management
// ═══════════════════════════════════════════════════════════════

export function beginCycle(): void {
  cycleOutputs = [];
  cycleContext = [];
  cycleRegime = null;
  cycleIndicators = new Map();
  cyclePending = true;
}

export function setRegime(regime: MarketRegime): void {
  cycleRegime = regime;
}

export function addContext(line: string): void {
  cycleContext.push(line);
}

export function pushEngineOutput(output: EngineOutput): void {
  if (cycleRegime) {
    const adjustments = getEngineAdjustments(cycleRegime);
    const engineKey = output.engine.toUpperCase().replace(/\s+/g, '_') as keyof typeof adjustments;
    const multiplier = adjustments[engineKey] ?? 1.0;
    output.confidence = Math.min(100, Math.round(output.confidence * multiplier));
  }
  cycleOutputs.push(output);
}

export function resetCycle(): void {
  cyclePending = false;
  cycleOutputs = [];
  cycleContext = [];
  cycleRegime = null;
  cycleIndicators = new Map();
}

// ═══════════════════════════════════════════════════════════════
// Alert budget
// ═══════════════════════════════════════════════════════════════

export function canSendTradeAlert(): boolean {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  while (alertHistory.length > 0 && alertHistory[0] < oneHourAgo) alertHistory.shift();
  return alertHistory.length < MAX_TRADE_ALERTS_PER_HOUR;
}

export function recordTradeAlert(): void {
  alertHistory.push(Date.now());
}

// ═══════════════════════════════════════════════════════════════
// Dedup
// ═══════════════════════════════════════════════════════════════

export function wasSentRecently(key: string): boolean {
  const now = Date.now();
  for (const [k, ts] of sentKeys) {
    if (now - ts > DEDUP_MS) sentKeys.delete(k);
  }
  return sentKeys.has(key);
}

export function markSent(key: string): void {
  sentKeys.set(key, Date.now());
}
