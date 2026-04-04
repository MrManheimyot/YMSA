// ─── D1 Config Table — Runtime Risk Parameter Override ───────
// Load risk parameters from D1 at cron start. Hardcoded ceilings
// prevent any DB value from exceeding safety limits.
//
// Table: config (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)

// ═══════════════════════════════════════════════════════════════
// Hardcoded Safety Ceilings (NO DB value can exceed these)
// ═══════════════════════════════════════════════════════════════

const CEILINGS: Record<string, number> = {
  risk_per_trade: 0.10,            // 10% max per trade
  max_position_pct: 0.35,          // 35% max position
  max_total_exposure_pct: 100,     // 100% max exposure
  kelly_fraction: 1.0,             // Full Kelly ceiling
  kill_switch_drawdown_pct: 15,    // -15% max
  max_open_positions: 25,          // 25 max positions
  max_daily_trades: 50,            // 50 max daily trades
  daily_loss_limit_usd: 25000,     // $25K max daily loss
  max_sector_exposure_pct: 50,     // 50% max sector
  confidence_gate: 100,            // max confidence gate
  merge_min_engines: 1,            // at least 1 engine
  max_leverage: 2.0,               // 2x Alpaca max
};

// ═══════════════════════════════════════════════════════════════
// Default Values (used when no DB override)
// ═══════════════════════════════════════════════════════════════

const DEFAULTS: Record<string, number> = {
  risk_per_trade: 0.02,
  max_position_pct: 0.10,
  max_total_exposure_pct: 80,
  kelly_fraction: 0.50,
  kill_switch_drawdown_pct: 5,
  max_open_positions: 8,
  max_daily_trades: 15,
  daily_loss_limit_usd: 5000,
  max_sector_exposure_pct: 25,
  max_correlation: 0.85,
  max_portfolio_risk: 0.06,
  confidence_gate: 85,
  confidence_gate_d1: 55,
  merge_min_engines: 2,
  express_lane_min_confidence: 90,
  express_lane_min_rr: 2.5,
  max_leverage: 1.0,
  atr_stop_multiplier: 2.0,
  atr_tp_multiplier: 3.0,
  // Engine budgets
  engine_budget_mtf_momentum: 0.30,
  engine_budget_smart_money: 0.20,
  engine_budget_stat_arb: 0.20,
  engine_budget_options: 0.10,
  engine_budget_crypto_defi: 0.10,
  engine_budget_event_driven: 0.10,
  engine_budget_probation: 0.05,
  // VIX thresholds
  vix_calm_threshold: 15,
  vix_normal_threshold: 25,
  vix_volatile_threshold: 35,
};

// ═══════════════════════════════════════════════════════════════
// Runtime Config (loaded from D1 + clamped to ceilings)
// ═══════════════════════════════════════════════════════════════

let runtimeConfig: Record<string, number> = { ...DEFAULTS };

/**
 * Load config overrides from D1 config table.
 * Values are clamped to safety ceilings.
 */
export async function loadConfig(db: D1Database): Promise<void> {
  try {
    const result = await db.prepare(`SELECT key, value FROM config`).all();
    const overrides: Record<string, number> = {};
    for (const row of (result.results || []) as { key: string; value: string }[]) {
      const num = parseFloat(row.value);
      if (!isNaN(num)) {
        overrides[row.key] = num;
      }
    }

    // Merge: defaults → DB overrides → clamped to ceilings
    runtimeConfig = { ...DEFAULTS };
    for (const [key, value] of Object.entries(overrides)) {
      const ceiling = CEILINGS[key];
      runtimeConfig[key] = ceiling !== undefined ? Math.min(value, ceiling) : value;
    }

    console.log(`[Config] Loaded ${Object.keys(overrides).length} overrides from D1`);
  } catch (err) {
    console.error('[Config] Failed to load from D1, using defaults:', err);
    runtimeConfig = { ...DEFAULTS };
  }
}

/**
 * Get a config value by key. Returns the runtime value (DB override or default).
 */
export function getConfig(key: string): number {
  return runtimeConfig[key] ?? DEFAULTS[key] ?? 0;
}

/**
 * Get all current config as a flat object.
 */
export function getAllConfig(): Record<string, number> {
  return { ...runtimeConfig };
}

/**
 * Upsert a config value in D1.
 */
export async function setConfig(db: D1Database, key: string, value: number): Promise<void> {
  const ceiling = CEILINGS[key];
  const clamped = ceiling !== undefined ? Math.min(value, ceiling) : value;
  await db.prepare(
    `INSERT INTO config (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, clamped.toString(), Date.now()).run();
  runtimeConfig[key] = clamped;
}

// ═══════════════════════════════════════════════════════════════
// Tier Presets (A = Conservative, B = Moderate, C = Aggressive)
// ═══════════════════════════════════════════════════════════════

export interface TierPreset {
  name: string;
  values: Record<string, number>;
}

export const TIER_PRESETS: Record<string, TierPreset> = {
  A: {
    name: 'Conservative',
    values: {
      risk_per_trade: 0.02,
      max_position_pct: 0.10,
      kelly_fraction: 0.50,
      max_open_positions: 8,
      confidence_gate: 85,
      merge_min_engines: 2,
      max_leverage: 1.0,
    },
  },
  B: {
    name: 'Moderate',
    values: {
      risk_per_trade: 0.04,
      max_position_pct: 0.18,
      kelly_fraction: 0.65,
      max_open_positions: 12,
      confidence_gate: 80,
      merge_min_engines: 2,
      max_leverage: 1.3,
    },
  },
  C: {
    name: 'Aggressive',
    values: {
      risk_per_trade: 0.07,
      max_position_pct: 0.25,
      kelly_fraction: 0.85,
      max_open_positions: 15,
      confidence_gate: 75,
      merge_min_engines: 1,
      max_leverage: 1.5,
    },
  },
};

/**
 * Apply a tier preset to D1 config.
 */
export async function applyTier(db: D1Database, tier: 'A' | 'B' | 'C'): Promise<void> {
  const preset = TIER_PRESETS[tier];
  for (const [key, value] of Object.entries(preset.values)) {
    await setConfig(db, key, value);
  }
  console.log(`[Config] Applied Tier ${tier} (${preset.name})`);
}
