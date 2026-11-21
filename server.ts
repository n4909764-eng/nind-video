import { PLANS, findPlan, planByVariant, createCheckout, verifyWebhook, pick, PlanDef } from './whop';
import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import crypto from 'crypto';
import { spawn } from 'child_process';
import https from 'https';
import dotenv from 'dotenv';
import { runVideoPipeline, newCostTracker, CostTracker, levelCfg, normLevel, Level, ffmpeg } from './videoPipeline';
import { applyCreatedEdit, runSourceEdit, applySourceEdit, SourceState } from './editEngine';
import { planCreation, estimateCreation, runLongVideoPipeline, decideSourceLayout } from './longForm';
import { probeVideo } from './smartReframe';
import { CaptionStyle } from './captionStyle';
import { startGoogleAuth, handleGoogleCallback, consumeGoogleTicket, authOrigin } from './googleAuth';

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
  support_requests?: SupportRequest[];
}

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
  } catch (e) {
    console.error('Error loading db.json:', e);
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
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
    const ext = path.extname(file.originalname) || '.bin';
    const unique = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, unique);
  },
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

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
      const r = await ffmpeg(['-ss', String(ss), '-i', srcPath, '-an', '-frames:v', '1', '-vf', vf, '-q:v', '3', thumbPath], 45_000);
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
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Static uploads serving
app.use('/api/uploads', express.static(UPLOADS_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));
app.use('/assets', express.static(path.resolve(__dirname, 'public/assets')));

// ======================= CREDITS =======================
// $0.01 of real OpenRouter API cost = 1 credit. Real cost is summed per video
// (usage.cost from every OpenRouter response) and charged when the job finishes.
const USD_PER_CREDIT = 0.01;
const MIN_GENERATION_CREDITS = Number(process.env.MIN_GENERATION_CREDITS || 10); // must hold at least this to start
const MIN_EDIT_CREDITS = Number(process.env.MIN_EDIT_CREDITS || 3);
const DEFAULT_SIGNUP_CREDITS = Number(process.env.WELCOME_CREDITS || 20);
const MIN_TOPUP = 500;
const MAX_TOPUP = 50000;

/** The job's spending limit: never more than the user's available balance (and the level's cap). */
function budgetFor(available: number, capUsd: number) {
  return Math.max(0.01, Math.min(available * USD_PER_CREDIT, capUsd));
}

function getOrCreateUser(userId?: string): User | undefined {
  if (!userId) return undefined;
  if (db.users[userId]) return db.users[userId];
  // The browser may hold a user created client-side (offline fallback) — register it
  // server-side instead of silently charging somebody else's account.
  const u: User = {
    user_id: userId, id: userId, username: 'Creator', email: '', name: 'Creator',
    avatar: '/assets/profile-icon.png', role: 'creator', credits: DEFAULT_SIGNUP_CREDITS,
    created_at: new Date().toISOString(),
  };
  db.users[userId] = u;
  saveDb();
  return u;
}

function reservedCredits(userId: string): number {
  return Object.values(db.projects)
    .filter((p) => p.user_id === userId && (p.status === 'pending' || p.status === 'processing'))
    .reduce((sum, p) => sum + (p.credits_reserved || 0), 0);
}

function availableCredits(user: User): number {
  return Math.max(0, (user.credits || 0) - reservedCredits(user.user_id));
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
      audioFile = r.state.audio;
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
  res.json({ message: 'Slind AI API', status: 'ok' });
});

// Auth & Session Endpoints
app.post('/api/auth/session', (req: Request, res: Response) => {
  const token = req.body?.session_token || `guest_${crypto.randomBytes(8).toString('hex')}`;
  const userId = `usr_${crypto.randomBytes(6).toString('hex')}`;
  const user: User = {
    user_id: userId,
    id: userId,
    username: 'Guest Creator',
    email: 'guest@slind.ai',
    name: 'Guest Creator',
    avatar: '/assets/profile-icon.png',
    role: 'creator',
    credits: DEFAULT_SIGNUP_CREDITS,
    created_at: new Date().toISOString(),
  };

  db.users[userId] = user;
  saveDb();

  res.json({
    user,
    session_token: token,
    session_id: token,
  });
});

