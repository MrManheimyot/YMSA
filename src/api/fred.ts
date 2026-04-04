// ─── FRED API Client (Federal Reserve Economic Data) ──────────
// Free macro data: CPI, PPI, GDP, interest rates, unemployment
// No API key needed for basic access, key for higher limits
// Docs: https://fred.stlouisfed.org/docs/api/fred/

import type { MacroIndicator } from '../agents/types';

const BASE_URL = 'https://api.stlouisfed.org/fred';

// Key FRED series IDs for commodity/macro analysis
export const FRED_SERIES = {
  FED_FUNDS_RATE: 'FEDFUNDS',
  CPI: 'CPIAUCSL',
  CORE_CPI: 'CPILFESL',
  PPI: 'PPIACO',
  GDP: 'GDP',
  UNEMPLOYMENT: 'UNRATE',
  TREASURY_10Y: 'DGS10',
  TREASURY_2Y: 'DGS2',
  YIELD_SPREAD: 'T10Y2Y',       // 10Y - 2Y (recession indicator)
  YIELD_SPREAD_3M: 'T10Y3M',    // GAP-026: 10Y - 3M (complementary recession indicator)
  CREDIT_SPREAD: 'BAA10Y',      // GAP-026: Baa corporate - 10Y treasury (credit risk)
  MONEY_SUPPLY_M2: 'M2SL',      // GAP-026: M2 money supply (liquidity indicator)
  USD_INDEX: 'DTWEXBGS',
  VIX: 'VIXCLS',
  OIL_WTI: 'DCOILWTICO',
  GOLD: 'GOLDAMGBD228NLBM',
  NATURAL_GAS: 'DHHNGSP',
  INITIAL_CLAIMS: 'ICSA',       // Weekly jobless claims
  CONSUMER_SENTIMENT: 'UMCSENT',
} as const;

/**
 * Fetch latest value for a FRED series
 */
export async function getLatestValue(
  seriesId: string,
  apiKey: string
): Promise<MacroIndicator | null> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: 'json',
    sort_order: 'desc',
    limit: '2', // Get latest + previous for change calc
  });

  try {
    const res = await fetch(`${BASE_URL}/series/observations?${params}`);
    const data = await res.json() as Record<string, any>;
    const observations = data.observations;

    if (!observations || observations.length === 0) return null;

    const latest = observations[0];
    const previous = observations[1];

    const value = parseFloat(latest.value);
    const prevValue = previous ? parseFloat(previous.value) : value;

    if (isNaN(value)) return null;

    return {
      id: seriesId,
      name: seriesId,
      value,
      previousValue: prevValue,
      change: value - prevValue,
      unit: '%', // Most FRED series are percentages
      date: latest.date,
      source: 'FRED',
    };
  } catch (err) {
    console.error(`[FRED] Error fetching ${seriesId}:`, err);
    return null;
  }
}

/**
 * Fetch multiple FRED series in parallel
 */
export async function getMultipleSeries(
  seriesIds: string[],
  apiKey: string
): Promise<MacroIndicator[]> {
  const results = await Promise.all(
    seriesIds.map((id) => getLatestValue(id, apiKey))
  );
  return results.filter((r): r is MacroIndicator => r !== null);
}

/**
 * Get key macro dashboard — all critical indicators
 */
export async function getMacroDashboard(apiKey: string): Promise<MacroIndicator[]> {
  return getMultipleSeries([
    FRED_SERIES.FED_FUNDS_RATE,
    FRED_SERIES.CPI,
    FRED_SERIES.TREASURY_10Y,
    FRED_SERIES.TREASURY_2Y,
    FRED_SERIES.YIELD_SPREAD,
    FRED_SERIES.YIELD_SPREAD_3M,    // GAP-026
    FRED_SERIES.CREDIT_SPREAD,       // GAP-026
    FRED_SERIES.MONEY_SUPPLY_M2,     // GAP-026
    FRED_SERIES.VIX,
    FRED_SERIES.UNEMPLOYMENT,
    FRED_SERIES.OIL_WTI,
    FRED_SERIES.GOLD,
    FRED_SERIES.INITIAL_CLAIMS,
    FRED_SERIES.CONSUMER_SENTIMENT,
  ], apiKey);
}

