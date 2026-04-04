// ─── Engine Budgets + Probation ───────────────────────────────

import { upsertEngineBudget, loadEngineBudgets } from '../../db/queries';

// ═══════════════════════════════════════════════════════════════
// Engine-level capital budgets (% of total equity)
// ═══════════════════════════════════════════════════════════════

export const ENGINE_BUDGETS: Record<string, number> = {
  MTF_MOMENTUM: 0.30,
  SMART_MONEY: 0.20,
  STAT_ARB: 0.20,
  OPTIONS: 0.10,
  CRYPTO_DEFI: 0.10,
  EVENT_DRIVEN: 0.10,
};

const MIN_ENGINE_BUDGET = 0.05;
const MAX_ENGINE_BUDGET = 0.40;

// In-memory probation state (persists within Worker lifetime)
const probationState: Record<string, { onProbation: boolean; originalBudget: number; consecutiveWins: number }> = {};

// ═══════════════════════════════════════════════════════════════
// Persistence
// ═══════════════════════════════════════════════════════════════

export async function loadPersistedBudgets(db: D1Database | undefined): Promise<void> {
  if (!db) return;
  try {
    const rows = await loadEngineBudgets(db);
    if (rows.length === 0) return;
    for (const row of rows) {
      if (ENGINE_BUDGETS[row.engine_id] !== undefined) {
        ENGINE_BUDGETS[row.engine_id] = row.budget;
      }
      if (row.on_probation) {
        probationState[row.engine_id] = {
          onProbation: true,
          originalBudget: row.original_budget ?? ENGINE_BUDGETS[row.engine_id],
          consecutiveWins: 0,
        };
      }
    }
    console.log(`[RiskController] Loaded ${rows.length} persisted engine budgets from D1`);
  } catch (err) {
    console.error('[RiskController] Failed to load persisted budgets:', err);
  }

  // GAP-019: Also load probation state from engine_probation table
  try {
    const probRows = await db.prepare(
      `SELECT engine_id, on_probation, budget_override, reason, started_at FROM engine_probation`
    ).all();
    for (const row of (probRows.results || []) as any[]) {
      if (row.on_probation) {
        probationState[row.engine_id] = {
          onProbation: true,
          originalBudget: row.budget_override ?? ENGINE_BUDGETS[row.engine_id] ?? 0.10,
          consecutiveWins: 0,
        };
        // Apply reduced budget
        if (ENGINE_BUDGETS[row.engine_id] !== undefined) {
          ENGINE_BUDGETS[row.engine_id] = MIN_ENGINE_BUDGET;
        }
      }
    }
  } catch { /* engine_probation table may not exist yet */ }
}

// ═══════════════════════════════════════════════════════════════
// Budget checks
// ═══════════════════════════════════════════════════════════════

export function checkEngineBudget(
  engineId: string,
  engineExposure: number,
  totalEquity: number
): { approved: boolean; message: string } {
  const budget = ENGINE_BUDGETS[engineId] || 0.10;
  const maxExposure = totalEquity * budget;
  if (engineExposure > maxExposure) {
    return {
      approved: false,
      message: `Engine ${engineId} exposure $${engineExposure.toFixed(0)} exceeds budget $${maxExposure.toFixed(0)} (${(budget * 100).toFixed(0)}%)`,
    };
  }
  return { approved: true, message: 'Within budget' };
}

// ═══════════════════════════════════════════════════════════════
// P3: Dynamic rebalancing
// ═══════════════════════════════════════════════════════════════

export interface EngineBudgetRebalance {
  engineId: string;
  oldBudget: number;
  newBudget: number;
  winRate: number;
  profitFactor: number;
  reason: string;
}