app.get('/api/auth/me', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const userId = req.headers['x-user-id'] as string;
  let user: User | undefined;

  if (userId && db.users[userId]) {
    user = db.users[userId];
  } else {
    // Return first user or default active session
    const users = Object.values(db.users);
    user = users.length > 0 ? users[users.length - 1] : undefined;
  }

  if (!user) {
    const defaultId = 'usr_default';
    user = {
      user_id: defaultId,
      id: defaultId,
      username: 'Slind Creator',
      email: 'creator@slind.ai',
      name: 'Slind Creator',
      avatar: '/assets/profile-icon.png',
      role: 'creator',
      credits: DEFAULT_SIGNUP_CREDITS,
      created_at: new Date().toISOString(),
    };
    db.users[defaultId] = user;
    saveDb();
  }

  res.json({ user });
});

// Confirmation OTP codes storage
const authCodes: Record<string, { code: string; expires_at: number; mode: string }> = {};

app.post('/api/auth/send-code', (req: Request, res: Response) => {
  const { email, mode = 'signup' } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  const normalized = email.toLowerCase().trim();
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  authCodes[normalized] = {
    code,
    expires_at: Date.now() + 15 * 60 * 1000,
    mode,
  };

  const devCodes = process.env.DEV_AUTH_CODES === '1' || process.env.NODE_ENV !== 'production';
  if (devCodes) console.log(`[AUTH] Confirmation code for ${normalized}: ${code}`);
  const payload: { success: boolean; message: string; code?: string } = {
    success: true,
    message: `Confirmation code sent to ${normalized}`,
  };
  if (devCodes) payload.code = code;
  res.json(payload);
});

app.post('/api/auth/verify-code', (req: Request, res: Response) => {
  const { email, code, mode = 'signup' } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: 'Email and code are required' });
  }

  const normalized = email.toLowerCase().trim();
  const entry = authCodes[normalized];
  const devCodes = process.env.DEV_AUTH_CODES === '1' || process.env.NODE_ENV !== 'production';
  const isValid = (devCodes && code === '123456') || (entry && entry.code === code && entry.expires_at > Date.now());

  if (!isValid) {
    return res.status(400).json({ error: 'Invalid or expired confirmation code' });
  }

  delete authCodes[normalized];

  let user = Object.values(db.users).find((u) => u.email.toLowerCase() === normalized);

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

  res.json({
    success: true,
    user,
    token: `token_${user.user_id}`,
    message: mode === 'signup' ? 'Account created successfully' : 'Welcome back!',
  });
});

app.post('/api/auth/register', (req: Request, res: Response) => {
  const { email, password, username, name } = req.body;
  const userId = `usr_${crypto.randomBytes(6).toString('hex')}`;
  const newUser: User = {
    user_id: userId,
    id: userId,
    username: username || email?.split('@')[0] || 'Creator',
    email: email || 'user@slind.ai',
    name: name || username || 'Creator',
    avatar: '/assets/profile-icon.png',
    role: 'creator',
    credits: DEFAULT_SIGNUP_CREDITS,
    created_at: new Date().toISOString(),
  };

  db.users[userId] = newUser;
  saveDb();

  res.json({
    user: newUser,
    token: `token_${userId}`,
    message: 'Registered successfully',
  });
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const { email } = req.body;
  let user = Object.values(db.users).find((u) => u.email === email);

  if (!user) {
    const userId = `usr_${crypto.randomBytes(6).toString('hex')}`;
    user = {
      user_id: userId,
      id: userId,
      username: email?.split('@')[0] || 'Creator',
      email: email || 'creator@slind.ai',
      name: email?.split('@')[0] || 'Creator',
      avatar: '/assets/profile-icon.png',
      role: 'creator',
      credits: DEFAULT_SIGNUP_CREDITS,
      created_at: new Date().toISOString(),
    };
    db.users[userId] = user;
    saveDb();
  }

  res.json({
    user,
    token: `token_${user.user_id}`,
    message: 'Logged in successfully',
  });
});

