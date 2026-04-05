// ─── Information Reliability Agent — Core Engine ──────────────
// Methodology: Google SRE "Four Golden Signals" adapted for
// information trust:
//   1. FRESHNESS  — Is the data current? (recency decay)
//   2. AGREEMENT  — Do multiple sources agree? (cross-validation)
//   3. PROVENANCE — Is the source itself healthy? (uptime, bias)
//   4. CONSISTENCY — Are indicators internally coherent? (contradiction detection)
//
// Integration: Runs BEFORE Z.AI validateTradeSetup(). Produces
// a ReliabilityVerdict that is injected into Z.AI's prompt so
// it can do evidence-weighted reasoning ("trust TV at 92%, ignore
// stale RSS at 31%") rather than binary accept/reject.

import type {
  DataSourceId, SourceProfile, SourceObservation,
  SourceReliabilityScore, ContradictionReport, RecencyAssessment,
  ReliabilityVerdict, ReliabilityAgentStats,
} from './types';
import { SOURCE_PROFILES, TRUST_WEIGHTS, TRUST_THRESHOLDS } from './config';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ReliabilityAgent');

// ═══════════════════════════════════════════════════════════════
// In-Memory Stats (resets each Worker lifecycle)
// ═══════════════════════════════════════════════════════════════

const agentStats: ReliabilityAgentStats = {
  totalAssessments: 0,
  avgTrustScore: 0,
  contradictionsDetected: 0,
  staleDataBlocked: 0,
  highTrustApprovals: 0,
  lowTrustRejections: 0,
  sourceAccuracyMap: {},
  lastResetAt: Date.now(),
};

// Rolling source accuracy (loaded from D1, updated per cycle)
const sourceAccuracy: Map<DataSourceId, number> = new Map();

/** Load historical source accuracy from D1 at cron start */
export async function loadSourceAccuracy(db: any): Promise<void> {
  if (!db) return;
  try {
    const rows = await db.prepare(
      `SELECT source_id, accuracy_rate FROM source_reliability
       WHERE date >= date('now', '-30 days')
       ORDER BY date DESC`
    ).all();
    const bySource = new Map<string, number[]>();
    for (const r of rows.results || []) {
      const arr = bySource.get(r.source_id as string) || [];
      arr.push(r.accuracy_rate as number);
      bySource.set(r.source_id as string, arr);
    }
    for (const [src, rates] of bySource) {
      const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
      sourceAccuracy.set(src as DataSourceId, avg);
      agentStats.sourceAccuracyMap[src] = Math.round(avg * 100);
    }
    logger.info(`Loaded source accuracy for ${bySource.size} sources`);
  } catch {
    // Table may not exist yet — graceful fallback
    logger.info('Source reliability table not yet created — using defaults');
  }
}

// ═══════════════════════════════════════════════════════════════
// 1. FRESHNESS SCORING
// ═══════════════════════════════════════════════════════════════

/**
 * Exponential decay: score = 100 × e^(-λt)
 * where λ = ln(2) / halfLife, t = age in ms
 * halfLife = source's expected refresh interval
 */
function scoreFreshness(obs: SourceObservation, profile: SourceProfile, now: number): number {
  const dataAge = now - (obs.dataTimestamp || obs.timestamp);
  if (dataAge <= 0) return 100;

  const halfLife = profile.refreshIntervalMs || 60_000;
  const lambda = Math.LN2 / halfLife;
  const score = 100 * Math.exp(-lambda * dataAge);

  // Hard floor: anything older than 4× refresh interval gets 0
  if (dataAge > halfLife * 4) return 0;

  return Math.round(Math.max(0, Math.min(100, score)));
}

// ═══════════════════════════════════════════════════════════════
// 2. AGREEMENT SCORING — Cross-Source Verification
// ═══════════════════════════════════════════════════════════════

/**
 * For PRICE sources: deviation-based (< 0.3% = 100, > 1.5% = 0)
 * For DIRECTION sources: consensus count / total
 * For SENTIMENT sources: agreement with majority direction
 */
