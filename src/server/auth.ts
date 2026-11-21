import crypto from 'node:crypto';
import type express from 'express';
import type { AuthStateResponse, AuthUser } from '../shared/types';
import { getDb } from './db';

export const SESSION_COOKIE = 'siglens_session';
export const STATE_COOKIE = 'siglens_oauth_state';
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

let tablesInitialized = false;

export function ensureAuthTables(): void {
  if (tablesInitialized) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      picture TEXT,
      provider TEXT NOT NULL DEFAULT 'google',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions (expires_at);
  `);
  tablesInitialized = true;
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim(),
  );
}

export function getGoogleCallbackUrl(req: express.Request): string {
  const configuredOrigin = process.env.APP_URL?.trim().replace(/\/+$/, '');
  if (configuredOrigin) {
    return `${configuredOrigin}/api/auth/google/callback`;
  }
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim();
  const proto = forwardedProto || req.protocol || 'https';
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || 'siglens.cc.cd')
    .split(',')[0]
    .trim();
  return `${proto}://${host}/api/auth/google/callback`;
}

export function isSecureRequest(req: express.Request): boolean {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').toLowerCase();
  return req.secure || forwardedProto.includes('https');
}

export function parseCookies(req: express.Request): Record<string, string> {
  const raw = req.headers.cookie;
  if (!raw) return {};
  const map: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try {
      map[k] = decodeURIComponent(v);
    } catch {
      map[k] = v;
    }
  }
  return map;
}

export function serializeCookie(
  name: string,
  value: string,
  opts: { maxAgeSeconds?: number; httpOnly?: boolean; secure?: boolean; sameSite?: 'Lax' | 'Strict' } = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/'];
  if (typeof opts.maxAgeSeconds === 'number') {
    parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAgeSeconds))}`);
  }
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${opts.sameSite ?? 'Lax'}`);
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function createOAuthState(): string {
  return crypto.randomBytes(24).toString('hex');
}

export function buildGoogleAuthUrl(req: express.Request, state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || '';
  const redirectUri = getGoogleCallbackUrl(req);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleCodeAndCreateSession(
  code: string,
  redirectUri: string,
): Promise<{ user: AuthUser; sessionToken: string }> {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || '';
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth is not configured on the server.');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '');
    throw new Error(`Google token exchange failed (${tokenRes.status}): ${body.slice(0, 180)}`);
  }

  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    throw new Error('Google did not return an access_token.');
  }

  const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!profileRes.ok) {
    throw new Error(`Google userinfo fetch failed (${profileRes.status})`);
  }

  const profile = (await profileRes.json()) as {
    sub?: string;
    email?: string;
    name?: string;
    picture?: string;
  };
  if (!profile.sub || !profile.email) {
    throw new Error('Google profile missing required sub/email claims.');
  }

  const user: AuthUser = {
    id: `google:${profile.sub}`,
    email: profile.email,
    name: profile.name || profile.email.split('@')[0],
    picture: profile.picture || null,
    provider: 'google',
  };

  ensureAuthTables();
  const db = getDb();
  const now = Date.now();

  db.prepare(
    `INSERT INTO auth_users (id, email, name, picture, provider, updated_at)
     VALUES (?, ?, ?, ?, 'google', ?)
     ON CONFLICT(id) DO UPDATE SET
       email = excluded.email,
       name = excluded.name,
       picture = excluded.picture,
       updated_at = excluded.updated_at`,
  ).run(user.id, user.email, user.name, user.picture, now);

  // Clean up expired sessions opportunistically
  db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now);

  const sessionToken = crypto.randomBytes(32).toString('hex');
  db.prepare(
    'INSERT INTO auth_sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  ).run(sessionToken, user.id, now + SESSION_TTL_MS, now);

  return { user, sessionToken };
}

export function getSessionUserFromReq(req: express.Request): AuthUser | null {
  ensureAuthTables();
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;

  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.picture, u.provider
       FROM auth_sessions s
       JOIN auth_users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, Date.now()) as
    | { id: string; email: string; name: string; picture: string | null; provider: string }
    | undefined;

  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    picture: row.picture,
    provider: 'google',
  };
}

export function deleteSessionFromReq(req: express.Request): void {
  ensureAuthTables();
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return;
  const db = getDb();
  db.prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
}

export function buildAuthStateResponse(req: express.Request): AuthStateResponse {
  return {
    configured: isGoogleOAuthConfigured(),
    callbackUrl: getGoogleCallbackUrl(req),
    user: getSessionUserFromReq(req),
  };
}

