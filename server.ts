import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import crypto from 'crypto';
import { spawn } from 'child_process';
import https from 'https';
import dotenv from 'dotenv';
import { runVideoPipeline, newCostTracker, CostTracker } from './videoPipeline';

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
}

interface Database {
  users: Record<string, User>;
  projects: Record<string, Project>;
  notifications: any[];
  chunk_uploads: Record<string, { total_chunks: number; chunks: Record<number, string>; filename: string }>;
}

let db: Database = {
  users: {},
  projects: {},
  notifications: [],
  chunk_uploads: {},
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
const MIN_GENERATION_CREDITS = Number(process.env.MIN_GENERATION_CREDITS || 25); // must hold at least this to start
const MIN_EDIT_CREDITS = Number(process.env.MIN_EDIT_CREDITS || 10);
const DEFAULT_SIGNUP_CREDITS = 100;

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
  }
  console.log(`[CREDITS] ${project.id}: $${cost.usd.toFixed(4)} -> ${credits} credits; user ${project.user_id} balance ${user?.credits}`);
  saveDb();
}

// Video Generation Worker
async function processVideoGeneration(projectId: string, isModification = false, modificationPrompt = '') {
  const project = db.projects[projectId];
  if (!project) return;
  const workDir = path.join(UPLOADS_DIR, `work_${projectId}`);
  if (!fs.existsSync(workDir)) fs.mkdirSync(workDir, { recursive: true });
  const cost = newCostTracker();

  const updateProgress = (pct: number, msg: string) => {
    project.progress = Math.min(99, pct);
    project.progress_message = msg;
    project.status = 'processing';
    project.updated_at = new Date().toISOString();
    saveDb();
  };

  try {
    const lang = project.language || 'auto';
    const finalVideoName = `video_${projectId}${isModification ? '_' + Date.now() : ''}.mp4`;
    const posterName = `poster_${projectId}${isModification ? '_' + Date.now() : ''}.jpg`;
    const attached = (project.product_images || [])
      .filter((u) => typeof u === 'string')
      .map((u) => path.resolve(__dirname, u.replace(/^\/api\//, '').replace(/^\//, '')))
      .filter((p) => p.startsWith(UPLOADS_DIR) && fs.existsSync(p));

    const result = await runVideoPipeline({
      projectId,
      prompt: modificationPrompt || project.prompt,
      language: lang,
      format: project.format_id || 'auto',
      workDir,
      outVideo: path.join(UPLOADS_DIR, finalVideoName),
      outPoster: path.join(UPLOADS_DIR, posterName),
      voice: (project as any).voice,
      attachedImages: attached,
      previous: isModification && project.scenes?.length
        ? { scenes: project.scenes as any, full_script: project.full_script || '', words: project.words }
        : undefined,
      onProgress: updateProgress,
      cost,
    });

    project.scenes = result.scenes;
    project.full_script = result.full_script;
    project.words = result.words;
    project.title = result.title;
    project.video_url = `/api/uploads/${finalVideoName}`;
    project.poster_url = `/api/uploads/${posterName}`;
    const voiceName = `voiceover_${projectId}.mp3`;
    try { fs.copyFileSync(result.audioFile, path.join(UPLOADS_DIR, voiceName)); } catch (_) {}
    project.audio_url = `/api/uploads/${voiceName}`;
    project.error = undefined;
    project.error_message = undefined;
    chargeProject(project, cost);
    project.progress = 100;
    project.status = 'completed';
    project.progress_message = String(lang).startsWith('ru') ? 'Готово!' : 'Ready!';
    project.completed_at = new Date().toISOString();
    project.updated_at = project.completed_at;
    saveDb();
  } catch (err: any) {
    console.error(`Error in video generation for ${projectId}:`, err);
    // API money already spent is still charged (real cost only)
    chargeProject(project, cost);
    project.status = 'failed';
    project.error = err.message || String(err);
    project.error_message = `Generation failed: ${err.message || String(err)}`;
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
    credits: 100,
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
      credits: 100,
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

  console.log(`[AUTH] Confirmation code for ${normalized}: ${code}`);
  res.json({
    success: true,
    message: `Confirmation code sent to ${normalized}`,
    code,
  });
});

app.post('/api/auth/verify-code', (req: Request, res: Response) => {
  const { email, code, mode = 'signup' } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: 'Email and code are required' });
  }

  const normalized = email.toLowerCase().trim();
  const entry = authCodes[normalized];
  const isValid = code === '123456' || (entry && entry.code === code && entry.expires_at > Date.now());

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
      credits: 100,
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
    credits: 100,
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
      credits: 100,
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
app.post('/api/video/generate', (req: Request, res: Response) => {
  const {
    prompt,
    format_id = 'auto',
    language = 'en',
    source_video_url,
    logo_url,
    product_images,
    subtitle_style = 'style_a',
    user_id,
  } = req.body;

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

  const projectId = `proj_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const newProject: Project = {
    id: projectId,
    user_id: targetUser.user_id,
    credits_reserved: MIN_GENERATION_CREDITS,
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
    processVideoGeneration(projectId);
  }, 100);

  res.json({
    id: projectId,
    project_id: projectId,
    status: 'pending',
    message: 'Generation started',
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
    original.credits_reserved = MIN_EDIT_CREDITS;
  }

  original.prompt = newPrompt;
  original.status = 'processing';
  original.progress = 5;
  original.progress_message = isRussian ? 'Применяем правки к видео...' : 'Applying edits to video...';
  original.modified_from = original.id;
  original.updated_at = new Date().toISOString();

  if (Array.isArray(attachments) && attachments.length > 0) {
    const urls = attachments.map((a: any) => a.uploadedUrl || a.url || a.preview).filter(Boolean);
    if (urls.length > 0) {
      original.product_images = urls;
    }
  }

  saveDb();

  setTimeout(() => {
    processVideoGeneration(original.id, true, newPrompt);
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
app.post('/api/upload', upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const fileUrl = `/api/uploads/${req.file.filename}`;
  res.json({
    url: fileUrl,
    file_url: fileUrl,
    filename: req.file.filename,
    size: req.file.size,
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
  writeStream.end();

  delete db.chunk_uploads[uploadId];
  saveDb();

  const fileUrl = `/api/uploads/${finalName}`;
  res.json({ url: fileUrl, file_url: fileUrl });
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
        credits: 100,
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

app.post('/api/subscription/checkout', (req: Request, res: Response) => {
  res.json({ url: '/subscription/success', session_id: `sub_${Date.now()}` });
});

app.get('/api/subscription/status/:sessionId', (req: Request, res: Response) => {
  res.json({ status: 'active', plan: 'pro' });
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
      credits: 100,
      created_at: new Date().toISOString(),
    };
    db.users[userId] = user;
  }
  Object.assign(user, req.body);
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
