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
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FONT_DIR = path.resolve(__dirname, 'fonts');
const HELPER = path.resolve(__dirname, 'tools/media_helper.py');

const W = 720;
const H = 1280;
const FPS = 30;

export const MODELS = {
  get script() { return process.env.SCRIPT_MODEL || 'openai/gpt-4o-mini'; },
  get tts() { return process.env.TTS_MODEL || 'openai/gpt-audio-mini'; },
  get image() { return process.env.IMAGE_MODEL || 'google/gemini-3.1-flash-image'; },
  get overlay() { return process.env.OVERLAY_IMAGE_MODEL || 'google/gemini-2.5-flash-image'; },
  get vision() { return process.env.VISION_MODEL || 'google/gemini-2.5-flash-lite'; },
};

const orKey = () => process.env.OPENROUTER_API_KEY || '';
const pyBin = () => process.env.MEDIA_PYTHON || 'python3';
const UA = 'nindVideoBot/1.0 (https://nind.pro)';

// ------------------------------------------------------------------ cost tracking
export interface CostTracker { usd: number; items: { label: string; model: string; usd: number }[] }
export const newCostTracker = (): CostTracker => ({ usd: 0, items: [] });

function addCost(cost: CostTracker | undefined, label: string, model: string, usd: number) {
  if (!cost || !isFinite(usd) || usd <= 0) return;
  cost.usd += usd;
  cost.items.push({ label, model, usd: Math.round(usd * 1e6) / 1e6 });
}

// ------------------------------------------------------------------ small utils
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function run(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ code: number; out: string; err: string }> {
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

const ffmpeg = (args: string[], timeoutMs = 10 * 60 * 1000) => run('ffmpeg', ['-y', '-v', 'error', ...args], { timeoutMs });

async function probeDuration(file: string): Promise<number> {
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

function download(url: string, out: string, maxBytes = 80 * 1024 * 1024, timeoutSec = 60): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn('curl', ['-sSL', '--fail', '--max-time', String(timeoutSec), '--max-filesize', String(maxBytes), '-A', UA, url, '-o', out]);
    p.on('close', (code) => resolve(code === 0 && fs.existsSync(out) && fs.statSync(out).size > 2048));
    p.on('error', () => resolve(false));
  });
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
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

const norm = (w: string) => w.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '');

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

