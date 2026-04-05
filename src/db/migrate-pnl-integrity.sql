-- ═══ P&L Integrity Migration — April 2026 ═══
-- Adds gate_status column to telegram_alerts for approval tracking.
-- Rejected signals no longer contaminate the simulator or P&L tables.

-- Add gate_status: PENDING_REVIEW → APPROVED / REJECTED
ALTER TABLE telegram_alerts ADD COLUMN gate_status TEXT DEFAULT 'APPROVED';

-- Index for simulator queries that filter by gate_status
CREATE INDEX IF NOT EXISTS idx_tg_alerts_gate ON telegram_alerts(gate_status);

-- Mark all existing PENDING alerts that have NO alert_text as REJECTED
-- (They were logged at step 1b but never passed the gates → never got Telegram text)
UPDATE telegram_alerts
  SET gate_status = 'REJECTED'
  WHERE outcome = 'PENDING'
    AND (alert_text IS NULL OR alert_text = '');
