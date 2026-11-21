/**
 * nind video pipeline
 * script (LLM) -> voiceover (TTS) -> word timestamps (local whisper) -> per-scene media
 * (verified stock video/photo or photoreal AI image) -> AI overlay elements (transparent) ->
 * ffmpeg assembly with word-synced subtitles + headline captions.
 *
 * Every OpenRouter call records its real cost (usage.cost) into a CostTracker so the
 * caller can charge credits: $0.01 = 1 credit.
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { AsyncLocalStorage } from 'async_hooks';
import { fileURLToPath } from 'url';
import { CaptionStyle, styleSpec } from './captionStyle';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FONT_DIR = path.resolve(__dirname, 'fonts');
export const HELPER = path.resolve(__dirname, 'tools/media_helper.py');

export const W = 720;
export const H = 1280;
export const FPS = 30;

/** Output frame. Short-form = vertical 720x1280 (default), long-form = horizontal 1920x1080.
 *  The active frame travels with the job via AsyncLocalStorage, so concurrent jobs never mix sizes. */
export interface Frame { w: number; h: number; aspect: '9:16' | '16:9'; orientation: 'portrait' | 'landscape' }
export const FRAME_PORTRAIT: Frame = { w: W, h: H, aspect: '9:16', orientation: 'portrait' };
export const FRAME_LANDSCAPE: Frame = { w: 1920, h: 1080, aspect: '16:9', orientation: 'landscape' };
export const frameFor = (aspect?: string | null): Frame => (aspect === '16:9' ? FRAME_LANDSCAPE : FRAME_PORTRAIT);
const frameCtx = new AsyncLocalStorage<Frame>();
export const curFrame = (): Frame => frameCtx.getStore() || FRAME_PORTRAIT;
export function withFrame<T>(f: Frame, fn: () => Promise<T>): Promise<T> { return frameCtx.run(f, fn); }

export type Level = 'low' | 'default' | 'high';
export const normLevel = (l?: any): Level => (l === 'low' || l === 'high' ? l : 'default');

export const MODELS = {
  get script() { return process.env.SCRIPT_MODEL || 'openai/gpt-4o-mini'; },
  get tts() { return process.env.TTS_MODEL || 'openai/gpt-audio-mini'; },
  get image() { return process.env.IMAGE_MODEL || 'google/gemini-3.1-flash-image'; },
  get overlay() { return process.env.OVERLAY_IMAGE_MODEL || 'google/gemini-2.5-flash-image'; },
  get vision() { return process.env.VISION_MODEL || 'google/gemini-2.5-flash-lite'; },
  get ttsHigh() { return process.env.TTS_MODEL_HIGH || 'openai/gpt-audio'; },
  get imageCheap() { return process.env.IMAGE_MODEL_LOW || 'google/gemini-2.5-flash-image'; },
};

/** Per-level behaviour. Default = the original pipeline. */
export interface LevelCfg {
  level: Level; tts: string; image: string; visionMin: number; hd: boolean;
  maxAiPhotos: number; capUsd: number; scriptRule: string; maxOverlays: number;
}
export function levelCfg(level: Level): LevelCfg {
  if (level === 'low') return {
    level, tts: MODELS.tts, image: MODELS.imageCheap, visionMin: 6, hd: false, maxAiPhotos: 2, capUsd: 0.15, maxOverlays: 1,
    scriptRule: 'media_type: COST-SAVING mode. Use "stock_video" or "stock_photo" for EVERY scene (real places, people, objects, nature, cities, events, technology). Use "ai_photo" in at most ONE scene, only if nothing real could possibly show it.',
  };
  if (level === 'high') return {
    level, tts: MODELS.ttsHigh, image: MODELS.image, visionMin: 8, hd: true, maxAiPhotos: 99, capUsd: 1.2, maxOverlays: 3,
    scriptRule: 'media_type: HIGH-QUALITY mode. At least half of the scenes MUST be "stock_video" or "stock_photo". Prefer "stock_video": real, cinematic, high-resolution footage of places, people, nature, cities, objects, events, technology. Use "ai_photo" only for moments that cannot be found as real footage (very specific or fictional compositions). Every scene needs a concrete English search_query.',
  };
  return {
    level, tts: MODELS.tts, image: MODELS.image, visionMin: 7, hd: false, maxAiPhotos: 99, capUsd: 0.6, maxOverlays: 2,
    scriptRule: 'media_type: mix real footage and AI. Use "stock_video" for real places, nature, cities, people doing generic actions, technology, animals, events; "stock_photo" for real well-known things, landmarks, historical subjects; "ai_photo" only for things impossible to film/find (specific fictional situations, the future, very specific compositions). At least 40% of scenes must be stock_video or stock_photo.',
  };
}

/** Rough upper-bound price per paid call, used to stay inside the user's credit budget. */
export const EST = { image: 0.07, imageCheap: 0.042, overlay: 0.042, vision: 0.002, script: 0.003, ttsMini: 0.02, ttsHigh: 0.08 };

const orKey = () => process.env.OPENROUTER_API_KEY || '';
export const pyBin = () => process.env.MEDIA_PYTHON || 'python3';
const UA = 'nindVideoBot/1.0 (https://nind.pro)';

// ------------------------------------------------------------------ cost tracking
export interface CostTracker { usd: number; items: { label: string; model: string; usd: number }[]; limitUsd?: number; pendingUsd?: number }
export const newCostTracker = (limitUsd?: number): CostTracker => ({ usd: 0, items: [], limitUsd, pendingUsd: 0 });

/** Reserve an estimated amount before a paid call. Returns false if it would exceed the budget. */
export function reserve(cost: CostTracker | undefined, est: number): boolean {
  if (!cost) return true;
  const pending = cost.pendingUsd || 0;
  if (cost.limitUsd !== undefined && cost.usd + pending + est > cost.limitUsd) return false;
  cost.pendingUsd = pending + est;
  return true;
}
export function release(cost: CostTracker | undefined, est: number) {
  if (cost) cost.pendingUsd = Math.max(0, (cost.pendingUsd || 0) - est);
}

function addCost(cost: CostTracker | undefined, label: string, model: string, usd: number) {
  if (!cost || !isFinite(usd) || usd <= 0) return;
  cost.usd += usd;
  cost.items.push({ label, model, usd: Math.round(usd * 1e6) / 1e6 });
}

// ------------------------------------------------------------------ small utils
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function run(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args);
    let out = '';
    let err = '';
    const t = opts.timeoutMs ? setTimeout(() => p.kill('SIGKILL'), opts.timeoutMs) : null;
    p.stdout.on('data', (d) => (out += d.toString()));
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('close', (code) => { if (t) clearTimeout(t); resolve({ code: code ?? 1, out, err }); });
    p.on('error', (e) => { if (t) clearTimeout(t); resolve({ code: 1, out, err: String(e) }); });
  });
}

export const ffmpeg = (args: string[], timeoutMs = 10 * 60 * 1000) => run('ffmpeg', ['-y', '-v', 'error', ...args], { timeoutMs });

/** Drop container / sidecar provenance on the next output file (encoder tags, XMP, chapters). */
export const STRIP_META_FLAGS = ['-map_metadata', '-1', '-map_chapters', '-1', '-fflags', '+bitexact'];
export const STRIP_ENCODE_FLAGS = [...STRIP_META_FLAGS, '-flags', '+bitexact', '-metadata', 'encoder=', '-metadata:s:v', 'encoder=', '-metadata:s:a', 'encoder='];
/** H.264 SEI often carries the "x264 - core ..." ident; not present on audio/image outputs. */
export const STRIP_H264_SEI = ['-bsf:v', 'filter_units=remove_types=6'];

/** Insert clean-export flags before the output path. */
export function withCleanOutput(args: string[], opts: { sei?: boolean } = {}): string[] {
  if (!args.length) return args;
  const out = args[args.length - 1];
  const head = args.slice(0, -1);
  const sei = opts.sei !== false && !/\.(png|jpe?g|webp|mp3|m4a|aac|wav)$/i.test(String(out));
  return [...head, ...STRIP_ENCODE_FLAGS, ...(sei ? STRIP_H264_SEI : []), out];
}

const SAFE_PNG_CHUNKS = new Set(['IHDR', 'PLTE', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'pHYs', 'IDAT', 'IEND']);

/** Losslessly drop tEXt/iTXt/zTXt/caBX (C2PA) and other non-essential PNG chunks. Pixels stay intact. */
function stripPngChunks(file: string): boolean {
  const data = fs.readFileSync(file);
  if (data.length < 8 || data.subarray(0, 8).compare(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) !== 0) return false;
  const parts: Buffer[] = [data.subarray(0, 8)];
  let i = 8;
  let dropped = false;
  while (i + 12 <= data.length) {
    const len = data.readUInt32BE(i);
    const typ = data.subarray(i + 4, i + 8).toString('latin1');
    const end = i + 12 + len;
    if (end > data.length) return false;
    if (SAFE_PNG_CHUNKS.has(typ)) parts.push(data.subarray(i, end));
    else dropped = true;
    i = end;
  }
  if (dropped) fs.writeFileSync(file, Buffer.concat(parts));
  return true;
}