function extractJson(text: string): any {
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

const SCRIPT_RULES = (langLine: string, format: string) => `You are an elite short-form video director and scriptwriter (TikTok, Reels, Shorts).
${langLine}
Format style: ${format}.

RULES:
1. Total length 15-40 s (5-8 scenes) unless the user asked for a specific duration. Strong hook, build-up, satisfying ending. Never truncate the story.
2. voiceover_chunk: natural spoken sentences. The full voiceover = all chunks in order. Do not put stage directions or emojis in it.
3. Every scene's visuals must literally match what is being said at that exact moment.
4. media_type: mix real footage and AI. Use "stock_video" for real places, nature, cities, people doing generic actions, technology, animals, events; "stock_photo" for real well-known things, landmarks, historical subjects; "ai_photo" only for things impossible to film/find (specific fictional situations, the future, very specific compositions). At least 40% of scenes must be stock_video or stock_photo.
5. search_query: ALWAYS English, concrete nouns (e.g. "chernobyl reactor ruins", "geiger counter", "surfer big wave").
6. ai_image_prompt: describe a REAL photograph: real people/objects, natural light, real location; never ask for illustration, render, cartoon, or text.
7. headline: REQUIRED in exactly 2 scenes (3 if there are 7+ scenes) - the key punchlines. phrase = 2-6 words copied verbatim and consecutively from that scene's voiceover_chunk; highlight = the single most important word of the phrase.
8. overlay: REQUIRED in 1-2 scenes. Pick the moments where the narration names something with an obvious icon/object (radiation -> yellow warning triangle with black exclamation mark; money -> stack of dollar bills; fire -> flame; idea -> glowing light bulb; time -> alarm clock; water/flood -> water drop; growth -> green arrow up; danger -> red alarm siren). trigger_word = the exact word in voiceover_chunk. Never put a headline and an overlay in the same scene.

Return ONLY valid JSON with this schema:
${SCENE_SCHEMA}`;

export async function writeScript(opts: {
  prompt: string; language: string; format: string; cost: CostTracker;
  previous?: { scenes: SceneSpec[]; full_script: string };
}): Promise<{ title: string; scenes: SceneSpec[]; needs_new_voiceover: boolean }> {
  const lang = String(opts.language || 'auto').toLowerCase();
  const langLine = lang === 'auto' || !lang
    ? 'Language of the voiceover, headlines and overlays text: the same language the user wrote the prompt in.'
    : `Language of the voiceover and headlines: ${lang.startsWith('ru') ? 'Russian' : lang.startsWith('en') ? 'English' : lang}.`;
  let system = SCRIPT_RULES(langLine, opts.format || 'auto');
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
  return { title: String(data.title || opts.prompt.slice(0, 40)), scenes, needs_new_voiceover: data.needs_new_voiceover !== false };
}

// ------------------------------------------------------------------ 2. voiceover
export function generateSpeech(text: string, outMp3: string, cost: CostTracker, voice = 'alloy'): Promise<boolean> {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model: MODELS.tts,
      modalities: ['text', 'audio'],
      audio: { voice, format: 'pcm16' },
      stream: true,
      usage: { include: true },
      messages: [
        { role: 'system', content: 'You are a professional voice-over narrator. Read the user message aloud EXACTLY as written, word for word, in its original language, with an energetic, natural, confident delivery. Do not add, skip, translate or comment on anything.' },
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
        addCost(cost, 'voiceover', MODELS.tts, usd || 0);
        if (!bufs.length) return resolve(false);
        const pcm = outMp3.replace(/\.[^.]+$/, '.pcm');
        fs.writeFileSync(pcm, Buffer.concat(bufs));
        const r = await ffmpeg(['-f', 's16le', '-ar', '24000', '-ac', '1', '-i', pcm, '-af', 'silenceremove=start_periods=1:start_threshold=-50dB', '-c:a', 'libmp3lame', '-b:a', '192k', outMp3]);
        try { fs.unlinkSync(pcm); } catch { /* ignore */ }
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
interface Candidate { source: string; kind: 'video' | 'photo'; thumb: string; url: string; page_url?: string; w?: number; h?: number }

async function pexels(query: string, kind: 'video' | 'photo'): Promise<Candidate[]> {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  try {
    if (kind === 'video') {
      const j = await httpJson(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=5`, { headers: { Authorization: key }, timeoutMs: 15000 });
      return (j.videos || []).map((v: any) => {
        const files = (v.video_files || []).filter((f: any) => f.file_type === 'video/mp4' && f.width && f.height)
          .sort((a: any, b: any) => Math.abs(a.height - 1280) - Math.abs(b.height - 1280));
        return files[0] ? { source: 'pexels', kind, thumb: v.image, url: files[0].link, page_url: v.url, w: files[0].width, h: files[0].height } : null;
      }).filter(Boolean);
    }
    const j = await httpJson(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=5`, { headers: { Authorization: key }, timeoutMs: 15000 });
    return (j.photos || []).map((p: any) => ({ source: 'pexels', kind, thumb: p.src?.medium, url: p.src?.large2x || p.src?.original, page_url: p.url, w: p.width, h: p.height }));
  } catch (e) { console.warn('[pexels]', (e as Error).message); return []; }
}

async function pixabay(query: string, kind: 'video' | 'photo'): Promise<Candidate[]> {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];
  try {
    if (kind === 'video') {
      const j = await httpJson(`https://pixabay.com/api/videos/?key=${key}&q=${encodeURIComponent(query)}&per_page=5&safesearch=true`, { timeoutMs: 15000 });
      return (j.hits || []).map((h: any) => {
        const v = h.videos?.medium?.url ? h.videos.medium : h.videos?.small;
        return v?.url ? { source: 'pixabay', kind, thumb: v.thumbnail || h.videos?.tiny?.thumbnail, url: v.url, page_url: h.pageURL, w: v.width, h: v.height } : null;
      }).filter((c: any) => c && c.thumb);
    }
    const j = await httpJson(`https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(query)}&image_type=photo&per_page=5&safesearch=true`, { timeoutMs: 15000 });
    return (j.hits || []).map((h: any) => ({ source: 'pixabay', kind, thumb: h.webformatURL, url: h.largeImageURL, page_url: h.pageURL, w: h.imageWidth, h: h.imageHeight }));
  } catch (e) { console.warn('[pixabay]', (e as Error).message); return []; }
}

const WIKI_BAD = /\b(map|maps|diagram|logo|chart|graph|flag|coat of arms|seal|icon|symbol|scheme|schema|drawing|svg|pdf|tiff?|stamp|poster|document|animation|animated|render|veo|ai-generated|illustration|cartoon|screenshot)\b/i;

export async function wikimedia(query: string, kind: 'video' | 'photo'): Promise<Candidate[]> {
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
        const pick = ders.find((d) => /720p.*\.webm$/.test(d.src)) || ders.find((d) => /480p.*\.webm$/.test(d.src)) || ders.find((d) => /\.webm$/.test(d.src));
        if (!pick) continue;
        out.push({ source: 'wikimedia', kind, thumb, url: pick.src, page_url: ii.descriptionurl, w: ii.width, h: ii.height });
      }
      if (out.length >= 5) break;
    }
    return out;
  } catch (e) { console.warn('[wikimedia]', (e as Error).message); return []; }
}