app.post('/api/auth/logout', (_req: Request, res: Response) => {
  res.json({ success: true, message: 'Logged out' });
});

app.delete('/api/auth/me', (req: Request, res: Response) => {
  const userId = req.headers['x-user-id'] as string;
  if (userId && db.users[userId]) {
    delete db.users[userId];
    saveDb();
  }
  res.json({ success: true });
});

function findOrCreateGoogleUser(profile: { email: string; name: string; avatar?: string }): User {
  const email = profile.email.toLowerCase().trim();
  let user = Object.values(db.users).find((u) => (u.email || '').toLowerCase() === email);
  if (user) {
    if (profile.name && (!user.name || user.name === (user.email || '').split('@')[0])) user.name = profile.name;
    if (profile.avatar) user.avatar = profile.avatar;
    if (!user.authProvider) user.authProvider = 'google';
    saveDb();
    return user;
  }
  const userId = `usr_${crypto.randomBytes(6).toString('hex')}`;
  const username = (profile.name || email.split('@')[0] || 'Creator').replace(/\s+/g, '').slice(0, 30) || 'Creator';
  user = {
    user_id: userId,
    id: userId,
    username,
    email,
    name: profile.name || email.split('@')[0] || 'Creator',
    avatar: profile.avatar || '/assets/profile-icon.png',
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
    return { user, token: `token_${user.user_id}` };
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
    user_id,
    level: rawLevel,
    voice,
    style,
  } = req.body;
  const level = normLevel(rawLevel);
  const cfg = levelCfg(level);

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  const isRussian = String(language).toLowerCase().startsWith('ru');
  const effectiveUserId = user_id || (req.headers['x-user-id'] as string) || 'usr_default';
  const targetUser = getOrCreateUser(effectiveUserId);
  if (!targetUser) return res.status(401).json({ error: 'Not signed in' });

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

  const projectId = `proj_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const budgetUsd = budgetFor(available, capUsd);
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
    source_video_url,
    logo_url,
    product_images,
    subtitle_style,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  db.projects[projectId] = newProject;
  saveDb();

  // Run generation in background
  setTimeout(() => {
    processVideoGeneration(projectId, false, '', budgetUsd);
  }, 100);

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
  res.json(project);
});

// Modify Video Project
app.post('/api/video/:id/modify', (req: Request, res: Response) => {
  const original = db.projects[req.params.id];
  if (!original) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const newPrompt = req.body.prompt || original.prompt;
  const attachments = req.body.attachments || [];
  if (req.body.language) {
    original.language = req.body.language;
  }
  const isRussian = String(original.language || 'en').toLowerCase().startsWith('ru');

  // Edits are charged by real API cost too ($0.01 = 1 credit) when they finish.
  let editBudget = 0.3;
  const ownerId = original.user_id || (req.headers['x-user-id'] as string);
  const targetUser = getOrCreateUser(ownerId);
  if (targetUser) {
    if (original.status === 'processing' || original.status === 'pending') {
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

  setTimeout(() => {
    processVideoGeneration(original.id, true, newPrompt, editBudget, editFiles);
  }, 100);

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
app.get('/api/videos', (_req: Request, res: Response) => {
  const list = Object.values(db.projects).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  res.json({ projects: list });
});

app.get('/api/videos/user/:userId', (req: Request, res: Response) => {
  const userId = req.params.userId;
  const list = Object.values(db.projects)
    .filter((p) => p.user_id === userId || !p.user_id)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  res.json({ projects: list });
});

app.patch('/api/videos/:id', (req: Request, res: Response) => {
  const project = db.projects[req.params.id];
  if (!project) return res.status(404).json({ error: 'Not found' });
  if (req.body.prompt) project.prompt = req.body.prompt;
  project.updated_at = new Date().toISOString();
  saveDb();
  res.json(project);
});

app.delete('/api/videos/:id', (req: Request, res: Response) => {
  delete db.projects[req.params.id];
  saveDb();
  res.json({ success: true });
});

// File Uploads
app.post('/api/upload', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
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
  const { filename, total_chunks } = req.body;
  const uploadId = `upl_${crypto.randomBytes(8).toString('hex')}`;
  db.chunk_uploads[uploadId] = {
    total_chunks: total_chunks || 1,
    chunks: {},
    filename: filename || 'file.bin',
  };
  saveDb();
  res.json({ upload_id: uploadId });
});

app.post('/api/upload/chunk', upload.single('chunk'), (req: Request, res: Response) => {
  const { upload_id, chunk_index } = req.body;
  const uploadSession = db.chunk_uploads[upload_id];
  if (!uploadSession || !req.file) {
    return res.status(400).json({ error: 'Invalid upload session or chunk' });
  }

  uploadSession.chunks[Number(chunk_index)] = req.file.path;
  res.json({ success: true, chunk_index });
});

app.post('/api/upload/complete', (req: Request, res: Response) => {
  const uploadId = (req.query.upload_id as string) || req.body.upload_id;
  const session = db.chunk_uploads[uploadId];
  if (!session) return res.status(404).json({ error: 'Upload session not found' });

  const finalName = `${Date.now()}_${session.filename}`;
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
    const thumbnailUrl = await makeUploadThumbnail(finalPath, session.filename);
    res.json({
      url: fileUrl,
      file_url: fileUrl,
      filename: finalName,
      ...(thumbnailUrl ? { thumbnail_url: thumbnailUrl } : {}),
    });
  });
});

// Device Mockup Creation
app.post('/api/device-mockup/create', (req: Request, res: Response) => {
  const { media_url, device_type = 'iphone16', background = 'gradient' } = req.body;
  const projectId = `mockup_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  const newProject: Project = {
    id: projectId,
    prompt: `Device Mockup: ${device_type}`,
    format_id: 'device_mockup',
    language: 'ru',
    status: 'pending',
    progress: 10,
    progress_message: 'Создаём 3D мокап смартфона...',
    source_video_url: media_url,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  db.projects[projectId] = newProject;
  saveDb();

  setTimeout(async () => {
    try {
      newProject.status = 'processing';
      newProject.progress = 50;
      newProject.progress_message = 'Рендерим кадры iPhone...';
      saveDb();

      const outputName = `video_${projectId}.mp4`;
      const outputPath = path.join(UPLOADS_DIR, outputName);

      // Create a vertical 9:16 video featuring the mockup aesthetic
      await new Promise((resolve) => {
        const ff = spawn('ffmpeg', [
          '-y',
          '-f',
          'lavfi',
          '-i',
          'color=c=0x0F172A:s=720x1280:d=4',
          '-vf',
          `drawbox=x=110:y=140:w=500:h=1000:color=white@0.1:t=fill,drawbox=x=120:y=150:w=480:h=980:color=0x1E293B:t=fill,drawtext=text='iPhone 16 Pro':fontsize=36:fontcolor=white:x=(w-text_w)/2:y=240,drawtext=text='Live Preview':fontsize=28:fontcolor=0x0096FE:x=(w-text_w)/2:y=620`,
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-r',
          '30',
          outputPath,
        ]);
        ff.on('close', () => resolve(true));
        ff.on('error', () => resolve(false));
      });

      newProject.status = 'completed';
      newProject.progress = 100;
      newProject.progress_message = 'Готово!';
      newProject.video_url = `/api/uploads/${outputName}`;
      newProject.poster_url = `/api/uploads/${outputName}`;
      saveDb();
    } catch (e: any) {
      newProject.status = 'failed';
      newProject.error_message = e.message;
      saveDb();
    }
  }, 200);

  res.json({ id: projectId, project_id: projectId });
});

