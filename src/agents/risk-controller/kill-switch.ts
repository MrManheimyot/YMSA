// ─── Tiered Kill Switch ──────────────────────────────────────

import { getKillSwitchState, upsertKillSwitchState } from '../../db/queries';

export interface TieredKillSwitch {
  level: 'NONE' | 'REDUCE' | 'CLOSE_ALL' | 'HALT';
  action: string;
  threshold: number;
}

export function evaluateKillSwitch(dailyPnlPct: number): TieredKillSwitch {
  if (dailyPnlPct <= -10) {
    return { level: 'HALT', action: 'HALT all trading for 7 days', threshold: -10 };
  }
  if (dailyPnlPct <= -5) {
    return { level: 'CLOSE_ALL', action: 'CLOSE all open positions immediately', threshold: -5 };
  }
  if (dailyPnlPct <= -3) {
    return { level: 'REDUCE', action: 'REDUCE all positions by 50%', threshold: -3 };
  }
  return { level: 'NONE', action: 'Normal operations', threshold: 0 };
}

export async function evaluateAndPersistKillSwitch(
  dailyPnlPct: number,
  db: D1Database | undefined,
): Promise<TieredKillSwitch> {
  const ks = evaluateKillSwitch(dailyPnlPct);

  if (db) {
    try {
      const existing = await getKillSwitchState(db);
      if (existing && existing.tier === 'HALT' && ks.level !== 'HALT') {
        const haltedAt = existing.activated_at || 0;
        const sevenDays = 7 * 24 * 60 * 60 * 1000;
        if (Date.now() - haltedAt < sevenDays) {
          return { level: 'HALT', action: 'HALT still active (7-day cooldown)', threshold: -10 };
        }
      }
      await upsertKillSwitchState(db, ks.level, dailyPnlPct, ks.action);
    } catch (err) {
      console.error('[RiskController] Kill switch persist failed:', err);
    }
  }

  return ks;
}

export async function loadKillSwitchState(db: D1Database | undefined): Promise<TieredKillSwitch> {
  if (!db) return { level: 'NONE', action: 'Normal operations', threshold: 0 };
  try {
    const state = await getKillSwitchState(db);
    if (!state || state.tier === 'NONE') return { level: 'NONE', action: 'Normal operations', threshold: 0 };

    if (state.tier === 'HALT' && state.activated_at) {
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      if (Date.now() - state.activated_at >= sevenDays) {
        await upsertKillSwitchState(db, 'NONE', null, 'HALT expired after 7 days');
        return { level: 'NONE', action: 'HALT expired', threshold: 0 };
      }
    }

    return {
      level: state.tier as TieredKillSwitch['level'],
      action: state.reason || 'Kill switch active',
      threshold: state.daily_pnl_pct || 0,
    };
  } catch {
    return { level: 'NONE', action: 'Normal operations (DB unavailable)', threshold: 0 };
  }
}