function scoreAgreement(
  obs: SourceObservation,
  allObs: SourceObservation[],
  profile: SourceProfile,
): number {
  const peers = allObs.filter(o => o.sourceId !== obs.sourceId && o.symbol === obs.symbol);
  if (peers.length === 0) return 50; // no cross-validation possible, neutral

  if (profile.dataType === 'PRICE' && obs.price != null) {
    // Price agreement: compare absolute deviation
    const pricePeers = peers.filter(p => p.price != null);
    if (pricePeers.length === 0) return 50;

    const avgPrice = pricePeers.reduce((s, p) => s + p.price!, 0) / pricePeers.length;
    if (avgPrice === 0) return 50;
    const deviation = Math.abs(obs.price - avgPrice) / avgPrice;

    // Linear scale: 0% dev → 100, 1.5% dev → 0
    return Math.round(Math.max(0, Math.min(100, 100 - (deviation / 0.015) * 100)));
  }

  if (obs.direction || obs.sentiment) {
    // Direction/sentiment agreement
    const dir = obs.direction || obs.sentiment || 'NEUTRAL';
    const agreeCount = peers.filter(p => (p.direction || p.sentiment) === dir).length;
    return Math.round((agreeCount / peers.length) * 100);
  }

  // Indicator agreement: compare individual indicator values
  if (obs.indicators && Object.keys(obs.indicators).length > 0) {
    let matchCount = 0;
    let totalChecks = 0;
    for (const peer of peers) {
      if (!peer.indicators) continue;
      for (const [key, val] of Object.entries(obs.indicators)) {
        if (peer.indicators[key] != null) {
          totalChecks++;
          const peerVal = peer.indicators[key];
          // Within 10% tolerance
          if (Math.abs(val - peerVal) / (Math.abs(peerVal) || 1) < 0.10) {
            matchCount++;
          }
        }
      }
    }
    return totalChecks > 0 ? Math.round((matchCount / totalChecks) * 100) : 50;
  }

  return 50;
}

// ═══════════════════════════════════════════════════════════════
// 3. PROVENANCE SCORING — Source Health & Bias
// ═══════════════════════════════════════════════════════════════

function scoreProvenance(obs: SourceObservation, profile: SourceProfile): number {
  let score = profile.baseReliability;

  // Historical accuracy adjustment (from D1)
  const histAccuracy = sourceAccuracy.get(obs.sourceId);
  if (histAccuracy != null) {
    // Blend: 60% base + 40% historical
    score = Math.round(score * 0.6 + (histAccuracy * 100) * 0.4);
  }

  // Tier bonus: Tier 1 sources get benefit of the doubt
  if (profile.tier === 1) score = Math.min(100, score + 5);

  // Empty/null data penalty
  if (obs.price == null && obs.direction == null && obs.sentiment == null) {
    score = Math.max(0, score - 30);
  }

  return Math.round(Math.max(0, Math.min(100, score)));
}

// ═══════════════════════════════════════════════════════════════
// 4. CONTRADICTION DETECTION
// ═══════════════════════════════════════════════════════════════

