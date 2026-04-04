---
name: ymsa-sre-security-hardening
description: Security audit and hardening for YMSA — OWASP Top 10, API key protection, auth bypass prevention, injection defense
---

# YMSA SRE Security Hardening

You are an expert in application security. When the user asks about security, vulnerabilities, auth issues, or OWASP compliance, use this skill. Based on OWASP Top 10 (2025/2026), Cloudflare Workers security best practices, and financial system security requirements.

## Security Architecture

### Authentication Layers (Defense in Depth)

| Layer | Mechanism | Protects | Implementation |
|-------|-----------|----------|----------------|
| **Layer 1** | Google Sign-In OAuth 2.0 | Dashboard web access | auth.ts — whitelist of 3 emails |
| **Layer 2** | HMAC session tokens | Session continuity | 7-day TTL, SESSION_SECRET |
| **Layer 3** | API key (X-API-Key / ?key=) | API endpoints | YMSA_API_KEY wrangler secret |

### Auth Flow
```
Browser → /auth/google → Google OAuth → validate email ∈ whitelist → HMAC session cookie → /dashboard
API client → X-API-Key header or ?key= param → validate against YMSA_API_KEY → /api/*
Cron job → Internal (no auth needed — Cloudflare triggers directly)
```

## OWASP Top 10 Compliance