// Montage Creation & Styles
app.get('/api/montage/styles', (_req: Request, res: Response) => {
  res.json({
    styles: [
      { id: 'classic_fast', name: 'Динамичный ритм', bpm: 128 },
      { id: 'cinematic', name: 'Кинематографичный', bpm: 90 },
      { id: 'glitch_trap', name: 'Глитч & Трэп', bpm: 140 },
    ],
  });
});

app.post('/api/montage/create', (req: Request, res: Response) => {
  const { prompt, style = 'classic_fast' } = req.body;
  const montageId = `montage_${Date.now()}`;
  res.json({ montage_id: montageId, status: 'processing' });
});

app.get('/api/montage/:id', (req: Request, res: Response) => {
  res.json({ id: req.params.id, status: 'completed' });
});

// Voice Transcription Endpoint
app.post('/api/voice/transcribe', upload.single('audio'), async (req: Request, res: Response) => {
  try {
    // If audio was submitted, return transcribed text or guidance
    res.json({
      text: 'Создай динамичное рекламное видео о новом продукте со стильными субтитрами и эффектами',
      status: 'success',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Subscription Endpoints
app.get('/api/subscription/plans', (_req: Request, res: Response) => {
  res.json({
    plans: [
      {
        id: 'free',
        name: 'Free',
        price: 0,
        credits: DEFAULT_SIGNUP_CREDITS,
        features: ['1080p Export', 'Basic AI formats', 'Standard queue'],
      },
      {
        id: 'pro',
        name: 'Pro Creator',
        price: 19,
        credits: 1000,
        features: ['4K Ultra HD', 'Full 3D iPhone Mockups', 'Priority queue', 'No watermark'],
      },
    ],
  });
});

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
    const plan = planByVariant(pick.variant(d)) || PLANS.find((p) => p.key === pick.meta(d).nind_plan);
    if (!plan) return 'ignored_unknown_plan';
    const user = findWhopUser(d);
    if (!user) { db.whop_unmatched!.push({ at: new Date().toISOString(), type, payment: payId, variant: plan.variantId, email: pick.email(d) }); return 'unmatched_user'; }
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
  res.json({ plans: PLANS.map(({ key, tier, name, credits, cycle, price }) => ({ key, tier, name, credits, cycle, price })) });
});

// Body: { user_id, tier: 'starter'|'creator', credits?: 3000|6000|9000, cycle: 'monthly'|'annually' }
app.post('/api/subscription/checkout', async (req: Request, res: Response) => {
  const userId = (req.body?.user_id || req.headers['x-user-id']) as string;
  const user = userId ? getOrCreateUser(userId) : undefined;
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  const plan = findPlan(String(req.body?.tier || req.body?.plan || ''), Number(req.body?.credits), String(req.body?.cycle || 'monthly'));
  if (!plan) return res.status(400).json({ error: 'unknown_plan' });
  const sessionId = `chk_${crypto.randomBytes(8).toString('hex')}`;
  try {
    const co = await createCheckout(plan, user.user_id, `${publicUrl(req)}/subscription/success?session_id=${sessionId}`);
    db.whop_checkouts![sessionId] = { user_id: user.user_id, plan_key: plan.key, created_at: new Date().toISOString() };
    saveDb();
    res.json({ url: co.url, session_id: sessionId, mode: co.mode, plan: plan.key });
  } catch (e: any) {
    console.error('[whop] checkout error', e?.message);
    res.status(502).json({ error: 'checkout_failed', message: 'Could not open checkout. Please try again.' });
  }
});

app.get('/api/subscription/status/:sessionId', (req: Request, res: Response) => {
  const chk = db.whop_checkouts?.[req.params.sessionId];
  if (!chk) return res.status(404).json({ status: 'unknown' });
  const user = db.users[chk.user_id];
  const paid = !!user && user.subscription_status === 'active' && user.plan_key === chk.plan_key;
  const expired = !paid && Date.now() - Date.parse(chk.created_at) > 2 * DAY;
  res.json({ status: paid ? 'active' : expired ? 'expired' : 'pending', payment_status: paid ? 'paid' : 'unpaid', plan: chk.plan_key, credits: user?.credits });
});

// Credit top-up (subscribers only). Creates a payment-provider checkout.
app.post('/api/topup', (req: Request, res: Response) => {
  const userId = (req.body?.user_id || req.headers['x-user-id']) as string;
  const user = userId ? db.users[userId] : undefined;
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  const credits = Math.floor(Number(req.body?.credits));
  if (!isFinite(credits) || credits < MIN_TOPUP || credits > MAX_TOPUP) {
    return res.status(400).json({ error: 'invalid_amount', message: `Enter between ${MIN_TOPUP} and ${MAX_TOPUP} credits.` });
  }
  const active = user.subscription_status === 'active' || (!!user.plan && user.plan !== 'free');
  if (!active) return res.status(403).json({ error: 'subscription_required', message: 'Top-ups are available with an active subscription.' });
  // TODO(whop): create a Whop checkout session for `credits` (price per credit from the plan),
  // pass metadata { user_id, credits }, return its purchase URL here, and credit the balance
  // from the Whop `payment.succeeded` webhook (never from this endpoint).
  const checkoutUrl = process.env.WHOP_TOPUP_CHECKOUT_URL || '';
  if (!checkoutUrl) return res.status(501).json({ error: 'payments_not_configured', message: 'Payments are being set up. Please try again soon.', credits });
  const url = new URL(checkoutUrl);
  url.searchParams.set('metadata[user_id]', user.user_id);
  url.searchParams.set('metadata[credits]', String(credits));
  res.json({ checkout_url: url.toString(), credits });
});

// User Management & Settings
app.put('/api/users/:userId', (req: Request, res: Response) => {
  const userId = req.params.userId;
  let user = db.users[userId];
  if (!user) {
    user = {
      user_id: userId,
      id: userId,
      username: req.body.username || 'Creator',
      email: req.body.email || 'user@slind.ai',
      name: req.body.name || 'Creator',
      role: 'creator',
      credits: DEFAULT_SIGNUP_CREDITS,
      created_at: new Date().toISOString(),
    };
    db.users[userId] = user;
  }
  // never let the client set its own balance / plan
  const { credits: _c, plan: _p, subscription_status: _s, role: _r, user_id: _u, id: _i, sub_credits: _sc, plan_key: _pk, plan_credits: _pc, billing_cycle: _bc, last_deposit: _ld, whop_membership_id: _wm, whop_user_id: _wu, next_credit_at: _nc, period_end: _pe, cancel_at_period_end: _cp, ...safe } = req.body || {};
  Object.assign(user, safe);
  saveDb();
  res.json({ user });
});

// Current user profile incl. live credit balance (used by Account page)
app.get('/api/users/:userId', (req: Request, res: Response) => {
  const user = getOrCreateUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: { ...user, available_credits: availableCredits(user) } });
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
  const userId = String(req.body?.user_id || req.headers['x-user-id'] || '').trim() || undefined;
  const faqId = String(req.body?.faq_id || '').trim().slice(0, 80) || undefined;
  if (!email || !email.includes('@') || email.length > 200) {
    return res.status(400).json({ error: 'invalid_email', message: 'Please enter a valid email address.' });
  }
  if (!message) {
    return res.status(400).json({ error: 'invalid_message', message: 'Please write a short message.' });
  }
  if (!supportRateOk(email)) {
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

// ======================= FRONTEND SERVING =======================
async function startServer() {
  if (process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve(__dirname, 'dist'))) {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist/index.html'));
    });
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Slind AI Full-Stack Server running on port ${PORT}`);
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
      console.log(`🚀 Slind AI Full-Stack Server running on port ${PORT}`);
    });
  }
}

startServer().catch((err) => {
  console.error('Fatal server error:', err);
});