function detectContradictions(observations: SourceObservation[]): ContradictionReport[] {
  const contradictions: ContradictionReport[] = [];
  const bySymbol = new Map<string, SourceObservation[]>();

  for (const obs of observations) {
    const arr = bySymbol.get(obs.symbol) || [];
    arr.push(obs);
    bySymbol.set(obs.symbol, arr);
  }

  for (const [, symObs] of bySymbol) {
    // 4a. Price divergence
    const priceObs = symObs.filter(o => o.price != null);
    for (let i = 0; i < priceObs.length; i++) {
      for (let j = i + 1; j < priceObs.length; j++) {
        const a = priceObs[i];
        const b = priceObs[j];
        const avgP = (a.price! + b.price!) / 2;
        if (avgP === 0) continue;
        const dev = Math.abs(a.price! - b.price!) / avgP;
        if (dev > 0.005) { // > 0.5% divergence
          const profileA = SOURCE_PROFILES[a.sourceId];
          const profileB = SOURCE_PROFILES[b.sourceId];
          const trustA = (profileA?.tier || 3) <= (profileB?.tier || 3);
          contradictions.push({
            type: 'PRICE_DIVERGENCE',
            severity: dev > 0.02 ? 'HIGH' : dev > 0.01 ? 'MEDIUM' : 'LOW',
            sourceA: a.sourceId,
            sourceB: b.sourceId,
            detail: `${a.sourceId} $${a.price!.toFixed(2)} vs ${b.sourceId} $${b.price!.toFixed(2)} (${(dev * 100).toFixed(2)}% gap)`,
            resolution: trustA ? 'TRUST_A' : 'TRUST_B',
            resolutionReason: trustA
              ? `${a.sourceId} is Tier ${profileA?.tier || '?'} (higher priority)`
              : `${b.sourceId} is Tier ${profileB?.tier || '?'} (higher priority)`,
          });
        }
      }
    }

    // 4b. Direction conflicts
    const dirObs = symObs.filter(o => o.direction && o.direction !== 'NEUTRAL');
    const bullish = dirObs.filter(o => o.direction === 'BULLISH');
    const bearish = dirObs.filter(o => o.direction === 'BEARISH');
    if (bullish.length > 0 && bearish.length > 0) {
      const majority = bullish.length >= bearish.length ? 'BULLISH' : 'BEARISH';
      const minority = majority === 'BULLISH' ? bearish : bullish;
      for (const m of minority) {
        const bestMajority = (majority === 'BULLISH' ? bullish : bearish)[0];
        contradictions.push({
          type: 'DIRECTION_CONFLICT',
          severity: minority.length >= dirObs.length / 2 ? 'HIGH' : 'MEDIUM',
          sourceA: bestMajority.sourceId,
          sourceB: m.sourceId,
          detail: `${bestMajority.sourceId} says ${majority} but ${m.sourceId} says ${majority === 'BULLISH' ? 'BEARISH' : 'BULLISH'}`,
          resolution: 'TRUST_A',
          resolutionReason: `Majority consensus (${Math.max(bullish.length, bearish.length)}/${dirObs.length}) favors ${majority}`,
        });
      }
    }

    // 4c. Stale vs fresh conflict
    const now = Date.now();
    const freshObs = symObs.filter(o => now - (o.dataTimestamp || o.timestamp) < 5 * 60 * 1000);
    const staleObs = symObs.filter(o => now - (o.dataTimestamp || o.timestamp) >= 30 * 60 * 1000);
    if (freshObs.length > 0 && staleObs.length > 0) {
      for (const stale of staleObs) {
        const fresh = freshObs[0];
        // Only flag if they disagree
        if (stale.direction && fresh.direction && stale.direction !== fresh.direction) {
          contradictions.push({
            type: 'STALE_VS_FRESH',
            severity: 'MEDIUM',
            sourceA: fresh.sourceId,
            sourceB: stale.sourceId,
            detail: `Fresh ${fresh.sourceId} (${Math.round((now - (fresh.dataTimestamp || fresh.timestamp)) / 60000)}min) says ${fresh.direction}, stale ${stale.sourceId} (${Math.round((now - (stale.dataTimestamp || stale.timestamp)) / 60000)}min) says ${stale.direction}`,
            resolution: 'TRUST_A',
            resolutionReason: `Fresher data takes precedence`,
          });
        }
      }
    }

    // 4d. Sentiment split (social vs news)
    const sentObs = symObs.filter(o => o.sentiment && o.sentiment !== 'NEUTRAL');
    const sentBullish = sentObs.filter(o => o.sentiment === 'BULLISH');
    const sentBearish = sentObs.filter(o => o.sentiment === 'BEARISH');
    if (sentBullish.length > 0 && sentBearish.length > 0) {
      contradictions.push({
        type: 'SENTIMENT_SPLIT',
        severity: 'LOW',
        sourceA: sentBullish[0].sourceId,
        sourceB: sentBearish[0].sourceId,
        detail: `${sentBullish.length} bullish vs ${sentBearish.length} bearish sentiment sources`,
        resolution: sentBullish.length > sentBearish.length ? 'TRUST_A' : 'TRUST_B',
        resolutionReason: `Majority sentiment wins (${Math.max(sentBullish.length, sentBearish.length)}/${sentObs.length})`,
      });
    }
  }

  return contradictions;
}

