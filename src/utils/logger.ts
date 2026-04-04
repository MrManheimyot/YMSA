// ─── Structured Logger ───────────────────────────────────────
// JSON structured logging for Cloudflare Workers
// Levels: DEBUG, INFO, WARN, ERROR, FATAL

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

const LEVEL_ORDER: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 };

let minLevel: LogLevel = 'INFO';
const recentErrors: Array<{ ts: string; module: string; msg: string; error?: string }> = [];

export function setLogLevel(level: LogLevel): void { minLevel = level; }

export function getRecentErrors(): typeof recentErrors {
  return recentErrors.slice(-50);
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

function emit(level: LogLevel, component: string, message: string, data?: Record<string, unknown>, err?: unknown): void {
  if (!shouldLog(level)) return;
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    component,
    msg: message,
    ...data,
  };
  if (err instanceof Error) {
    entry.error = err.message;
    entry.stack = err.stack?.split('\n').slice(0, 3).join(' | ');
  } else if (err) {
    entry.error = String(err);
  }

  // Track recent errors for health endpoint
  if (level === 'ERROR' || level === 'FATAL') {
    recentErrors.push({ ts: entry.ts as string, module: component, msg: message, error: entry.error as string | undefined });
    if (recentErrors.length > 50) recentErrors.shift();
  }

  const line = JSON.stringify(entry);
  if (level === 'FATAL' || level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (component: string, msg: string, data?: Record<string, unknown>) => emit('DEBUG', component, msg, data),
  info:  (component: string, msg: string, data?: Record<string, unknown>) => emit('INFO', component, msg, data),
  warn:  (component: string, msg: string, data?: Record<string, unknown>) => emit('WARN', component, msg, data),
  error: (component: string, msg: string, data?: Record<string, unknown>, err?: unknown) => emit('ERROR', component, msg, data, err),
  fatal: (component: string, msg: string, data?: Record<string, unknown>, err?: unknown) => emit('FATAL', component, msg, data, err),
};

export function createLogger(module: string) {
  return {
    debug: (msg: string, data?: Record<string, unknown>) => emit('DEBUG', module, msg, data),
    info:  (msg: string, data?: Record<string, unknown>) => emit('INFO', module, msg, data),
    warn:  (msg: string, data?: Record<string, unknown>) => emit('WARN', module, msg, data),
    error: (msg: string, err?: unknown, data?: Record<string, unknown>) => emit('ERROR', module, msg, data, err),
    fatal: (msg: string, err?: unknown, data?: Record<string, unknown>) => emit('FATAL', module, msg, data, err),
  };
}

/**
 * Error boundary — wraps async function with structured error capture.
 * Returns defaultValue on error, logs to structured logger.
 */
export async function withErrorBoundary<T>(
  module: string,
  operation: string,
  fn: () => Promise<T>,
  defaultValue: T,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    emit('ERROR', module, `${operation} failed`, undefined, err);
    return defaultValue;
  }
}