/** Ask a cheap vision model which candidate (if any) really shows the scene. */
async function verifyCandidates(scene: SceneSpec, cands: Candidate[], workDir: string, cost: CostTracker, tag: string): Promise<{ idx: number; score: number }> {
  const thumbs = await mapLimit(cands, 4, async (c, i) => {
    const raw = path.join(workDir, `cand_${tag}_${i}.bin`);
    const jpg = path.join(workDir, `cand_${tag}_${i}.jpg`);
    if (!(await download(c.thumb, raw, 8 * 1024 * 1024, 20))) return null;
    const r = await ffmpeg(['-i', raw, '-frames:v', '1', '-vf', 'scale=384:384:force_original_aspect_ratio=decrease', '-q:v', '5', jpg], 30000);
    return r.code === 0 && fs.existsSync(jpg) ? fs.readFileSync(jpg).toString('base64') : null;
  });
  const valid = thumbs.map((t, i) => ({ t, i })).filter((x) => x.t);
  if (!valid.length) return { idx: -1, score: 0 };
  const content: any[] = [{
    type: 'text',
    text: `You check stock media for a short video. Scene narration: "${scene.voiceover_chunk}". Required visual: "${scene.visual_description}".
Below are ${valid.length} candidate images (${cands[0].kind === 'video' ? 'video thumbnails' : 'photos'}), numbered 1..${valid.length} in order.
Score each 0-10 for how well it literally shows the required visual AND is a clean real-world photo/footage frame (penalize maps, diagrams, text-heavy images, logos, collages, watermarks, low quality, unrelated subjects).
Return ONLY JSON: {"scores":[...], "best": <number 1..${valid.length} or 0 if none scores >= 7>}`,
  }];
  valid.forEach((v) => content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${v.t}` } }));
  try {
    const res = await orChat({ model: MODELS.vision, messages: [{ role: 'user', content }], response_format: { type: 'json_object' }, temperature: 0 }, cost, `vision check scene ${scene.scene_num}`);
    const j = extractJson(res?.choices?.[0]?.message?.content || '') || {};
    const scores: number[] = Array.isArray(j.scores) ? j.scores.map(Number) : [];
    let best = Number(j.best) || 0;
    if (!best && scores.length) {
      const m = Math.max(...scores);
      if (m >= 7) best = scores.indexOf(m) + 1;
    }
    const score = best ? (scores[best - 1] ?? 7) : 0;
    if (best < 1 || best > valid.length || score < 7) return { idx: -1, score };
    return { idx: valid[best - 1].i, score };
  } catch (e) {
    console.warn('[vision]', (e as Error).message);
    return { idx: -1, score: 0 };
  }
}

const QUERY_NOISE = /\b(footage|video|videos|clip|photo|photos|image|images|picture|shot|stock|hd|4k|scene|of|the|a|an|and|with|in|on)\b/gi;

/** Full query first, then progressively broader ones until some source returns results. */
function queryVariants(q: string): string[] {
  const words = q.replace(QUERY_NOISE, ' ').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let n = Math.min(words.length, 4); n >= 1; n--) out.push(words.slice(0, n).join(' '));
  if (words.length > 2) out.splice(2, 0, words.slice(-2).join(' '));
  return [...new Set(out)].slice(0, 4);
}

export async function findStock(scene: SceneSpec, kind: 'video' | 'photo', workDir: string, cost: CostTracker, i: number): Promise<SceneSpec['media'] | null> {
  const variants = queryVariants(scene.search_query || scene.visual_description);
  let lists: Candidate[][] = [];
  for (const q of variants) {
    lists = await Promise.all([pexels(q, kind), pixabay(q, kind), wikimedia(q, kind)]);
    if (lists.reduce((n, l) => n + l.length, 0) >= 2) break;
  }
  // interleave sources, max 6 candidates per vision call
  const cands: Candidate[] = [];
  for (let k = 0; k < 5 && cands.length < 6; k++) for (const l of lists) if (l[k] && cands.length < 6) cands.push(l[k]);
  if (!cands.length) return null;
  const { idx, score } = await verifyCandidates(scene, cands, workDir, cost, `${i}_${kind}`);
  if (idx < 0) return null;
  const c = cands[idx];
  const ext = kind === 'video' ? (c.url.endsWith('.webm') ? '.webm' : '.mp4') : '.jpg';
  const file = path.join(workDir, `scene_${i}_${Date.now()}${ext}`);
  if (!(await download(c.url, file, kind === 'video' ? 120 * 1024 * 1024 : 25 * 1024 * 1024, 120))) return null;
  return { kind, source: c.source, file, page_url: c.page_url, verified_score: score };
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
  return fs.statSync(out).size > 1024;
}

export async function generateRealPhoto(prompt: string, out: string, cost: CostTracker, label: string): Promise<boolean> {
  try {
    const res = await orChat({
      model: MODELS.image,
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: '9:16' },
      messages: [{ role: 'user', content: `${REALISM_PREFIX}\nScene: ${prompt}\n${REALISM_NEGATIVE}` }],
    }, cost, label);
    return await imageFromResponse(res, out);
  } catch (e) {
    console.warn('[image]', (e as Error).message);
    return false;
  }
}

// ------------------------------------------------------------------ 6. overlay elements (transparent PNG)
async function makeOverlayElement(element: string, workDir: string, cost: CostTracker): Promise<string | null> {
  const dir = path.join(workDir, 'overlays');
  fs.mkdirSync(dir, { recursive: true });
  const id = crypto.createHash('md5').update(element.toLowerCase()).digest('hex').slice(0, 10);
  const outPng = path.join(dir, `${id}.png`);
  if (fs.existsSync(outPng)) return outPng;
  const raw = path.join(dir, `${id}_raw.png`);
  try {
    const res = await orChat({
      model: MODELS.overlay,
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: '1:1' },
      messages: [{ role: 'user', content: `A single ${element}, glossy high-detail 3D sticker/emoji style object, centered, fully visible with margin around it, isolated on a perfectly plain solid white background. No shadow on the background, no text, no other objects, no frame.` }],
    }, cost, `overlay "${element}"`);
    if (!(await imageFromResponse(res, raw))) return null;
  } catch (e) { console.warn('[overlay]', (e as Error).message); return null; }
  const r = await run(pyBin(), [HELPER, 'rembg', raw, outPng], { timeoutMs: 5 * 60 * 1000 });
  if (r.code !== 0 || !fs.existsSync(outPng)) {
    // fallback: chroma-key the white background
    const f = await ffmpeg(['-i', raw, '-vf', 'format=rgba,colorkey=0xFFFFFF:0.12:0.08', outPng]);
    if (f.code !== 0) return null;
  }
  return outPng;
}

// ------------------------------------------------------------------ 7. rendering
function motionFilter(i: number, frames: number) {
  const t = i % 5;
  if (t === 0) return `zoompan=z='1+0.18*on/${frames}':d=${frames}:s=1440x2560:fps=${FPS}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
  if (t === 1) return `zoompan=z='1.18-0.18*on/${frames}':d=${frames}:s=1440x2560:fps=${FPS}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
  if (t === 2) return `zoompan=z='1.15':d=${frames}:s=1440x2560:fps=${FPS}:x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)'`;
  if (t === 3) return `zoompan=z='1.15':d=${frames}:s=1440x2560:fps=${FPS}:x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)'`;
  return `zoompan=z='1.05+0.12*on/${frames}':d=${frames}:s=1440x2560:fps=${FPS}:x='(iw-iw/zoom)*on/${frames}':y='(ih-ih/zoom)*on/${frames}'`;
}