// ═══════════════════════════════════════════════════════════════
// 5. RECENCY ASSESSMENT
// ═══════════════════════════════════════════════════════════════

function assessRecency(observations: SourceObservation[]): RecencyAssessment {
  const now = Date.now();
  if (observations.length === 0) {
    return { oldestSourceAge: 0, freshestSourceAge: 0, medianAge: 0, allFresh: false, staleCount: 0, staleSources: [] };
  }

  const ages = observations.map(o => now - (o.dataTimestamp || o.timestamp));
  ages.sort((a, b) => a - b);

  const staleThreshold = 15 * 60 * 1000; // 15 min
  const staleSources: DataSourceId[] = [];
  for (const obs of observations) {
    const age = now - (obs.dataTimestamp || obs.timestamp);
    if (age > staleThreshold) staleSources.push(obs.sourceId);
  }

  return {
    oldestSourceAge: ages[ages.length - 1],
    freshestSourceAge: ages[0],
    medianAge: ages[Math.floor(ages.length / 2)],
    allFresh: staleSources.length === 0,
    staleCount: staleSources.length,
    staleSources,
  };
}

// ═══════════════════════════════════════════════════════════════
// 6. DIRECTION CONSENSUS
// ═══════════════════════════════════════════════════════════════

function computeDirectionConsensus(observations: SourceObservation[]) {
  let bullish = 0;
  let bearish = 0;
  let neutral = 0;

  for (const obs of observations) {
    const dir = obs.direction || obs.sentiment;
    if (dir === 'BULLISH') bullish++;
    else if (dir === 'BEARISH') bearish++;
    else neutral++;
  }

  const total = bullish + bearish + neutral;
  const maxDir = Math.max(bullish, bearish, neutral);
  let consensusDirection: 'BULLISH' | 'BEARISH' | 'MIXED' | 'NEUTRAL' = 'MIXED';
  if (bullish > bearish && bullish > neutral) consensusDirection = 'BULLISH';
  else if (bearish > bullish && bearish > neutral) consensusDirection = 'BEARISH';
  else if (neutral > bullish && neutral > bearish) consensusDirection = 'NEUTRAL';

  const consensusStrength = total > 0 ? Math.round((maxDir / total) * 100) : 0;

  return { bullish, bearish, neutral, total, consensusDirection, consensusStrength };
}

// ═══════════════════════════════════════════════════════════════
// 7. COMPOSITE TRUST SCORE
// ═══════════════════════════════════════════════════════════════

function computeTrustScore(
  sourceScores: SourceReliabilityScore[],
  contradictions: ContradictionReport[],
  recency: RecencyAssessment,
  consensus: { consensusStrength: number },
): number {
  if (sourceScores.length === 0) return 0;

  // Weighted average of per-source composites (tier-weighted)
  let weightedSum = 0;
  let totalWeight = 0;
  for (const ss of sourceScores) {
    const profile = SOURCE_PROFILES[ss.sourceId];
    const tierWeight = profile ? (4 - profile.tier) : 1; // Tier 1 = 3x, Tier 2 = 2x, Tier 3 = 1x
    weightedSum += ss.compositeScore * tierWeight;
    totalWeight += tierWeight;
  }
  let trust = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Contradiction penalty: -5 per LOW, -10 per MEDIUM, -20 per HIGH, -30 per CRITICAL
  const contraPenalties: Record<string, number> = { LOW: 5, MEDIUM: 10, HIGH: 20, CRITICAL: 30 };
  for (const c of contradictions) {
    trust -= contraPenalties[c.severity] || 5;
  }

  // Recency penalty: stale sources degrade trust
  if (recency.staleCount > 0) {
    trust -= recency.staleCount * 5;
  }

  // Consensus bonus: strong consensus boosts trust
  if (consensus.consensusStrength >= 80) trust += 5;
  else if (consensus.consensusStrength < 40) trust -= 10;

  return Math.round(Math.max(0, Math.min(100, trust)));
}