/** Drop JPEG COM / APPn (EXIF, XMP, IPTC, C2PA) except JFIF (APP0) and ICC (APP2). Pixels stay intact. */
function stripJpegMarkers(file: string): boolean {
  const data = fs.readFileSync(file);
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return false;
  const parts: Buffer[] = [data.subarray(0, 2)];
  let i = 2;
  let dropped = false;
  while (i + 1 < data.length) {
    if (data[i] !== 0xff) { parts.push(data.subarray(i)); break; }
    while (i < data.length && data[i] === 0xff) i++;
    if (i >= data.length) break;
    const marker = data[i++];
    if (marker === 0xd9) { parts.push(Buffer.from([0xff, 0xd9])); break; }
    if (marker === 0xda) { // SOS: remainder is entropy-coded data
      parts.push(Buffer.from([0xff, marker]), data.subarray(i));
      break;
    }
    if (marker >= 0xd0 && marker <= 0xd7) { parts.push(Buffer.from([0xff, marker])); continue; }
    if (i + 2 > data.length) return false;
    const len = data.readUInt16BE(i);
    const end = i + len;
    if (end > data.length) return false;
    const drop = marker === 0xfe || (marker >= 0xe1 && marker <= 0xef && marker !== 0xe2);
    if (drop) dropped = true;
    else parts.push(Buffer.from([0xff, marker]), data.subarray(i, end));
    i = end;
  }
  if (dropped) fs.writeFileSync(file, Buffer.concat(parts));
  return true;
}

/**
 * Strip provenance metadata from an intermediate or final media file in place.
 * Removes C2PA/JUMBF, XMP/IPTC (incl. trainedAlgorithmicMedia, "Made with Google AI"),
 * encoder/comment tags and ID3. Does not alter pixels or audio samples — invisible
 * watermarks such as SynthID are left untouched.
 */
export async function stripProvenance(file: string): Promise<void> {
  if (!file || !fs.existsSync(file) || fs.statSync(file).size < 32) return;
  const ext = path.extname(file).toLowerCase();
  try {
    if (ext === '.png' && stripPngChunks(file)) return;
    if ((ext === '.jpg' || ext === '.jpeg') && stripJpegMarkers(file)) return;
    const tmp = `${file}.clean${ext}`;
    const args = ['-i', file, ...STRIP_META_FLAGS, '-c', 'copy'];
    if (ext === '.mp3') args.push('-id3v2_version', '0');
    if (ext === '.mp4' || ext === '.m4a' || ext === '.mov') args.push('-movflags', '+faststart', '-metadata', 'encoder=');
    const tryRun = async (extra: string[]) => {
      const r = await ffmpeg([...args, ...extra, tmp], 180_000);
      if (r.code === 0 && fs.existsSync(tmp) && fs.statSync(tmp).size > 0) {
        fs.renameSync(tmp, file);
        return true;
      }
      try { fs.unlinkSync(tmp); } catch { /* ignore */ }
      return false;
    };
    if (ext === '.mp4' || ext === '.mov' || ext === '.m4v') {
      if (await tryRun(STRIP_H264_SEI)) return;
    }
    await tryRun([]);
  } catch (e) {
    console.warn('[stripProvenance]', path.basename(file), (e as Error).message);
  }
}

export async function probeDuration(file: string): Promise<number> {
  const r = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  const d = parseFloat(r.out.trim());
  return isFinite(d) ? d : 0;
}

