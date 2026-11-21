import { Request, Response } from 'express';
import crypto from 'crypto';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);
const STATE_COOKIE = 'nind_g_state';

function clientId() {
  return (process.env.GOOGLE_CLIENT_ID || '').trim();
}

function clientSecret() {
  return (process.env.GOOGLE_CLIENT_SECRET || '').trim();
}

export function isGoogleConfigured() {
  return Boolean(clientId() && clientSecret());
}

/** Prefer the request host on localhost so local OAuth works even if PUBLIC_URL is production. */
export function authOrigin(req: Request, publicUrl: string) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  const hostname = host.split(':')[0];
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
    return `${proto}://${host}`;
  }
  const env = (publicUrl || '').replace(/\/+$/, '');
  if (env) return env;
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  return `${proto}://${host || 'localhost'}`;
}

export function googleRedirectUri(origin: string) {
  return `${origin.replace(/\/+$/, '')}/api/auth/google/callback`;
}

function b64url(buf: Buffer) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBuf(s: string) {
  let str = s.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie || '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) {
      try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
    }
  }
  return out;
}

function isHttps(req: Request) {
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  return proto === 'https';
}

function stateCookie(req: Request, value: string, maxAge: number) {
  const parts = [
    `${STATE_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (isHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

type OAuthPending = { verifier: string; expires: number };
const pending = new Map<string, OAuthPending>();

export type SessionTicket = { user: unknown; token: string; expires: number };
const tickets = new Map<string, SessionTicket>();

function sweep() {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
  for (const [k, v] of tickets) if (v.expires < now) tickets.delete(k);
}

function redirectAuthError(res: Response, message: string) {
  return res.redirect(302, `/auth?error=${encodeURIComponent(message)}`);
}

export function startGoogleAuth(req: Request, res: Response, origin: string) {
  if (!isGoogleConfigured()) {
    return redirectAuthError(
      res,
      'Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
    );
  }
  sweep();
  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  pending.set(state, { verifier, expires: Date.now() + 10 * 60 * 1000 });
  res.setHeader('Set-Cookie', stateCookie(req, state, 600));

  const url = new URL(GOOGLE_AUTH);
  url.searchParams.set('client_id', clientId());
  url.searchParams.set('redirect_uri', googleRedirectUri(origin));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('access_type', 'online');
  url.searchParams.set('prompt', 'select_account');
  return res.redirect(302, url.toString());
}

type GoogleJwk = crypto.JsonWebKey & { kid?: string };

let cachedJwks: { keys: GoogleJwk[]; fetched: number } | null = null;

async function getGoogleJwks(): Promise<GoogleJwk[]> {
  if (cachedJwks && Date.now() - cachedJwks.fetched < 60 * 60 * 1000) return cachedJwks.keys;
  const r = await fetch(GOOGLE_JWKS);
  if (!r.ok) throw new Error('Failed to fetch Google signing keys');
  const data = (await r.json()) as { keys?: GoogleJwk[] };
  const keys = data.keys || [];
  if (!keys.length) throw new Error('Google signing keys were empty');
  cachedJwks = { keys, fetched: Date.now() };
  return keys;
}

export async function verifyGoogleIdToken(idToken: string, aud: string): Promise<Record<string, unknown>> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed ID token');
  const header = JSON.parse(b64urlToBuf(parts[0]).toString('utf8')) as { alg?: string; kid?: string };
  const payload = JSON.parse(b64urlToBuf(parts[1]).toString('utf8')) as Record<string, unknown>;
  if (header.alg !== 'RS256') throw new Error('Unexpected ID token algorithm');

  const keys = await getGoogleJwks();
  const jwk = keys.find((k) => k.kid === header.kid) || keys[0];
  if (!jwk) throw new Error('No matching Google signing key');

  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const ok = crypto.verify(
    'sha256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    key,
    b64urlToBuf(parts[2]),
  );
  if (!ok) throw new Error('Invalid ID token signature');

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now >= Number(payload.exp)) throw new Error('ID token expired');
  if (payload.nbf && now < Number(payload.nbf) - 60) throw new Error('ID token not yet valid');
  const tokenAud = payload.aud;
  const audOk = tokenAud === aud || (Array.isArray(tokenAud) && tokenAud.includes(aud));
  if (!audOk) throw new Error('ID token audience mismatch');
  if (!ISSUERS.has(String(payload.iss))) throw new Error('ID token issuer mismatch');
  return payload;
}

export type GoogleProfile = { email: string; name: string; avatar?: string };

export async function handleGoogleCallback(
  req: Request,
  res: Response,
  origin: string,
  upsertUser: (profile: GoogleProfile) => { user: unknown; token: string },
) {
  const q = req.query as Record<string, string | undefined>;
  if (q.error) {
    const denied = q.error === 'access_denied';
    return redirectAuthError(
      res,
      denied ? 'Google sign-in was cancelled.' : (q.error_description || q.error || 'Google sign-in failed.'),
    );
  }
  if (!q.code || !q.state) {
    return redirectAuthError(res, 'Google sign-in failed: missing authorization code. Please try again.');
  }

  const cookies = parseCookies(req);
  const cookieState = cookies[STATE_COOKIE];
  const rec = pending.get(q.state);
  pending.delete(q.state);
  res.setHeader('Set-Cookie', stateCookie(req, '', 0));

  if (!rec || rec.expires < Date.now() || !cookieState || cookieState !== q.state) {
    return redirectAuthError(res, 'Google sign-in failed: invalid or expired state. Please try again.');
  }

  try {
    const body = new URLSearchParams({
      code: q.code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: googleRedirectUri(origin),
      grant_type: 'authorization_code',
      code_verifier: rec.verifier,
    });
    const tokenRes = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
    const tokenJson = (await tokenRes.json()) as { id_token?: string; error?: string };
    if (!tokenRes.ok || !tokenJson.id_token) {
      console.error('[AUTH] Google token exchange failed:', tokenRes.status, tokenJson.error || 'no id_token');
      return redirectAuthError(res, 'Google sign-in failed: could not exchange the authorization code.');
    }

    const claims = await verifyGoogleIdToken(tokenJson.id_token, clientId());
    const email = String(claims.email || '').toLowerCase().trim();
    const verified = claims.email_verified === true || claims.email_verified === 'true';
    if (!email || !verified) {
      return redirectAuthError(res, 'Google sign-in failed: a verified email is required.');
    }

    const name = String(claims.name || claims.given_name || email.split('@')[0] || 'Creator');
    const avatar = typeof claims.picture === 'string' ? claims.picture : undefined;
    const session = upsertUser({ email, name, avatar });

    sweep();
    const ticket = b64url(crypto.randomBytes(24));
    tickets.set(ticket, { user: session.user, token: session.token, expires: Date.now() + 2 * 60 * 1000 });
    return res.redirect(302, `/auth/callback?ticket=${encodeURIComponent(ticket)}`);
  } catch (e) {
    console.error('[AUTH] Google callback error:', e instanceof Error ? e.message : e);
    return redirectAuthError(res, 'Google sign-in failed. Please try again.');
  }
}

export function consumeGoogleTicket(req: Request, res: Response) {
  const ticket = String((req.query.ticket as string) || (req.body && req.body.ticket) || '');
  const rec = tickets.get(ticket);
  if (rec) tickets.delete(ticket);
  if (!ticket || !rec || rec.expires < Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired sign-in session. Please try again.' });
  }
  return res.json({
    success: true,
    user: rec.user,
    token: rec.token,
    message: 'Welcome!',
  });
}