// ═══════════════════════════════════════════════════════════════
// PUBLIC: Assess reliability for a symbol
// ═══════════════════════════════════════════════════════════════

/**
 * Main entry point: given all observations for a symbol,
 * produce a ReliabilityVerdict.
 */
export function assessReliability(
  symbol: string,
  observations: SourceObservation[],
): ReliabilityVerdict {
  const now = Date.now();
  const symbolObs = observations.filter(o => o.symbol === symbol);

  // Score each source
  const sourceScores: SourceReliabilityScore[] = [];
  for (const obs of symbolObs) {
    const profile = SOURCE_PROFILES[obs.sourceId] || SOURCE_PROFILES.LOCAL_INDICATORS;
    const freshness = scoreFreshness(obs, profile, now);
    const agreement = scoreAgreement(obs, symbolObs, profile);
    const provenance = scoreProvenance(obs, profile);

    // Composite: weighted blend
    const composite = Math.round(
      freshness * TRUST_WEIGHTS.freshness +
      agreement * TRUST_WEIGHTS.agreement +
      provenance * TRUST_WEIGHTS.provenance
    );

    let penalty: string | null = null;
    if (freshness < 20) penalty = `STALE: data age exceeds acceptable window`;
    else if (agreement < 30) penalty = `OUTLIER: disagrees with ${symbolObs.length - 1} other sources`;
    else if (provenance < 40) penalty = `UNRELIABLE: source has low historical accuracy`;

    sourceScores.push({
      sourceId: obs.sourceId,
      freshnessScore: freshness,
      accuracyScore: provenance,
      agreementScore: agreement,
      provenanceScore: provenance,
      compositeScore: composite,
      penalty,
    });
  }

  // Detect contradictions
  const contradictions = detectContradictions(symbolObs);

  // Assess recency
  const recency = assessRecency(symbolObs);

  // Direction consensus
  const directionConsensus = computeDirectionConsensus(symbolObs);

  // Composite trust
  const trustScore = computeTrustScore(sourceScores, contradictions, recency, directionConsensus);

  // Trust tier
  let trustTier: ReliabilityVerdict['trustTier'] = 'MEDIUM';
  if (trustScore >= TRUST_THRESHOLDS.VERY_HIGH) trustTier = 'VERY_HIGH';
  else if (trustScore >= TRUST_THRESHOLDS.HIGH) trustTier = 'HIGH';
  else if (trustScore >= TRUST_THRESHOLDS.MEDIUM) trustTier = 'MEDIUM';
  else if (trustScore >= TRUST_THRESHOLDS.LOW) trustTier = 'LOW';
  else trustTier = 'UNTRUSTED';

  // Confidence multiplier
  let confidenceMultiplier = 1.0;
  if (trustTier === 'VERY_HIGH') confidenceMultiplier = 1.10;
  else if (trustTier === 'HIGH') confidenceMultiplier = 1.0;
  else if (trustTier === 'MEDIUM') confidenceMultiplier = 0.90;
  else if (trustTier === 'LOW') confidenceMultiplier = 0.70;
  else confidenceMultiplier = 0.50;

  // Summary for Z.AI prompt
  const topSources = sourceScores
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, 3)
    .map(s => `${s.sourceId}(${s.compositeScore})`)
    .join(', ');
  const contraStr = contradictions.length > 0
    ? `${contradictions.length} contradiction(s): ${contradictions.map(c => c.type).join(', ')}`
    : 'No contradictions';
  const summary = `Trust: ${trustScore}/100 (${trustTier}). Sources: ${topSources}. ${contraStr}. Consensus: ${directionConsensus.consensusDirection} (${directionConsensus.consensusStrength}%). Freshness: ${recency.allFresh ? 'ALL FRESH' : `${recency.staleCount} stale`}. Confidence multiplier: ${confidenceMultiplier.toFixed(2)}x.`;

  // Update stats
  agentStats.totalAssessments++;
  const prevAvg = agentStats.avgTrustScore;
  agentStats.avgTrustScore = prevAvg + (trustScore - prevAvg) / agentStats.totalAssessments;
  agentStats.contradictionsDetected += contradictions.length;
  if (recency.staleCount > 0) agentStats.staleDataBlocked++;
  if (trustTier === 'VERY_HIGH' || trustTier === 'HIGH') agentStats.highTrustApprovals++;
  if (trustTier === 'LOW' || trustTier === 'UNTRUSTED') agentStats.lowTrustRejections++;

  return {
    symbol,
    timestamp: now,
    trustScore,
    trustTier,
    sourceScores,
    contradictions,
    recency,
    directionConsensus,
    summary,
    confidenceMultiplier,
  };
}