async function renderSceneClip(media: NonNullable<SceneSpec['media']>, i: number, frames: number, out: string): Promise<boolean> {
  const enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-an', '-frames:v', String(frames)];
  if (media.kind === 'video') {
    const dur = frames / FPS;
    const srcDur = await probeDuration(media.file);
    const ss = srcDur > dur + 2 ? Math.min(1.5, srcDur - dur - 0.2) : 0;
    const r = await ffmpeg(['-stream_loop', '-1', '-ss', ss.toFixed(2), '-i', media.file, '-t', (dur + 0.5).toFixed(2),
      '-vf', `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},eq=saturation=1.03`, ...enc, out]);
    if (r.code === 0) return true;
    console.warn('[clip video]', r.err.slice(-300));
    return false;
  }
  // landscape real photos: slow horizontal pan across the frame instead of a hard centre crop
  const dims = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', media.file]);
  const [iw, ih] = dims.out.trim().split(',').map(Number);
  const landscape = iw > 0 && ih > 0 && iw / ih > 1.05;
  const vf = landscape
    ? `scale=-2:2560,setsar=1,crop=1440:2560:x='(iw-ow)*(${i % 2 === 0 ? `0.2+0.6*n/${frames}` : `0.8-0.6*n/${frames}`})':y=0,scale=${W}:${H}:flags=lanczos`
    : `scale=1440:2560:force_original_aspect_ratio=increase,crop=1440:2560,setsar=1,${motionFilter(i, frames)},scale=${W}:${H}:flags=lanczos`;
  const r = await ffmpeg([...(landscape ? ['-loop', '1', '-framerate', String(FPS)] : []), '-i', media.file, '-vf', vf, ...enc, out]);
  if (r.code !== 0) console.warn('[clip photo]', r.err.slice(-300));
  return r.code === 0;
}