export async function rebalanceEngineBudgets(
  db: D1Database | undefined,
): Promise<EngineBudgetRebalance[]> {
  if (!db) return [];

  const changes: EngineBudgetRebalance[] = [];
  const engineIds = Object.keys(ENGINE_BUDGETS);
  const perfMap: Record<string, { winRate: number; profitFactor: number; trades: number; pnl: number }> = {};
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  for (const engineId of engineIds) {
    try {
      const trades = await db.prepare(
        `SELECT * FROM trades WHERE engine_id = ? AND status = 'CLOSED' AND closed_at >= ?`
      ).bind(engineId, thirtyDaysAgo).all();

      const tradeRows = (trades.results || []) as unknown as Array<{ pnl: number | null; pnl_pct: number | null }>;
      const total = tradeRows.length;
      const wins = tradeRows.filter(t => (t.pnl || 0) > 0);
      const losses = tradeRows.filter(t => (t.pnl || 0) < 0);
      const grossWin = wins.reduce((s, t) => s + (t.pnl || 0), 0);
      const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl || 0), 0));

      perfMap[engineId] = {
        winRate: total > 0 ? wins.length / total : 0.5,
        profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 2.0 : 1.0,
        trades: total,
        pnl: tradeRows.reduce((s, t) => s + (t.pnl || 0), 0),
      };
    } catch {
      perfMap[engineId] = { winRate: 0.5, profitFactor: 1.0, trades: 0, pnl: 0 };
    }
  }

  const scores: Record<string, number> = {};
  for (const engineId of engineIds) {
    const perf = perfMap[engineId];
    const wrScore = perf.winRate * 40;
    const pfScore = Math.min(perf.profitFactor, 3) / 3 * 30;
    const activityScore = Math.min(perf.trades, 20) / 20 * 30;
    scores[engineId] = wrScore + pfScore + activityScore;
  }

  const totalScore = Object.values(scores).reduce((s, v) => s + v, 0);
  if (totalScore <= 0) return [];

  const rawBudgets: Record<string, number> = {};
  for (const engineId of engineIds) {
    rawBudgets[engineId] = scores[engineId] / totalScore;
  }

  let totalBudget = 0;
  const clampedBudgets: Record<string, number> = {};
  for (const engineId of engineIds) {
    clampedBudgets[engineId] = Math.max(MIN_ENGINE_BUDGET, Math.min(MAX_ENGINE_BUDGET, rawBudgets[engineId]));
    totalBudget += clampedBudgets[engineId];
  }

  for (const engineId of engineIds) {
    const oldBudget = ENGINE_BUDGETS[engineId];
    const newBudget = clampedBudgets[engineId] / totalBudget;

    if (Math.abs(newBudget - oldBudget) > 0.01) {
      const perf = perfMap[engineId];
      changes.push({
        engineId, oldBudget, newBudget,
        winRate: perf.winRate,
        profitFactor: perf.profitFactor,
        reason: perf.trades < 5
          ? 'Low activity — using default score'
          : `WR ${(perf.winRate * 100).toFixed(0)}%, PF ${perf.profitFactor.toFixed(2)}, ${perf.trades} trades`,
      });
    }

    ENGINE_BUDGETS[engineId] = newBudget;

    try {
      await upsertEngineBudget(db!, engineId, newBudget, probationState[engineId]?.onProbation || false, probationState[engineId]?.originalBudget || null);
    } catch { /* best-effort persist */ }
  }

  return changes;
}

