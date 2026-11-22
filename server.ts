import { PLANS, findPlan, planByVariant, createCheckout, createCheckoutFor, verifyWebhook, pick, PlanDef, TOPUPS, topUpByVariant, STARTER_PROMO, fetchStarterPromo, invalidatePromoCache } from './whop';
import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import crypto from 'crypto';
import { spawn } from 'child_process';
import https from 'https';
import dotenv from 'dotenv';
import { runVideoPipeline, newCostTracker, CostTracker, levelCfg, normLevel, Level, ffmpeg, withCleanOutput, stripProvenance } from './videoPipeline';
import { applyCreatedEdit, runSourceEdit, applySourceEdit, SourceState } from './editEngine';
import { planCreation, estimateCreation, runLongVideoPipeline, decideSourceLayout } from './longForm';
import { probeVideo } from './smartReframe';
import { moderatePrompt, moderateMedia, recordViolation, restriction, POLICY_MSG, FILE_POLICY_MSG, Violation } from './moderation';
import { CaptionStyle } from './captionStyle';
import { startGoogleAuth, handleGoogleCallback, consumeGoogleTicket, authOrigin, mergeGoogleProfile, GoogleProfile } from './googleAuth';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Directories
const DATA_DIR = path.resolve(__dirname, 'data');
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// OpenRouter Key (Secure server-side ONLY - never exposed to clients)
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
if (!OPENROUTER_API_KEY) console.warn('⚠️  OPENROUTER_API_KEY is not set — generation will fail.');

// In-Memory & Persistent Storage
interface Project {
  id: string;
  user_id?: string;
  prompt: string;
  format_id: string;
  language: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  progress_message: string;
  video_url?: string;
  poster_url?: string;
  audio_url?: string;
  scenes?: any[];
  full_script?: string;
  error?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  source_video_url?: string;
  logo_url?: string;
  product_images?: string[];
  subtitle_style?: string;
  modified_from?: string;
  title?: string;
  words?: any[];
  cost_usd?: number;
  credits_charged?: number;
  credits_reserved?: number;
  cost_breakdown?: any[];
  level?: Level;
  style?: CaptionStyle;
  kind?: 'create' | 'source';
  source_state?: SourceState;
  edit_notes?: string[];
  edit_summary?: string;
  voice?: string;
  // output format: short = vertical 9:16 (default), long = horizontal 16:9 long-form
  format?: 'short' | 'long';
  aspect?: '9:16' | '16:9';
  target_seconds?: number | null;
  format_reason?: string;
  duration?: number;
  chapters?: { title: string; start: number }[];
  description?: string;
}

interface User {
  user_id: string;
  id?: string;
  username: string;
  email: string;
  name: string;
  avatar?: string;
  picture?: string;
  name_manual?: boolean;
  picture_manual?: boolean;
  bio?: string;
  role: string;
  credits: number;
  created_at: string;
  authProvider?: string;
  plan?: string;
  subscription_status?: string;
  // Whop subscription state
  plan_key?: string;            // e.g. creator3000_monthly
  plan_credits?: number;        // credits per month of the plan
  billing_cycle?: 'monthly' | 'annual';
  sub_credits?: number;         // remaining credits of the current subscription month (expire at period end)
  last_deposit?: number;
  whop_membership_id?: string;
  whop_user_id?: string;
  next_credit_at?: string;      // annual plans: next monthly credit refill
  period_end?: string;
  cancel_at_period_end?: boolean;
  ever_subscribed?: boolean;      // had any paid subscription (not eligible for the Starter intro price)
  starter_promo_used?: boolean;
  // content moderation (see moderation.ts)
  mod_violations?: Violation[];
  mod_blocked_until?: string;
  mod_flagged?: boolean;       // set after 10 violations: generation disabled until an admin clears it
}

interface Database {
  users: Record<string, User>;
  projects: Record<string, Project>;
  notifications: any[];
  chunk_uploads: Record<string, { total_chunks: number; chunks: Record<number, string>; filename: string }>;
  whop_events?: Record<string, string>;      // webhook-id / event id -> processed at (idempotency)
  whop_payments?: Record<string, string>;    // payment id -> user id (credits granted once per payment)
  whop_checkouts?: Record<string, { user_id: string; plan_key: string; created_at: string }>;
  whop_unmatched?: any[];                    // paid events we could not map to a user (manual review)
  starter_promo_count?: number;              // Starter intro ($12.99) purchases seen by webhook
  whop_topups?: Record<string, { user_id: string; credits: number; created_at: string }>;
  support_requests?: SupportRequest[];
  sessions?: Record<string, SessionRec>;     // sha256(token) -> session
}

interface SessionRec { user_id: string; created_at: string; expires_at: number }

interface SupportRequest {
  id: string;
  user_id?: string;
  email: string;
  subject: string;
  message: string;
  faq_id?: string;
  created_at: string;
  emailed: boolean;
}

let db: Database = {
  users: {},
  projects: {},
  notifications: [],
  chunk_uploads: {},
  whop_events: {},
  whop_payments: {},
  whop_checkouts: {},
  whop_unmatched: [],
  support_requests: [],
  sessions: {},
};

// Load database from disk
if (fs.existsSync(DB_FILE)) {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    db = JSON.parse(raw);
    if (!db.users) db.users = {};
    if (!db.projects) db.projects = {};
    if (!db.notifications) db.notifications = [];
    if (!db.chunk_uploads) db.chunk_uploads = {};
    if (!db.whop_events) db.whop_events = {};
    if (!db.whop_payments) db.whop_payments = {};
    if (!db.whop_checkouts) db.whop_checkouts = {};
    if (!db.whop_unmatched) db.whop_unmatched = [];
    if (!db.support_requests) db.support_requests = [];
    if (!db.sessions) db.sessions = {};
  } catch (e) {
    // Never start with an empty DB on top of a broken file: keep a copy so nothing is lost.
    const bad = `${DB_FILE}.corrupt-${Date.now()}`;
    try { fs.copyFileSync(DB_FILE, bad); } catch (_) {}
    console.error(`Error loading db.json (copied to ${bad}):`, e);
    if (process.env.NODE_ENV === 'production') {
      console.error('Refusing to start with an unreadable database. Restore data/db.json from a backup.');
      process.exit(1);
    }
  }
}