// locate a phrase (sequence of words) inside a word range; returns absolute index of first word
function findPhrase(words: Word[], from: number, to: number, phrase: string): number {
  const p = phrase.split(/\s+/).map(norm).filter(Boolean);
  if (!p.length) return -1;
  for (let i = from; i + p.length - 1 <= to; i++) {
    let ok = true;
    for (let k = 0; k < p.length; k++) if (norm(words[i + k].w) !== p[k]) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

function findWord(words: Word[], from: number, to: number, word: string): number {
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
  attachedImages?: string[]; // absolute paths to user images, used as scene photos in order
  previous?: { scenes: SceneSpec[]; full_script: string; words?: Word[] };
  onProgress: (pct: number, msg: string) => void;
  cost: CostTracker;
}

export interface PipelineResult { title: string; scenes: SceneSpec[]; full_script: string; words: Word[]; audioFile: string; duration: number }

export async function runVideoPipeline(inp: PipelineInput): Promise<PipelineResult> {
  const { workDir, cost } = inp;
  fs.mkdirSync(workDir, { recursive: true });
  const ru = String(inp.language).toLowerCase().startsWith('ru');
  const say = (en: string, r: string) => (ru ? r : en);

  // 1. script
  inp.onProgress(8, say('Writing the script...', 'Пишем сценарий...'));
  const script = await writeScript({ prompt: inp.prompt, language: inp.language, format: inp.format, cost, previous: inp.previous });
  const scenes = script.scenes;
  const fullScript = scenes.map((s) => s.voiceover_chunk).join(' ');

  // 2. voiceover (+ reuse when an edit doesn't touch narration)
  const audioFile = path.join(workDir, 'voiceover.mp3');
  const prevAudio = path.join(workDir, 'prev_voiceover.mp3');
  let words: Word[] | null = null;
  const sameNarration = !!inp.previous && inp.previous.full_script === fullScript && fs.existsSync(prevAudio) && Array.isArray(inp.previous.words) && inp.previous.words.length > 0;
  if (sameNarration) {
    fs.copyFileSync(prevAudio, audioFile);
    words = inp.previous!.words!;
  } else {
    inp.onProgress(18, say('Recording the voiceover...', 'Записываем озвучку...'));
    const ok = await generateSpeech(fullScript, audioFile, cost, inp.voice || 'alloy');
    if (!ok) throw new Error('Voiceover generation failed');
  }
  const duration = await probeDuration(audioFile);
  if (!words) {
    inp.onProgress(26, say('Syncing subtitles to the voice...', 'Синхронизируем субтитры с голосом...'));
    words = await alignWords(audioFile, fullScript, workDir, inp.language);
  }

  // scene word ranges & time windows
  const ranges: { from: number; to: number }[] = [];
  let idx = 0;
  for (const s of scenes) {
    const n = s.voiceover_chunk.split(/\s+/).filter(Boolean).length;
    ranges.push({ from: idx, to: Math.min(words.length - 1, idx + n - 1) });
    idx += n;
  }
  const sceneStart = (i: number) => (i === 0 ? 0 : words![ranges[i].from]?.start ?? 0);
  const boundaries = scenes.map((_, i) => sceneStart(i));
  boundaries.push(duration);
  const frameAt = (t: number) => Math.round(t * FPS);
  const sceneFrames = scenes.map((_, i) => Math.max(8, frameAt(boundaries[i + 1]) - frameAt(boundaries[i])));

  // 3. media per scene
  inp.onProgress(32, say('Finding real footage and generating photos...', 'Подбираем реальные видео/фото и генерируем кадры...'));
  let done = 0;
  await mapLimit(scenes, 3, async (s, i) => {
    const prev = inp.previous?.scenes?.[i];
    if (inp.attachedImages?.[i] && fs.existsSync(inp.attachedImages[i])) {
      s.media = { kind: 'photo', source: 'user', file: inp.attachedImages[i] };
    } else if (prev && s.needs_new_visual === false && prev.media?.file && fs.existsSync(prev.media.file)) {
      s.media = prev.media;
    } else {
      let m: SceneSpec['media'] | null = null;
      if (s.media_type === 'stock_video') m = (await findStock(s, 'video', workDir, cost, i)) || (await findStock(s, 'photo', workDir, cost, i));
      else if (s.media_type === 'stock_photo') m = await findStock(s, 'photo', workDir, cost, i);
      if (!m) {
        const f = path.join(workDir, `scene_${i}_${Date.now()}.png`);
        if (await generateRealPhoto(s.ai_image_prompt || s.visual_description, f, cost, `photo scene ${s.scene_num}`)) m = { kind: 'photo', source: 'ai', file: f };
      }
      if (!m) {
        const f = path.join(workDir, `scene_${i}_fallback.png`);
        await ffmpeg(['-f', 'lavfi', '-i', `color=c=0x111318:s=${W}x${H}`, '-frames:v', '1', f]);
        m = { kind: 'photo', source: 'fallback', file: f };
      }
      s.media = m;
    }
    done++;
    inp.onProgress(32 + Math.round((done / scenes.length) * 33), say(`Visuals ${done}/${scenes.length}`, `Кадры ${done}/${scenes.length}`));
  });

  await assembleVideo({ scenes, words, duration, audioFile, workDir, outVideo: inp.outVideo, outPoster: inp.outPoster, cost, onProgress: inp.onProgress, ru, sceneFrames, ranges });
  try { fs.copyFileSync(audioFile, prevAudio); } catch { /* ignore */ }

  scenes.forEach((s, i) => { s.text = s.headline?.phrase || s.voiceover_chunk.split(/\s+/).slice(0, 6).join(' '); (s as any).duration = +(boundaries[i + 1] - boundaries[i]).toFixed(2); });
  return { title: script.title, scenes, full_script: fullScript, words, audioFile, duration };
}

export interface AssembleInput {
  scenes: SceneSpec[]; words: Word[]; duration: number; audioFile: string; workDir: string;
  outVideo: string; outPoster: string; cost: CostTracker; onProgress: (pct: number, msg: string) => void; ru: boolean;
  sceneFrames: number[]; ranges: { from: number; to: number }[];
}

/** Steps 4-7: headline/overlay timing, overlay elements, scene clips, subtitles, final mux. */
export async function assembleVideo(a: AssembleInput): Promise<void> {
  const { scenes, words, duration, audioFile, workDir, cost, sceneFrames, ranges } = a;
  const inp = { outVideo: a.outVideo, outPoster: a.outPoster, onProgress: a.onProgress };
  const say = (en: string, r: string) => (a.ru ? r : en);
  // 4. headlines + overlays timing
  const headlines: { start_idx: number; end_idx: number; highlight_idx: number }[] = [];
  const overlays: { file: string; start: number; end: number }[] = [];
  scenes.forEach((s, i) => {
    const r = ranges[i];
    if (s.headline) {
      const st = findPhrase(words!, r.from, r.to, s.headline.phrase);
      if (st >= 0) {
        const len = s.headline.phrase.split(/\s+/).filter(Boolean).length;
        const en = st + len - 1;
        const hi = findWord(words!, st, en, s.headline.highlight);
        headlines.push({ start_idx: st, end_idx: en, highlight_idx: hi });
      }
    }
  });
  inp.onProgress(68, say('Creating animated elements...', 'Создаём анимированные элементы...'));
  const overlayJobs = scenes.map((s, i) => ({ s, i })).filter((x) => x.s.overlay).slice(0, 3);
  await mapLimit(overlayJobs, 2, async ({ s, i }) => {
    const r = ranges[i];
    let wi = findWord(words!, r.from, r.to, s.overlay!.trigger_word);
    if (wi < 0) wi = r.from;
    let start = Math.max(0, words![wi].start - 0.1);
    let end = Math.min(duration - 0.05, start + 2.8);
    // never collide with a headline caption
    for (const h of headlines) {
      const hs = words![h.start_idx].start; const he = words![h.end_idx].end + 0.9;
      if (start < he && end > hs) { start = he; end = Math.min(duration - 0.05, start + 2.6); }
    }
    if (end - start < 1.6) return;
    const file = await makeOverlayElement(s.overlay!.element, workDir, cost);
    if (file) overlays.push({ file, start, end });
  });

  // 5. render scene clips
  inp.onProgress(74, say('Editing the video...', 'Монтируем видео...'));
  const clips: string[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const out = path.join(workDir, `clip_${i}.mp4`);
    let ok = await renderSceneClip(scenes[i].media!, i, sceneFrames[i], out);
    if (!ok && scenes[i].media!.kind === 'video') {
      // broken video download -> AI photo instead
      const f = path.join(workDir, `scene_${i}_${Date.now()}.png`);
      if (await generateRealPhoto(scenes[i].ai_image_prompt, f, cost, `photo scene ${i + 1} (retry)`)) {
        scenes[i].media = { kind: 'photo', source: 'ai', file: f };
        ok = await renderSceneClip(scenes[i].media!, i, sceneFrames[i], out);
      }
    }
    if (!ok) throw new Error(`Failed to render scene ${i + 1}`);
    clips.push(out);
    inp.onProgress(74 + Math.round(((i + 1) / scenes.length) * 12), say(`Editing ${i + 1}/${scenes.length}`, `Монтаж ${i + 1}/${scenes.length}`));
  }
  const list = path.join(workDir, 'concat.txt');
  fs.writeFileSync(list, clips.map((c) => `file '${c}'`).join('\n'));
  const merged = path.join(workDir, 'merged.mp4');
  const cr = await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', merged]);
  if (cr.code !== 0) throw new Error('concat failed: ' + cr.err.slice(-200));

  // 6. subtitles (ASS)
  const spec = path.join(workDir, 'subs_spec.json');
  const ass = path.join(workDir, 'subs.ass');
  fs.writeFileSync(spec, JSON.stringify({ width: W, height: H, duration, words, headlines }));
  const ar = await run(pyBin(), [HELPER, 'ass', spec, ass], { timeoutMs: 120000 });
  if (ar.code !== 0) throw new Error('subtitle build failed: ' + ar.err.slice(-300));

  // 7. final composition: overlays (eased rise from bottom to centre, then slide back down) + subtitles + audio
  inp.onProgress(90, say('Adding subtitles and effects...', 'Добавляем субтитры и эффекты...'));
  const args: string[] = ['-i', merged];
  overlays.forEach((o) => args.push('-loop', '1', '-t', duration.toFixed(2), '-i', o.file));
  args.push('-i', audioFile);
  const audioIdx = overlays.length + 1;
  const fc: string[] = [];
  let last = '[0:v]';
  const RISE = 0.75;
  overlays.forEach((o, k) => {
    const A = o.start.toFixed(3), B = o.end.toFixed(3);
    fc.push(`[${k + 1}:v]scale=w='min(330,iw)':h=-1,format=rgba[ov${k}]`);
    const pin = `clip((t-${A})/${RISE},0,1)`;
    const pout = `clip((t-(${B}-${RISE}))/${RISE},0,1)`;
    const target = `(H*0.47-h/2)`;
    // eased: cubic ease-out on the way up, cubic ease-in on the way down
    const y = `${target}+(H-${target})*(pow(1-${pin},3)+pow(${pout},3))`;
    fc.push(`${last}[ov${k}]overlay=x='(W-w)/2':y='${y}':enable='between(t,${A},${B})':eval=frame[v${k}]`);
    last = `[v${k}]`;
  });
  const esc = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  fc.push(`${last}subtitles=filename='${esc(ass)}':fontsdir='${esc(FONT_DIR)}'[vout]`);
  args.push('-filter_complex', fc.join(';'), '-map', '[vout]', '-map', `${audioIdx}:a`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-t', duration.toFixed(3), '-movflags', '+faststart', inp.outVideo);
  const fr = await ffmpeg(args, 20 * 60 * 1000);
  if (fr.code !== 0 || !fs.existsSync(inp.outVideo)) throw new Error('final render failed: ' + fr.err.slice(-400));

  await ffmpeg(['-ss', Math.min(1, duration / 2).toFixed(2), '-i', inp.outVideo, '-frames:v', '1', '-q:v', '3', inp.outPoster]);

}
