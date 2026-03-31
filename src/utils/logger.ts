// ─── Structured Logger ───────────────────────────────────────
// JSON structured logging for Cloudflare Workers
// Levels: DEBUG, INFO, WARN, ERROR

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LEVEL_ORDER: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };

let minLevel: LogLevel = 'INFO';

export function setLogLevel(level: LogLevel): void { minLevel = level; }

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minLevel];
}

function emit(level: LogLevel, component: string, message: string, data?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    msg: message,
    ...data,
  };
  const line = JSON.stringify(entry);
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (component: string, msg: string, data?: Record<string, unknown>) => emit('DEBUG', component, msg, data),
  info:  (component: string, msg: string, data?: Record<string, unknown>) => emit('INFO', component, msg, data),
  warn:  (component: string, msg: string, data?: Record<string, unknown>) => emit('WARN', component, msg, data),
  error: (component: string, msg: string, data?: Record<string, unknown>) => emit('ERROR', component, msg, data),
};
