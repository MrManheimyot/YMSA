// ─── Smart Broker Manager — Barrel ────────────────────────────
// Re-exports from modular sub-modules under ./broker-manager/

export type { EngineOutput, MessagePlan, MergedTrade } from './broker-manager/types';
export { beginCycle, setRegime, addContext, pushEngineOutput, getCycleOutputs, getCycleRegime, getCycleContext, getCycleIndicators, getCycleVolumeRatios, getCycleSignalScores, setCycleVolumeRatio, setCycleSignalScore, isCyclePending, resetCycle, canSendTradeAlert, recordTradeAlert, wasSentRecently, markSent } from './broker-manager/cycle-state';
export { mergeBySymbol } from './broker-manager/merge-and-plan';
export { pushAndRecordSignal, pushSmartMoney, pushMTF, pushTechnical, pushStatArb, pushCryptoDefi, pushEventDriven, pushOptions } from './broker-manager/engine-adapters';
export { flushCycle } from './broker-manager/flush-cycle';
export { sendRiskAlert, sendExecutionAlert } from './broker-manager/telegram';