### A01: Broken Access Control
| Check | Status | Details |
|-------|--------|---------|
| Dashboard auth required | ✅ | Google OAuth + email whitelist |
| API key on all endpoints | ✅ | X-API-Key or session cookie required |
| No horizontal privilege escalation | ✅ | Single-tenant system |
| CORS properly configured | ⚠️ Review | Ensure CORS restricts to known origins |
| Rate limiting on auth endpoints | ⚠️ Recommend | Add rate limit on /auth/* |

### A02: Cryptographic Failures
| Check | Status | Details |
|-------|--------|---------|
| API keys not in source code | ✅ | Stored as Cloudflare secrets |
| HMAC for session tokens | ✅ | SESSION_SECRET used for signing |
| HTTPS only | ✅ | Cloudflare Workers enforce HTTPS |
| No secrets in logs | ⚠️ Audit | Verify console.log never prints API keys |
| API keys rotated regularly | ⚠️ Recommend | Quarterly rotation schedule |

### A03: Injection
| Check | Status | Details |
|-------|--------|---------|
| SQL injection (D1) | ✅ | Using parameterized queries (`.bind()`) |
| XSS in dashboard | ⚠️ Review | Dashboard renders HTML — verify all user data is escaped |
| Command injection | ✅ | No shell execution in Workers |
| Header injection | ✅ | Hono sanitizes headers |

### A04: Insecure Design
| Check | Status | Details |
|-------|--------|---------|
| Kill switch is deterministic | ✅ | No AI in risk path (by design) |
| Financial limits enforced server-side | ✅ | Max 20 positions, 10% per position, etc. |
| No trust of client-side data | ✅ | All limits checked in risk-controller.ts |
| Signal pipeline integrity | ✅ | No track = no send (commit 4b76209) |

### A05: Security Misconfiguration
| Check | Status | Details |
|-------|--------|---------|
| Error messages don't leak internals | ⚠️ Review | Ensure 500 errors return generic message |
| Debug endpoints disabled in prod | ⚠️ Check | `/api/trigger` should be auth-gated |
| Unused API routes removed | ✅ | All routes serve a purpose |
| wrangler.toml reviewed | ✅ | No unexpected bindings |

### A06: Vulnerable Components
| Check | Status | Details |
|-------|--------|---------|
| Dependencies up to date | ⚠️ Audit | Run `npm audit` periodically |
| Hono version current | ✅ | v4.7 |
| No known CVEs in deps | ⚠️ Check | `npm audit --production` |

### A07: Authentication Failures
| Check | Status | Details |
|-------|--------|---------|
| Session timeout | ✅ | 7-day TTL on HMAC tokens |
| No default credentials | ✅ | API key is unique per deployment |
| Google OAuth verified | ✅ | Email whitelist prevents unauthorized access |
| Brute force protection | ⚠️ Recommend | Add rate limiting on auth endpoints |

### A08: Data Integrity Failures
| Check | Status | Details |
|-------|--------|---------|
| Input validation | ✅ | 3-layer data validation (data-validator.ts) |
| Signal integrity | ✅ | ≥2 engines must agree, D1 audit trail |
| Trade execution verification | ✅ | Broker response validated |
| Serialization attacks | ✅ | JSON only, no deserialization of untrusted objects |

### A09: Logging & Monitoring Failures
| Check | Status | Details |
|-------|--------|---------|
| Auth events logged | ⚠️ Recommend | Log all login attempts (success + failure) |
| Risk events tracked | ✅ | D1 risk_events table |
| Failed API calls logged | ✅ | Circuit breaker tracks failures |
| Alerting on security events | ⚠️ Recommend | Alert on repeated auth failures |

### A10: Server-Side Request Forgery (SSRF)
| Check | Status | Details |
|-------|--------|---------|
| External URLs validated | ✅ | Only calling known API domains (Yahoo, Alpaca, etc.) |
| No user-controlled URLs | ✅ | All API endpoints are hardcoded |
| Internal services not exposed | ✅ | Workers don't have internal network access |

## Security Hardening Recommendations

### Priority 1: Immediate
```typescript
// 1. Add rate limiting on auth endpoints
import { rateLimit } from 'hono/rate-limit'; // or custom implementation

app.use('/auth/*', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10, // 10 attempts per window
}));

// 2. Sanitize error responses
app.onError((err, c) => {
  console.error(JSON.stringify({
    level: 'ERROR',
    path: c.req.path,
    error: err.message, // Log full error internally
  }));
  return c.json({ error: 'Internal server error' }, 500); // Generic to client
});

// 3. Add security headers
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  c.header('Content-Security-Policy', "default-src 'self'");
});
```

### Priority 2: Short-term
- Audit all `console.log` for leaked secrets/API keys
- Add request ID to all logs for correlation
- Implement API key scoping (read-only vs admin)
- Add `npm audit` to pre-deploy checklist

### Priority 3: Medium-term
- Implement IP allowlisting for API access
- Add Telegram alert for failed auth attempts
- Create security-focused stress tests
- Document security incident response plan

## Sensitive Data Inventory

| Data Type | Location | Protection |
|-----------|----------|------------|
| API keys (3rd party) | Cloudflare Secrets | Encrypted at rest, never in logs |
| Alpaca credentials | Cloudflare Secrets | Encrypted, paper/live separation |
| Telegram bot token | Cloudflare Secrets | Encrypted |
| Session tokens | In-flight (cookie) | HMAC signed, 7-day expiry |
| Trade data | D1 database | Cloudflare-managed encryption at rest |
| Portfolio positions | D1 + Alpaca | Encrypted in transit (HTTPS) |
| User email (Google OAuth) | In-flight only | Not persisted, only checked against whitelist |

## Security Audit Commands

```bash
# Check for hardcoded secrets in source
grep -rn "sk-\|api_key\|secret\|password\|token" src/ --include="*.ts" | grep -v "process.env\|env\.\|Secret\|TOKEN\|KEY"

# Check npm dependencies for vulnerabilities
npm audit --production

# List all Cloudflare secrets (names only, not values)
npx wrangler secret list

# Verify CORS configuration (should not be *)
grep -rn "cors\|CORS\|origin" src/ --include="*.ts"
```

## Usage Examples
```
"Run a security audit"
"Check for OWASP vulnerabilities"
"Are there any hardcoded secrets?"
"Audit the authentication flow"
"Add rate limiting to the API"
"What sensitive data do we store?"
"Review CORS configuration"
```