export function formatBudgetRebalance(changes: EngineBudgetRebalance[]): string {
  if (changes.length === 0) {
    return `⚖️ <b>Engine Budget Re-check</b>\nNo significant changes — budgets stable.`;
  }

  const lines = [`⚖️ <b>Engine Budget Rebalance</b>`, `━━━━━━━━━━━━━━━━━━━━━━`];

  for (const c of changes) {
    const arrow = c.newBudget > c.oldBudget ? '📈' : '📉';
    lines.push(
      `${arrow} <b>${c.engineId}</b>: ${(c.oldBudget * 100).toFixed(0)}% → ${(c.newBudget * 100).toFixed(0)}%`,
      `   ${c.reason}`,
    );
  }

  lines.push(``, `Current budgets:`);
  for (const [id, budget] of Object.entries(ENGINE_BUDGETS)) {
    lines.push(`  ${id}: ${(budget * 100).toFixed(0)}%`);
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// P5: Engine Probation
// ═══════════════════════════════════════════════════════════════

export interface EngineProbation {
  engineId: string;
  onProbation: boolean;
  reason: string;
  originalBudget: number;
  probationBudget: number;
  closedTrades: number;
  wins: number;
  consecutiveWins: number;
}

export async function evaluateEngineProbation(
  db: D1Database | undefined,
): Promise<EngineProbation[]> {
  if (!db) return [];

  const results: EngineProbation[] = [];
  const engineIds = Object.keys(ENGINE_BUDGETS);
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  for (const engineId of engineIds) {
    try {
      const trades = await db.prepare(
        `SELECT pnl FROM trades WHERE engine_id = ? AND status = 'CLOSED' AND closed_at >= ? ORDER BY closed_at ASC`
      ).bind(engineId, thirtyDaysAgo).all();

      const tradeRows = (trades.results || []) as unknown as Array<{ pnl: number | null }>;
      const total = tradeRows.length;
      const wins = tradeRows.filter(t => (t.pnl || 0) > 0).length;

      if (!probationState[engineId]) {
        probationState[engineId] = {
          onProbation: false,
          originalBudget: ENGINE_BUDGETS[engineId],
          consecutiveWins: 0,
        };
      }

      const state = probationState[engineId];

      let consWins = 0;
      for (let j = tradeRows.length - 1; j >= 0; j--) {
        if ((tradeRows[j].pnl || 0) > 0) consWins++;
        else break;
      }
      state.consecutiveWins = consWins;

      // Trigger: 0 wins with ≥5 trades
      if (!state.onProbation && total >= 5 && wins === 0) {
        state.onProbation = true;
        state.originalBudget = ENGINE_BUDGETS[engineId];
        ENGINE_BUDGETS[engineId] = MIN_ENGINE_BUDGET;
        results.push({
          engineId, onProbation: true,
          reason: `0 wins in ${total} trades — budget reduced to 5%`,
          originalBudget: state.originalBudget, probationBudget: MIN_ENGINE_BUDGET,
          closedTrades: total, wins, consecutiveWins: consWins,
        });
        try { await upsertEngineBudget(db!, engineId, MIN_ENGINE_BUDGET, true, state.originalBudget); } catch { /* best-effort */ }
        // GAP-019: Persist to engine_probation table
        try { await persistProbation(db!, engineId, true, state.originalBudget, `0 wins in ${total} trades`); } catch { /* best-effort */ }
      }
      // Recovery: 5 consecutive wins
      else if (state.onProbation && consWins >= 5) {
        ENGINE_BUDGETS[engineId] = state.originalBudget;
        state.onProbation = false;
        results.push({
          engineId, onProbation: false,
          reason: `5 consecutive wins — budget restored to ${(state.originalBudget * 100).toFixed(0)}%`,
          originalBudget: state.originalBudget, probationBudget: ENGINE_BUDGETS[engineId],
          closedTrades: total, wins, consecutiveWins: consWins,
        });
        try { await upsertEngineBudget(db!, engineId, state.originalBudget, false, null); } catch { /* best-effort */ }
        try { await persistProbation(db!, engineId, false, null, '5 consecutive wins — restored'); } catch { /* best-effort */ }
      }
      // Recovery: >40% WR with ≥10 trades
      else if (state.onProbation && total >= 10 && wins / total > 0.4) {
        ENGINE_BUDGETS[engineId] = state.originalBudget;
        state.onProbation = false;
        results.push({
          engineId, onProbation: false,
          reason: `WR improved to ${((wins / total) * 100).toFixed(0)}% — budget restored`,
          originalBudget: state.originalBudget, probationBudget: ENGINE_BUDGETS[engineId],
          closedTrades: total, wins, consecutiveWins: consWins,
        });
        try { await upsertEngineBudget(db!, engineId, state.originalBudget, false, null); } catch { /* best-effort */ }
        try { await persistProbation(db!, engineId, false, null, `WR ${((wins / total) * 100).toFixed(0)}% — restored`); } catch { /* best-effort */ }
      }
    } catch (err) {
      console.error(`[P5] Probation check failed for ${engineId}:`, err);
    }
  }

  return results;
}

export function formatProbationReport(probations: EngineProbation[]): string {
  if (probations.length === 0) return '';
  const lines = [`🚦 <b>Engine Probation Update</b>`, `━━━━━━━━━━━━━━━━━━━━━━`];
  for (const p of probations) {
    const icon = p.onProbation ? '🔴' : '🟢';
    lines.push(`${icon} <b>${p.engineId}</b>: ${p.reason}`);
    lines.push(`   Trades: ${p.closedTrades} | Wins: ${p.wins} | Consec: ${p.consecutiveWins}`);
  }
  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// GAP-019: Probation D1 Persistence
// ═══════════════════════════════════════════════════════════════

async function persistProbation(
  db: D1Database,
  engineId: string,
  onProbation: boolean,
  budgetOverride: number | null,
  reason: string,
): Promise<void> {
  await db.prepare(
    `INSERT INTO engine_probation (engine_id, on_probation, budget_override, reason, started_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(engine_id) DO UPDATE SET
       on_probation = excluded.on_probation,
       budget_override = excluded.budget_override,
       reason = excluded.reason,
       started_at = CASE WHEN excluded.on_probation = 1 THEN excluded.started_at ELSE started_at END,
       updated_at = excluded.updated_at`
  ).bind(engineId, onProbation ? 1 : 0, budgetOverride, reason, Date.now(), Date.now()).run();
}

export function isOnProbation(engineId: string): boolean {
  return probationState[engineId]?.onProbation || false;
}