// ═══════════════════════════════════════════════════════════════
// Z.AI Integration — Format verdict for LLM prompt injection
// ═══════════════════════════════════════════════════════════════

/**
 * Produces a concise block of text to inject into Z.AI's
 * validateTradeSetup prompt so it can reason about source trust.
 */
export function formatForZAi(verdict: ReliabilityVerdict): string {
  const lines: string[] = [
    `INFORMATION RELIABILITY ASSESSMENT (${verdict.symbol}):`,
    `Trust Score: ${verdict.trustScore}/100 (${verdict.trustTier})`,
    `Confidence Multiplier: ${verdict.confidenceMultiplier.toFixed(2)}x`,
    `Direction Consensus: ${verdict.directionConsensus.consensusDirection} (${verdict.directionConsensus.consensusStrength}% strength, ${verdict.directionConsensus.total} sources)`,
  ];

  // Top/bottom sources
  const sorted = [...verdict.sourceScores].sort((a, b) => b.compositeScore - a.compositeScore);
  if (sorted.length > 0) {
    lines.push(`Most Trusted: ${sorted[0].sourceId} (${sorted[0].compositeScore}/100)`);
    if (sorted.length > 1) {
      const worst = sorted[sorted.length - 1];
      if (worst.compositeScore < 50) {
        lines.push(`Least Trusted: ${worst.sourceId} (${worst.compositeScore}/100)${worst.penalty ? ' — ' + worst.penalty : ''}`);
      }
    }
  }

  // Contradictions
  if (verdict.contradictions.length > 0) {
    lines.push(`Contradictions (${verdict.contradictions.length}):`);
    for (const c of verdict.contradictions.slice(0, 3)) {
      lines.push(`  - ${c.type} [${c.severity}]: ${c.detail} → ${c.resolution} (${c.resolutionReason})`);
    }
  }

  // Recency
  if (!verdict.recency.allFresh) {
    lines.push(`Stale Sources (${verdict.recency.staleCount}): ${verdict.recency.staleSources.join(', ')}`);
  }

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════
// Stats Access
// ═══════════════════════════════════════════════════════════════

export function getReliabilityStats(): ReliabilityAgentStats {
  return { ...agentStats };
}

export function resetReliabilityStats(): void {
  agentStats.totalAssessments = 0;
  agentStats.avgTrustScore = 0;
  agentStats.contradictionsDetected = 0;
  agentStats.staleDataBlocked = 0;
  agentStats.highTrustApprovals = 0;
  agentStats.lowTrustRejections = 0;
  agentStats.lastResetAt = Date.now();
}

// ═══════════════════════════════════════════════════════════════
// D1 Persistence — Record source performance for learning
// ═══════════════════════════════════════════════════════════════

export async function persistSourcePerformance(
  db: any,
  sourceId: DataSourceId,
  date: string,
  totalSignals: number,
  correctSignals: number,
  avgFreshnessMs: number,
  avgAgreement: number,
  bullishBiasPct: number,
): Promise<void> {
  if (!db) return;
  try {
    await db.prepare(
      `INSERT OR REPLACE INTO source_reliability
       (source_id, date, total_signals, correct_signals, accuracy_rate,
        avg_freshness_ms, avg_agreement_score, bullish_bias_pct, downtime_minutes, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).bind(
      sourceId, date, totalSignals, correctSignals,
      totalSignals > 0 ? correctSignals / totalSignals : 0,
      avgFreshnessMs, avgAgreement, bullishBiasPct, Date.now(),
    ).run();
  } catch (err) {
    logger.error(`Failed to persist source performance for ${sourceId}:`, err);
  }
}
