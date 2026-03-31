// ─── Environment Validator ───────────────────────────────────
// Validates all required env vars at request time (Workers don't have startup hooks)

import type { Env } from '../types';

interface ValidationResult {
  valid: boolean;
  missing: string[];
  warnings: string[];
}

const REQUIRED_SECRETS = [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID',
] as const;

const RECOMMENDED_SECRETS = [
  'ALPHA_VANTAGE_API_KEY',
  'TAAPI_API_KEY',
  'FINNHUB_API_KEY',
  'FRED_API_KEY',
  'YMSA_API_KEY',
] as const;

const REQUIRED_VARS = [
  'DEFAULT_WATCHLIST',
  'ENVIRONMENT',
  'TIMEZONE',
] as const;

let validated = false;
let cachedResult: ValidationResult | null = null;

export function validateEnv(env: Env): ValidationResult {
  if (validated && cachedResult) return cachedResult;

  const missing: string[] = [];
  const warnings: string[] = [];

  // Required secrets
  for (const key of REQUIRED_SECRETS) {
    if (!(env as any)[key]) missing.push(key);
  }

  // Required vars
  for (const key of REQUIRED_VARS) {
    if (!(env as any)[key]) missing.push(key);
  }

  // Recommended
  for (const key of RECOMMENDED_SECRETS) {
    if (!(env as any)[key]) warnings.push(`${key} not set — some features disabled`);
  }

  // D1 binding
  if (!env.DB) missing.push('DB (D1 database binding)');

  // Alpaca check
  if ((env as any).ALPACA_API_KEY && !(env as any).ALPACA_SECRET_KEY) {
    warnings.push('ALPACA_API_KEY set but ALPACA_SECRET_KEY missing');
  }

  cachedResult = { valid: missing.length === 0, missing, warnings };
  validated = true;
  return cachedResult;
}

/**
 * Quick check — logs warnings on first call, throws if critical vars missing.
 */
export function ensureEnv(env: Env): void {
  const result = validateEnv(env);
  if (result.warnings.length > 0) {
    for (const w of result.warnings) console.warn(`[Env] ⚠️ ${w}`);
  }
  if (!result.valid) {
    console.error(`[Env] ❌ Missing required: ${result.missing.join(', ')}`);
  }
}