/** Atomic write: a crash mid-write never leaves a half-written db.json. */
function saveDb() {
  try {
    const tmp = `${DB_FILE}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error('Error saving db.json:', e);
  }
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname || '').toLowerCase().replace(/[^a-z0-9.]/g, '') || '.bin').slice(0, 8);
    const unique = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, unique);
  },
});
// Only media files may be uploaded (they are served back from our own origin: no .html/.svg/.js).
const UPLOAD_EXT = /\.(mov|mp4|m4v|webm|mkv|avi|3gp|3g2|mts|m2ts|mpeg|mpg|wmv|qt|png|jpe?g|webp|gif|heic|heif|avif|bmp|mp3|m4a|wav|aac|ogg|oga|opus|flac)$/i;
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = UPLOAD_EXT.test(file.originalname || '') || (file.fieldname === 'chunk');
    if (!ok) return cb(new Error('unsupported_file_type'));
    cb(null, true);
  },
});

const VIDEO_EXT = /\.(mov|mp4|m4v|webm|mkv|avi|3gp|3g2|mts|m2ts|ts|mpeg|mpg|wmv|qt)$/i;

function isVideoUpload(filename?: string, mime?: string) {
  if (mime && mime.startsWith('video/')) return true;
  return !!filename && VIDEO_EXT.test(filename);
}

/** Extract a small JPEG frame for the attachment preview (HEVC/.mov etc. that browsers can't decode). */
async function makeUploadThumbnail(srcPath: string, originalName?: string, mime?: string): Promise<string | undefined> {
  const name = originalName || path.basename(srcPath);
  if (!isVideoUpload(name, mime)) return undefined;
  const base = path.parse(path.basename(srcPath)).name;
  const thumbName = `thumb_${base}.jpg`;
  const thumbPath = path.join(UPLOADS_DIR, thumbName);
  // Autorotate is on by default (honours iPhone display-matrix / rotate tags).
  const vf = "scale='min(360,iw)':-2";
  for (const ss of [0.5, 0]) {
    try {
      const r = await ffmpeg(withCleanOutput(['-ss', String(ss), '-i', srcPath, '-an', '-frames:v', '1', '-vf', vf, '-q:v', '3', thumbPath], { sei: false }), 45_000);
      if (r.code === 0 && fs.existsSync(thumbPath)) await stripProvenance(thumbPath);
      if (r.code === 0 && fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 200) {
        return `/api/uploads/${thumbName}`;
      }
    } catch (e) {
      console.warn('thumbnail extract failed:', e);
    }
    try { if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath); } catch (_) {}
  }
  return undefined;
}


// Whop webhook needs the raw body for signature verification -> registered before express.json
app.post('/api/webhooks/whop', express.raw({ type: '*/*', limit: '2mb' }), (req: Request, res: Response) => handleWhopWebhook(req, res));

// Middleware
app.disable('x-powered-by');
if (process.env.TRUST_PROXY !== '0') app.set('trust proxy', 1); // behind nginx/caddy: real client IP + https
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Static uploads serving (work_* folders hold intermediates/state of jobs and are not public)
const blockWorkDirs = (req: Request, res: Response, next: any) => (/^\/work_/.test(req.path) ? res.status(404).end() : next());
app.use('/api/uploads', blockWorkDirs, express.static(UPLOADS_DIR, { dotfiles: 'deny', index: false }));
app.use('/uploads', blockWorkDirs, express.static(UPLOADS_DIR, { dotfiles: 'deny', index: false }));
app.use('/assets', express.static(path.resolve(__dirname, 'public/assets')));

// ======================= SESSIONS / RATE LIMITS =======================
const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

function createSession(userId: string): string {
  const token = `nsn_${crypto.randomBytes(32).toString('hex')}`;
  db.sessions![hashToken(token)] = { user_id: userId, created_at: new Date().toISOString(), expires_at: Date.now() + SESSION_TTL_MS };
  saveDb();
  return token;
}

function bearer(req: Request): string {
  const h = String(req.headers.authorization || '');
  const m = h.match(/^Bearer\s+(\S+)$/i);
  return m && m[1] !== 'undefined' && m[1] !== 'null' ? m[1] : '';
}

/** The signed-in user of this request (server-side session; client-supplied user ids are never trusted). */
function sessionUser(req: Request): User | undefined {
  const t = bearer(req);
  if (!t) return undefined;
  const rec = db.sessions?.[hashToken(t)];
  if (!rec) return undefined;
  if (rec.expires_at < Date.now()) { delete db.sessions![hashToken(t)]; return undefined; }
  return db.users[rec.user_id];
}

function requireUser(req: Request, res: Response): User | undefined {
  const u = sessionUser(req);
  if (!u) { res.status(401).json({ error: 'auth_required', message: 'Please sign in again.' }); return undefined; }
  return u;
}

function dropSessionsOf(userId: string) {
  for (const [k, v] of Object.entries(db.sessions || {})) if (v.user_id === userId) delete db.sessions![k];
}

/** Simple in-memory sliding-window limiter. */
const hits: Record<string, number[]> = {};
function rateOk(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits[key] || []).filter((t) => now - t < windowMs);
  if (recent.length >= max) { hits[key] = recent; return false; }
  recent.push(now);
  hits[key] = recent;
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const k of Object.keys(hits)) if (!hits[k].some((t) => now - t < 24 * 3600_000)) delete hits[k];
  let changed = false;
  for (const [k, v] of Object.entries(db.sessions || {})) if (v.expires_at < now) { delete db.sessions![k]; changed = true; }
  if (changed) saveDb();
}, 3600_000).unref?.();
const clientIp = (req: Request) => String(req.ip || req.socket.remoteAddress || 'ip');

// ======================= CREDITS =======================
// $0.01 of real OpenRouter API cost = 1 credit. Real cost is summed per video
// (usage.cost from every OpenRouter response) and charged when the job finishes.
const USD_PER_CREDIT = 0.01;
const MIN_GENERATION_CREDITS = Number(process.env.MIN_GENERATION_CREDITS || 10); // must hold at least this to start
const MIN_EDIT_CREDITS = Number(process.env.MIN_EDIT_CREDITS || 3);
const DEFAULT_SIGNUP_CREDITS = Number(process.env.WELCOME_CREDITS || 20);

/** Creator plan (any credit size) with an active subscription: unlocks the High generation level. */
function isCreator(user?: User): boolean {
  if (!user) return false;
  const active = user.subscription_status === 'active' || user.subscription_status === 'trialing';
  return active && (String(user.plan_key || '').startsWith('creator') || user.plan === 'pro' || user.plan === 'creator');
}
const HIGH_LOCKED_MSG = 'High generation mode is exclusive to Creator Plan';

/** First-time buyer: never had a subscription and never used the intro price. */
function starterPromoEligible(user?: User): boolean {
  if (!user) return true; // signed-out visitors see the offer; checkout re-checks after sign-in
  return !user.ever_subscribed && !user.starter_promo_used && !user.whop_membership_id && !user.plan_key && (!user.plan || user.plan === 'free');
}

/** Intro price is live while fewer than 300 buyers used it (Whop promo usage + our own webhook counter). */
async function starterPromoState() {
  const w = await fetchStarterPromo();
  const local = db.starter_promo_count || 0;
  const used = Math.max(local, w.uses ?? 0);
  const limit = Math.min(STARTER_PROMO.limit, w.stock ?? STARTER_PROMO.limit);
  const active = (w.status === null || w.status === 'active') && used < limit;
  return { active, used, limit, remaining: Math.max(0, limit - used) };
}

/** The job's spending limit: never more than the user's available balance (and the level's cap). */
function budgetFor(available: number, capUsd: number) {
  return Math.max(0.01, Math.min(available * USD_PER_CREDIT, capUsd));
}

/** Lookup only: accounts are created exclusively by e-mail code / Google sign-in. */
function getOrCreateUser(userId?: string): User | undefined {
  if (!userId) return undefined;
  return db.users[userId];
}

function reservedCredits(userId: string): number {
  return Object.values(db.projects)
    .filter((p) => p.user_id === userId && (p.status === 'pending' || p.status === 'processing'))
    .reduce((sum, p) => sum + (p.credits_reserved || 0), 0);
}

function availableCredits(user: User): number {
  return Math.max(0, (user.credits || 0) - reservedCredits(user.user_id));
}

const DEFAULT_AVATAR = '/assets/profile-icon.png';

/**
 * Content-policy gate for anything that takes a user prompt. Runs BEFORE credits are reserved.
 * Returns false (and has answered the request) when the prompt or the account is blocked.
 */
async function promptAllowed(user: User, prompt: string, res: Response, kind = 'prompt'): Promise<boolean> {
  const why = restriction(user);
  if (why) { res.status(403).json({ error: 'account_restricted', message: why }); return false; }
  const v = await moderatePrompt(prompt);
  if (v.source === 'model') console.log(`[MOD] ${kind} ${v.allowed ? 'ok' : 'BLOCKED'} (${v.category}) ${v.ms}ms $${(v.usd || 0).toFixed(6)}`);
  if (v.allowed) return true;
  recordViolation(user, 'prompt', v.category);
  saveDb();
  res.status(422).json({ error: 'content_policy', category: v.category, message: POLICY_MSG });
  return false;
}

/** Local NSFW check of a just-uploaded file; deletes it and answers 422 when blocked. */
async function uploadAllowed(user: User, file: string, res: Response): Promise<boolean> {
  const v = await moderateMedia(file);
  if (v.allowed) return true;
  try { fs.unlinkSync(file); } catch { /* ignore */ }
  recordViolation(user, 'upload', 'nsfw');
  saveDb();
  res.status(422).json({ error: 'content_policy', category: 'nsfw', message: FILE_POLICY_MSG });
  return false;
}

/** API-facing user: always expose `picture` (alias of a real avatar URL). */
function publicUser(user: User, extra: Record<string, unknown> = {}) {
  const picture = user.picture || (user.avatar && user.avatar !== DEFAULT_AVATAR ? user.avatar : undefined);
  const { mod_violations: _mv, ...rest } = user;
  return {
    ...rest,
    is_creator: isCreator(user),
    picture: picture || undefined,
    avatar: user.avatar || picture || DEFAULT_AVATAR,
    ...extra,
  };
}

function chargeProject(project: Project, cost: CostTracker) {
  const credits = Math.ceil(Math.round(cost.usd * 1e6) / 1e6 / USD_PER_CREDIT);
  project.cost_usd = Math.round(((project.cost_usd || 0) + cost.usd) * 1e6) / 1e6;
  project.credits_charged = (project.credits_charged || 0) + credits;
  project.cost_breakdown = [...(project.cost_breakdown || []), ...cost.items];
  project.credits_reserved = 0;
  const user = project.user_id ? db.users[project.user_id] : undefined;
  if (user) {
    user.credits = Math.max(0, (user.credits || 0) - credits);
    if (user.sub_credits) user.sub_credits = Math.max(0, Math.min(user.credits, user.sub_credits - credits));
  }
  console.log(`[CREDITS] ${project.id}: $${cost.usd.toFixed(4)} -> ${credits} credits; user ${project.user_id} balance ${user?.credits}`);
  saveDb();
}

// ======================= JOB QUEUE =======================
// Rendering is CPU/RAM heavy (ffmpeg, whisper, OpenCV): run at most MAX_CONCURRENT_JOBS at once, queue the rest.
const MAX_CONCURRENT_JOBS = Math.max(1, Number(process.env.MAX_CONCURRENT_JOBS || 2));
const MAX_JOBS_PER_USER = Math.max(1, Number(process.env.MAX_JOBS_PER_USER || 2));
let runningJobs = 0;
const jobQueue: Array<() => Promise<void>> = [];
function enqueueJob(fn: () => Promise<void>) {
  jobQueue.push(fn);
  pumpJobs();
}
function pumpJobs() {
  while (runningJobs < MAX_CONCURRENT_JOBS && jobQueue.length) {
    const fn = jobQueue.shift()!;
    runningJobs++;
    Promise.resolve()
      .then(fn)
      .catch((e) => console.error('[queue] job crashed:', e))
      .finally(() => { runningJobs--; pumpJobs(); });
  }
}
function activeJobsOf(userId: string) {
  return Object.values(db.projects).filter((p) => p.user_id === userId && (p.status === 'pending' || p.status === 'processing')).length;
}

/** After a restart nothing is rendering any more: release reservations and mark interrupted jobs. */
function recoverInterruptedJobs() {
  let n = 0;
  for (const p of Object.values(db.projects)) {
    if (p.status !== 'pending' && p.status !== 'processing') continue;
    n++;
    p.credits_reserved = 0;
    p.updated_at = new Date().toISOString();
    if (p.video_url) {
      // an interrupted edit keeps the previous, working video
      p.status = 'completed';
      p.progress = 100;
      p.error_message = 'Edit was interrupted by a server restart. Please try again.';
    } else {
      p.status = 'failed';
      p.error = 'interrupted';
      p.error_message = 'Generation was interrupted by a server restart. Please try again (no credits were charged for the unfinished part).';
    }
  }
  if (n) { console.warn(`[startup] ${n} interrupted job(s) marked as failed/restored`); saveDb(); }
}
recoverInterruptedJobs();

// Video Generation Worker
async function processVideoGeneration(projectId: string, isModification = false, modificationPrompt = '', budgetUsd?: number, editAttachments: string[] = []) {
  const project = db.projects[projectId];
  if (!project) return;
  const workDir = path.join(UPLOADS_DIR, `work_${projectId}`);
  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });
  const cost = newCostTracker(budgetUsd);

  const updateProgress = (pct: number, msg: string) => {
    project.progress = Math.min(99, pct);
    project.progress_message = msg;
    project.status = 'processing';
    project.updated_at = new Date().toISOString();
    saveDb();
  };

  try {
    const lang = project.language || 'auto';
    const ru = String(lang).toLowerCase().startsWith('ru');
    const stamp = isModification ? '_' + Date.now() : '';
    const finalVideoName = `video_${projectId}${stamp}.mp4`;
    const posterName = `poster_${projectId}${stamp}.jpg`;
    const outVideo = path.join(UPLOADS_DIR, finalVideoName);
    const outPoster = path.join(UPLOADS_DIR, posterName);
    const toLocal = (u: string) => path.resolve(__dirname, u.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\//, '').replace(/^\//, ''));
    const attached = (project.product_images || [])
      .filter((u) => typeof u === 'string')
      .map(toLocal)
      .filter((p) => p.startsWith(UPLOADS_DIR) && fs.existsSync(p));
    let audioFile = '';

    if (project.kind === 'source' && !isModification) {
      // user's own footage: real editing on top of it
      const src = project.source_video_url ? toLocal(project.source_video_url) : '';
      if (!src || !src.startsWith(UPLOADS_DIR) || !fs.existsSync(src)) throw new Error('Uploaded video not found — please upload it again.');
      const r = await runSourceEdit({ sourceFile: src, prompt: project.prompt, level: project.level, style: project.style, voice: project.voice, workDir, outVideo, outPoster, cost, onProgress: updateProgress, ru });
      project.source_state = r.state;
      project.style = r.state.style;
      project.words = r.state.words;
      project.title = r.title;
      project.aspect = r.state.aspect || '9:16';
      project.duration = r.state.duration;
      project.format = project.aspect === '16:9' || r.state.duration > 300 ? 'long' : 'short';
      project.edit_notes = r.notes;
      audioFile = r.state.translated?.dubAudio || r.state.audio;
    } else if (project.kind === 'source' && isModification && project.source_state) {
      const r = await applySourceEdit({ state: project.source_state, request: modificationPrompt, workDir, outVideo, outPoster, cost, onProgress: updateProgress, ru, voice: project.voice });
      project.source_state = r.state;
      project.style = r.state.style;
      project.edit_notes = r.notes;
      project.edit_summary = r.summary;
      audioFile = r.state.translated?.dubAudio || r.state.audio;
    } else if (isModification && project.scenes?.length) {
      // structured edit: only the requested change, existing assets/voice/timings reused
      const r = await applyCreatedEdit({
        project: { scenes: project.scenes as any, words: project.words || [], full_script: project.full_script || '', style: project.style, level: project.level, voice: project.voice, language: lang, format_id: project.format_id, prompt: project.prompt, aspect: project.aspect },
        request: modificationPrompt, attachments: editAttachments, workDir, outVideo, outPoster, cost, onProgress: updateProgress, ru,
      });
      project.scenes = r.scenes;
      project.words = r.words;
      project.full_script = r.full_script;
      project.style = r.style;
      if ((r as any).voice) project.voice = (r as any).voice;
      project.edit_notes = r.notes;
      project.edit_summary = r.summary;
      audioFile = r.audioFile;
    } else if ((project.target_seconds || 0) >= 150) {
      // long / chaptered video (usually horizontal 16:9)
      const result = await runLongVideoPipeline({
        projectId, prompt: project.prompt, language: lang, format: project.format_id || 'auto', workDir, outVideo, outPoster,
        voice: project.voice, level: project.level, style: project.style, attachedImages: attached, onProgress: updateProgress, cost,
        aspect: project.aspect || '16:9', targetSeconds: project.target_seconds!,
      });
      project.scenes = result.scenes;
      project.full_script = result.full_script;
      project.words = result.words;
      project.title = result.title;
      project.chapters = result.chapters;
      project.description = result.description;
      project.duration = result.duration;
      audioFile = result.audioFile;
    } else {
      const result = await runVideoPipeline({
        aspect: project.aspect,
        projectId,
        prompt: project.prompt,
        language: lang,
        format: project.format_id || 'auto',
        workDir, outVideo, outPoster,
        voice: project.voice,
        level: project.level,
        style: project.style,
        attachedImages: attached,
        onProgress: updateProgress,
        cost,
      });
      project.scenes = result.scenes;
      project.full_script = result.full_script;
      project.words = result.words;
      project.title = result.title;
      audioFile = result.audioFile;
    }

    project.video_url = `/api/uploads/${finalVideoName}`;
    project.poster_url = `/api/uploads/${posterName}`;
    const voiceName = `voiceover_${projectId}.mp3`;
    try { if (audioFile) { fs.copyFileSync(audioFile, path.join(UPLOADS_DIR, voiceName)); project.audio_url = `/api/uploads/${voiceName}`; } } catch (_) {}
    project.error = undefined;
    project.error_message = undefined;
    chargeProject(project, cost);
    project.progress = 100;
    project.status = 'completed';
    project.progress_message = ru ? 'Готово!' : 'Ready!';
    project.completed_at = new Date().toISOString();
    project.updated_at = project.completed_at;
    saveDb();
  } catch (err: any) {
    console.error(`Error in video generation for ${projectId}:`, err);
    // API money already spent is still charged (real cost only)
    chargeProject(project, cost);
    if (isModification && project.video_url) {
      // a failed edit keeps the previous, working video
      project.status = 'completed';
      project.progress = 100;
      project.edit_notes = [`Edit failed: ${err.message || String(err)}`];
      project.error_message = `Edit failed: ${err.message || String(err)}`;
    } else {
      project.status = 'failed';
      project.error = err.message || String(err);
      project.error_message = `Generation failed: ${err.message || String(err)}`;
    }
    saveDb();
  }
}

// ======================= API ROUTES =======================

// Base Health Check
app.get('/api', (_req: Request, res: Response) => {
  res.json({ message: 'nind ai API', status: 'ok' });
});

// Auth & Session Endpoints
// Accounts are created only through a verified e-mail code or Google sign-in.
// The old guest/login/register shortcuts (no verification) are gone.
const goneAuth = (_req: Request, res: Response) => res.status(410).json({ error: 'gone', message: 'Please sign in with your e-mail code or Google.' });
app.post('/api/auth/session', goneAuth);
app.post('/api/auth/register', goneAuth);
app.post('/api/auth/login', goneAuth);

app.get('/api/auth/me', (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  res.json({ user: publicUser(user, { available_credits: availableCredits(user) }) });
});

// Confirmation OTP codes storage
const authCodes: Record<string, { code: string; expires_at: number; mode: string; attempts: number }> = {};
const CODE_MAX_ATTEMPTS = 5;

/** Universal dev code 123456 / code in the response: local development only, never on an https deployment. */
function devAuthCodes() {
  const httpsDeploy = /^https:\/\//i.test(process.env.PUBLIC_URL || '');
  return !httpsDeploy && (process.env.DEV_AUTH_CODES === '1' || process.env.NODE_ENV !== 'production');
}

function mailTransport() {
  if (!smtpReady()) return null;
  return import('nodemailer').then(({ default: nodemailer }) => {
    const port = Number(process.env.SMTP_PORT || 587);
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  });
}

async function sendLoginCodeMail(email: string, code: string): Promise<boolean> {
  const tp = mailTransport();
  if (!tp) return false;
  try {
    const transporter = await tp;
    const from = process.env.MAIL_FROM || process.env.SUPPORT_FROM || process.env.SMTP_USER || 'no-reply@nind.pro';
    await transporter.sendMail({
      from,
      to: email,
      subject: `${code} is your nind ai code`,
      text: `Your nind ai confirmation code is ${code}\n\nIt expires in 15 minutes. If you didn't request it, just ignore this e-mail.\n\nnind ai — https://nind.pro`,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#111"><p>Your <b>nind ai</b> confirmation code:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>It expires in 15 minutes. If you didn't request it, just ignore this e-mail.</p></div>`,
    });
    return true;
  } catch (e: any) {
    console.error('[auth] code e-mail failed:', e?.message || e);
    return false;
  }
}

app.post('/api/auth/send-code', async (req: Request, res: Response) => {
  const { email, mode = 'signup' } = req.body || {};
  const normalized = String(email || '').toLowerCase().trim();
  if (!normalized || normalized.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  if (!rateOk(`code:${normalized}`, 5, 15 * 60_000) || !rateOk(`codeip:${clientIp(req)}`, 20, 60 * 60_000)) {
    return res.status(429).json({ error: 'Too many codes requested. Please wait a few minutes.' });
  }

  const code = crypto.randomInt(100000, 1000000).toString();
  authCodes[normalized] = { code, expires_at: Date.now() + 15 * 60 * 1000, mode: String(mode), attempts: 0 };

  const dev = devAuthCodes();
  if (dev) {
    console.log(`[AUTH] Confirmation code for ${normalized}: ${code}`);
    return res.json({ success: true, message: `Confirmation code sent to ${normalized}`, code });
  }
  const sent = await sendLoginCodeMail(normalized, code);
  if (!sent) {
    delete authCodes[normalized];
    return res.status(503).json({ error: 'We could not send the e-mail right now. Please try again or continue with Google.' });
  }
  res.json({ success: true, message: `Confirmation code sent to ${normalized}` });
});

app.post('/api/auth/verify-code', (req: Request, res: Response) => {
  const { email, code, mode = 'signup' } = req.body || {};
  if (!email || !code) {
    return res.status(400).json({ error: 'Email and code are required' });
  }
  if (!rateOk(`verifyip:${clientIp(req)}`, 30, 15 * 60_000)) {
    return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes.' });
  }

  const normalized = String(email).toLowerCase().trim();
  const entry = authCodes[normalized];
  const given = String(code).trim();
  const isValid = (devAuthCodes() && given === '123456') || (!!entry && entry.code === given && entry.expires_at > Date.now());

  if (!isValid) {
    if (entry && ++entry.attempts >= CODE_MAX_ATTEMPTS) delete authCodes[normalized];
    return res.status(400).json({ error: 'Invalid or expired confirmation code' });
  }

  delete authCodes[normalized];

  let user = Object.values(db.users).find((u) => (u.email || '').toLowerCase() === normalized);

  if (!user) {
    const userId = `usr_${crypto.randomBytes(6).toString('hex')}`;
    user = {
      user_id: userId,
      id: userId,
      username: normalized.split('@')[0] || 'Creator',
      email: normalized,
      name: normalized.split('@')[0] || 'Creator',
      avatar: '/assets/profile-icon.png',
      role: 'creator',
      credits: DEFAULT_SIGNUP_CREDITS,
      created_at: new Date().toISOString(),
    };
    db.users[userId] = user;
    saveDb();
  }

  const token = createSession(user.user_id);
  res.json({
    success: true,
    user: publicUser(user, { token }),
    token,
    message: mode === 'signup' ? 'Account created successfully' : 'Welcome back!',
  });
});

app.post('/api/auth/logout', (req: Request, res: Response) => {
  const t = bearer(req);
  if (t && db.sessions?.[hashToken(t)]) { delete db.sessions[hashToken(t)]; saveDb(); }
  res.json({ success: true, message: 'Logged out' });
});

/** Removes a project's rendered files and its work folder. */
function removeProjectFiles(p: Project) {
  const files = [p.video_url, p.poster_url, p.audio_url, p.source_video_url, ...(p.product_images || [])]
    .filter((u): u is string => typeof u === 'string' && u.startsWith('/api/uploads/'))
    .map((u) => path.resolve(UPLOADS_DIR, path.basename(u)));
  for (const f of files) { try { if (f.startsWith(UPLOADS_DIR + path.sep) && fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {} }
  try { fs.rmSync(path.join(UPLOADS_DIR, `work_${path.basename(p.id)}`), { recursive: true, force: true }); } catch (_) {}
  try { fs.rmSync(path.join(UPLOADS_DIR, `voiceover_${path.basename(p.id)}.mp3`), { force: true }); } catch (_) {}
}

// Account deletion: user, sessions, videos and their files.
app.delete('/api/auth/me', (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const busy = Object.values(db.projects).some((p) => p.user_id === user.user_id && (p.status === 'processing' || p.status === 'pending'));
  if (busy) return res.status(409).json({ error: 'busy', message: 'Wait until your videos finish rendering, then try again.' });
  for (const p of Object.values(db.projects)) {
    if (p.user_id !== user.user_id) continue;
    removeProjectFiles(p);
    delete db.projects[p.id];
  }
  dropSessionsOf(user.user_id);
  delete db.users[user.user_id];
  saveDb();
  res.json({ success: true });
});

function findOrCreateGoogleUser(profile: GoogleProfile): User {
  const email = profile.email.toLowerCase().trim();
  let user = Object.values(db.users).find((u) => (u.email || '').toLowerCase() === email);
  if (user) {
    mergeGoogleProfile(user, profile);
    saveDb();
    return user;
  }
  const userId = `usr_${crypto.randomBytes(6).toString('hex')}`;
  const username = (profile.name || email.split('@')[0] || 'Creator').replace(/\s+/g, '').slice(0, 30) || 'Creator';
  const pic = profile.picture || profile.avatar;
  user = {
    user_id: userId,
    id: userId,
    username,
    email,
    name: profile.name || email.split('@')[0] || 'Creator',
    avatar: pic || DEFAULT_AVATAR,
    picture: pic,
    role: 'creator',
    credits: DEFAULT_SIGNUP_CREDITS,
    created_at: new Date().toISOString(),
    authProvider: 'google',
  };
  db.users[userId] = user;
  saveDb();
  return user;
}

app.get('/api/auth/google/start', (req: Request, res: Response) => {
  startGoogleAuth(req, res, authOrigin(req, publicUrl(req)));
});

app.get('/api/auth/google/callback', async (req: Request, res: Response) => {
  await handleGoogleCallback(req, res, authOrigin(req, publicUrl(req)), (profile) => {
    const user = findOrCreateGoogleUser(profile);
    const token = createSession(user.user_id);
    return { user: publicUser(user, { token }), token };
  });
});

app.get('/api/auth/google/complete', (req: Request, res: Response) => {
  consumeGoogleTicket(req, res);
});

app.post('/api/auth/google/complete', (req: Request, res: Response) => {
  consumeGoogleTicket(req, res);
});

// Formats List
app.get('/api/formats', (_req: Request, res: Response) => {
  const formats = [
    {
      id: 'auto',
      name: 'Авто-определение',
      name_en: 'Auto Detect',
      description: 'AI сам определит наилучший стиль и формат для вашей идеи',
      badge: 'Smart AI',
      icon: 'Sparkles',
    },
    {
      id: 'universal_source_edit',
      name: 'Монтаж с субтитрами',
      name_en: 'Universal Montage',
      description: 'Динамичный монтаж вашего видео со стильными субтитрами и акцентами',
      badge: 'Popular',
      icon: 'Video',
    },
    {
      id: 'kinetic_typography',
      name: 'Кинетическая типографика',
      name_en: 'Kinetic Typography',
      description: 'Крупный анимированный текст в стиле Apple Keynote',
      badge: 'Trending',
      icon: 'Type',
    },
    {
      id: 'product_advertisement',
      name: 'Реклама продукта',
      name_en: 'Product Ad',
      description: 'Эффектная презентация товара с 3D-анимацией и карточками',
      badge: 'Business',
      icon: 'ShoppingBag',
    },
    {
      id: 'device_mockup',
      name: 'iPhone 16 Мокап',
      name_en: 'iPhone 16 Mockup',
      description: 'Демонстрация интерфейса или медиа на экране смартфона',
      badge: '3D Render',
      icon: 'Smartphone',
    },
    {
      id: 'ai_story',
      name: 'AI История',
      name_en: 'AI Story',
      description: 'Захватывающий сторителлинг с озвучкой и кинематографичными кадрами',
      badge: 'Creative',
      icon: 'Film',
    },
    {
      id: 'gameplay_clip',
      name: 'Split-screen Геймплей',
      name_en: 'Gameplay Clip',
      description: 'Видео с реакцией или историей поверх фонового геймплея (Minecraft/Parkour)',
      badge: 'Shorts',
      icon: 'Gamepad2',
    },
  ];
  res.json({ formats });
});

// Video Generation
app.post('/api/video/generate', async (req: Request, res: Response) => {
  const {
    prompt,
    format_id = 'auto',
    language = 'en',
    source_video_url,
    logo_url,
    product_images,
    subtitle_style = 'style_a',
    level: rawLevel,
    voice,
    style,
  } = req.body;
  const level = normLevel(rawLevel);
  const cfg = levelCfg(level);

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  if (prompt.length > 4000) return res.status(400).json({ error: 'Prompt is too long (max 4000 characters).' });
  const isRussian = String(language).toLowerCase().startsWith('ru');
  const targetUser = requireUser(req, res);
  if (!targetUser) return;
  if (level === 'high' && !isCreator(targetUser)) {
    return res.status(403).json({ error: 'creator_required', message: HIGH_LOCKED_MSG });
  }
  if (!rateOk(`gen:${targetUser.user_id}`, 20, 60 * 60_000)) {
    return res.status(429).json({ error: 'rate_limited', message: 'Too many videos started in the last hour. Please wait a bit.' });
  }
  if (activeJobsOf(targetUser.user_id) >= MAX_JOBS_PER_USER) {
    return res.status(429).json({ error: 'busy', message: `You already have ${MAX_JOBS_PER_USER} videos rendering. Wait for one to finish.` });
  }

  // Real cost is charged after rendering ($0.01 = 1 credit); to start, the user must hold
  // enough credits to cover a typical video.
  const available = availableCredits(targetUser);
  if (available < MIN_GENERATION_CREDITS) {
    return res.status(402).json({
      error: 'Insufficient credits',
      message: isRussian
        ? `Недостаточно кредитов: нужно минимум ${MIN_GENERATION_CREDITS}, доступно ${available}.`
        : `Not enough credits: at least ${MIN_GENERATION_CREDITS} needed to create a video, you have ${available}.`,
      required: MIN_GENERATION_CREDITS,
      current: available,
    });
  }

  // Content policy before any credits are reserved: a blocked prompt is never charged.
  // (Runs after the cheap balance check so empty accounts don't cost a moderation call.)
  if (!(await promptAllowed(targetUser, prompt, res, 'generate'))) return;

  // Format: short vertical by default; long-form horizontal only when the prompt asks for it.
  // Uploads: decided from the footage (orientation/length) + the prompt.
  let capUsd = cfg.capUsd;
  let fmt: { format: 'short' | 'long'; aspect: '9:16' | '16:9'; target_seconds: number | null; reason: string };
  if (source_video_url) {
    let probe = { w: 0, h: 0, duration: 0 };
    try {
      const local = path.resolve(__dirname, String(source_video_url).replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\//, '').replace(/^\//, ''));
      if (local.startsWith(UPLOADS_DIR) && fs.existsSync(local)) probe = await probeVideo(local);
    } catch { /* decided again in the worker */ }
    const lay = decideSourceLayout(probe, prompt);
    const mins = (lay.cutTo || lay.maxSeconds || 0) / 60;
    fmt = { format: lay.aspect === '16:9' || (lay.cutTo || lay.maxSeconds) > 300 ? 'long' : 'short', aspect: lay.aspect, target_seconds: lay.cutTo, reason: lay.reason };
    if (mins > 2) capUsd = cfg.capUsd * Math.min(25, mins / 2); // edits of long footage scale with length
  } else {
    const plan = planCreation(prompt);
    fmt = { format: plan.format, aspect: plan.aspect, target_seconds: plan.target_seconds, reason: plan.reason };
    if (plan.chaptered) {
      const est = estimateCreation(plan, level);
      console.log(`[FORMAT] ${plan.reason}; estimate $${est.usd} (${est.credits} credits, min ${est.minCredits}), ${est.chapters} chapters, ~${est.scenes} scenes`);
      if (available < est.minCredits) {
        return res.status(402).json({
          error: 'Insufficient credits',
          message: isRussian
            ? `Недостаточно кредитов для видео на ~${est.minutes} мин: нужно примерно ${est.credits} кредитов (минимум ${est.minCredits}, чтобы начать), доступно ${available}. Выберите длительность покороче или пополните баланс.`
            : `Not enough credits for a ~${est.minutes}-minute video: it needs about ${est.credits} credits (at least ${est.minCredits} to start), you have ${available}. Choose a shorter length or top up.`,
          required: est.minCredits,
          estimated: est.credits,
          current: available,
          format: plan.format,
          target_seconds: plan.target_seconds,
        });
      }
      capUsd = Math.max(cfg.capUsd, est.usd * 1.3);
    }
  }

  // the probe above is async: re-check the balance now so parallel requests can't spend the same credits twice
  const availableNow = availableCredits(targetUser);
  if (availableNow < MIN_GENERATION_CREDITS || activeJobsOf(targetUser.user_id) >= MAX_JOBS_PER_USER) {
    return res.status(402).json({ error: 'Insufficient credits', message: `Not enough free credits right now (${availableNow} available).`, required: MIN_GENERATION_CREDITS, current: availableNow });
  }
  const projectId = `proj_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const budgetUsd = budgetFor(availableNow, capUsd);
  const newProject: Project = {
    id: projectId,
    user_id: targetUser.user_id,
    credits_reserved: Math.ceil(budgetUsd / USD_PER_CREDIT),
    format: fmt.format,
    aspect: fmt.aspect,
    target_seconds: fmt.target_seconds,
    format_reason: fmt.reason,
    level,
    voice: typeof voice === 'string' ? voice : undefined,
    style: style && typeof style === 'object' ? style : undefined,
    kind: source_video_url ? 'source' : 'create',
    prompt,
    format_id,
    language,
    status: 'pending',
    progress: 5,
    progress_message: isRussian ? 'В очереди на генерацию...' : 'Queued for generation...',
    source_video_url: typeof source_video_url === 'string' ? source_video_url : undefined,
    logo_url: typeof logo_url === 'string' ? logo_url : undefined,
    product_images: Array.isArray(product_images) ? product_images.filter((u: any) => typeof u === 'string').slice(0, 20) : undefined,
    subtitle_style,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  db.projects[projectId] = newProject;
  saveDb();

  // Run generation in background
  enqueueJob(() => processVideoGeneration(projectId, false, '', budgetUsd));

  res.json({
    id: projectId,
    project_id: projectId,
    status: 'pending',
    message: 'Generation started',
    format: fmt.format,
    aspect: fmt.aspect,
    target_seconds: fmt.target_seconds,
    remaining_credits: targetUser.credits,
    available_credits: availableCredits(targetUser),
  });
});

// Get Video Project
app.get('/api/video/:id', (req: Request, res: Response) => {
  const project = db.projects[req.params.id];
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  const me = sessionUser(req);
  if (me && project.user_id === me.user_id) return res.json(project);
  // shared link: the video itself, not the owner's account data / edit internals
  const { source_state: _s, cost_breakdown: _c, user_id: _u, credits_reserved: _r, edit_notes: _n, ...pub } = project;
  res.json(pub);
});

function ownProject(req: Request, res: Response): { user: User; project: Project } | undefined {
  const user = requireUser(req, res);
  if (!user) return undefined;
  const project = db.projects[req.params.id];
  if (!project || project.user_id !== user.user_id) { res.status(404).json({ error: 'Project not found' }); return undefined; }
  return { user, project };
}

// Modify Video Project
app.post('/api/video/:id/modify', async (req: Request, res: Response) => {
  const own = ownProject(req, res);
  if (!own) return;
  const original = own.project;
  if (!rateOk(`gen:${own.user.user_id}`, 20, 60 * 60_000)) {
    return res.status(429).json({ error: 'rate_limited', message: 'Too many edits in the last hour. Please wait a bit.' });
  }

  const newPrompt = req.body.prompt || original.prompt;
  if (typeof newPrompt !== 'string' || newPrompt.length > 4000) return res.status(400).json({ error: 'Prompt is too long (max 4000 characters).' });
  const attachments = req.body.attachments || [];
  if (original.status === 'processing' || original.status === 'pending') {
    return res.status(409).json({ error: 'busy', message: 'This video is still being processed.' });
  }
  // Content policy before anything is reserved (the await below must not race a second edit)
  if (!(await promptAllowed(own.user, newPrompt, res, 'edit'))) return;
  if (req.body.language) {
    original.language = req.body.language;
  }
  const isRussian = String(original.language || 'en').toLowerCase().startsWith('ru');

  // Edits are charged by real API cost too ($0.01 = 1 credit) when they finish.
  let editBudget = 0.3;
  const targetUser = own.user;
  if (targetUser) {
    if ((original.status as string) === "processing" || (original.status as string) === "pending") { // may have changed during the moderation await
      return res.status(409).json({ error: 'busy', message: 'This video is still being processed.' });
    }
    const available = availableCredits(targetUser);
    if (available < MIN_EDIT_CREDITS) {
      return res.status(402).json({
        error: 'Insufficient credits',
        message: isRussian
          ? `Недостаточно кредитов для правок: нужно минимум ${MIN_EDIT_CREDITS}, доступно ${available}.`
          : `Not enough credits to edit: at least ${MIN_EDIT_CREDITS} needed, you have ${available}.`,
        required: MIN_EDIT_CREDITS,
        current: available,
      });
    }
    original.user_id = targetUser.user_id;
    if (original.level === 'high' && !isCreator(targetUser)) original.level = 'default'; // High is Creator-only
    original.credits_reserved = Math.min(available, original.format === 'long' ? 1000 : 100);
    // long videos: a re-voice / re-render of many scenes costs more than a short edit
    editBudget = budgetFor(available, original.format === 'long' ? Math.max(1.0, ((original.duration || original.target_seconds || 600) / 60) * 0.2) : 1.0);
  }

  original.prompt = newPrompt;
  original.status = 'processing';
  original.progress = 5;
  original.progress_message = isRussian ? 'Применяем правки к видео...' : 'Applying edits to video...';
  original.modified_from = original.id;
  original.updated_at = new Date().toISOString();

  let editFiles: string[] = [];
  if (Array.isArray(attachments) && attachments.length > 0) {
    const urls = attachments.map((a: any) => (typeof a === 'string' ? a : a.uploadedUrl || a.url)).filter((u: any) => typeof u === 'string' && !u.startsWith('blob:'));
    editFiles = urls.map((u: string) => path.resolve(__dirname, u.replace(/^https?:\/\/[^/]+/, '').replace(/^\/api\//, '').replace(/^\//, '')))
      .filter((p: string) => p.startsWith(UPLOADS_DIR) && fs.existsSync(p) && /\.(png|jpe?g|webp|heic)$/i.test(p));
  }
  original.edit_notes = undefined;
  original.error_message = undefined;

  saveDb();

  enqueueJob(() => processVideoGeneration(original.id, true, newPrompt, editBudget, editFiles));

  res.json({
    ...original,
    remaining_credits: targetUser?.credits,
  });
});

// Export Video Project
app.post('/api/video/:id/export', (req: Request, res: Response) => {
  const project = db.projects[req.params.id];
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }
  res.json({
    download_url: project.video_url || '',
    project_id: project.id,
    status: 'ready',
  });
});

// Video Library
app.get('/api/videos', (req: Request, res: Response) => {
  const me = requireUser(req, res);
  if (!me) return;
  const list = Object.values(db.projects).filter((p) => p.user_id === me.user_id).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  res.json({ projects: list });
});

app.get('/api/videos/user/:userId', (req: Request, res: Response) => {
  const me = requireUser(req, res);
  if (!me) return;
  if (req.params.userId !== me.user_id) return res.status(403).json({ error: 'forbidden' });
  const userId = me.user_id;
  const list = Object.values(db.projects)
    .filter((p) => p.user_id === userId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  res.json({ projects: list });
});

app.patch('/api/videos/:id', (req: Request, res: Response) => {
  const own = ownProject(req, res);
  if (!own) return;
  const project = own.project;
  if (typeof req.body.prompt === 'string') project.prompt = req.body.prompt.slice(0, 4000);
  project.updated_at = new Date().toISOString();
  saveDb();
  res.json(project);
});

app.delete('/api/videos/:id', (req: Request, res: Response) => {
  const own = ownProject(req, res);
  if (!own) return;
  if (own.project.status === 'processing' || own.project.status === 'pending') {
    return res.status(409).json({ error: 'busy', message: 'This video is still rendering.' });
  }
  removeProjectFiles(own.project);
  delete db.projects[own.project.id];
  saveDb();
  res.json({ success: true });
});

// File Uploads
/** Auth + per-user rate limit in front of multer, so anonymous clients can't fill the disk. */
function uploadGate(req: Request, res: Response, next: any) {
  const user = requireUser(req, res);
  if (!user) return;
  if (!rateOk(`upl:${user.user_id}`, 120, 60 * 60_000)) return res.status(429).json({ error: 'rate_limited', message: 'Too many uploads. Please wait a bit.' });
  const why = restriction(user);
  if (why) return res.status(403).json({ error: 'account_restricted', message: why });
  (req as any).nindUser = user;
  next();
}

app.post('/api/upload', uploadGate, upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const upUser: User = (req as any).nindUser;
  if (!(await uploadAllowed(upUser, req.file.path, res))) return;
  const fileUrl = `/api/uploads/${req.file.filename}`;
  const thumbnailUrl = await makeUploadThumbnail(req.file.path, req.file.originalname, req.file.mimetype);
  res.json({
    url: fileUrl,
    file_url: fileUrl,
    filename: req.file.filename,
    size: req.file.size,
    ...(thumbnailUrl ? { thumbnail_url: thumbnailUrl } : {}),
  });
});

// Chunked Uploads
app.post('/api/upload/init', (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const why = restriction(user);
  if (why) return res.status(403).json({ error: 'account_restricted', message: why });
  const { filename, total_chunks } = req.body;
  // basename only + media extension only (prevents ../ path traversal when the chunks are assembled)
  const safeName = path.basename(String(filename || 'file.bin')).replace(/[^\w.\-]+/g, '_').slice(-80);
  if (!UPLOAD_EXT.test(safeName)) return res.status(415).json({ error: 'unsupported_file_type', message: 'Please upload a video, image or audio file.' });
  const chunks = Math.floor(Number(total_chunks) || 1);
  if (chunks < 1 || chunks > 200) return res.status(400).json({ error: 'invalid_chunks' });
  const uploadId = `upl_${crypto.randomBytes(8).toString('hex')}`;
  db.chunk_uploads[uploadId] = {
    total_chunks: chunks,
    chunks: {},
    filename: safeName,
    user_id: user.user_id,
  } as any;
  saveDb();
  res.json({ upload_id: uploadId });
});

app.post('/api/upload/chunk', uploadGate, upload.single('chunk'), (req: Request, res: Response) => {
  const { upload_id, chunk_index } = req.body;
  const uploadSession = db.chunk_uploads[upload_id] as any;
  const idx = Number(chunk_index);
  if (!uploadSession || !req.file || uploadSession.user_id !== (req as any).nindUser.user_id || !Number.isInteger(idx) || idx < 0 || idx >= uploadSession.total_chunks) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
    return res.status(400).json({ error: 'Invalid upload session or chunk' });
  }

  uploadSession.chunks[idx] = req.file.path;
  res.json({ success: true, chunk_index });
});

app.post('/api/upload/complete', (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const uploadId = (req.query.upload_id as string) || req.body.upload_id;
  const session = db.chunk_uploads[uploadId] as any;
  if (!session || session.user_id !== user.user_id) return res.status(404).json({ error: 'Upload session not found' });
  const finalName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${path.basename(session.filename)}`;
  const finalPath = path.join(UPLOADS_DIR, finalName);
  const writeStream = fs.createWriteStream(finalPath);

  for (let i = 0; i < session.total_chunks; i++) {
    const chunkPath = session.chunks[i];
    if (chunkPath && fs.existsSync(chunkPath)) {
      const data = fs.readFileSync(chunkPath);
      writeStream.write(data);
      try {
        fs.unlinkSync(chunkPath);
      } catch (_) {}
    }
  }
  delete db.chunk_uploads[uploadId];
  saveDb();

  const fileUrl = `/api/uploads/${finalName}`;
  writeStream.on('error', (err) => {
    console.error('Failed to assemble chunked upload:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to assemble upload' });
  });
  writeStream.end(async () => {
    if (res.headersSent) return;
    if (!(await uploadAllowed(user, finalPath, res))) return;
    const thumbnailUrl = await makeUploadThumbnail(finalPath, session.filename);
    res.json({
      url: fileUrl,
      file_url: fileUrl,
      filename: finalName,
      ...(thumbnailUrl ? { thumbnail_url: thumbnailUrl } : {}),
    });
  });
});

// Legacy prototype endpoints (fake 3D mockup / montage / placeholder transcription) are disabled:
// they returned placeholder output instead of real results. Voice input uses the browser's speech recognition.
const notAvailable = (_req: Request, res: Response) => res.status(410).json({ error: 'not_available', message: 'This feature is not available.' });
app.post('/api/device-mockup/create', notAvailable);
app.get('/api/montage/styles', notAvailable);
app.post('/api/montage/create', notAvailable);
app.get('/api/montage/:id', notAvailable);
app.post('/api/voice/transcribe', notAvailable);

// ======================= SUBSCRIPTIONS (Whop) =======================
function publicUrl(req: Request) {
  const env = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
  if (env) return env;
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

/** New subscription month: unused subscription credits of the previous month expire, purchased/welcome credits stay. */
function grantSubscriptionPeriod(user: User, plan: PlanDef) {
  const extra = Math.max(0, (user.credits || 0) - (user.sub_credits || 0));
  user.sub_credits = plan.credits;
  user.credits = extra + plan.credits;
  user.last_deposit = user.credits;
  user.plan_credits = plan.credits;
}

function activateSubscription(user: User, plan: PlanDef, membershipId?: string | null) {
  user.plan = plan.tier === 'starter' ? 'starter' : 'pro';
  user.plan_key = plan.key;
  user.billing_cycle = plan.cycle;
  user.subscription_status = 'active';
  user.cancel_at_period_end = false;
  user.ever_subscribed = true;
  if (membershipId) user.whop_membership_id = membershipId;
}

function downgradeToFree(user: User, reason: string) {
  user.credits = Math.max(0, (user.credits || 0) - (user.sub_credits || 0));
  user.sub_credits = 0;
  user.plan = 'free';
  user.subscription_status = reason;
  user.plan_key = undefined;
  user.plan_credits = undefined;
  user.next_credit_at = undefined;
  user.cancel_at_period_end = false;
}

function findWhopUser(d: any): User | undefined {
  const meta = pick.meta(d);
  const uid = meta.nind_user_id || meta.user_id;
  if (uid && db.users[uid]) return db.users[uid];
  const mem = pick.membership(d);
  if (mem) { const u = Object.values(db.users).find((x) => x.whop_membership_id === mem); if (u) return u; }
  const email = pick.email(d);
  if (email) {
    const matches = Object.values(db.users).filter((x) => (x.email || '').toLowerCase() === email);
    if (matches.length === 1) return matches[0];
  }
  return undefined;
}

const DAY = 86400000;

/** Processes a verified Whop event. Returns a short status string (for logs/tests). */
function processWhopEvent(evt: any): string {
  const type = String(evt?.type || '');
  const d = evt?.data || {};
  if (type === 'payment.succeeded') {
    const payId = String(d.id || '');
    if (payId && db.whop_payments![payId]) return 'duplicate_payment';
    const topup = topUpByVariant(pick.variant(d));
    if (topup || pick.meta(d).nind_topup) {
      const pack = topup || TOPUPS.find((t) => String(t.credits) === String(pick.meta(d).nind_topup));
      if (!pack) return 'ignored_unknown_topup';
      const user = findWhopUser(d);
      if (!user) { db.whop_unmatched!.push({ at: new Date().toISOString(), type, payment: payId, variant: pack.variantId, email: pick.email(d) }); return 'unmatched_user'; }
      // Purchased credits are not subscription credits: they never expire with the month.
      user.credits = (user.credits || 0) + pack.credits;
      user.last_deposit = Math.max(user.last_deposit || 0, user.credits);
      if (payId) db.whop_payments![payId] = user.user_id;
      if (!db.whop_topups) db.whop_topups = {};
      db.whop_topups[payId || `t_${Date.now()}`] = { user_id: user.user_id, credits: pack.credits, created_at: new Date().toISOString() };
      console.log(`[whop] top-up ${payId} -> ${user.user_id} +${pack.credits} credits`);
      return 'topup_granted';
    }
    const plan = planByVariant(pick.variant(d)) || PLANS.find((p) => p.key === pick.meta(d).nind_plan);
    if (!plan) return 'ignored_unknown_plan';
    const user = findWhopUser(d);
    if (!user) { db.whop_unmatched!.push({ at: new Date().toISOString(), type, payment: payId, variant: plan.variantId, email: pick.email(d) }); return 'unmatched_user'; }
    const promo = pick.promo(d);
    const promoUsed = plan.key === STARTER_PROMO.planKey && !user.starter_promo_used &&
      (promo === STARTER_PROMO.id.toLowerCase() || promo === STARTER_PROMO.code.toLowerCase() ||
        (!promo && pick.meta(d).nind_promo === 'starter_intro' && !(Number(d.subtotal ?? d.total ?? d.usd_total ?? 0) >= STARTER_PROMO.regular)));
    if (promoUsed) { user.starter_promo_used = true; db.starter_promo_count = (db.starter_promo_count || 0) + 1; invalidatePromoCache(); }
    activateSubscription(user, plan, pick.membership(d));
    if (d.user_id || d.user?.id) user.whop_user_id = d.user_id || d.user?.id;
    grantSubscriptionPeriod(user, plan);
    const now = Date.now();
    user.next_credit_at = plan.cycle === 'annual' ? new Date(now + 30 * DAY).toISOString() : undefined;
    user.period_end = new Date(now + (plan.cycle === 'annual' ? 365 : 30) * DAY).toISOString();
    if (payId) db.whop_payments![payId] = user.user_id;
    console.log(`[whop] ${payId} -> ${user.user_id} ${plan.key} (+${plan.credits} credits, reason ${d.billing_reason || '-'})`);
    return 'granted';
  }
  if (type.startsWith('membership.')) {
    const user = findWhopUser(d);
    if (!user) return 'unmatched_user';
    const mem = pick.membership(d);
    if (user.whop_membership_id && mem && user.whop_membership_id !== mem && type !== 'membership.activated') return 'other_membership';
    const status = String(d.status || '');
    if (type === 'membership.activated' || status === 'active' || status === 'trialing') {
      const plan = planByVariant(pick.variant(d));
      if (plan && user.plan_key !== plan.key && type === 'membership.activated') activateSubscription(user, plan, mem); // credits come with payment.succeeded
      else if (mem) user.whop_membership_id = mem;
      if (status === 'active' || type === 'membership.activated') user.subscription_status = 'active';
      user.cancel_at_period_end = !!d.cancel_at_period_end;
      if (d.renewal_period_end) user.period_end = new Date(typeof d.renewal_period_end === 'number' ? d.renewal_period_end * 1000 : d.renewal_period_end).toISOString();
      return 'active';
    }
    if (status === 'past_due') { user.subscription_status = 'past_due'; return 'past_due'; }
    if (type === 'membership.deactivated' || ['canceled', 'expired', 'completed', 'unresolved'].includes(status)) {
      downgradeToFree(user, status || 'canceled');
      return 'downgraded';
    }
    return 'noop';
  }
  return 'ignored';
}

function handleWhopWebhook(req: Request, res: Response) {
  const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
  const secret = process.env.WHOP_WEBHOOK_SECRET || '';
  if (!secret) return res.status(503).json({ error: 'webhook_not_configured' });
  if (!verifyWebhook(raw, req.headers as any, secret)) return res.status(401).json({ error: 'invalid_signature' });
  let evt: any;
  try { evt = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'invalid_json' }); }
  const eventId = String(req.headers['webhook-id'] || evt.id || '');
  if (eventId && db.whop_events![eventId]) return res.json({ ok: true, result: 'duplicate_event' });
  let result = 'error';
  try { result = processWhopEvent(evt); } catch (e: any) { console.error('[whop] webhook error', e?.message); return res.status(500).json({ error: 'processing_failed' }); }
  if (eventId) db.whop_events![eventId] = new Date().toISOString();
  saveDb();
  res.json({ ok: true, result });
}

// Annual plans pay once a year but credits are issued monthly.
function refillAnnualCredits() {
  const now = Date.now();
  let changed = false;
  for (const u of Object.values(db.users)) {
    if (u.billing_cycle !== 'annual' || u.subscription_status !== 'active' || !u.plan_key || !u.next_credit_at) continue;
    if (Date.parse(u.next_credit_at) > now) continue;
    if (u.period_end && Date.parse(u.period_end) <= now) continue; // the yearly renewal payment refills instead
    const plan = PLANS.find((p) => p.key === u.plan_key);
    if (!plan) continue;
    grantSubscriptionPeriod(u, plan);
    u.next_credit_at = new Date(Date.parse(u.next_credit_at) + 30 * DAY).toISOString();
    changed = true;
    console.log(`[whop] annual monthly refill ${u.user_id} +${plan.credits}`);
  }
  if (changed) saveDb();
}
setInterval(refillAnnualCredits, 60 * 60 * 1000).unref?.();
setTimeout(refillAnnualCredits, 15000).unref?.();

app.get('/api/subscription/plans', (_req: Request, res: Response) => {
  res.json({
    plans: PLANS.map(({ key, tier, name, credits, cycle, price }) => ({ key, tier, name, credits, cycle, price })),
    topups: TOPUPS.map(({ credits, price }) => ({ credits, price })),
  });
});

// Starter intro offer for the Upgrade page: { active, eligible, price, regular, remaining }
app.get('/api/subscription/offer', async (req: Request, res: Response) => {
  const user = sessionUser(req);
  const st = await starterPromoState();
  const eligible = starterPromoEligible(user);
  res.json({ starter_intro: { active: st.active, eligible, show: st.active && eligible, price: STARTER_PROMO.price, regular: STARTER_PROMO.regular, remaining: st.remaining, limit: st.limit } });
});

// Body: { user_id, tier: 'starter'|'creator', credits?: 3000|6000|9000, cycle: 'monthly'|'annually' }
app.post('/api/subscription/checkout', async (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!rateOk(`chk:${user.user_id}`, 30, 60 * 60_000)) return res.status(429).json({ error: 'rate_limited' });
  const plan = findPlan(String(req.body?.tier || req.body?.plan || ''), Number(req.body?.credits), String(req.body?.cycle || 'monthly'));
  if (!plan) return res.status(400).json({ error: 'unknown_plan' });
  const sessionId = `chk_${crypto.randomBytes(8).toString('hex')}`;
  try {
    let promoCode: string | undefined;
    if (plan.key === STARTER_PROMO.planKey && starterPromoEligible(user) && (await starterPromoState()).active) promoCode = STARTER_PROMO.code;
    const co = await createCheckout(plan, user.user_id, `${publicUrl(req)}/subscription/success?session_id=${sessionId}`, promoCode);
    db.whop_checkouts![sessionId] = { user_id: user.user_id, plan_key: plan.key, created_at: new Date().toISOString() };
    saveDb();
    res.json({ url: co.url, session_id: sessionId, mode: co.mode, plan: plan.key, intro_price: !!promoCode });
  } catch (e: any) {
    console.error('[whop] checkout error', e?.message);
    res.status(502).json({ error: 'checkout_failed', message: 'Could not open checkout. Please try again.' });
  }
});

app.get('/api/subscription/status/:sessionId', (req: Request, res: Response) => {
  const chk = db.whop_checkouts?.[req.params.sessionId];
  if (!chk) return res.status(404).json({ status: 'unknown' });
  const me = sessionUser(req);
  if (me && me.user_id !== chk.user_id) return res.status(404).json({ status: 'unknown' });
  const user = db.users[chk.user_id];
  const paid = !!user && user.subscription_status === 'active' && user.plan_key === chk.plan_key;
  const expired = !paid && Date.now() - Date.parse(chk.created_at) > 2 * DAY;
  res.json({ status: paid ? 'active' : expired ? 'expired' : 'pending', payment_status: paid ? 'paid' : 'unpaid', plan: chk.plan_key, credits: user?.credits });
});

// Credit top-up (subscribers only): one-time Whop checkout for a fixed pack; credits arrive with payment.succeeded.
app.post('/api/topup', async (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  const pack = TOPUPS.find((t) => t.credits === Math.floor(Number(req.body?.credits)));
  if (!pack) return res.status(400).json({ error: 'invalid_amount', message: 'Choose one of the credit packs.' });
  const active = user.subscription_status === 'active' || (!!user.plan && user.plan !== 'free');
  if (!active) return res.status(403).json({ error: 'subscription_required', message: 'Top-ups are available with an active subscription.' });
  if (!rateOk(`topup:${user.user_id}`, 30, 60 * 60_000)) return res.status(429).json({ error: 'rate_limited' });
  try {
    const co = await createCheckoutFor(pack.variantId, { nind_user_id: user.user_id, nind_topup: String(pack.credits) }, `${publicUrl(req)}/`);
    res.json({ checkout_url: co.url, credits: pack.credits, price: pack.price, mode: co.mode });
  } catch (e: any) {
    console.error('[whop] top-up checkout error', e?.message);
    res.status(502).json({ error: 'checkout_failed', message: 'Could not open checkout. Please try again.' });
  }
});

// User Management & Settings
app.put('/api/users/:userId', (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (req.params.userId !== user.user_id) return res.status(403).json({ error: 'forbidden' });
  // never let the client set its own balance / plan or the manual-edit flags
  // whitelist of profile fields the client may change (never balance, plan, email or ids)
  const body = req.body || {};
  const safe: Record<string, any> = {};
  for (const k of ['username', 'name', 'bio', 'language', 'picture', 'avatar']) {
    if (typeof body[k] === 'string') safe[k] = body[k].slice(0, k === 'bio' ? 1000 : 500);
  }
  for (const k of ['picture', 'avatar']) {
    // own uploads or Google profile photos only (no javascript:/data: URLs)
    if (safe[k] && !/^(\/api\/uploads\/|\/assets\/|https:\/\/[a-z0-9.-]+\.googleusercontent\.com\/|https?:\/\/[^/]+\/api\/uploads\/)/i.test(safe[k])) delete safe[k];
  }
  const nextName = typeof safe.name === 'string' ? safe.name.trim() : undefined;
  if (nextName) {
    safe.name = nextName;
    if (nextName !== user.name) user.name_manual = true;
  }
  const nextPic = typeof safe.picture === 'string' && safe.picture
    ? safe.picture
    : (typeof safe.avatar === 'string' && safe.avatar ? safe.avatar : undefined);
  if (nextPic) {
    safe.picture = nextPic;
    safe.avatar = nextPic;
    user.picture_manual = true;
  }
  Object.assign(user, safe);
  saveDb();
  res.json({ user: publicUser(user) });
});

// Current user profile incl. live credit balance (used by Account page)
app.get('/api/users/:userId', (req: Request, res: Response) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (req.params.userId !== user.user_id) return res.status(403).json({ error: 'forbidden' });
  res.json({ user: publicUser(user, { available_credits: availableCredits(user) }) });
});

app.get('/api/users/check-username/:username', (req: Request, res: Response) => {
  const username = req.params.username.toLowerCase();
  const exclude = req.query.exclude_user_id as string;
  const taken = Object.values(db.users).some(
    (u) => u.username.toLowerCase() === username && u.user_id !== exclude
  );
  res.json({ available: !taken });
});

app.get('/api/user/notifications', (_req: Request, res: Response) => {
  res.json({ notifications: db.notifications || [] });
});

app.get('/api/users/:userId/notifications', (_req: Request, res: Response) => {
  res.json({ notifications: db.notifications || [] });
});

app.get('/api/users/:userId/team', (_req: Request, res: Response) => {
  res.json({ team: [], members: [] });
});

// ======================= SUPPORT =======================
const SUPPORT_INBOX = 'support@nind.pro';
const SUPPORT_RATE_WINDOW_MS = 10 * 60 * 1000;
const SUPPORT_RATE_MAX = 5;
const supportHits: Record<string, number[]> = {};

function smtpReady() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function supportRateOk(key: string) {
  const now = Date.now();
  const recent = (supportHits[key] || []).filter((t) => now - t < SUPPORT_RATE_WINDOW_MS);
  if (recent.length >= SUPPORT_RATE_MAX) {
    supportHits[key] = recent;
    return false;
  }
  recent.push(now);
  supportHits[key] = recent;
  return true;
}

function buildSupportMailto(email: string, subject: string, message: string) {
  const body = `From: ${email || '(not provided)'}\n\n${message || ''}`;
  return `mailto:${SUPPORT_INBOX}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function sendSupportMail(entry: SupportRequest): Promise<boolean> {
  if (!smtpReady()) return false;
  try {
    const nodemailer = (await import('nodemailer')).default;
    const port = Number(process.env.SMTP_PORT || 587);
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    const from = process.env.SUPPORT_FROM || process.env.SMTP_USER || SUPPORT_INBOX;
    await transporter.sendMail({
      from,
      to: SUPPORT_INBOX,
      replyTo: entry.email,
      subject: entry.subject,
      text: `From: ${entry.email}\nUser: ${entry.user_id || '-'}\nFAQ: ${entry.faq_id || '-'}\n\n${entry.message}`,
    });
    return true;
  } catch (e) {
    console.error('[support] email send failed', e);
    return false;
  }
}

// Body: { email, subject, message, user_id?, faq_id? }
app.post('/api/support', async (req: Request, res: Response) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const subject = String(req.body?.subject || 'Help & Support').trim().slice(0, 200) || 'Help & Support';
  const message = String(req.body?.message || '').trim().slice(0, 5000);
  const userId = sessionUser(req)?.user_id;
  const faqId = String(req.body?.faq_id || '').trim().slice(0, 80) || undefined;
  if (!email || !email.includes('@') || email.length > 200) {
    return res.status(400).json({ error: 'invalid_email', message: 'Please enter a valid email address.' });
  }
  if (!message) {
    return res.status(400).json({ error: 'invalid_message', message: 'Please write a short message.' });
  }
  if (!supportRateOk(email) || !supportRateOk(`ip:${clientIp(req)}`)) {
    return res.status(429).json({ error: 'rate_limited', message: 'Please wait a few minutes before sending another message.' });
  }
  const entry: SupportRequest = {
    id: `sup_${crypto.randomBytes(6).toString('hex')}`,
    user_id: userId,
    email,
    subject,
    message,
    faq_id: faqId,
    created_at: new Date().toISOString(),
    emailed: false,
  };
  if (!db.support_requests) db.support_requests = [];
  db.support_requests.push(entry);
  saveDb();
  const emailed = await sendSupportMail(entry);
  if (emailed) {
    entry.emailed = true;
    saveDb();
  }
  res.json({
    ok: true,
    id: entry.id,
    emailed,
    mailto: emailed ? undefined : buildSupportMailto(email, subject, message),
  });
});

// Uploads / JSON parse errors -> clean JSON responses instead of HTML stack traces
app.use((err: any, req: Request, res: Response, next: any) => {
  if (!err) return next();
  if (res.headersSent) return next(err);
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'file_too_large', message: 'Files up to 500 MB are supported.' });
  if (String(err?.message) === 'unsupported_file_type') return res.status(415).json({ error: 'unsupported_file_type', message: 'Please upload a video, image or audio file.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
  console.error('[http] unhandled error on', req.method, req.path, err?.message || err);
  res.status(500).json({ error: 'server_error' });
});

process.on('unhandledRejection', (e) => console.error('[process] unhandled rejection:', e));
process.on('uncaughtException', (e) => console.error('[process] uncaught exception:', e));

function startupChecks() {
  const prod = process.env.NODE_ENV === 'production';
  if (devAuthCodes()) console.warn('⚠️  DEV auth codes are ON (code 123456 works for any e-mail). Never run like this on the public site.');
  if (prod && !smtpReady()) console.warn('⚠️  SMTP_* is not set: e-mail login codes cannot be delivered (only Google sign-in will work).');
  if (prod && !process.env.PUBLIC_URL) console.warn('⚠️  PUBLIC_URL is not set (Google OAuth / Whop redirects use the Host header).');
  if (prod && !process.env.WHOP_WEBHOOK_SECRET) console.warn('⚠️  WHOP_WEBHOOK_SECRET is not set: subscriptions will not be credited.');
  if (prod && !process.env.GOOGLE_CLIENT_ID) console.warn('⚠️  GOOGLE_CLIENT_ID is not set: Google sign-in disabled.');
}

// ======================= FRONTEND SERVING =======================
async function startServer() {
  startupChecks();
  if (process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve(__dirname, 'dist'))) {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist/index.html'));
    });
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 nind ai server running on port ${PORT}`);
    });
  } else {
    // In dev mode, attach Vite HMR to HTTP server on port 3000
    const http = await import('http');
    const httpServer = http.createServer(app);
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: {
          ignored: [
            '**/uploads/**',
            '**/data/**',
            '**/*.json',
            '**/dist/**',
            '**/.git/**',
            '**/public/assets/**',
          ],
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 nind ai server running on port ${PORT}`);
    });
  }
}

startServer().catch((err) => {
  console.error('Fatal server error:', err);
});