/**
 * Get commodity prices from FRED
 */
export async function getCommodityPrices(apiKey: string): Promise<MacroIndicator[]> {
  return getMultipleSeries([
    FRED_SERIES.OIL_WTI,
    FRED_SERIES.GOLD,
    FRED_SERIES.NATURAL_GAS,
  ], apiKey);
}

/**
 * Check for yield curve inversion (recession signal)
 */
export async function checkYieldCurve(apiKey: string): Promise<{
  inverted: boolean;
  spread: number;
  signal: string;
} | null> {
  const spread = await getLatestValue(FRED_SERIES.YIELD_SPREAD, apiKey);
  if (!spread) return null;

  return {
    inverted: spread.value < 0,
    spread: spread.value,
    signal: spread.value < 0
      ? '⚠️ Yield curve INVERTED — recession risk elevated'
      : spread.value < 0.5
        ? '🟡 Yield curve flattening — watch closely'
        : '🟢 Yield curve normal',
  };
}

// ═══════════════════════════════════════════════════════════════
// GAP-026: Comprehensive Recession Indicator Dashboard
// ═══════════════════════════════════════════════════════════════

export interface RecessionIndicators {
  yieldCurveInverted: boolean;     // T10Y2Y < 0
  shortEndInverted: boolean;       // T10Y3M < 0
  creditSpreadWidening: boolean;   // BAA10Y > 3.0
  m2Contracting: boolean;          // M2 YoY change < 0
  claimsRising: boolean;           // ICSA > 300K
  recessionScore: number;          // 0-100 (higher = more risk)
  signals: string[];
}

/**
 * Comprehensive recession risk assessment using multiple FRED indicators.
 * Score 0-100: 0 = no risk, 100 = full recession conditions.
 */
export async function getRecessionIndicators(apiKey: string): Promise<RecessionIndicators | null> {
  const [yieldSpread, shortSpread, creditSpread, claims] = await Promise.all([
    getLatestValue(FRED_SERIES.YIELD_SPREAD, apiKey),
    getLatestValue(FRED_SERIES.YIELD_SPREAD_3M, apiKey),
    getLatestValue(FRED_SERIES.CREDIT_SPREAD, apiKey),
    getLatestValue(FRED_SERIES.INITIAL_CLAIMS, apiKey),
  ]);

  if (!yieldSpread && !shortSpread) return null;

  const yieldCurveInverted = (yieldSpread?.value ?? 1) < 0;
  const shortEndInverted = (shortSpread?.value ?? 1) < 0;
  const creditSpreadWidening = (creditSpread?.value ?? 2) > 3.0;
  const claimsRising = (claims?.value ?? 200) > 300;
  const m2Contracting = false; // M2 is monthly — change detection requires 2 values

  let score = 0;
  const signals: string[] = [];

  if (yieldCurveInverted) { score += 25; signals.push('🔴 10Y-2Y inverted'); }
  if (shortEndInverted) { score += 25; signals.push('🔴 10Y-3M inverted'); }
  if (creditSpreadWidening) { score += 20; signals.push(`🟡 Credit spread ${creditSpread?.value.toFixed(2)}% (>3%)`);}
  if (claimsRising) { score += 15; signals.push(`🟡 Initial claims ${(claims?.value ?? 0).toFixed(0)}K (>300K)`); }
  if (signals.length === 0) signals.push('🟢 No recession signals');

  return {
    yieldCurveInverted,
    shortEndInverted,
    creditSpreadWidening,
    m2Contracting,
    claimsRising,
    recessionScore: Math.min(100, score),
    signals,
  };
}