function httpJson(url: string, opts: { method?: string; headers?: Record<string, string>; body?: any; timeoutMs?: number } = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = opts.body ? JSON.stringify(opts.body) : undefined;
    const req = https.request(url, {
      method: opts.method || (data ? 'POST' : 'GET'),
      headers: { 'User-Agent': UA, ...(data ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
      timeout: opts.timeoutMs || 120000,
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          if ((res.statusCode || 500) >= 400) return reject(new Error(j?.error?.message || `HTTP ${res.statusCode}`));
          resolve(j);
        } catch {
          reject(new Error(`Bad JSON from ${url.split('?')[0]} (HTTP ${res.statusCode})`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (data) req.write(data);
    req.end();
  });
}

export function download(url: string, out: string, maxBytes = 80 * 1024 * 1024, timeoutSec = 60): Promise<boolean> {
  return new Promise((resolve) => {
    // stock URLs come from third-party APIs: only public http(s) hosts, never localhost / private ranges
    let host = '';
    try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) return resolve(false); host = u.hostname.toLowerCase(); } catch { return resolve(false); }
    if (/^(localhost|0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd]|\[?fe80)/.test(host) || host.endsWith('.local') || host.endsWith('.internal')) return resolve(false);
    const p = spawn('curl', ['-sSL', '--fail', '--proto', '=http,https', '--proto-redir', '=http,https', '--max-redirs', '5', '--max-time', String(timeoutSec), '--max-filesize', String(maxBytes), '-A', UA, '-o', out, '--', url]);
    p.on('close', (code) => resolve(code === 0 && fs.existsSync(out) && fs.statSync(out).size > 2048));
    p.on('error', () => resolve(false));
  });
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export const norm = (w: string) => w.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');

// ------------------------------------------------------------------ OpenRouter
async function fetchGenerationCost(id: string): Promise<number> {
  for (let i = 0; i < 4; i++) {
    await sleep(1500 + i * 1500);
    try {
      const j = await httpJson(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${orKey()}` }, timeoutMs: 15000,
      });
      const c = Number(j?.data?.total_cost);
      if (isFinite(c)) return c;
    } catch { /* not ready yet */ }
  }
  return 0;
}

export async function orChat(payload: any, cost: CostTracker | undefined, label: string): Promise<any> {
  const res = await httpJson('https://openrouter.ai/api/v1/chat/completions', {
    headers: { Authorization: `Bearer ${orKey()}`, 'HTTP-Referer': 'https://nind.pro', 'X-Title': 'nind AI Video Creator' },
    body: { ...payload, usage: { include: true } },
    timeoutMs: 180000,
  });
  let usd = Number(res?.usage?.cost);
  if (!isFinite(usd) && res?.id) usd = await fetchGenerationCost(res.id);
  addCost(cost, label, payload.model, usd || 0);
  return res;
}

export function extractJson(text: string): any {
  try { return JSON.parse(text); } catch { /* fallthrough */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

// ------------------------------------------------------------------ 1. script
export interface SceneSpec {
  scene_num: number;
  voiceover_chunk: string;
  visual_description: string;
  media_type: 'stock_video' | 'stock_photo' | 'ai_photo';
  search_query: string;
  ai_image_prompt: string;
  headline?: { phrase: string; highlight: string } | null;
  overlay?: { trigger_word: string; element: string } | null;
  needs_new_visual?: boolean;
  text?: string;
  media?: { kind: 'video' | 'photo'; source: string; file: string; page_url?: string; verified_score?: number };
}

const SCENE_SCHEMA = `{
  "title": "Short catchy title",
  "needs_new_voiceover": true,
  "scenes": [
    {
      "scene_num": 1,
      "voiceover_chunk": "Exact narration spoken during this scene (1-2 short sentences)",
      "visual_description": "Literal, concrete description of what must be on screen at this moment",
      "media_type": "stock_video | stock_photo | ai_photo",
      "search_query": "2-4 English keywords to find this exact shot on stock sites",
      "ai_image_prompt": "Detailed description of a real-looking photograph of this moment (subject, setting, light, camera angle)",
      "headline": null or { "phrase": "2-6 consecutive words copied exactly from voiceover_chunk", "highlight": "ONE key word from phrase" },
      "overlay": null or { "trigger_word": "one word copied exactly from voiceover_chunk", "element": "short description of one iconic object/symbol, e.g. yellow warning triangle with black exclamation mark" },
      "needs_new_visual": true
    }
  ]
}`;

const SCRIPT_RULES = (langLine: string, format: string, mediaRule?: string) => `You are an elite short-form video director and scriptwriter (TikTok, Reels, Shorts).
${langLine}
Format style: ${format}.

RULES:
1. Total length 15-40 s (5-8 scenes) unless the user asked for a specific duration. Strong hook, build-up, satisfying ending. Never truncate the story.
2. voiceover_chunk: natural spoken sentences. The full voiceover = all chunks in order. Do not put stage directions or emojis in it.
3. Every scene's visuals must literally match what is being said at that exact moment.
4. ${mediaRule || levelCfg('default').scriptRule}
5. search_query: ALWAYS English, concrete nouns (e.g. "chernobyl reactor ruins", "geiger counter", "surfer big wave").
6. ai_image_prompt: describe a REAL photograph: real people/objects, natural light, real location; never ask for illustration, render, cartoon, or text.
7. headline: REQUIRED in exactly 2 scenes (3 if there are 7+ scenes) - the key punchlines. phrase = 2-6 words copied verbatim and consecutively from that scene's voiceover_chunk; highlight = the single most important word of the phrase.
8. overlay: REQUIRED in 1-2 scenes. Pick the moments where the narration names something with an obvious icon/object (radiation -> yellow warning triangle with black exclamation mark; money -> stack of dollar bills; fire -> flame; idea -> glowing light bulb; time -> alarm clock; water/flood -> water drop; growth -> green arrow up; danger -> red alarm siren). trigger_word = the exact word in voiceover_chunk. Never put a headline and an overlay in the same scene.

Return ONLY valid JSON with this schema:
${SCENE_SCHEMA}`;

export async function writeScript(opts: {
  prompt: string; language: string; format: string; cost: CostTracker;
  previous?: { scenes: SceneSpec[]; full_script: string }; level?: Level;
}): Promise<{ title: string; scenes: SceneSpec[]; needs_new_voiceover: boolean }> {
  const lang = String(opts.language || 'auto').toLowerCase();
  const langLine = lang === 'auto' || !lang
    ? 'Language of the voiceover, headlines and overlays text: the same language the user wrote the prompt in.'
    : `Language of the voiceover and headlines: ${lang.startsWith('ru') ? 'Russian' : lang.startsWith('en') ? 'English' : lang}.`;
  const cfg = levelCfg(normLevel(opts.level));
  let system = SCRIPT_RULES(langLine, opts.format || 'auto', cfg.scriptRule);
  let user = `User prompt: "${opts.prompt}"`;
  if (opts.previous && opts.previous.scenes?.length) {
    system += `\n\nYou are EDITING an existing video. Apply ONLY the user's requested change. Keep every other scene identical (same voiceover_chunk, same visuals). Set "needs_new_voiceover": true only if any narration text changes. Per scene set "needs_new_visual": true only if that scene's visual must change.`;
    const prev = opts.previous.scenes.map((s) => ({
      scene_num: s.scene_num, voiceover_chunk: s.voiceover_chunk, visual_description: s.visual_description,
      media_type: s.media_type, search_query: s.search_query, ai_image_prompt: s.ai_image_prompt,
      headline: s.headline || null, overlay: s.overlay || null,
    }));
    user = `Existing scenes:\n${JSON.stringify(prev, null, 2)}\n\nUser edit request: "${opts.prompt}"`;
  }
  const res = await orChat({
    model: MODELS.script,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' },
    temperature: 0.8,
  }, opts.cost, 'script');
  const data = extractJson(res?.choices?.[0]?.message?.content || '') || {};
  let scenes: SceneSpec[] = Array.isArray(data.scenes) ? data.scenes : [];
  scenes = scenes
    .filter((s: any) => s && typeof s.voiceover_chunk === 'string' && s.voiceover_chunk.trim())
    .map((s: any, i: number) => ({
      scene_num: i + 1,
      voiceover_chunk: s.voiceover_chunk.replace(/\s+/g, ' ').trim(),
      visual_description: String(s.visual_description || s.ai_image_prompt || s.voiceover_chunk),
      media_type: (['stock_video', 'stock_photo', 'ai_photo'].includes(s.media_type) ? s.media_type : 'ai_photo') as SceneSpec['media_type'],
      search_query: String(s.search_query || s.visual_description || '').slice(0, 80),
      ai_image_prompt: String(s.ai_image_prompt || s.visual_description || s.voiceover_chunk),
      headline: s.headline && s.headline.phrase ? { phrase: String(s.headline.phrase), highlight: String(s.headline.highlight || '') } : null,
      overlay: s.overlay && s.overlay.trigger_word && s.overlay.element ? { trigger_word: String(s.overlay.trigger_word), element: String(s.overlay.element) } : null,
      needs_new_visual: s.needs_new_visual !== false,
    }));
  if (!scenes.length) throw new Error('Script generation returned no scenes');
  let ai = 0;
  for (const s of scenes) if (s.media_type === 'ai_photo' && ++ai > cfg.maxAiPhotos) s.media_type = 'stock_photo';
  if (cfg.level === 'high') ensureHighStockPlan(scenes);
  return { title: String(data.title || opts.prompt.slice(0, 40)), scenes, needs_new_voiceover: data.needs_new_voiceover !== false };
}

// ------------------------------------------------------------------ 2. voiceover
/** Default: read a full narration script exactly. */
export const TTS_NARRATE_SYSTEM = 'You are a professional voice-over narrator. Read the user message aloud EXACTLY as written, word for word, in its original language, with an energetic, natural, confident delivery. Do not add, skip, translate or comment on anything.';
/** Dubbing a short subtitle line: chat-audio models otherwise answer questions instead of reading them. */
export const TTS_SPEAK_LINE_SYSTEM = 'You are a text-to-speech engine, not an assistant. Speak the user text aloud word for word, in its original language, with a natural, clear delivery. If the text is a question, read the question only — do not answer it. Do not add, skip, translate, explain, continue, improvise or comment. Stop immediately after the last word of the given text.';

export function generateSpeech(text: string, outMp3: string, cost: CostTracker, voice = 'alloy', model = MODELS.tts, opts?: { system?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model,
      modalities: ['text', 'audio'],
      audio: { voice, format: 'pcm16' },
      stream: true,
      usage: { include: true },
      messages: [
        { role: 'system', content: opts?.system || TTS_NARRATE_SYSTEM },
        { role: 'user', content: text },
      ],
    });
    const req = https.request('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${orKey()}`, 'Content-Type': 'application/json' },
      timeout: 180000,
    }, (res) => {
      if ((res.statusCode || 500) >= 400) { res.resume(); return resolve(false); }
      const bufs: Buffer[] = [];
      let line = '';
      let usd = NaN;
      let genId = '';
      res.on('data', (chunk: Buffer) => {
        line += chunk.toString('utf8');
        const lines = line.split('\n');
        line = lines.pop() || '';
        for (const l of lines) {
          const t = l.trim();
          if (!t.startsWith('data: ') || t.includes('[DONE]')) continue;
          try {
            const j = JSON.parse(t.slice(6));
            if (j.id) genId = j.id;
            const a = j.choices?.[0]?.delta?.audio?.data;
            if (a) bufs.push(Buffer.from(a, 'base64'));
            if (j.usage && isFinite(Number(j.usage.cost))) usd = Number(j.usage.cost);
          } catch { /* keep-alive comments etc */ }
        }
      });
      res.on('end', async () => {
        if (!isFinite(usd) && genId) usd = await fetchGenerationCost(genId);
        addCost(cost, 'voiceover', model, usd || 0);
        if (!bufs.length) return resolve(false);
        const pcm = outMp3.replace(/\.[^.]+$/, '.pcm');
        fs.writeFileSync(pcm, Buffer.concat(bufs));
        const r = await ffmpeg(withCleanOutput(['-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcm, '-af', 'silenceremove=start_periods=1:start_threshold=-50dB', '-c:a', 'libmp3lame', '-b:a', '192k', outMp3], { sei: false }));
        try { fs.unlinkSync(pcm); } catch { /* ignore */ }
        if (r.code === 0 && fs.existsSync(outMp3)) await stripProvenance(outMp3);
        resolve(r.code === 0 && fs.existsSync(outMp3));
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => req.destroy());
    req.write(payload);
    req.end();
  });
}

// ------------------------------------------------------------------ 3. word timestamps
export interface Word { w: string; start: number; end: number }

export async function alignWords(audio: string, script: string, workDir: string, language?: string): Promise<Word[]> {
  const sp = path.join(workDir, 'script.txt');
  const op = path.join(workDir, 'words.json');
  fs.writeFileSync(sp, script, 'utf8');
  const args = [HELPER, 'align', audio, sp, op];
  if (language && language !== 'auto') args.push(language.slice(0, 2));
  const r = await run(pyBin(), args, { timeoutMs: 10 * 60 * 1000 });
  if (r.code !== 0 || !fs.existsSync(op)) {
    console.warn('[align] whisper alignment failed, falling back to proportional timing:', r.err.slice(-400));
    const dur = await probeDuration(audio);
    const toks = script.split(/\s+/).filter(Boolean);
    const total = toks.reduce((s, t) => s + t.length + 1, 0);
    let acc = 0;
    return toks.map((t) => {
      const st = (acc / total) * dur; acc += t.length + 1;
      return { w: t, start: st, end: (acc / total) * dur };
    });
  }
  return JSON.parse(fs.readFileSync(op, 'utf8')).words as Word[];
}

// ------------------------------------------------------------------ 4. media: stock search + vision verification
export interface Candidate { source: string; kind: 'video' | 'photo'; thumb: string; url: string; page_url?: string; w?: number; h?: number }

async function pexels(query: string, kind: 'video' | 'photo', hd = false): Promise<Candidate[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  try {
    if (kind === 'video') {
      const fr = curFrame();
      const tgt = fr.orientation === 'landscape' ? (hd ? 1080 : 720) : (hd ? 1920 : 1280);
      const j = await httpJson(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=${fr.orientation}&per_page=5`, { headers: { Authorization: key }, timeoutMs: 15000 });
      return (j.videos || []).map((v: any) => {
        const files = (v.video_files || []).filter((f: any) => f.file_type === 'video/mp4' && f.width && f.height)
          .sort((a: any, b: any) => Math.abs(a.height - tgt) - Math.abs(b.height - tgt));
        return files[0] ? { source: 'pexels', kind, thumb: v.image, url: files[0].link, page_url: v.url, w: files[0].width, h: files[0].height } : null;
      }).filter(Boolean);
    }
    const j = await httpJson(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=${curFrame().orientation}&per_page=5`, { headers: { Authorization: key }, timeoutMs: 15000 });
    return (j.photos || []).map((p: any) => ({ source: 'pexels', kind, thumb: p.src?.medium, url: p.src?.large2x || p.src?.original, page_url: p.url, w: p.width, h: p.height }));
  } catch (e) { console.warn('[pexels]', (e as Error).message); return []; }
}

async function pixabay(query: string, kind: 'video' | 'photo', hd = false): Promise<Candidate[]> {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];
  try {
    if (kind === 'video') {
      const j = await httpJson(`https://pixabay.com/api/videos/?key=${key}&q=${encodeURIComponent(query)}&per_page=5&safesearch=true`, { timeoutMs: 15000 });
      return (j.hits || []).map((h: any) => {
        const v = hd && h.videos?.large?.url ? h.videos.large : h.videos?.medium?.url ? h.videos.medium : h.videos?.small;
        return v?.url ? { source: 'pixabay', kind, thumb: v.thumbnail || h.videos?.tiny?.thumbnail, url: v.url, page_url: h.pageURL, w: v.width, h: v.height } : null;
      }).filter((c: any) => c && c.thumb);
    }
    const j = await httpJson(`https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(query)}&image_type=photo&per_page=5&safesearch=true${curFrame().orientation === 'landscape' ? '&orientation=horizontal' : ''}`, { timeoutMs: 15000 });
    return (j.hits || []).map((h: any) => ({ source: 'pixabay', kind, thumb: h.webformatURL, url: h.largeImageURL, page_url: h.pageURL, w: h.imageWidth, h: h.imageHeight }));
  } catch (e) { console.warn('[pixabay]', (e as Error).message); return []; }
}

const WIKI_BAD = /\b(map|maps|diagram|logo|chart|graph|flag|coat of arms|seal|icon|symbol|scheme|schema|drawing|svg|pdf|tiff?|stamp|poster|document|animation|animated|render|veo|ai-generated|illustration|cartoon|screenshot)\b/i;

/** Openverse (CC-licensed photos, no API key needed). */
async function openverse(query: string, kind: 'video' | 'photo', hd = false): Promise<Candidate[]> {
  if (kind !== 'photo') return [];
  try {
    const j = await httpJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=8&mature=false&category=photograph${hd ? '&size=large' : ''}`, { timeoutMs: 15000 });
    return (j.results || [])
      .filter((r: any) => r.url && (r.width || 0) >= (hd ? 1400 : 900) && !WIKI_BAD.test(r.title || ''))
      .slice(0, 5)
      .map((r: any) => ({ source: 'openverse', kind, thumb: r.thumbnail || r.url, url: r.url, page_url: r.foreign_landing_url, w: r.width, h: r.height }));
  } catch (e) { console.warn('[openverse]', (e as Error).message); return []; }
}

export async function wikimedia(query: string, kind: 'video' | 'photo', hd = false): Promise<Candidate[]> {
  try {
    const q = `${query} ${kind === 'video' ? 'filetype:video' : 'filetype:bitmap'}`;
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(q)}&gsrlimit=10&prop=imageinfo|videoinfo&iiprop=url|mime|size&iiurlwidth=1280&viprop=derivatives&format=json`;
    const j = await httpJson(url, { timeoutMs: 15000 });
    const pages = Object.values(j?.query?.pages || {}) as any[];
    pages.sort((a, b) => (a.index || 0) - (b.index || 0));
    const out: Candidate[] = [];
    for (const p of pages) {
      const ii = p.imageinfo?.[0];
      if (!ii?.thumburl || WIKI_BAD.test(p.title || '')) continue;
      const thumb = ii.thumburl.replace(/\/\d+px-/, '/330px-');
      if (kind === 'photo') {
        if (!/image\/(jpeg|png)/.test(ii.mime || '') || (ii.width || 0) < 900) continue;
        out.push({ source: 'wikimedia', kind, thumb, url: ii.thumburl, page_url: ii.descriptionurl, w: ii.width, h: ii.height });
      } else {
        const ders = (p.videoinfo?.[0]?.derivatives || []) as any[];
        const pick = (hd ? ders.find((d) => /1080p.*\.webm$/.test(d.src)) : undefined) || ders.find((d) => /720p.*\.webm$/.test(d.src)) || ders.find((d) => /480p.*\.webm$/.test(d.src)) || ders.find((d) => /\.webm$/.test(d.src));
        if (!pick) continue;
        out.push({ source: 'wikimedia', kind, thumb, url: pick.src, page_url: ii.descriptionurl, w: ii.width, h: ii.height });
      }
      if (out.length >= 5) break;
    }
    return out;
  } catch (e) { console.warn('[wikimedia]', (e as Error).message); return []; }
}

/** Ask a cheap vision model which candidate (if any) really shows the scene. */
async function verifyCandidates(scene: SceneSpec, cands: Candidate[], workDir: string, cost: CostTracker, tag: string, minScore = 7): Promise<{ idx: number; score: number; bestIdx: number; bestScore: number }> {
  const thumbs = await mapLimit(cands, 4, async (c, i) => {
    const raw = path.join(workDir, `cand_${tag}_${i}.bin`);
    const jpg = path.join(workDir, `cand_${tag}_${i}.jpg`);
    if (!(await download(c.thumb, raw, 8 * 1024 * 1024, 20))) return null;
    const r = await ffmpeg(withCleanOutput(['-i', raw, '-frames:v', '1', '-vf', 'scale=384:384:force_original_aspect_ratio=decrease', '-q:v', '5', jpg], { sei: false }), 30000);
    if (r.code === 0 && fs.existsSync(jpg)) { await stripProvenance(jpg); return fs.readFileSync(jpg).toString('base64'); }
    return null;
  });
  const valid = thumbs.map((t, i) => ({ t, i })).filter((x) => x.t);
  if (!valid.length) return { idx: -1, score: 0, bestIdx: -1, bestScore: 0 };
  const content: any[] = [{
    type: 'text',
    text: `You check stock media for a short video. Scene narration: "${scene.voiceover_chunk}". Required visual: "${scene.visual_description}".
Below are ${valid.length} candidate images (${cands[0].kind === 'video' ? 'video thumbnails' : 'photos'}), numbered 1..${valid.length} in order.
Score each 0-10 for how well it literally shows the required visual AND is a clean real-world photo/footage frame. Penalize maps, diagrams, text-heavy images, logos, collages, low quality, and unrelated subjects. If a watermark or logo overlay is clearly visible, or it is not a real photograph/footage frame, score it at most 4.
Return ONLY JSON: {"scores":[...], "best": <number 1..${valid.length} or 0 if none scores >= ${minScore}>}`,
  }];
  valid.forEach((v) => content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${v.t}` } }));
  if (!reserve(cost, EST.vision)) return { idx: -1, score: 0, bestIdx: -1, bestScore: 0 };
  try {
    const res = await orChat({ model: MODELS.vision, messages: [{ role: 'user', content }], response_format: { type: 'json_object' }, temperature: 0 }, cost, `vision check scene ${scene.scene_num}`);
    const j = extractJson(res?.choices?.[0]?.message?.content || '') || {};
    const scores: number[] = Array.isArray(j.scores) ? j.scores.map(Number) : [];
    let bestAll = -1, bestScore = 0;
    if (scores.length) {
      bestScore = Math.max(...scores.map((n) => (isFinite(n) ? n : 0)));
      bestAll = scores.findIndex((n) => n === bestScore);
    }
    let best = Number(j.best) || 0;
    if (!best && bestScore >= minScore) best = bestAll + 1;
    const score = best ? (scores[best - 1] ?? minScore) : 0;
    const bestIdx = bestAll >= 0 ? valid[bestAll].i : -1;
    if (best < 1 || best > valid.length || score < minScore) return { idx: -1, score: 0, bestIdx, bestScore };
    return { idx: valid[best - 1].i, score, bestIdx, bestScore };
  } catch (e) {
    console.warn('[vision]', (e as Error).message);
    return { idx: -1, score: 0, bestIdx: -1, bestScore: 0 };
  } finally { release(cost, EST.vision); }
}

const QUERY_NOISE = /\b(footage|video|videos|clip|photo|photos|image|images|picture|shot|stock|hd|4k|scene|of|the|a|an|and|with|in|on)\b/gi;

/** Full query first, then progressively broader ones until some source returns results. */
export function queryVariants(q: string): string[] {
  const words = q.replace(QUERY_NOISE, ' ').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let n = Math.min(words.length, 4); n >= 1; n--) out.push(words.slice(0, n).join(' '));
  if (words.length > 2) out.splice(2, 0, words.slice(-2).join(' '));
  return [...new Set(out)].slice(0, 4);
}

const QUERY_SYNONYMS: Record<string, string[]> = {
  smartphone: ['mobile phone', 'cell phone'], phone: ['smartphone', 'mobile phone'],
  computer: ['laptop computer', 'desktop computer'], laptop: ['notebook computer', 'laptop desk'],
  car: ['automobile traffic', 'city cars'], city: ['city skyline', 'urban street'],
  people: ['crowd pedestrians', 'people walking'], person: ['man walking', 'woman portrait'],
  nature: ['landscape nature', 'forest trees'], forest: ['woodland trees', 'forest path'],
  ocean: ['sea waves', 'ocean water'], sea: ['ocean waves', 'sea water'],
  mountain: ['mountain range', 'alpine landscape'], beach: ['sandy beach', 'beach waves'],
  office: ['office desk', 'workplace office'], factory: ['industrial factory', 'factory floor'],
  school: ['classroom school', 'students classroom'], university: ['university campus', 'college campus'],
  money: ['cash money', 'banknotes'], social: ['social media phone', 'smartphone scrolling'],
  robot: ['industrial robot', 'robot arm'],
  ai: ['artificial intelligence computer', 'data center'],
  night: ['night city lights', 'night sky'], food: ['restaurant food', 'cooked meal'],
  street: ['city street', 'busy road'], crowd: ['crowded people', 'busy street crowd'],
};

function latinKeywords(text: string, max = 4): string {
  const words = String(text || '').replace(QUERY_NOISE, ' ').replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/).filter((w) => /[A-Za-z]{3,}/.test(w));
  return words.slice(0, max).join(' ');
}

/** Concrete English (or source) keywords for a stock search. */
export function deriveSearchQuery(s: { search_query?: string; visual_description?: string; voiceover_chunk?: string; ai_image_prompt?: string }): string {
  for (const t of [s.search_query, s.visual_description, s.ai_image_prompt, s.voiceover_chunk]) {
    const k = latinKeywords(t || '', 4);
    if (k) return k.slice(0, 80);
  }
  return String(s.search_query || s.visual_description || s.voiceover_chunk || '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** High-level query list: original, visual description, broader cuts, and synonyms. */
export function stockQueryVariants(scene: { search_query?: string; visual_description?: string; voiceover_chunk?: string; ai_image_prompt?: string }, wide = false): string[] {
  const primary = deriveSearchQuery(scene);
  const out: string[] = primary ? queryVariants(primary) : [];
  if (wide) {
    for (const t of [scene.visual_description, scene.ai_image_prompt]) {
      const extra = latinKeywords(t || '', 3);
      if (extra && extra.toLowerCase() !== primary.toLowerCase()) out.push(...queryVariants(extra));
    }
    const words = primary.toLowerCase().split(/\s+/).filter(Boolean);
    for (const w of words) {
      for (const syn of (QUERY_SYNONYMS[w] || [])) {
        out.push(syn);
        const swapped = words.map((x) => (x === w ? syn : x)).join(' ');
        if (swapped !== syn) out.push(swapped);
      }
    }
  }
  return [...new Set(out.map((s) => s.trim()).filter(Boolean))].slice(0, wide ? 10 : 4);
}

/** Minimum number of created-video scenes that must use real web stock on High. */
export function highStockTarget(sceneCount: number): number {
  if (sceneCount <= 0) return 0;
  if (sceneCount === 1) return 1;
  return Math.max(2, Math.ceil(sceneCount * 0.5));
}

/** Upgrade planner output so High videos have a guaranteed stock share. */
export function ensureHighStockPlan(scenes: SceneSpec[]): void {
  const target = highStockTarget(scenes.length);
  const isStock = (s: SceneSpec) => s.media_type === 'stock_video' || s.media_type === 'stock_photo';
  for (const s of scenes) if (!String(s.search_query || '').trim()) s.search_query = deriveSearchQuery(s);
  let n = scenes.filter(isStock).length;
  if (n >= target) return;
  const unfilmable = /\b(fictional|fantasy|futuristic|imaginary|surreal|impossible|cgi|made-up|hypothetical|invented)\b/i;
  const order = scenes
    .filter((s) => !isStock(s))
    .sort((a, b) => Number(unfilmable.test(`${a.visual_description} ${a.ai_image_prompt}`)) - Number(unfilmable.test(`${b.visual_description} ${b.ai_image_prompt}`)));
  for (const s of order) {
    if (n >= target) break;
    s.media_type = 'stock_video';
    s.search_query = deriveSearchQuery(s);
    n++;
    console.log(`[high stock] upgraded scene ${s.scene_num} to stock_video query="${s.search_query}"`);
  }
}

export async function collectStockCandidates(query: string, kind: 'video' | 'photo', hd = false, exclude?: Set<string>): Promise<Candidate[]> {
  let lists: Candidate[][] = await Promise.all([pexels(query, kind, hd), pixabay(query, kind, hd), wikimedia(query, kind, hd), openverse(query, kind, hd)]);
  if (exclude) lists = lists.map((l) => l.filter((c) => !exclude!.has(c.url)));
  const cands: Candidate[] = [];
  for (let k = 0; k < 5 && cands.length < 8; k++) for (const l of lists) if (l[k] && cands.length < 8) cands.push(l[k]);
  return cands;
}

function interleaveCandidates(lists: Candidate[][], exclude?: Set<string>, used?: Set<string>, max = 6): Candidate[] {
  const cands: Candidate[] = [];
  for (let k = 0; k < 5 && cands.length < max; k++) {
    for (const l of lists) {
      const c = l[k];
      if (!c || (exclude && exclude.has(c.url)) || (used && used.has(c.url))) continue;
      if (cands.some((x) => x.url === c.url)) continue;
      cands.push(c);
      if (cands.length >= max) break;
    }
  }
  return cands;
}

async function acceptStock(c: Candidate, kind: 'video' | 'photo', workDir: string, i: number | string, exclude?: Set<string>, score?: number): Promise<SceneSpec['media'] | null> {
  exclude?.add(c.url);
  const ext = kind === 'video' ? (c.url.endsWith('.webm') ? '.webm' : '.mp4') : '.jpg';
  const file = path.join(workDir, `scene_${i}_${Date.now()}${ext}`);
  if (!(await download(c.url, file, kind === 'video' ? 120 * 1024 * 1024 : 25 * 1024 * 1024, 120))) return null;
  await stripProvenance(file);
  const probe = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width', '-of', 'csv=p=0', file]);
  if (probe.code !== 0 || !parseInt(probe.out)) { try { fs.unlinkSync(file); } catch { /* ignore */ } return null; }
  return { kind, source: c.source, file, page_url: c.page_url, verified_score: score };
}

export interface StockOpts { minScore?: number; hd?: boolean; exclude?: Set<string>; wide?: boolean; softMin?: number }

export async function findStock(scene: SceneSpec, kind: 'video' | 'photo', workDir: string, cost: CostTracker, i: number | string, o: StockOpts = {}): Promise<SceneSpec['media'] | null> {
  const hd = !!o.hd;
  const minScore = o.minScore ?? 7;

  if (!o.wide) {
    const variants = queryVariants(scene.search_query || scene.visual_description);
    let lists: Candidate[][] = [];
    for (const q of variants) {
      lists = await Promise.all([pexels(q, kind, hd), pixabay(q, kind, hd), wikimedia(q, kind, hd), openverse(q, kind, hd)]);
      if (o.exclude) lists = lists.map((l) => l.filter((c) => !o.exclude!.has(c.url)));
      if (lists.reduce((n, l) => n + l.length, 0) >= 2) break;
    }
    const cands = interleaveCandidates(lists, o.exclude);
    if (!cands.length) return null;
    const { idx, score } = await verifyCandidates(scene, cands, workDir, cost, `${i}_${kind}`, minScore);
    if (idx < 0) return null;
    return acceptStock(cands[idx], kind, workDir, i, o.exclude, score);
  }

  const variants = stockQueryVariants(scene, true);
  const used = new Set<string>();
  const soft: { cur: { c: Candidate; score: number } | null } = { cur: null };
  let visionCalls = 0;
  let pending: Candidate[][] = [[], [], [], []];
  const flush = async (tag: string, last: boolean) => {
    const cands = interleaveCandidates(pending, o.exclude, used, 6);
    pending = [[], [], [], []];
    if (!cands.length) return null as SceneSpec['media'] | null;
    cands.forEach((c) => used.add(c.url));
    visionCalls++;
    const { idx, score, bestIdx, bestScore } = await verifyCandidates(scene, cands, workDir, cost, tag, minScore);
    if (idx >= 0) return acceptStock(cands[idx], kind, workDir, i, o.exclude, score);
    if (bestIdx >= 0 && bestScore >= (o.softMin ?? 6) && (!soft.cur || bestScore > soft.cur.score)) soft.cur = { c: cands[bestIdx], score: bestScore };
    if (!last && visionCalls >= 3) return null;
    return null;
  };

  for (let vi = 0; vi < variants.length; vi++) {
    const lists = await Promise.all([pexels(variants[vi], kind, hd), pixabay(variants[vi], kind, hd), wikimedia(variants[vi], kind, hd), openverse(variants[vi], kind, hd)]);
    lists.forEach((l, si) => { pending[si] = pending[si].concat(l); });
    const ready = interleaveCandidates(pending, o.exclude, used, 6).length;
    const last = vi === variants.length - 1;
    if (ready >= 3 || last) {
      const got = await flush(`${i}_${kind}_${vi}`, last);
      if (got) return got;
      if (visionCalls >= 3) break;
    }
  }
  if (soft.cur) {
    console.log(`[high stock] scene ${scene.scene_num}: accepted ${kind} from ${soft.cur.c.source} at score ${soft.cur.score} (preferred ${minScore}) query="${variants[0] || ''}"`);
    return acceptStock(soft.cur.c, kind, workDir, i, o.exclude, soft.cur.score);
  }
  console.warn(`[high stock] scene ${scene.scene_num}: no relevant ${kind} after queries ${JSON.stringify(variants.slice(0, 6))}`);
  return null;
}

// ------------------------------------------------------------------ 5. photoreal AI images
export const REALISM_PREFIX = 'An authentic, unedited real-world photograph, indistinguishable from a real camera photo. Shot on a full-frame camera (Sony A7 IV) with a 35mm f/1.8 prime lens, natural available light, true-to-life colors and white balance, realistic skin pores and material textures, natural imperfections, subtle sensor grain, gentle depth of field, documentary/editorial photojournalism style. Vertical 9:16 framing.';
export const REALISM_NEGATIVE = 'Strictly avoid: illustration, digital art, CGI, 3D render, cartoon, anime, painting, plastic or waxy skin, over-smoothing, oversaturated or neon colors, HDR glow, fantasy lighting, text, captions, watermarks, logos, borders.';

async function imageFromResponse(res: any, out: string): Promise<boolean> {
  const msg = res?.choices?.[0]?.message;
  const url: string = msg?.images?.[0]?.image_url?.url || '';
  let b64 = '';
  if (url.startsWith('data:image/')) b64 = url.split(',')[1];
  else {
    const m = String(msg?.content || '').match(/data:image\/[a-zA-Z]+;base64,([^\s"')]+)/);
    if (m) b64 = m[1];
  }
  if (!b64) return false;
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  if (fs.statSync(out).size > 1024) { await stripProvenance(out); return true; }
  return false;
}

export async function generateRealPhoto(prompt: string, out: string, cost: CostTracker, label: string, model = MODELS.image, aspect: string = curFrame().aspect): Promise<boolean> {
  const est = model === MODELS.image ? EST.image : EST.imageCheap;
  if (!reserve(cost, est)) { console.warn(`[image] skipped "${label}": credit budget reached`); return false; }
  try {
    const res = await orChat({
      model,
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: aspect },
      messages: [{ role: 'user', content: `${REALISM_PREFIX.replace('Vertical 9:16 framing.', aspect === '9:16' ? 'Vertical 9:16 framing.' : `${aspect} framing.`)}\nScene: ${prompt}\n${REALISM_NEGATIVE}` }],
    }, cost, label);
    return await imageFromResponse(res, out);
  } catch (e) {
    console.warn('[image]', (e as Error).message);
    return false;
  } finally { release(cost, est); }
}

// ------------------------------------------------------------------ 6. overlay elements (transparent PNG)
export async function makeOverlayElement(element: string, workDir: string, cost: CostTracker): Promise<string | null> {
  const dir = path.join(workDir, 'overlays');
  fs.mkdirSync(dir, { recursive: true });
  const id = crypto.createHash('md5').update(element.toLowerCase()).digest('hex').slice(0, 10);
  const outPng = path.join(dir, `${id}.png`);
  if (fs.existsSync(outPng)) return outPng;
  const raw = path.join(dir, `${id}_raw.png`);
  if (!reserve(cost, EST.overlay)) { console.warn('[overlay] skipped: credit budget reached'); return null; }
  try {
    const res = await orChat({
      model: MODELS.overlay,
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: '1:1' },
      messages: [{ role: 'user', content: `A single ${element}, glossy high-detail 3D sticker/emoji style object, centered, fully visible with margin around it, isolated on a perfectly plain solid white background. No shadow on the background, no text, no other objects, no frame.` }],
    }, cost, `overlay "${element}"`);
    if (!(await imageFromResponse(res, raw))) return null;
  } catch (e) { console.warn('[overlay]', (e as Error).message); return null; } finally { release(cost, EST.overlay); }
  const r = await run(pyBin(), [HELPER, 'rembg', raw, outPng], { timeoutMs: 5 * 60 * 1000 });
  if (r.code !== 0 || !fs.existsSync(outPng)) {
    // fallback: chroma-key the white background
    const f = await ffmpeg(withCleanOutput(['-i', raw, '-vf', 'format=rgba,colorkey=0xFFFFFF:0.12:0.08', outPng], { sei: false }));
    if (f.code !== 0) return null;
  }
  if (fs.existsSync(outPng)) await stripProvenance(outPng);
  return outPng;
}

// ------------------------------------------------------------------ 7. rendering
/** Working canvas for photo motion (2x of the 720x1280 frame; 1.5x of 1920x1080). */
function bigCanvas(f: Frame = curFrame()) { return f.orientation === 'landscape' ? { bw: 2880, bh: 1620 } : { bw: 1440, bh: 2560 }; }

function motionFilter(i: number, frames: number) {
  const t = i % 5;
  const { bw, bh } = bigCanvas();
  const s = `${bw}x${bh}`;
  if (t === 0) return `zoompan=z='1+0.18*on/${frames}':d=${frames}:s=${s}:fps=${FPS}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
  if (t === 1) return `zoompan=z='1.18-0.18*on/${frames}':d=${frames}:s=${s}:fps=${FPS}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
  if (t === 2) return `zoompan=z='1.15':d=${frames}:s=${s}:fps=${FPS}:x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)'`;
  if (t === 3) return `zoompan=z='1.15':d=${frames}:s=${s}:fps=${FPS}:x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)'`;
  return `zoompan=z='1.05+0.12*on/${frames}':d=${frames}:s=${s}:fps=${FPS}:x='(iw-iw/zoom)*on/${frames}':y='(ih-ih/zoom)*on/${frames}'`;
}

export async function renderSceneClip(media: NonNullable<SceneSpec['media']>, i: number, frames: number, out: string): Promise<boolean> {
  const fr = curFrame();
  const { w: W, h: H } = fr;
  const { bw, bh } = bigCanvas(fr);
  const enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an', '-frames:v', String(frames), ...STRIP_ENCODE_FLAGS, ...STRIP_H264_SEI];
  const dims = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', media.file]);
  const [iw, ih] = dims.out.trim().split(',').map(Number);
  // horizontal frame + vertical/square media: blurred fill + the whole media in the middle (never a thin centre slice)
  const narrowInWide = fr.orientation === 'landscape' && iw > 0 && ih > 0 && iw / ih < 1.2;
  if (media.kind === 'video') {
    const dur = frames / FPS;
    const srcDur = await probeDuration(media.file);
    const ss = srcDur > dur + 2 ? Math.min(1.5, srcDur - dur - 0.2) : 0;
    const vf = narrowInWide
      ? `split[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=30:2,eq=brightness=-0.1[bg];[b]scale=-2:${H}[fg];[bg][fg]overlay=(W-w)/2:0,setsar=1,fps=${FPS}`
      : `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},eq=saturation=1.03`;
    const r = await ffmpeg(['-stream_loop', '-1', '-ss', ss.toFixed(2), '-i', media.file, '-t', (dur + 0.5).toFixed(2),
      '-vf', vf, ...enc, out]);
    if (r.code === 0) return true;
    console.warn('[clip video]', r.err.slice(-300));
    return false;
  }
  // photos much wider than the frame: slow horizontal pan across it instead of a hard centre crop
  const landscape = iw > 0 && ih > 0 && iw / ih > (fr.orientation === 'landscape' ? 2.4 : 1.05);
  const vf = narrowInWide
    ? `split[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=30:2,eq=brightness=-0.1[bg];[b]scale=-2:${H}:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:0,setsar=1,scale=${bw}:${bh},${motionFilter(i, frames)},scale=${W}:${H}:flags=lanczos`
    : landscape
      ? `scale=-2:${bh},setsar=1,crop=${bw}:${bh}:x='(iw-ow)*(${i % 2 === 0 ? `0.2+0.6*n/${frames}` : `0.8-0.6*n/${frames}`})':y=0,scale=${W}:${H}:flags=lanczos`
      : `scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},setsar=1,${motionFilter(i, frames)},scale=${W}:${H}:flags=lanczos`;
  const r = await ffmpeg([...(landscape && !narrowInWide ? ['-loop', '1', '-framerate', String(FPS)] : []), '-i', media.file, '-vf', vf, ...enc, out]);
  if (r.code !== 0) console.warn('[clip photo]', r.err.slice(-300));
  return r.code === 0;
}

// locate a phrase (sequence of words) inside a word range; returns absolute index of first word
export function findPhrase(words: Word[], from: number, to: number, phrase: string): number {
  const p = phrase.split(/\s+/).map(norm).filter(Boolean);
  if (!p.length) return -1;
  for (let i = from; i + p.length - 1 <= to; i++) {
    let ok = true;
    for (let k = 0; k < p.length; k++) if (norm(words[i + k].w) !== p[k]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

export function findWord(words: Word[], from: number, to: number, word: string): number {
  const t = norm(word);
  if (!t) return -1;
  for (let i = from; i <= to; i++) if (norm(words[i].w) === t) return i;
  for (let i = from; i <= to; i++) { const n = norm(words[i].w); if (n.startsWith(t.slice(0, Math.max(4, t.length - 2))) || t.startsWith(n) && n.length >= 4) return i; }
  return -1;
}

// ------------------------------------------------------------------ main entry
export interface PipelineInput {
  projectId: string;
  prompt: string;
  language: string;
  format: string;
  workDir: string;
  outVideo: string;
  outPoster: string;
  voice?: string;
  level?: Level;
  style?: CaptionStyle;
  attachedImages?: string[]; // absolute paths to user images, used as scene photos in order
  aspect?: '9:16' | '16:9'; // output frame (default vertical short-form)
  previous?: { scenes: SceneSpec[]; full_script: string; words?: Word[] };
  onProgress: (pct: number, msg: string) => void;
  cost: CostTracker;
}

export interface PipelineResult { title: string; scenes: SceneSpec[]; full_script: string; words: Word[]; audioFile: string; duration: number; ranges: { from: number; to: number }[]; sceneFrames: number[] }

export function sceneTiming(scenes: SceneSpec[], words: Word[], duration: number) {
  const ranges: { from: number; to: number }[] = [];
  let idx = 0;
  for (const s of scenes) {
    const n = s.voiceover_chunk.split(/\s+/).filter(Boolean).length;
    ranges.push({ from: idx, to: Math.min(words.length - 1, idx + n - 1) });
    idx += n;
  }
  const sceneStart = (i: number) => (i === 0 ? 0 : words[ranges[i].from]?.start ?? 0);
  const boundaries = scenes.map((_, i) => sceneStart(i));
  boundaries.push(duration);
  const frameAt = (t: number) => Math.round(t * FPS);
  const sceneFrames = scenes.map((_, i) => Math.max(8, frameAt(boundaries[i + 1]) - frameAt(boundaries[i])));
  return { ranges, boundaries, sceneFrames };
}

function isRealStock(m?: SceneSpec['media'] | null): boolean {
  if (!m?.source) return false;
  const src = m.source.split(':')[0];
  return src !== 'ai' && src !== 'user' && src !== 'gradient';
}

/** After per-scene fetch, try leftover High scenes as stock until the guaranteed share is met. */
export async function fulfillHighStock(scenes: SceneSpec[], workDir: string, cost: CostTracker, cfg: LevelCfg, state: { ai: number; exclude: Set<string> }): Promise<void> {
  if (cfg.level !== 'high') return;
  const eligible = scenes.map((s, i) => ({ s, i })).filter(({ s }) => s.media?.source !== 'user');
  const target = highStockTarget(eligible.length);
  let have = eligible.filter(({ s }) => isRealStock(s.media)).length;
  if (have >= target) return;
  const so: StockOpts = { minScore: cfg.visionMin, hd: cfg.hd, exclude: state.exclude, wide: true, softMin: 6 };
  for (const { s, i } of eligible) {
    if (have >= target) break;
    if (isRealStock(s.media)) continue;
    const prev = s.media;
    const m = (await findStock(s, 'video', workDir, cost, `${i}_retry`, so)) || (await findStock(s, 'photo', workDir, cost, `${i}_retry`, so));
    if (m) {
      s.media = m;
      s.media_type = m.kind === 'video' ? 'stock_video' : 'stock_photo';
      have++;
      console.log(`[high stock] scene ${s.scene_num}: compensated with ${m.source} ${m.kind}`);
    } else if (prev) {
      s.media = prev;
    }
  }
  if (have < target) console.warn(`[high stock] only ${have}/${eligible.length} scenes have internet stock (target ${target})`);
}

/** Find real media for one scene (stock -> AI photo). Returns null if nothing could be obtained. */
export async function mediaForScene(s: SceneSpec, i: number, workDir: string, cost: CostTracker, cfg: LevelCfg,
  state: { ai: number; exclude: Set<string> }, force?: 'stock_video' | 'stock_photo' | 'ai_photo'): Promise<SceneSpec['media'] | null> {
  const type = force || s.media_type;
  const so: StockOpts = { minScore: cfg.visionMin, hd: cfg.hd, exclude: state.exclude };
  if (cfg.level === 'high') { so.wide = true; so.softMin = 6; }
  let m: SceneSpec['media'] | null = null;
  if (type === 'stock_video' || (cfg.level === 'high' && type === 'stock_photo')) {
    m = (await findStock(s, 'video', workDir, cost, i, so)) || (await findStock(s, 'photo', workDir, cost, i, so));
  } else if (type === 'stock_photo') {
    m = (await findStock(s, 'photo', workDir, cost, i, so)) || (cfg.level !== 'low' ? null : await findStock(s, 'video', workDir, cost, i, so));
  }
  if (!m && (type === 'ai_photo' || state.ai < cfg.maxAiPhotos)) {
    if (cfg.level === 'high' && type !== 'ai_photo') {
      console.warn(`[high stock] scene ${s.scene_num}: no relevant stock for query="${s.search_query || deriveSearchQuery(s)}", falling back to AI photo`);
    }
    state.ai++;
    const f = path.join(workDir, `scene_${i}_${Date.now()}.png`);
    if (await generateRealPhoto(s.ai_image_prompt || s.visual_description, f, cost, `photo scene ${s.scene_num}`, cfg.image)) m = { kind: 'photo', source: 'ai', file: f };
    else state.ai--;
  }
  return m;
}

/** Never leave a blank scene: borrow the nearest scene's media, or as a last resort a moving dark-blue gradient. */
export async function fillMissingMedia(scenes: SceneSpec[], workDir: string) {
  const have = scenes.map((s, i) => (s.media?.file && fs.existsSync(s.media.file) ? i : -1)).filter((i) => i >= 0);
  for (let i = 0; i < scenes.length; i++) {
    if (scenes[i].media?.file && fs.existsSync(scenes[i].media!.file)) continue;
    if (have.length) {
      const j = have.reduce((b, x) => (Math.abs(x - i) < Math.abs(b - i) ? x : b), have[0]);
      scenes[i].media = { ...scenes[j].media!, source: `${scenes[j].media!.source}:reused` };
    } else {
      const f = path.join(workDir, `scene_${i}_gradient_${curFrame().w}.png`);
      await ffmpeg(['-f', 'lavfi', '-i', `gradients=s=${curFrame().w}x${curFrame().h}:c0=0x0b1a3a:c1=0x0f7dfe:c2=0x05060a:n=3:speed=0.01`, '-frames:v', '1', f]);
      scenes[i].media = { kind: 'photo', source: 'gradient', file: f };
    }
  }
}

export function runVideoPipeline(inp: PipelineInput): Promise<PipelineResult> {
  return withFrame(frameFor(inp.aspect), () => runVideoPipelineInFrame(inp));
}

async function runVideoPipelineInFrame(inp: PipelineInput): Promise<PipelineResult> {
  const { workDir, cost } = inp;
  fs.mkdirSync(workDir, { recursive: true });
  const ru = String(inp.language).toLowerCase().startsWith('ru');
  const say = (en: string, r: string) => (ru ? r : en);
  const cfg = levelCfg(normLevel(inp.level));

  // 1. script
  inp.onProgress(8, say('Writing the script...', 'Пишем сценарий...'));
  const script = await writeScript({ prompt: inp.prompt, language: inp.language, format: inp.format, cost, previous: inp.previous, level: cfg.level });
  const scenes = script.scenes;
  const fullScript = scenes.map((s) => s.voiceover_chunk).join(' ');

  // 2. voiceover (+ reuse when an edit doesn't touch narration)
  const audioFile = path.join(workDir, `voiceover_${Date.now()}.mp3`);
  const prevAudio = path.join(workDir, 'prev_voiceover.mp3');
  let words: Word[] | null = null;
  const sameNarration = !!inp.previous && inp.previous.full_script === fullScript && fs.existsSync(prevAudio) && Array.isArray(inp.previous.words) && inp.previous.words.length > 0;
  if (sameNarration) {
    fs.copyFileSync(prevAudio, audioFile);
    words = inp.previous!.words!;
  } else {
    inp.onProgress(18, say('Recording the voiceover...', 'Записываем озвучку...'));
    const ok = await generateSpeech(fullScript, audioFile, cost, inp.voice || 'alloy', cfg.tts);
    if (!ok) throw new Error('Voiceover generation failed');
  }
  const duration = await probeDuration(audioFile);
  if (!words) {
    inp.onProgress(26, say('Syncing subtitles to the voice...', 'Синхронизируем субтитры с голосом...'));
    words = await alignWords(audioFile, fullScript, workDir, inp.language);
  }
  const { ranges, boundaries, sceneFrames } = sceneTiming(scenes, words, duration);

  // 3. media per scene
  inp.onProgress(32, say('Finding real footage and generating photos...', 'Подбираем реальные видео/фото и генерируем кадры...'));
  let done = 0;
  const state = { ai: 0, exclude: new Set<string>() };
  await mapLimit(scenes, 3, async (s, i) => {
    const prev = inp.previous?.scenes?.[i];
    if (inp.attachedImages?.[i] && fs.existsSync(inp.attachedImages[i])) {
      const src = inp.attachedImages[i];
      const f = path.join(workDir, `user_img_${i}_${path.basename(src)}`);
      try { fs.copyFileSync(src, f); await stripProvenance(f); } catch { /* keep original */ }
      s.media = { kind: 'photo', source: 'user', file: fs.existsSync(f) ? f : src };
    } else if (prev && s.needs_new_visual === false && prev.media?.file && fs.existsSync(prev.media.file)) {
      s.media = prev.media;
    } else {
      s.media = (await mediaForScene(s, i, workDir, cost, cfg, state)) || undefined;
    }
    done++;
    inp.onProgress(32 + Math.round((done / scenes.length) * 33), say(`Visuals ${done}/${scenes.length}`, `Кадры ${done}/${scenes.length}`));
  });
  if (cfg.level === 'high') await fulfillHighStock(scenes, workDir, cost, cfg, state);
  await fillMissingMedia(scenes, workDir);

  await assembleVideo({ scenes, words, duration, audioFile, workDir, outVideo: inp.outVideo, outPoster: inp.outPoster, cost, onProgress: inp.onProgress, ru, sceneFrames, ranges, style: inp.style, maxOverlays: cfg.maxOverlays });
  try { fs.copyFileSync(audioFile, prevAudio); } catch { /* ignore */ }

  scenes.forEach((s, i) => { s.text = s.headline?.phrase || s.voiceover_chunk.split(/\s+/).slice(0, 6).join(' '); (s as any).duration = +(boundaries[i + 1] - boundaries[i]).toFixed(2); });
  return { title: script.title, scenes, full_script: fullScript, words, audioFile, duration, ranges, sceneFrames };
}

export interface AssembleInput {
  scenes: SceneSpec[]; words: Word[]; duration: number; audioFile: string; workDir: string;
  outVideo: string; outPoster: string; cost: CostTracker; onProgress: (pct: number, msg: string) => void; ru: boolean;
  sceneFrames: number[]; ranges: { from: number; to: number }[]; style?: CaptionStyle; maxOverlays?: number; extraOverlays?: OverlayItem[];
}

export interface OverlayItem { file: string; start: number; end: number; mode: 'sticker' | 'card' | 'fullscreen' }

/** Render (or reuse from cache) the clip for one scene. */
export async function sceneClip(media: NonNullable<SceneSpec['media']>, i: number, frames: number, workDir: string): Promise<string | null> {
  const dir = path.join(workDir, 'clips');
  fs.mkdirSync(dir, { recursive: true });
  let mt = 0;
  try { mt = fs.statSync(media.file).mtimeMs; } catch { return null; }
  const key = crypto.createHash('md5').update(`${media.file}|${mt}|${frames}|${i % 5}|${curFrame().w}x${curFrame().h}`).digest('hex').slice(0, 16);
  const out = path.join(dir, `${key}.mp4`);
  if (fs.existsSync(out) && fs.statSync(out).size > 1000) return out;
  const ok = await renderSceneClip(media, i, frames, out);
  return ok ? out : null;
}

export function headlineIndexes(scenes: SceneSpec[], words: Word[], ranges: { from: number; to: number }[]) {
  const headlines: { start_idx: number; end_idx: number; highlight_idx: number }[] = [];
  scenes.forEach((s, i) => {
    const r = ranges[i];
    if (s.headline && r) {
      const st = findPhrase(words, r.from, r.to, s.headline.phrase);
      if (st >= 0) {
        const len = s.headline.phrase.split(/\s+/).filter(Boolean).length;
        const en = st + len - 1;
        headlines.push({ start_idx: st, end_idx: en, highlight_idx: findWord(words, st, en, s.headline.highlight) });
      }
    }
  });
  return headlines;
}

/** Overlay timing next to its trigger word, never colliding with a headline caption. */
export function overlayWindow(words: Word[], wi: number, duration: number, headlines: { start_idx: number; end_idx: number }[], len = 2.8) {
  let start = Math.max(0, (words[wi]?.start ?? 0) - 0.1);
  let end = Math.min(duration - 0.05, start + len);
  for (const h of headlines) {
    const hs = words[h.start_idx].start; const he = words[h.end_idx].end + 0.9;
    if (start < he && end > hs) { start = he; end = Math.min(duration - 0.05, start + len - 0.2); }
  }
  return end - start < 1.4 ? null : { start, end };
}

export async function buildAss(workDir: string, words: Word[], duration: number, headlines: any[], style?: CaptionStyle): Promise<string> {
  const spec = path.join(workDir, `subs_spec_${Date.now()}.json`);
  const ass = path.join(workDir, `subs_${Date.now()}.ass`);
  const fr = curFrame();
  // horizontal: smaller subtitles in the lower safe area, longer lines; headlines a bit above centre
  const layout = fr.orientation === 'landscape'
    ? { sub_font_size: 58, headline_font_size: 96, sub_y_frac: 0.84, head_y_frac: 0.42, sub_max_words: 6, side_margin: 240 }
    : {};
  fs.writeFileSync(spec, JSON.stringify({ width: fr.w, height: fr.h, duration, words, headlines, style: styleSpec(style || {}), ...layout }));
  const ar = await run(pyBin(), [HELPER, 'ass', spec, ass], { timeoutMs: Math.max(120000, duration * 200) });
  if (ar.code !== 0) throw new Error('subtitle build failed: ' + ar.err.slice(-300));
  return ass;
}

/** Steps 4-7: headline/overlay timing, overlay elements, scene clips, subtitles, final mux. */
export async function assembleVideo(a: AssembleInput): Promise<void> {
  const { scenes, words, duration, audioFile, workDir, cost, sceneFrames, ranges } = a;
  const say = (en: string, r: string) => (a.ru ? r : en);
  const headlines = headlineIndexes(scenes, words, ranges);
  a.onProgress(68, say('Creating animated elements...', 'Создаём анимированные элементы...'));
  const overlays: OverlayItem[] = [];
  const overlayJobs = scenes.map((s, i) => ({ s, i })).filter((x) => x.s.overlay).slice(0, a.maxOverlays ?? 3);
  await mapLimit(overlayJobs, 2, async ({ s, i }) => {
    const r = ranges[i];
    let wi = findWord(words, r.from, r.to, s.overlay!.trigger_word);
    if (wi < 0) wi = r.from;
    const win = overlayWindow(words, wi, duration, headlines);
    if (!win) return;
    const file = (s.overlay as any).file && fs.existsSync((s.overlay as any).file) ? (s.overlay as any).file : await makeOverlayElement(s.overlay!.element, workDir, cost);
    if (file) { (s.overlay as any).file = file; overlays.push({ file, ...win, mode: 'sticker' }); }
  });

  overlays.push(...(a.extraOverlays || []));
  // 5. render scene clips (cached: unchanged scenes are not re-encoded on edits)
  a.onProgress(74, say('Editing the video...', 'Монтируем видео...'));
  const clips: string[] = new Array(scenes.length);
  let rendered = 0;
  // long videos have hundreds of scenes: render a few clips in parallel (short ones stay sequential as before)
  await mapLimit(scenes.map((_, i) => i), scenes.length > 12 ? 3 : 1, async (i) => {
    let out = await sceneClip(scenes[i].media!, i, sceneFrames[i], workDir);
    if (!out) {
      // broken media -> borrow another scene's visual instead of failing / showing grey
      const alt = scenes.find((x, j) => j !== i && x.media && fs.existsSync(x.media.file));
      if (alt) { scenes[i].media = { ...alt.media!, source: alt.media!.source + ':reused' }; out = await sceneClip(scenes[i].media!, i, sceneFrames[i], workDir); }
    }
    if (!out) throw new Error(`Failed to render scene ${i + 1}`);
    clips[i] = out;
    rendered++;
    a.onProgress(74 + Math.round((rendered / scenes.length) * 12), say(`Editing ${rendered}/${scenes.length}`, `Монтаж ${rendered}/${scenes.length}`));
  });
  const list = path.join(workDir, 'concat.txt');
  fs.writeFileSync(list, clips.map((c) => `file '${c}'`).join('\n'));
  const merged = path.join(workDir, 'merged.mp4');
  const cr = await ffmpeg(withCleanOutput(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', merged], { sei: false }));
  if (cr.code !== 0) throw new Error('concat failed: ' + cr.err.slice(-200));

  const ass = await buildAss(workDir, words, duration, headlines, a.style);
  a.onProgress(90, say('Adding subtitles and effects...', 'Добавляем субтитры и эффекты...'));
  await composeFinal({ baseVideo: merged, overlays, assFile: ass, audioFile, duration, outVideo: a.outVideo, outPoster: a.outPoster });
}

/** Final composition: overlays (eased rise / fullscreen inserts) + subtitles + audio. */
export async function composeFinal(c: { baseVideo: string; overlays: OverlayItem[]; assFile: string; audioFile: string; duration: number; outVideo: string; outPoster: string }) {
  const { overlays, duration } = c;
  const fr = curFrame();
  const { w: W, h: H } = fr;
  const wide = fr.orientation === 'landscape';
  const args: string[] = ['-i', c.baseVideo];
  overlays.forEach((o) => {
    if (o.mode === 'fullscreen' && /\.(mp4|webm|mov)$/i.test(o.file)) args.push('-i', o.file);
    else args.push('-loop', '1', '-t', duration.toFixed(2), '-i', o.file);
  });
  args.push('-i', c.audioFile);
  const audioIdx = overlays.length + 1;
  const fc: string[] = [];
  let last = '[0:v]';
  const RISE = 0.75;
  // fullscreen inserts first (under stickers/cards)
  const order = overlays.map((o, k) => ({ o, k })).sort((x, y) => (x.o.mode === 'fullscreen' ? 0 : 1) - (y.o.mode === 'fullscreen' ? 0 : 1));
  order.forEach(({ o, k }) => {
    const A = o.start.toFixed(3), B = o.end.toFixed(3);
    if (o.mode === 'fullscreen') {
      const isVid = /\.(mp4|webm|mov)$/i.test(o.file);
      fc.push(`[${k + 1}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},format=yuva420p,` +
        `${isVid ? `setpts=PTS-STARTPTS+${A}/TB,` : ''}fade=t=in:st=${A}:d=0.2:alpha=1,fade=t=out:st=${(o.end - 0.2).toFixed(3)}:d=0.2:alpha=1[ov${k}]`);
      fc.push(`${last}[ov${k}]overlay=0:0:enable='between(t,${A},${B})':eof_action=pass[v${k}]`);
    } else {
      const maxW = wide ? (o.mode === 'card' ? 470 : 300) : (o.mode === 'card' ? 540 : 330);
      fc.push(`[${k + 1}:v]scale=w='min(${maxW},iw)':h=-1,format=rgba[ov${k}]`);
      const pin = `clip((t-${A})/${RISE},0,1)`;
      const pout = `clip((t-(${B}-${RISE}))/${RISE},0,1)`;
      const target = wide ? `(H*0.43-h/2)` : o.mode === 'card' ? `(H*0.40-h/2)` : `(H*0.47-h/2)`;
      const y = `${target}+(H-${target})*(pow(1-${pin},3)+pow(${pout},3))`;
      // horizontal: popups sit in the right third so the speaker/subject stays visible
      const x = wide ? `(W*0.76-w/2)` : `(W-w)/2`;
      fc.push(`${last}[ov${k}]overlay=x='${x}':y='${y}':enable='between(t,${A},${B})':eval=frame[v${k}]`);
    }
    last = `[v${k}]`;
  });
  const esc = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  fc.push(`${last}subtitles=filename='${esc(c.assFile)}':fontsdir='${esc(FONT_DIR)}'[vout]`);
  args.push('-filter_complex', fc.join(';'), '-map', '[vout]', '-map', `${audioIdx}:a`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-t', duration.toFixed(3), '-movflags', '+faststart',
    ...STRIP_ENCODE_FLAGS, ...STRIP_H264_SEI, c.outVideo);
  const rr = await ffmpeg(args, Math.max(20 * 60 * 1000, duration * 2500));
  if (rr.code !== 0 || !fs.existsSync(c.outVideo)) throw new Error('final render failed: ' + rr.err.slice(-400));
  await ffmpeg(withCleanOutput(['-ss', Math.min(1, duration / 2).toFixed(2), '-i', c.outVideo, '-frames:v', '1', '-q:v', '3', c.outPoster], { sei: false }));
  await stripProvenance(c.outVideo);
  if (fs.existsSync(c.outPoster)) await stripProvenance(c.outPoster);
}
