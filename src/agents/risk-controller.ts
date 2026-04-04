// ─── Risk Controller — Barrel ─────────────────────────────────

export {
  DEFAULT_RISK_LIMITS, checkRisk, shouldActivateKillSwitch,
  calculateExposure, calculateSectorExposure,
  formatRiskAlert, vixRiskAdjustment, correlationCheck, formatRiskEvent,
} from './risk-controller/risk-checker';

export type { TieredKillSwitch } from './risk-controller/kill-switch';
export { evaluateKillSwitch, evaluateAndPersistKillSwitch, loadKillSwitchState } from './risk-controller/kill-switch';

export type { EngineBudgetRebalance, EngineProbation } from './risk-controller/engine-budgets';
export {
  ENGINE_BUDGETS, loadPersistedBudgets, checkEngineBudget,
  rebalanceEngineBudgets, formatBudgetRebalance,
  evaluateEngineProbation, formatProbationReport, isOnProbation,
} from './risk-controller/engine-budgets';
