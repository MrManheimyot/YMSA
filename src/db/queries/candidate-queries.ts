// ─── Scan Candidate Queries ──────────────────────────────────
// D1 CRUD for scan_candidates table — universe expansion pipeline

export interface ScanCandidate {
  id: string;
  symbol: string;
  source: string;
  direction: string | null;
  score: number;
  price: number | null;
  change_pct: number | null;
  volume: number | null;
  volume_ratio: number | null;
  rsi: number | null;
  market_cap: number | null;
  sector: string | null;
  reason: string | null;
  discovered_at: number;
  scan_date: string;
  promoted: number;
  evaluated: number;
}

/**
 * Insert or update a scan candidate.
 * Uses UPSERT on (symbol, scan_date, source) to avoid duplicates per scan day.
 */
export async function insertCandidate(
  db: D1Database,
  symbol: string,
  source: string,
  opts: {
    direction?: string | null;
    score?: number;
    price?: number | null;
    changePct?: number | null;
    volume?: number | null;
    volumeRatio?: number | null;
    rsi?: number | null;
    marketCap?: number | null;
    sector?: string | null;
    reason?: string | null;
  } = {},
): Promise<void> {
  const scanDate = new Date().toISOString().split('T')[0];
  const id = `cand_${symbol}_${source}_${scanDate}`;
  const score = opts.score ?? computeCandidateScore(opts);

  await db.prepare(
    `INSERT INTO scan_candidates
       (id, symbol, source, direction, score, price, change_pct, volume, volume_ratio, rsi, market_cap, sector, reason, discovered_at, scan_date, promoted, evaluated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
     ON CONFLICT(symbol, scan_date, source) DO UPDATE SET
       score = MAX(scan_candidates.score, excluded.score),
       price = excluded.price,
       change_pct = excluded.change_pct,
       volume = excluded.volume,
       volume_ratio = excluded.volume_ratio,
       rsi = excluded.rsi,
       reason = excluded.reason,
       discovered_at = excluded.discovered_at`
  ).bind(
    id, symbol, source,
    opts.direction ?? null,
    score,
    opts.price ?? null,
    opts.changePct ?? null,
    opts.volume ?? null,
    opts.volumeRatio ?? null,
    opts.rsi ?? null,
    opts.marketCap ?? null,
    opts.sector ?? null,
    opts.reason ?? null,
    Date.now(),
    scanDate,
  ).run();
}

/**
 * Batch insert candidates (more efficient for bulk TV/FinViz results).
 */
export async function insertCandidatesBatch(
  db: D1Database,
  candidates: Array<{
    symbol: string;
    source: string;
    direction?: string | null;
    score?: number;
    price?: number | null;
    changePct?: number | null;
    volume?: number | null;
    volumeRatio?: number | null;
    rsi?: number | null;
    marketCap?: number | null;
    sector?: string | null;
    reason?: string | null;
  }>,
): Promise<number> {
  let inserted = 0;
  const scanDate = new Date().toISOString().split('T')[0];
  const stmt = db.prepare(
    `INSERT INTO scan_candidates
       (id, symbol, source, direction, score, price, change_pct, volume, volume_ratio, rsi, market_cap, sector, reason, discovered_at, scan_date, promoted, evaluated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
     ON CONFLICT(symbol, scan_date, source) DO UPDATE SET
       score = MAX(scan_candidates.score, excluded.score),
       price = excluded.price,
       change_pct = excluded.change_pct,
       volume = excluded.volume,
       volume_ratio = excluded.volume_ratio,
       rsi = excluded.rsi,
       reason = excluded.reason,
       discovered_at = excluded.discovered_at`
  );

  // D1 batch limit is 100 statements
  const batchSize = 50;
  for (let i = 0; i < candidates.length; i += batchSize) {
    const chunk = candidates.slice(i, i + batchSize);
    const stmts = chunk.map(c => {
      const id = `cand_${c.symbol}_${c.source}_${scanDate}`;
      const score = c.score ?? computeCandidateScore(c);
      return stmt.bind(
        id, c.symbol, c.source,
        c.direction ?? null,
        score,
        c.price ?? null,
        c.changePct ?? null,
        c.volume ?? null,
        c.volumeRatio ?? null,
        c.rsi ?? null,
        c.marketCap ?? null,
        c.sector ?? null,
        c.reason ?? null,
        Date.now(),
        scanDate,
      );
    });
    await db.batch(stmts);
    inserted += chunk.length;
  }

  return inserted;
}

/**
 * Promote top N candidates for today (or a given date) to the full pipeline.
 * Sorts by score DESC, promotes up to `limit`.
 * Returns promoted symbols.
 */
export async function promoteTopCandidates(
  db: D1Database,
  limit: number = 50,
  scanDate?: string,
): Promise<string[]> {
  const date = scanDate ?? new Date().toISOString().split('T')[0];

  // Get best unique symbols by max score across sources
  const result = await db.prepare(
    `SELECT symbol, MAX(score) as best_score
     FROM scan_candidates
     WHERE scan_date = ? AND promoted = 0
     GROUP BY symbol
     ORDER BY best_score DESC
     LIMIT ?`
  ).bind(date, limit).all();

  const symbols = ((result.results || []) as Array<{ symbol: string }>).map(r => r.symbol);
  if (symbols.length === 0) return [];

  // Mark all entries for promoted symbols — batch to stay within D1's 100-binding limit
  const batchSize = 80; // 80 symbols + 1 date = 81 bindings (under D1's 100 limit)
  for (let i = 0; i < symbols.length; i += batchSize) {
    const chunk = symbols.slice(i, i + batchSize);
    const placeholders = chunk.map(() => '?').join(',');
    await db.prepare(
      `UPDATE scan_candidates SET promoted = 1
       WHERE scan_date = ? AND symbol IN (${placeholders})`
    ).bind(date, ...chunk).run();
  }

  return symbols;
}

