// ─── D1 Database Query Layer (barrel) ────────────────────────
// Re-exports from sub-modules for backward-compatible imports

export { TradeRecord, PositionRecord, SignalRecord, DailyPnlRecord, EnginePerformanceRecord, KillSwitchState, TelegramAlertRecord, generateId } from './queries/types';
export { insertTrade, closeTrade, getOpenTrades, cancelTrade, getTradesByEngine, getRecentTrades, getClosedTradesSince, updateTrailingState, updateTradeQty, upsertPosition, deletePosition, getOpenPositions, getPositionBySymbol } from './queries/trade-queries';
export { insertSignal, getRecentSignals, getSignalsByEngine, upsertEnginePerformance, getEnginePerformance, getAllLatestEnginePerformance, upsertEngineBudget, loadEngineBudgets } from './queries/signal-engine-queries';
export { upsertDailyPnl, getDailyPnlRange, getRecentDailyPnl, getPnlDashboardData } from './queries/pnl-queries';
export { insertRegimeChange, getLatestRegime, insertRiskEvent, getRecentRiskEvents, getRecentNewsAlerts, getNewsAlertsByCategory, getKillSwitchState, upsertKillSwitchState } from './queries/system-queries';
export { insertTelegramAlert, updateTelegramAlertOutcome, getRecentTelegramAlerts, getTelegramAlertById, getTelegramAlertStats, getPendingTelegramAlerts, expireOldTelegramAlerts } from './queries/telegram-queries';
export { loadConfig, getConfig, getAllConfig, setConfig, applyTier, TIER_PRESETS } from './queries/config-queries';
export { insertRSSItem, updateRSSSentiment, getRecentRSSItems, getRSSItemsForSymbol, insertTVScannerSnapshot, getLatestTVSnapshot, insertSocialSentiment, getLatestSentiment, getRecentSentimentAll, updateFeedHealth, getFeedHealthReport } from './queries/superpower-queries';
export { insertCandidate, insertCandidatesBatch, promoteTopCandidates, getPromotedCandidates, getCandidateStats, markCandidatesEvaluated, cleanOldCandidates } from './queries/candidate-queries';
export type { ScanCandidate } from './queries/candidate-queries';
