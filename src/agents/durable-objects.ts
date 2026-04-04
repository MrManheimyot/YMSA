// ─── Durable Objects Stubs (GAP-022) ─────────────────────────
// ORCHESTRATOR and PORTFOLIO DurableObjectNamespace bindings are declared
// in types.ts but intentionally deferred to Phase 2 of the architecture.
//
// Phase 2 Plan:
//   ORCHESTRATOR — Stateful scan coordination across cron windows, ensuring
//     no duplicate signal processing when overlapping cron triggers fire.
//     Uses alarm() API for distributed timers.
//
//   PORTFOLIO — Real-time position tracking with WebSocket push to dashboard.
//     Maintains authoritative portfolio state in-memory with D1 persistence.
//     Eliminates D1 read overhead during high-frequency quote checks.
//
// These are optional enhancements. The current D1 + KV architecture handles
// all production workloads within the 5-minute CPU budget (Paid plan).
//
// To activate: Uncomment durable_objects section in wrangler.toml,
// implement the classes below, deploy with `wrangler deploy`.

import type { Env } from '../types';

/**
 * Check if Durable Objects are available in the current environment.
 */
export function isDurableObjectsAvailable(env: Env): boolean {
  return !!(env.ORCHESTRATOR && env.PORTFOLIO);
}

/**
 * Placeholder — will coordinate scan execution once ORCHESTRATOR is deployed.
 * Currently returns immediately (no-op).
 */
export async function acquireScanLock(_scanType: string, _env: Env): Promise<boolean> {
  // Phase 2: Use ORCHESTRATOR DO to prevent duplicate scan execution
  return true;
}

/**
 * Placeholder — will release scan lock once ORCHESTRATOR is deployed.
 */
export async function releaseScanLock(_scanType: string, _env: Env): Promise<void> {
  // Phase 2: Release ORCHESTRATOR DO lock
}
