// ─── Google Auth + Session Management ────────────────────────
// Google Sign-In token verification + HMAC session cookies
// Whitelist: only specific emails can access the system

import type { Env } from './types';

// ═══════════════════════════════════════════════════════════════
// Authorized Users (hardcoded whitelist)
// ═══════════════════════════════════════════════════════════════

const ALLOWED_EMAILS: Set<string> = new Set([
  'yotam.manheim@gmail.com',
  'ygalerlich@gmail.com',
  'reedlora798@gmail.com',
]);

// ═══════════════════════════════════════════════════════════════
// Google ID Token Verification
// ═══════════════════════════════════════════════════════════════

interface GoogleTokenInfo {
  email: string;
  email_verified: string;
  name?: string;
  picture?: string;
  sub: string;
  aud: string;
  exp: string;
}

/**
 * Verify a Google ID token via Google's tokeninfo endpoint.
 * Returns the user's email if valid, null otherwise.
 */
async function verifyGoogleToken(idToken: string): Promise<GoogleTokenInfo | null> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );
    if (!res.ok) return null;
    const data = await res.json() as GoogleTokenInfo;
    if (data.email_verified !== 'true') return null;
    return data;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// Session Tokens (HMAC-signed, stateless)
// ═══════════════════════════════════════════════════════════════

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Derive an HMAC key from env secrets (deterministic, no extra secret needed).
 */
async function getHmacKey(env: Env): Promise<CryptoKey> {
  const raw = env.TELEGRAM_BOT_TOKEN + ':ymsa-session-key';
  const encoded = new TextEncoder().encode(raw);
  return crypto.subtle.importKey(
    'raw', encoded, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

async function hmacSign(data: string, env: Env): Promise<string> {
  const key = await getHmacKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function hmacVerify(data: string, signature: string, env: Env): Promise<boolean> {
  const key = await getHmacKey(env);
  const sigBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
  return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
}

/**
 * Create a session token for a verified user.
 */
export async function createSession(email: string, env: Env): Promise<string> {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = `${email}:${expires}`;
  const sig = await hmacSign(payload, env);
  return btoa(`${payload}:${sig}`);
}

/**
 * Verify a session token. Returns the email if valid, null otherwise.
 */
export async function verifySession(token: string, env: Env): Promise<string | null> {
  try {
    const decoded = atob(token);
    const parts = decoded.split(':');
    if (parts.length < 3) return null;

    const sig = parts.pop()!;
    const email = parts.slice(0, -1).join(':');
    const expiresStr = parts[parts.length - 1];
    const expires = parseInt(expiresStr, 10);

    if (isNaN(expires) || Date.now() > expires) return null;
    const valid = await hmacVerify(`${email}:${expiresStr}`, sig, env);
    if (!valid) return null;
    if (!ALLOWED_EMAILS.has(email)) return null;

    return email;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// Auth Middleware
// ═══════════════════════════════════════════════════════════════

/**
 * Check if a request is authenticated. Checks:
 * 1. Session cookie (`ymsa_session`)
 * 2. Authorization: Bearer <session_token>
 * 3. Legacy X-API-Key header / ?key= param (for API compatibility)
 */
export async function isAuthenticated(request: Request, env: Env): Promise<{ ok: boolean; email?: string }> {
  // 1. Session cookie
  const cookies = request.headers.get('Cookie') || '';
  const sessionMatch = cookies.match(/ymsa_session=([^;]+)/);
  if (sessionMatch) {
    const email = await verifySession(sessionMatch[1], env);
    if (email) return { ok: true, email };
  }

  // 2. Bearer token
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const email = await verifySession(authHeader.slice(7), env);
    if (email) return { ok: true, email };
  }

  // 3. Legacy API key (for backward compat + Copilot skills)
  if (env.YMSA_API_KEY) {
    const apiKey = request.headers.get('X-API-Key') || new URL(request.url).searchParams.get('key');
    if (apiKey === env.YMSA_API_KEY) return { ok: true, email: 'api-key' };
  }

  return { ok: false };
}

// ═══════════════════════════════════════════════════════════════
// Auth Route Handlers
// ═══════════════════════════════════════════════════════════════

/**
 * POST /auth/google — Exchange Google ID token for session.
 * Body: { idToken: "..." }
 */
export async function handleGoogleAuth(request: Request, env: Env): Promise<Response> {
  let body: { idToken?: string };
  try {
    body = await request.json() as { idToken?: string };
  } catch {
    return jsonResp({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.idToken) {
    return jsonResp({ error: 'Missing idToken field' }, 400);
  }

  // Verify with Google
  const tokenInfo = await verifyGoogleToken(body.idToken);
  if (!tokenInfo) {
    return jsonResp({ error: 'Invalid or expired Google token' }, 401);
  }

  // Check whitelist
  if (!ALLOWED_EMAILS.has(tokenInfo.email)) {
    return jsonResp({ error: 'Access denied — email not authorized' }, 403);
  }

  // Issue session
  const session = await createSession(tokenInfo.email, env);
  const maxAge = SESSION_TTL_MS / 1000;

  return new Response(JSON.stringify({
    ok: true,
    email: tokenInfo.email,
    name: tokenInfo.name,
    picture: tokenInfo.picture,
    token: session,
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `ymsa_session=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`,
    },
  });
}

/**
 * POST /auth/logout — Clear session cookie.
 */
export function handleLogout(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': 'ymsa_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
    },
  });
}

/**
 * GET /auth/me — Check current session.
 */
export async function handleAuthMe(request: Request, env: Env): Promise<Response> {
  const auth = await isAuthenticated(request, env);
  if (!auth.ok) return jsonResp({ authenticated: false }, 401);
  return jsonResp({ authenticated: true, email: auth.email });
}

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
