/**
 * Whop subscriptions for nind.
 *  - plan catalogue (Whop variant ids are public, not secret; override with WHOP_PLAN_* env vars)
 *  - checkout links carrying the nind user id in metadata
 *  - Standard-Webhooks signature verification for /api/webhooks/whop
 */
import 'dotenv/config'; // plan id overrides are read at import time
import crypto from 'crypto';

export type Cycle = 'monthly' | 'annual';
export interface PlanDef { key: string; tier: 'starter' | 'creator'; name: string; credits: number; cycle: Cycle; price: number; variantId: string }

const env = (k: string, d: string) => (process.env[k] || d).trim();

// Prices exactly as on the Upgrade page; annual = per-month annual price x 12, billed yearly.
export const PLANS: PlanDef[] = [
  { key: 'starter_monthly', tier: 'starter', name: 'Starter', credits: 500, cycle: 'monthly', price: 20, variantId: env('WHOP_PLAN_STARTER_MONTHLY', 'plan_PEoFZUohfP7EQ') },
  { key: 'starter_annual', tier: 'starter', name: 'Starter', credits: 500, cycle: 'annual', price: 192, variantId: env('WHOP_PLAN_STARTER_ANNUAL', 'plan_qhQsIcxcgw0K7') },
  { key: 'creator3000_monthly', tier: 'creator', name: 'Creator', credits: 3000, cycle: 'monthly', price: 69, variantId: env('WHOP_PLAN_CREATOR3000_MONTHLY', 'plan_TZOKWqftoUoDz') },
  { key: 'creator3000_annual', tier: 'creator', name: 'Creator', credits: 3000, cycle: 'annual', price: 708, variantId: env('WHOP_PLAN_CREATOR3000_ANNUAL', 'plan_SbX1qP2M1PTDU') },
  { key: 'creator6000_monthly', tier: 'creator', name: 'Creator', credits: 6000, cycle: 'monthly', price: 119, variantId: env('WHOP_PLAN_CREATOR6000_MONTHLY', 'plan_8vgWPQY7cWOQB') },
  { key: 'creator6000_annual', tier: 'creator', name: 'Creator', credits: 6000, cycle: 'annual', price: 1188, variantId: env('WHOP_PLAN_CREATOR6000_ANNUAL', 'plan_O1UuonQls7oeJ') },
  { key: 'creator9000_monthly', tier: 'creator', name: 'Creator', credits: 9000, cycle: 'monthly', price: 199, variantId: env('WHOP_PLAN_CREATOR9000_MONTHLY', 'plan_YCo3Tg5Bfz1gx') },
  { key: 'creator9000_annual', tier: 'creator', name: 'Creator', credits: 9000, cycle: 'annual', price: 2028, variantId: env('WHOP_PLAN_CREATOR9000_ANNUAL', 'plan_xWkQKn3P9WH0Y') },
];

export function findPlan(tier: string, credits: number, cycle: string): PlanDef | undefined {
  const c: Cycle = cycle === 'annual' || cycle === 'annually' || cycle === 'yearly' ? 'annual' : 'monthly';
  return PLANS.find((p) => p.tier === tier && p.cycle === c && (tier === 'starter' || p.credits === Number(credits)));
}

export function planByVariant(id?: string | null): PlanDef | undefined {
  return id ? PLANS.find((p) => p.variantId === id) : undefined;
}

const API = 'https://api.whop.com/api/v1';

/**
 * Creates a Whop checkout configuration for the plan with metadata { nind_user_id, nind_plan }.
 * Without WHOP_API_KEY falls back to the plan's public checkout link (the webhook then maps the buyer by e-mail).
 */
export async function createCheckout(plan: PlanDef, userId: string, redirectUrl: string): Promise<{ url: string; id?: string; mode: 'api' | 'link' }> {
  const key = process.env.WHOP_API_KEY;
  const link = `https://whop.com/checkout/${plan.variantId}`;
  if (!key) return { url: link, mode: 'link' };
  const metadata = { nind_user_id: userId, nind_plan: plan.key };
  // Whop accepts only https redirect URLs (local http dev servers get Whop's default success page).
  const body: any = { variant_id: plan.variantId, metadata };
  if (/^https:\/\//.test(redirectUrl)) body.redirect_url = redirectUrl;
  const r = await fetch(`${API}/checkout_configurations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j: any = await r.json().catch(() => ({}));
  if (r.ok && j.purchase_url) return { url: j.purchase_url, id: j.id, mode: 'api' };
  console.warn(`[whop] checkout_configurations failed: ${r.status} ${String(j?.error?.message || j?.message || '').slice(0, 200)}`);
  return { url: link, mode: 'link' };
}

/** Standard Webhooks: base64(HMAC-SHA256(key, `${id}.${timestamp}.${body}`)), header "v1,<sig> [v1,<sig2>...]". */
export function verifyWebhook(rawBody: Buffer | string, headers: Record<string, any>, secret: string, toleranceSec = 300): boolean {
  if (!secret) return false;
  const id = String(headers['webhook-id'] || '');
  const ts = String(headers['webhook-timestamp'] || '');
  const sigHeader = String(headers['webhook-signature'] || '');
  if (!id || !ts || !sigHeader) return false;
  const t = Number(ts);
  if (!isFinite(t) || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const signed = `${id}.${ts}.${body}`;
  // Whop "ws_..." secrets are used as-is; classic Standard-Webhooks "whsec_<base64>" secrets are base64-decoded.
  const keys: Buffer[] = [Buffer.from(secret, 'utf8')];
  if (secret.startsWith('whsec_')) keys.push(Buffer.from(secret.slice(6), 'base64'));
  const given = sigHeader.split(' ').map((s) => s.split(',')).filter((p) => p[0] === 'v1' && p[1]).map((p) => Buffer.from(p[1], 'base64'));
  for (const k of keys) {
    const exp = crypto.createHmac('sha256', k).update(signed).digest();
    if (given.some((g) => g.length === exp.length && crypto.timingSafeEqual(g, exp))) return true;
  }
  return false;
}

/** Field helpers tolerant to payload versions (variant_id vs plan.id, membership_id vs membership.id...). */
export const pick = {
  variant: (d: any) => d?.variant_id || d?.plan_id || d?.variant?.id || d?.plan?.id || null,
  membership: (d: any) => d?.membership_id || d?.membership?.id || (typeof d?.id === 'string' && d.id.startsWith('mem_') ? d.id : null),
  email: (d: any) => String(d?.user?.email || d?.member?.email || d?.email || d?.billing_address?.email || '').toLowerCase() || null,
  meta: (d: any) => ({ ...(d?.membership?.metadata || {}), ...(d?.metadata || {}) }),
};
