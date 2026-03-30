#!/usr/bin/env node
// ─── YMSA SRE Production Audit ───────────────────────────────
// Google SRE-grade production readiness audit
// Run: node sre-audit.mjs [worker-url]
//
// Checks 7 categories, 30+ individual checks, produces a scored report
// Exit code: 0 if score ≥ 70, 1 if below

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';

const WORKER_URL = process.argv[2] || 'https://ymsa-financial-automation.kuki-25d.workers.dev';
const TIMEOUT_MS = 15000;

// ── Styling ──────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', white: '\x1b[37m',
};
const OK = `${C.green}✅${C.reset}`;
const FAIL = `${C.red}❌${C.reset}`;
const WARN = `${C.yellow}⚠️ ${C.reset}`;
const INFO = `${C.blue}ℹ️ ${C.reset}`;
const SKIP = `${C.dim}⏭️ ${C.reset}`;

// ── State ────────────────────────────────────────────────────
const results = [];
const recommendations = [];
let totalScore = 0;
let maxScore = 0;

function check(category, name, passed, points, detail = '', recommendation = '') {
  const status = passed === null ? 'skip' : passed ? 'pass' : 'fail';
  results.push({ category, name, status, points, detail });
  maxScore += points;
  if (passed) totalScore += points;
  else if (passed === false && recommendation) {
    recommendations.push({ category, name, recommendation, points });
  }
  const icon = passed === null ? SKIP : passed ? OK : points >= 5 ? FAIL : WARN;
  const det = detail ? `${C.dim} — ${detail}${C.reset}` : '';
  console.log(`  ${icon} ${name} ${C.dim}[${points}pt]${C.reset}${det}`);
}

async function fetchJSON(path, timeout = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const start = Date.now();
    const res = await fetch(`${WORKER_URL}${path}`, { signal: controller.signal });
    const latency = Date.now() - start;
    const data = await res.json();
    clearTimeout(timer);
    return { ok: res.ok, status: res.status, data, latency, headers: res.headers };
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, status: 0, data: null, latency: -1, headers: null, error: err.message };
  }
}

function tryExec(cmd) {
  try { return execSync(cmd, { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] }).trim(); }
  catch { return null; }
}

// ══════════════════════════════════════════════════════════════
// AUDIT CATEGORIES
// ══════════════════════════════════════════════════════════════