/**
 * Get promoted candidates for a given date (for full pipeline scan).
 */
export async function getPromotedCandidates(
  db: D1Database,
  scanDate?: string,
): Promise<string[]> {
  const date = scanDate ?? new Date().toISOString().split('T')[0];

  const result = await db.prepare(
    `SELECT DISTINCT symbol FROM scan_candidates
     WHERE scan_date = ? AND promoted = 1
     ORDER BY score DESC`
  ).bind(date).all();

  return ((result.results || []) as Array<{ symbol: string }>).map(r => r.symbol);
}

/**
 * Get candidate stats for a given date.
 */
export async function getCandidateStats(
  db: D1Database,
  scanDate?: string,
): Promise<{
  total: number;
  promoted: number;
  evaluated: number;
  bySources: Record<string, number>;
  topScorers: Array<{ symbol: string; score: number; source: string }>;
}> {
  const date = scanDate ?? new Date().toISOString().split('T')[0];

  const [totalRes, promotedRes, evaluatedRes, sourceRes, topRes] = await Promise.all([
    db.prepare(`SELECT COUNT(DISTINCT symbol) as cnt FROM scan_candidates WHERE scan_date = ?`).bind(date).first(),
    db.prepare(`SELECT COUNT(DISTINCT symbol) as cnt FROM scan_candidates WHERE scan_date = ? AND promoted = 1`).bind(date).first(),
    db.prepare(`SELECT COUNT(DISTINCT symbol) as cnt FROM scan_candidates WHERE scan_date = ? AND evaluated = 1`).bind(date).first(),
    db.prepare(`SELECT source, COUNT(DISTINCT symbol) as cnt FROM scan_candidates WHERE scan_date = ? GROUP BY source`).bind(date).all(),
    db.prepare(
      `SELECT symbol, MAX(score) as score, source FROM scan_candidates
       WHERE scan_date = ? GROUP BY symbol ORDER BY score DESC LIMIT 10`
    ).bind(date).all(),
  ]);

  const bySources: Record<string, number> = {};
  for (const r of ((sourceRes.results || []) as any[])) {
    bySources[r.source] = r.cnt;
  }

  return {
    total: (totalRes as any)?.cnt ?? 0,
    promoted: (promotedRes as any)?.cnt ?? 0,
    evaluated: (evaluatedRes as any)?.cnt ?? 0,
    bySources,
    topScorers: ((topRes.results || []) as any[]).map(r => ({
      symbol: r.symbol,
      score: r.score,
      source: r.source,
    })),
  };
}

/**
 * Mark symbols as evaluated (after full pipeline scan).
 */
export async function markCandidatesEvaluated(
  db: D1Database,
  symbols: string[],
  scanDate?: string,
): Promise<void> {
  if (symbols.length === 0) return;
  const date = scanDate ?? new Date().toISOString().split('T')[0];
  // Batch to stay within D1's 100-binding limit
  const batchSize = 80;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const chunk = symbols.slice(i, i + batchSize);
    const placeholders = chunk.map(() => '?').join(',');
    await db.prepare(
      `UPDATE scan_candidates SET evaluated = 1
       WHERE scan_date = ? AND symbol IN (${placeholders})`
    ).bind(date, ...chunk).run();
  }
}

/**
 * Clean old candidates (retention: N days).
 */
export async function cleanOldCandidates(
  db: D1Database,
  daysOld: number = 7,
): Promise<number> {
  const cutoff = new Date(Date.now() - daysOld * 86400000).toISOString().split('T')[0];
  const result = await db.prepare(
    `DELETE FROM scan_candidates WHERE scan_date < ?`
  ).bind(cutoff).run();
  return result.meta?.changes ?? 0;
}

// ─── Internal Scoring ────────────────────────────────────────

/**
 * Compute a composite score for a candidate based on available data.
 * Score: 0-100, higher = stronger candidate for promotion.
 */
function computeCandidateScore(data: {
  changePct?: number | null;
  volumeRatio?: number | null;
  rsi?: number | null;
  marketCap?: number | null;
}): number {
  let score = 30; // base

  // Momentum: large moves get higher scores
  const absPct = Math.abs(data.changePct ?? 0);
  if (absPct > 8) score += 25;
  else if (absPct > 5) score += 20;
  else if (absPct > 3) score += 15;
  else if (absPct > 1) score += 8;

  // Volume confirmation: relative volume is key
  const relVol = data.volumeRatio ?? 1;
  if (relVol > 5) score += 20;
  else if (relVol > 3) score += 15;
  else if (relVol > 2) score += 10;
  else if (relVol > 1.5) score += 5;

  // RSI extremes: oversold/overbought
  const rsi = data.rsi ?? 50;
  if (rsi < 25 || rsi > 75) score += 15;
  else if (rsi < 30 || rsi > 70) score += 10;
  else if (rsi < 35 || rsi > 65) score += 5;

  // Market cap: prefer liquid large-caps for execution
  const cap = data.marketCap ?? 0;
  if (cap > 50e9) score += 10;
  else if (cap > 10e9) score += 7;
  else if (cap > 1e9) score += 3;

  return Math.min(100, score);
}
