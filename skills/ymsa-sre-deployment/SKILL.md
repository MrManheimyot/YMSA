---
name: ymsa-sre-deployment
description: Safe deployment, rollback, canary release, and production change management for YMSA Cloudflare Workers
---

# YMSA SRE Deployment & Release Engineering

You are an expert Google SRE release engineer. When the user asks about deploying, rolling back, managing secrets, or production changes, use this skill. Based on Google SRE Ch.8 (Release Engineering) and Cloudflare Workers deployment docs.

## Deployment Pipeline

### Pre-Deploy Checklist
```
□ TypeScript compiles clean: node .\node_modules\typescript\bin\tsc --noEmit
□ All 110 tests pass: node .\node_modules\vitest\vitest.mjs run
□ No new lint warnings in changed files
□ wrangler.toml reviewed (no accidental config changes)
□ Secrets unchanged (or intentionally rotated)
□ D1 migrations applied if schema changed
□ CHANGELOG updated for significant changes
□ Git status clean, committed to master
```

### Deploy Command
```powershell
# Set PATH for Node.js, Git, and GitHub CLI
$env:PATH = "C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Program Files\GitHub CLI;" + $env:PATH

# Navigate to project
cd c:\Users\yotam\Downloads\YMSA\YMSA

# Step 1: Type check
node .\node_modules\typescript\bin\tsc --noEmit

# Step 2: Run tests
node .\node_modules\vitest\vitest.mjs run

# Step 3: Deploy
node .\node_modules\wrangler\bin\wrangler.js deploy

# Step 4: Smoke test
Invoke-RestMethod "https://ymsa-financial-automation.kuki-25d.workers.dev/api/system-status?key=ymsa-debug-key-2026"

# Step 5: Verify crons still work
Invoke-RestMethod -Uri "https://ymsa-financial-automation.kuki-25d.workers.dev/api/trigger?job=quick&key=ymsa-debug-key-2026" -Method POST
```

### Post-Deploy Verification
```powershell
# 1. System status check
Invoke-RestMethod "https://ymsa-financial-automation.kuki-25d.workers.dev/api/system-status?key=ymsa-debug-key-2026"

# 2. Dashboard loads
Start-Process "https://ymsa-financial-automation.kuki-25d.workers.dev/dashboard?key=ymsa-debug-key-2026"

# 3. Tail for errors (watch for 2-3 minutes)
npx wrangler tail ymsa-financial-automation --status error --format pretty

# 4. Verify D1 connectivity
Invoke-RestMethod "https://ymsa-financial-automation.kuki-25d.workers.dev/api/daily-pnl?key=ymsa-debug-key-2026"

# 5. Check engine budgets survived deploy (cold start test)
Invoke-RestMethod "https://ymsa-financial-automation.kuki-25d.workers.dev/api/engine-stats?key=ymsa-debug-key-2026"
```

## Rollback Procedures

### Quick Rollback (< 2 minutes)
```bash
# List recent deployments
npx wrangler deployments list

# Rollback to previous version
npx wrangler rollback

# Verify
curl "https://ymsa-financial-automation.kuki-25d.workers.dev/api/system-status?key=ymsa-debug-key-2026"
```

### Git-Based Rollback
```bash
# Find last known good commit
git log --oneline -10

# Reset to known good
git checkout <commit-hash>

# Deploy that version
node .\node_modules\wrangler\bin\wrangler.js deploy

# Return to master
git checkout master
```

### D1 Migration Rollback
```bash
# D1 migrations are NOT auto-reversible
# Always create a reverse migration BEFORE applying forward migration

# Example: If you added a column
# Forward: ALTER TABLE signals ADD COLUMN new_field TEXT;
# Reverse: (D1 doesn't support DROP COLUMN — must rebuild table)

# For critical changes, backup first:
wrangler d1 export ymsa-prod --local --output backup-$(date +%Y%m%d).sql
```

## Secret Management

### Current Secrets
| Secret | Purpose | Rotation Schedule |
|--------|---------|-------------------|
| YMSA_API_KEY | Dashboard/API auth | Quarterly |
| TELEGRAM_BOT_TOKEN | Alert delivery | On compromise only |
| TELEGRAM_CHAT_ID | Alert channel target | On channel change |
| ALPHA_VANTAGE_API_KEY | Technical data | Annual |
| TAAPI_SECRET | Indicator data | Annual |
| FINNHUB_API_KEY | News/earnings | Annual |
| FRED_API_KEY | Macro data | Annual |
| ALPACA_API_KEY | Broker auth | Quarterly |
| ALPACA_SECRET_KEY | Broker auth | Quarterly |
| GOOGLE_CLIENT_ID | OAuth login | On compromise only |
| GOOGLE_CLIENT_SECRET | OAuth login | On compromise only |
| SESSION_SECRET | HMAC sessions | Quarterly |

### Rotate a Secret
```bash
# Update secret (prompts for value)
npx wrangler secret put SECRET_NAME

# Verify worker picks it up (deploys new version)
curl "https://ymsa-financial-automation.kuki-25d.workers.dev/api/system-status?key=ymsa-debug-key-2026"
```

### Bulk Secret Deployment
```powershell
# Use set-secrets.mjs for initial setup
node set-secrets.mjs
```

## Safe Change Categories

| Change Type | Risk | Deploy Strategy | Rollback Plan |
|-------------|------|----------------|---------------|
| Bug fix (no schema change) | Low | Direct deploy | `wrangler rollback` |
| New API endpoint | Low | Direct deploy | `wrangler rollback` |
| Cron schedule change | Medium | Deploy + verify in tail | `wrangler rollback` |
| D1 schema migration | High | Backup → Migrate → Deploy → Verify | Reverse migration SQL |
| Confidence threshold change | High | Deploy + manual trigger + verify | `wrangler rollback` |
| Kill switch parameter change | Critical | Deploy → Test with sim data → Verify | `wrangler rollback` immediately |
| API key rotation | Medium | `wrangler secret put` → Smoke test | Restore old key |
| New external API integration | Medium | Deploy + circuit breaker naturally protects | `wrangler rollback` |

## Deploy Windows

| Window | Time (IST) | Time (UTC) | Risk Level | Notes |
|--------|-----------|------------|------------|-------|
| **Best** | 23:00-05:00 | 21:00-03:00 | Low | Markets closed, minimal crons |
| **Acceptable** | 05:00-07:30 | 03:00-05:30 | Medium | Pre-market, morning brief cron at 07:30 |
| **Avoid** | 17:00-00:30 | 14:30-22:00 | High | Market hours, all crons active |
| **Never** | 17:00-17:30 | 14:30-15:00 | Critical | Market open scan window |

## Wrangler Configuration Reference (wrangler.toml)
Key settings that affect deployment:
- `compatibility_date` — Workers runtime version (test before updating)
- `[triggers] crons` — All 13 cron schedules
- `[[d1_databases]]` — Database binding (do NOT change database_id)
- `[vars]` — Non-secret environment variables

## Usage Examples
```
"Deploy the latest changes"
"Rollback to the previous version"
"Rotate the Alpaca API keys"
"Is it safe to deploy right now?"
"Run the pre-deploy checklist"
"What secrets need rotation?"
```
