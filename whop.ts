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


// One-time credit top-ups (product "nind ai Credits", prod_7jbmwKtiYoR5N). 1 credit = $0.01 list price; bigger packs get bonus credits.
export interface TopUpDef { credits: number; price: number; variantId: string }
export const TOPUPS: TopUpDef[] = [
  { credits: 100, price: 5, variantId: env('WHOP_TOPUP_100', 'plan_o828tPAcTUKgY') },
  { credits: 500, price: 20, variantId: env('WHOP_TOPUP_500', 'plan_E8kU4GifJcamt') },
  { credits: 1500, price: 50, variantId: env('WHOP_TOPUP_1500', 'plan_qvkDxCM4YOPf9') },
  { credits: 3500, price: 100, variantId: env('WHOP_TOPUP_3500', 'plan_6L8B1g1WOoYX1') },
];
export const topUpByVariant = (id?: string | null) => (id ? TOPUPS.find((t) => t.variantId === id) : undefined);

// Starter intro offer: first month $12.99 instead of $20 for the first 300 first-time subscribers.
// Whop promo code (flat $7.01 off, once, new users only, one per customer, stock 300) on starter_monthly only.
export const STARTER_PROMO = {
  id: env('WHOP_STARTER_PROMO_ID', 'promo_GEm0b6GRVtwA'),
  code: env('WHOP_STARTER_PROMO_CODE', 'nindstart'),
  limit: Number(env('WHOP_STARTER_PROMO_LIMIT', '300')),
  planKey: 'starter_monthly',
  price: 12.99,
  regular: 20,
};

let promoCache: { at: number; uses: number | null; stock: number | null; status: string | null } | null = null;
/** Reads the promo code's live usage from Whop (cached 60 s). Returns nulls when Whop is unreachable. */
export async function fetchStarterPromo(): Promise<{ uses: number | null; stock: number | null; status: string | null }> {
  if (promoCache && Date.now() - promoCache.at < 60_000) return promoCache;
  const key = process.env.WHOP_API_KEY;
  let out = { uses: null as number | null, stock: null as number | null, status: null as string | null };
  if (key) {
    try {
      const r = await fetch(`${API}/promo_codes/${STARTER_PROMO.id}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const j: any = await r.json();
        out = { uses: Number(j.uses ?? 0), stock: j.unlimited_stock ? null : Number(j.stock ?? 0), status: String(j.status || '') };
      }
    } catch { /* offline: fall back to the local counter */ }
  }
  promoCache = { at: Date.now(), ...out };
  return out;
}
export function invalidatePromoCache() { promoCache = null; }

const API = 'https://api.whop.com/api/v1';

/**
 * Creates a Whop checkout configuration for a variant with the given metadata (nind_user_id etc.).
 * Without WHOP_API_KEY falls back to the variant's public checkout link (the webhook then maps the buyer by e-mail).
 * `promoCode` is pre-applied through the hosted checkout's ?promoCode= parameter.
 */
export async function createCheckoutFor(variantId: string, metadata: Record<string, string>, redirectUrl: string, promoCode?: string): Promise<{ url: string; id?: string; mode: 'api' | 'link' }> {
  const key = process.env.WHOP_API_KEY;
  const withPromo = (u: string) => {
    if (!promoCode) return u;
    const url = new URL(u);
    url.searchParams.set('promoCode', promoCode);
    return url.toString();
  };
  const link = withPromo(`https://whop.com/checkout/${variantId}`);
  if (!key) return { url: link, mode: 'link' };
  // Whop accepts only https redirect URLs (local http dev servers get Whop's default success page).
  const body: any = { variant_id: variantId, metadata };
  if (/^https:\/\//.test(redirectUrl)) body.redirect_url = redirectUrl;
  const r = await fetch(`${API}/checkout_configurations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j: any = await r.json().catch(() => ({}));
  if (r.ok && j.purchase_url) return { url: withPromo(j.purchase_url), id: j.id, mode: 'api' };
  console.warn(`[whop] checkout_configurations failed: ${r.status} ${String(j?.error?.message || j?.message || '').slice(0, 200)}`);
  return { url: link, mode: 'link' };
}

export function createCheckout(plan: PlanDef, userId: string, redirectUrl: string, promoCode?: string) {
  const metadata: Record<string, string> = { nind_user_id: userId, nind_plan: plan.key };
  if (promoCode) metadata.nind_promo = 'starter_intro';
  return createCheckoutFor(plan.variantId, metadata, redirectUrl, promoCode);
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
  promo: (d: any) => String(d?.promo_code?.id || d?.promo_code_id || d?.promo_code?.code || (typeof d?.promo_code === 'string' ? d.promo_code : '') || '').toLowerCase() || null,
};
