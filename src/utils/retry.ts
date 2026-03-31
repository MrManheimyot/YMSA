// ─── Retry + Circuit Breaker ─────────────────────────────────
// Exponential backoff with jitter + per-service circuit breaker

interface CircuitState {
  failures: number;
  lastFailure: number;
  open: boolean;
}

const circuits = new Map<string, CircuitState>();
const CIRCUIT_THRESHOLD = 5;       // failures before opening
const CIRCUIT_RESET_MS = 60_000;   // 1 min cooldown

/**
 * Retry a function with exponential backoff + circuit breaker.
 * @param service  Name of the service (for circuit breaker grouping)
 * @param fn       Async function to execute
 * @param retries  Max retries (default 2)
 * @param baseMs   Base delay in ms (default 500)
 */
export async function withRetry<T>(
  service: string,
  fn: () => Promise<T>,
  retries = 2,
  baseMs = 500,
): Promise<T> {
  // Circuit breaker check
  const circuit = circuits.get(service);
  if (circuit?.open) {
    if (Date.now() - circuit.lastFailure > CIRCUIT_RESET_MS) {
      circuit.open = false;
      circuit.failures = 0;
    } else {
      throw new Error(`[CircuitBreaker] ${service} is OPEN — skipping call`);
    }
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await fn();
      // Success: reset circuit
      if (circuit) { circuit.failures = 0; circuit.open = false; }
      return result;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        const delay = baseMs * Math.pow(2, attempt) + Math.random() * 200;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  // All retries failed: update circuit
  const state = circuits.get(service) ?? { failures: 0, lastFailure: 0, open: false };
  state.failures++;
  state.lastFailure = Date.now();
  if (state.failures >= CIRCUIT_THRESHOLD) state.open = true;
  circuits.set(service, state);

  throw lastError;
}

/**
 * Safe fetch with timeout. Returns null on failure instead of throwing.
 */
export async function safeFetch(
  url: string,
  init?: RequestInit,
  timeoutMs = 10_000,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