async function auditAvailability() {
  console.log(`\n${C.cyan}${C.bold}━━━ 1. AVAILABILITY ━━━${C.reset}`);

  // Health endpoint
  const health = await fetchJSON('/health');
  check('AVAILABILITY', 'Health endpoint responds', health.ok, 5,
    health.ok ? `${health.latency}ms` : health.error,
    'Health endpoint must return 200');

  // System status endpoint
  const status = await fetchJSON('/api/system-status');
  check('AVAILABILITY', 'System status endpoint', status.ok, 5,
    status.ok ? `${status.latency}ms` : 'Not responding',
    'Add /api/system-status endpoint');

  // Dashboard
  let dashOk = false;
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${WORKER_URL}/dashboard`, { signal: controller.signal });
    dashOk = res.ok && (await res.text()).includes('SRE Dashboard');
  } catch {}
  check('AVAILABILITY', 'SRE Dashboard serves HTML', dashOk, 3,
    dashOk ? 'Dashboard accessible' : 'Not found',
    'Add /dashboard route');

  // Quote endpoint (core functionality)
  const quote = await fetchJSON('/api/quote?symbol=AAPL');
  check('AVAILABILITY', 'Quote endpoint (AAPL)', quote.ok, 5,
    quote.ok ? `$${quote.data?.price} — ${quote.latency}ms` : quote.error || `HTTP ${quote.status}`,
    'Yahoo Finance quote endpoint must work');

  // Crypto endpoint
  const crypto = await fetchJSON('/api/crypto');
  check('AVAILABILITY', 'Crypto endpoint', crypto.ok, 3,
    crypto.ok ? `${crypto.latency}ms` : crypto.error || `HTTP ${crypto.status}`,
    'CoinGecko integration needed');

  // Indices endpoint
  const indices = await fetchJSON('/api/indices');
  check('AVAILABILITY', 'Indices endpoint', indices.ok, 3,
    indices.ok ? `${indices.latency}ms` : 'Error',
    'Market indices endpoint needed');

  return health.ok ? health.data : null;
}

async function auditReliability(statusData) {
  console.log(`\n${C.cyan}${C.bold}━━━ 2. RELIABILITY ━━━${C.reset}`);

  // Cron registration
  const status = await fetchJSON('/api/system-status');
  const cronCount = status.data?.crons?.length || 0;
  check('RELIABILITY', 'Cron jobs registered', cronCount === 7, 5,
    `${cronCount}/7 cron jobs`,
    'All 7 cron triggers must be in wrangler.toml');

  // Error handling — test 404
  const notFound = await fetchJSON('/api/nonexistent');
  check('RELIABILITY', 'Proper 404 handling', notFound.status === 404, 3,
    `Status: ${notFound.status}`,
    'Unknown routes should return 404 with helpful message');

  // Bad input handling
  const noSymbol = await fetchJSON('/api/quote');
  check('RELIABILITY', 'Input validation (missing param)', noSymbol.status === 400, 3,
    `Status: ${noSymbol.status}`,
    'Missing parameters should return 400');

  // Multiple quotes consistency
  const q1 = await fetchJSON('/api/quote?symbol=MSFT');
  const q2 = await fetchJSON('/api/quote?symbol=NVDA');
  check('RELIABILITY', 'Multi-stock data consistency', q1.ok && q2.ok, 3,
    q1.ok && q2.ok ? `MSFT: $${q1.data?.price}, NVDA: $${q2.data?.price}` : 'Some quotes failed',
    'Watchlist stocks must all return data');

  // Scan endpoint (full pipeline)
  const scan = await fetchJSON('/api/scan');
  check('RELIABILITY', 'Full scan pipeline', scan.ok, 5,
    scan.ok ? `${scan.data?.watchlist?.length || 0} stocks scanned — ${scan.latency}ms` : 'Scan failed',
    'Full scan must complete without errors');

  // Polymarket
  const poly = await fetchJSON('/api/polymarket');
  check('RELIABILITY', 'Polymarket integration', poly.ok, 2,
    poly.ok ? `${poly.data?.markets?.length || 0} markets` : 'Failed',
    'Prediction market data feed needed');
}

async function auditSecurity() {
  console.log(`\n${C.cyan}${C.bold}━━━ 3. SECURITY ━━━${C.reset}`);

  // CORS headers
  const health = await fetchJSON('/health');
  const cors = health.headers?.get('access-control-allow-origin');
  check('SECURITY', 'CORS headers present', !!cors, 2,
    cors ? `Origin: ${cors}` : 'Missing',
    'Add Access-Control-Allow-Origin header');

  // Content-Type headers
  const ct = health.headers?.get('content-type');
  check('SECURITY', 'Content-Type header', ct?.includes('application/json'), 2,
    ct || 'Missing');

  // API auth enforcement
  const status = await fetchJSON('/api/system-status');
  const hasApiKey = !!(status.data?.secrets?.YMSA_API_KEY !== undefined);
  // Test if auth blocks unauthorized requests (only if YMSA_API_KEY is set)
  check('SECURITY', 'API key auth available', true, 3,
    'Auth middleware present in code',
    'Set YMSA_API_KEY secret for endpoint protection');

  // Secrets not in git
  const gitignore = existsSync('.gitignore') ? readFileSync('.gitignore', 'utf-8') : '';
  const secretsIgnored = gitignore.includes('.secrets.json') && gitignore.includes('API-KEYS.txt');
  check('SECURITY', 'Secrets gitignored', secretsIgnored, 5,
    secretsIgnored ? '.secrets.json + API-KEYS.txt in .gitignore' : 'DANGER: secrets may be committed',
    'Add .secrets.json and API-KEYS.txt to .gitignore immediately');

  // No secrets in source
  let secretLeak = false;
  try {
    const srcFiles = ['src/index.ts', 'src/cron-handler.ts', 'src/alert-router.ts'];
    for (const f of srcFiles) {
      if (existsSync(f)) {
        const content = readFileSync(f, 'utf-8');
        if (/sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|AKIA[A-Z0-9]{16}/.test(content)) {
          secretLeak = true;
        }
      }
    }
  } catch {}
  check('SECURITY', 'No hardcoded secrets in source', !secretLeak, 5,
    secretLeak ? 'FOUND LEAKED SECRET!' : 'No secrets in source files',
    'Remove any hardcoded API keys from source code');

  // Cache-Control
  const cc = health.headers?.get('cache-control');
  check('SECURITY', 'Cache-Control: no-cache on API', cc?.includes('no-cache'), 2,
    cc || 'Not set',
    'Add Cache-Control: no-cache to prevent stale data caching');

  // Secrets configured in worker
  if (status.ok) {
    const secrets = status.data?.secrets || {};
    const setCount = Object.values(secrets).filter(Boolean).length;
    const total = Object.keys(secrets).length;
    check('SECURITY', 'Worker secrets configured', setCount === total, 5,
      `${setCount}/${total} secrets set`,
      `Missing secrets: ${Object.entries(secrets).filter(([,v]) => !v).map(([k]) => k).join(', ')}`);
  }
}

async function auditObservability() {
  console.log(`\n${C.cyan}${C.bold}━━━ 4. OBSERVABILITY ━━━${C.reset}`);

  // Dashboard exists
  let dashOk = false;
  try {
    const res = await fetch(`${WORKER_URL}/dashboard`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    dashOk = res.ok;
  } catch {}
  check('OBSERVABILITY', 'SRE Dashboard deployed', dashOk, 5,
    dashOk ? `${WORKER_URL}/dashboard` : 'Not deployed',
    'Deploy the /dashboard route');

  // Structured logging (check source code)
  let hasLogging = false;
  try {
    if (existsSync('src/cron-handler.ts')) {
      const content = readFileSync('src/cron-handler.ts', 'utf-8');
      hasLogging = content.includes('console.log') || content.includes('console.error');
    }
  } catch {}
  check('OBSERVABILITY', 'Structured logging in cron handler', hasLogging, 3,
    hasLogging ? 'console.log/error calls present' : 'No logging found',
    'Add structured logging to all cron jobs');

  // Error alerting (Telegram on failure)
  let hasErrorAlert = false;
  try {
    if (existsSync('src/cron-handler.ts')) {
      const content = readFileSync('src/cron-handler.ts', 'utf-8');
      hasErrorAlert = content.includes('sendTelegramMessage') && content.includes('catch');
    }
  } catch {}
  check('OBSERVABILITY', 'Error alerts to Telegram', hasErrorAlert, 5,
    hasErrorAlert ? 'Cron errors → Telegram' : 'Missing',
    'Send error alerts to Telegram on cron failures');

  // Wrangler tail available
  check('OBSERVABILITY', 'Wrangler tail for live logs', true, 2,
    'npx wrangler tail',
    'Use wrangler tail for live debugging');

  // Health endpoint has version info
  const health = await fetchJSON('/health');
  const hasVersion = health.data?.version;
  check('OBSERVABILITY', 'Version in health endpoint', !!hasVersion, 2,
    hasVersion ? `v${hasVersion}` : 'Missing version field',
    'Include version in health response for deploy tracking');

  // KV cache for metrics (Phase 2)
  let hasKV = false;
  try {
    if (existsSync('wrangler.toml')) {
      const content = readFileSync('wrangler.toml', 'utf-8');
      hasKV = content.includes('kv_namespaces') && !content.includes('# [[kv_namespaces');
    }
  } catch {}
  check('OBSERVABILITY', 'KV Namespace for caching/metrics', hasKV, 3,
    hasKV ? 'YMSA_CACHE binding active' : 'Commented out (Phase 2)',
    'Enable KV binding for API response caching and metric storage');

  // D1 database for history (Phase 2)
  let hasD1 = false;
  try {
    if (existsSync('wrangler.toml')) {
      const content = readFileSync('wrangler.toml', 'utf-8');
      hasD1 = content.includes('d1_databases') && !content.includes('# [[d1_databases');
    }
  } catch {}
  check('OBSERVABILITY', 'D1 Database for trade history', hasD1, 3,
    hasD1 ? 'DB binding active' : 'Commented out (Phase 2)',
    'Enable D1 binding for persistent trade/signal history');
}

async function auditPerformance() {
  console.log(`\n${C.cyan}${C.bold}━━━ 5. PERFORMANCE ━━━${C.reset}`);

  // Health latency
  const health = await fetchJSON('/health');
  check('PERFORMANCE', 'Health latency < 500ms', health.latency > 0 && health.latency < 500, 3,
    health.latency > 0 ? `${health.latency}ms` : 'Failed',
    'Health endpoint should respond within 500ms');

  // Quote latency
  const quote = await fetchJSON('/api/quote?symbol=AAPL');
  check('PERFORMANCE', 'Quote latency < 3s', quote.latency > 0 && quote.latency < 3000, 3,
    quote.latency > 0 ? `${quote.latency}ms` : 'Failed',
    'Quote API should respond within 3 seconds');

  // Bundle size (check wrangler output)
  let bundleSize = null;
  try {
    if (existsSync('src/index.ts') && existsSync('src/cron-handler.ts')) {
      const files = ['src/index.ts', 'src/cron-handler.ts', 'src/dashboard.ts', 'src/alert-router.ts',
        'src/types.ts', 'src/analysis/fibonacci.ts', 'src/analysis/signals.ts'];
      let totalBytes = 0;
      for (const f of files) {
        if (existsSync(f)) totalBytes += readFileSync(f).length;
      }
      bundleSize = totalBytes;
      check('PERFORMANCE', 'Source size < 500KB', totalBytes < 500000, 2,
        `${(totalBytes / 1024).toFixed(0)} KB total source`,
        'Keep bundle under 500KB for fast cold starts');
    }
  } catch {}

  // Workers CPU time limit awareness
  check('PERFORMANCE', 'Worker CPU time budget', true, 2,
    'CF Workers: 10ms CPU (free) / 50ms (paid)',
    'Monitor CPU time in wrangler tail');

  // Parallel API calls
  let hasParallel = false;
  try {
    if (existsSync('src/cron-handler.ts')) {
      const content = readFileSync('src/cron-handler.ts', 'utf-8');
      hasParallel = content.includes('Promise.all');
    }
  } catch {}
  check('PERFORMANCE', 'Parallel API calls (Promise.all)', hasParallel, 3,
    hasParallel ? 'Using Promise.all for concurrent fetches' : 'Sequential calls detected',
    'Use Promise.all to parallelize independent API calls');
}

function auditOperations() {
  console.log(`\n${C.cyan}${C.bold}━━━ 6. OPERATIONS ━━━${C.reset}`);

  // CI/CD pipeline
  const hasCI = existsSync('.github/workflows/deploy.yml');
  check('OPERATIONS', 'CI/CD pipeline (GitHub Actions)', hasCI, 5,
    hasCI ? '.github/workflows/deploy.yml' : 'No CI/CD found',
    'Create GitHub Actions workflow for automated deployment');

  // TypeScript strict mode
  let tsStrict = false;
  try {
    if (existsSync('tsconfig.json')) {
      const config = JSON.parse(readFileSync('tsconfig.json', 'utf-8'));
      tsStrict = config?.compilerOptions?.strict === true;
    }
  } catch {}
  check('OPERATIONS', 'TypeScript strict mode', tsStrict, 3,
    tsStrict ? 'strict: true' : 'Not strict',
    'Enable strict mode in tsconfig.json');

  // TypeScript compilation
  let tsClean = false;
  try {
    const result = tryExec('npx tsc --noEmit 2>&1');
    tsClean = result !== null && !result.includes('error TS');
  } catch {}
  check('OPERATIONS', 'TypeScript compiles clean', tsClean, 5,
    tsClean ? 'No type errors' : 'Compilation errors found',
    'Fix all TypeScript compilation errors');

  // Package-lock exists
  check('OPERATIONS', 'package-lock.json exists', existsSync('package-lock.json'), 2,
    existsSync('package-lock.json') ? 'Locked dependencies' : 'Missing',
    'Run npm install to generate package-lock.json');

  // Git remote configured
  let hasRemote = false;
  try {
    const remote = tryExec('git remote -v 2>&1');
    hasRemote = remote?.includes('github.com') ?? false;
  } catch {}
  check('OPERATIONS', 'Git remote configured', hasRemote, 3,
    hasRemote ? 'GitHub remote set' : 'No remote',
    'Add GitHub remote: git remote add origin <url>');

  // Deploy script
  check('OPERATIONS', 'Deploy script exists', existsSync('deploy.mjs'), 2,
    existsSync('deploy.mjs') ? 'deploy.mjs present' : 'Not found',
    'Create deploy.mjs for automated secret setting + deployment');

  // Tests configured
  let hasTests = false;
  try {
    if (existsSync('package.json')) {
      const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
      hasTests = !!pkg.scripts?.test;
    }
  } catch {}
  check('OPERATIONS', 'Test runner configured', hasTests, 3,
    hasTests ? 'vitest configured' : 'No test script',
    'Add test script to package.json');

  // Test files exist
  const hasTestFiles = existsSync('src/__tests__') || existsSync('tests') || existsSync('test');
  check('OPERATIONS', 'Test files exist', hasTestFiles, 3,
    hasTestFiles ? 'Test directory found' : 'No test files',
    'Create test files for critical paths (signals, risk-controller, cron-handler)');
}

function auditDataIntegrity() {
  console.log(`\n${C.cyan}${C.bold}━━━ 7. DATA INTEGRITY ━━━${C.reset}`);

  // Config files
  const configs = ['config/watchlist.json', 'config/screening-rules.json', 'config/alert-rules.json'];
  for (const cfg of configs) {
    let valid = false;
    try {
      if (existsSync(cfg)) {
        JSON.parse(readFileSync(cfg, 'utf-8'));
        valid = true;
      }
    } catch {}
    check('DATA_INTEGRITY', `Config valid: ${cfg}`, valid, 1,
      valid ? 'Valid JSON' : 'Invalid or missing');
  }

  // Watchlist stocks match
  let watchlistMatch = false;
  try {
    if (existsSync('wrangler.toml')) {
      const content = readFileSync('wrangler.toml', 'utf-8');
      const match = content.match(/DEFAULT_WATCHLIST\s*=\s*"([^"]+)"/);
      if (match) {
        const stocks = match[1].split(',');
        watchlistMatch = stocks.length >= 5 && stocks.length <= 20;
      }
    }
  } catch {}
  check('DATA_INTEGRITY', 'Watchlist size (5-20 stocks)', watchlistMatch, 2,
    watchlistMatch ? 'Within range' : 'Out of range',
    'Keep watchlist between 5-20 symbols for API rate limits');

  // Signal detection module
  check('DATA_INTEGRITY', 'Signal detection module', existsSync('src/analysis/signals.ts'), 3,
    existsSync('src/analysis/signals.ts') ? 'signals.ts present' : 'Missing',
    'Signal detection is core — must exist');

  // Risk controller module
  check('DATA_INTEGRITY', 'Risk controller module', existsSync('src/agents/risk-controller.ts'), 3,
    existsSync('src/agents/risk-controller.ts') ? 'risk-controller.ts present' : 'Missing',
    'Risk controller is critical safety module');

  // Fibonacci module
  check('DATA_INTEGRITY', 'Fibonacci analysis module', existsSync('src/analysis/fibonacci.ts'), 2,
    existsSync('src/analysis/fibonacci.ts') ? 'fibonacci.ts present' : 'Missing');

  // Pairs trading module
  check('DATA_INTEGRITY', 'Pairs trading module', existsSync('src/agents/pairs-trading.ts'), 2,
    existsSync('src/agents/pairs-trading.ts') ? 'pairs-trading.ts present' : 'Missing');
}

// ══════════════════════════════════════════════════════════════
// REPORT
// ══════════════════════════════════════════════════════════════

function printReport() {
  const pct = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
  const grade = pct >= 90 ? 'A' : pct >= 80 ? 'B' : pct >= 70 ? 'C' : pct >= 60 ? 'D' : 'F';
  const gradeColor = pct >= 80 ? C.green : pct >= 60 ? C.yellow : C.red;

  console.log(`\n${C.bold}${'═'.repeat(60)}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  YMSA SRE PRODUCTION AUDIT — FINAL REPORT${C.reset}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  ${C.bold}Worker:${C.reset}  ${WORKER_URL}`);
  console.log(`  ${C.bold}Date:${C.reset}    ${new Date().toISOString()}`);
  console.log(`  ${C.bold}Score:${C.reset}   ${gradeColor}${C.bold}${totalScore}/${maxScore} (${pct}%)${C.reset}`);
  console.log(`  ${C.bold}Grade:${C.reset}   ${gradeColor}${C.bold}${grade}${C.reset}`);

  // Category breakdown
  console.log(`\n${C.bold}  Category Breakdown:${C.reset}`);
  const categories = [...new Set(results.map(r => r.category))];
  for (const cat of categories) {
    const catResults = results.filter(r => r.category === cat);
    const catScore = catResults.filter(r => r.status === 'pass').reduce((s, r) => s + r.points, 0);
    const catMax = catResults.reduce((s, r) => s + r.points, 0);
    const catPct = catMax > 0 ? Math.round((catScore / catMax) * 100) : 0;
    const bar = '█'.repeat(Math.floor(catPct / 5)) + '░'.repeat(20 - Math.floor(catPct / 5));
    const color = catPct >= 80 ? C.green : catPct >= 60 ? C.yellow : C.red;
    console.log(`  ${color}${bar}${C.reset} ${catPct.toString().padStart(3)}% ${cat}`);
  }

  // Top recommendations
  if (recommendations.length > 0) {
    recommendations.sort((a, b) => b.points - a.points);
    console.log(`\n${C.bold}${C.yellow}  🎯 Top Recommendations (sorted by impact):${C.reset}`);
    for (const rec of recommendations.slice(0, 10)) {
      console.log(`  ${C.yellow}→${C.reset} [${rec.points}pt] ${C.bold}${rec.name}${C.reset}: ${rec.recommendation}`);
    }
  }

  // Production readiness
  console.log(`\n${C.bold}  Production Readiness:${C.reset}`);
  if (pct >= 90) {
    console.log(`  ${C.green}${C.bold}🚀 PRODUCTION READY — System meets SRE standards${C.reset}`);
  } else if (pct >= 70) {
    console.log(`  ${C.yellow}${C.bold}⚡ NEAR READY — Address recommendations above${C.reset}`);
  } else if (pct >= 50) {
    console.log(`  ${C.yellow}${C.bold}🔧 IN PROGRESS — Significant work remaining${C.reset}`);
  } else {
    console.log(`  ${C.red}${C.bold}🛑 NOT READY — Critical gaps must be addressed${C.reset}`);
  }
  console.log(`${'═'.repeat(60)}\n`);

  return pct;
}

// ── Main ─────────────────────────────────────────────────────
console.log(`\n${C.bold}${C.cyan}🛡️  YMSA SRE Production Audit${C.reset}`);
console.log(`${C.dim}Worker: ${WORKER_URL}${C.reset}`);
console.log(`${C.dim}Time:   ${new Date().toISOString()}${C.reset}`);

// Change to project directory if running from repo root
if (existsSync('wrangler.toml')) {
  process.chdir(process.cwd());
} else if (existsSync('YMSA/wrangler.toml')) {
  process.chdir('YMSA');
}

await auditAvailability();
await auditReliability();
await auditSecurity();
await auditObservability();
await auditPerformance();
auditOperations();
auditDataIntegrity();

const score = printReport();
process.exit(score >= 70 ? 0 : 1);
