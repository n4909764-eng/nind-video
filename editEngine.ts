/**
 * nind edit engine
 *  - structured edits of already-created videos (LLM -> minimal JSON ops -> re-render with cached assets)
 *  - editing of the user's own footage (whisper transcript -> plan -> subtitles, headlines, inserts, overlays, translation)
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  CostTracker, Level, LevelCfg, levelCfg, normLevel, MODELS, SceneSpec, Word, OverlayItem,
  orChat, extractJson, generateSpeech, TTS_SPEAK_LINE_SYSTEM, alignWords, mediaForScene, fillMissingMedia, sceneTiming, assembleVideo,
  composeFinal, buildAss, makeOverlayElement, findPhrase, findWord, renderSceneClip, mapLimit, ffmpeg, run,
  probeDuration, pyBin, HELPER, W, H, FPS, runVideoPipeline, overlayWindow, EST, reserve, release,
  withCleanOutput, stripProvenance,
  deriveSearchQuery, withFrame, frameFor, curFrame,
} from './videoPipeline';
import { probeVideo, smartReframe, ReframeResult } from './smartReframe';
import { decideSourceLayout, selectHighlights, remapToCut, SourceLayout } from './longForm';
import { CaptionStyle, DEFAULT_STYLE, FONTS, fontKey, normColor } from './captionStyle';

type Progress = (pct: number, msg: string) => void;

// ------------------------------------------------------------------ style ops
export function applyStyleOp(style: CaptionStyle, op: any): CaptionStyle {
  const s: CaptionStyle = { ...DEFAULT_STYLE, ...style };
  const both = fontKey(op.font);
  const sf = fontKey(op.subtitle_font) || both;
  const hf = fontKey(op.headline_font) || both;
  if (sf) s.subtitle_font = sf;
  if (hf) s.headline_font = hf;
  const hc = normColor(op.highlight_color); if (hc) s.highlight_color = hc;
  const sc = normColor(op.subtitle_color); if (sc) s.subtitle_color = sc;
  const hdc = normColor(op.headline_color); if (hdc) s.headline_color = hdc;
  if (typeof op.subtitles === 'boolean') s.subtitles = op.subtitles;
  if (typeof op.headlines === 'boolean') s.headlines = op.headlines;
  if (op.subtitle_size === 'bigger') s.sub_scale = (s.sub_scale || 1) * 1.2;
  if (op.subtitle_size === 'smaller') s.sub_scale = (s.sub_scale || 1) / 1.2;
  if (op.headline_size === 'bigger') s.head_scale = (s.head_scale || 1) * 1.15;
  if (op.headline_size === 'smaller') s.head_scale = (s.head_scale || 1) / 1.15;
  return s;
}

const FONT_LIST = Object.values(FONTS).map((f) => f.label).join(', ');
const STYLE_OP_DOC = `{"op":"style", "font"?: one of [${FONT_LIST}] (both subtitles+headlines), "subtitle_font"?, "headline_font"?, "highlight_color"?: "#RRGGBB" (box behind the key headline word), "subtitle_color"?, "headline_color"?, "subtitles"?: true|false, "headlines"?: true|false, "subtitle_size"?: "bigger"|"smaller", "headline_size"?: "bigger"|"smaller"}`;

async function askPlanner(system: string, user: string, cost: CostTracker, label: string): Promise<any> {
  const res = await orChat({
    model: MODELS.script,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  }, cost, label);
  return extractJson(res?.choices?.[0]?.message?.content || '') || {};
}

// ------------------------------------------------------------------ photo cards
async function makeCard(photo: string, workDir: string, square: boolean): Promise<string | null> {
  const out = path.join(workDir, 'cards', `${crypto.createHash('md5').update(photo + square).digest('hex').slice(0, 12)}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (fs.existsSync(out)) return out;
  const src = path.join(workDir, 'cards', `src_${Date.now()}.png`);
  await ffmpeg(withCleanOutput(['-i', photo, '-frames:v', '1', src], { sei: false }));
  if (fs.existsSync(src)) await stripProvenance(src);
  const r = await run(pyBin(), [HELPER, 'card', src, out, square ? '500' : '520', square ? '500' : '640', square ? '0' : '40', '6'], { timeoutMs: 60000 });
  if (r.code === 0 && fs.existsSync(out)) { await stripProvenance(out); return out; }
  return null;
}

/** Media for an insert/card: stock (relevance-checked) -> AI photo (within budget) -> null. */
async function insertMedia(spec: { media_type?: string; search_query?: string; visual_description?: string; ai_image_prompt?: string; context?: string },
  tag: string, workDir: string, cost: CostTracker, cfg: LevelCfg, state: { ai: number; exclude: Set<string> }, wantPhoto = false) {
  const scene: SceneSpec = {
    scene_num: 0, voiceover_chunk: spec.context || spec.visual_description || '', visual_description: spec.visual_description || spec.search_query || '',
    media_type: (wantPhoto ? (spec.media_type === 'ai_photo' ? 'ai_photo' : 'stock_photo') : (spec.media_type as any)) || 'stock_photo',
    search_query: spec.search_query || spec.visual_description || '', ai_image_prompt: spec.ai_image_prompt || spec.visual_description || spec.search_query || '',
  };
  // explicit "internet" requests must not silently become AI unless nothing real exists
  let m = await mediaForScene(scene, tag as any, workDir, cost, { ...cfg, maxAiPhotos: cfg.level === 'low' ? cfg.maxAiPhotos : 99 }, state);
  if (m && wantPhoto && m.kind === 'video') {
    const still = path.join(workDir, `still_${tag}_${Date.now()}.jpg`);
    await ffmpeg(withCleanOutput(['-ss', '1', '-i', m.file, '-frames:v', '1', '-q:v', '2', still], { sei: false }));
    if (fs.existsSync(still)) await stripProvenance(still);
    m = fs.existsSync(still) ? { ...m, kind: 'photo', file: still } : null;
  }
  return m;
}

// ================================================================== 1. edits of created videos
export interface CreatedProject {
  scenes: SceneSpec[]; words: Word[]; full_script: string; style?: CaptionStyle; level?: Level; voice?: string; language?: string; format_id?: string; prompt?: string;
  aspect?: '9:16' | '16:9';
}

const CREATE_EDIT_SYSTEM = `You convert a user's edit request for an existing short video into a MINIMAL list of JSON operations.
Change ONLY what the user asked for. Never touch anything else (do not re-pick visuals, overlays, narration or fonts unless asked).
Operations:
- ${STYLE_OP_DOC}
- {"op":"replace_visual","scene":N,"source":"internet_video"|"internet_photo"|"ai_photo","search_query":"2-4 English keywords","visual_description":"what must be visible","ai_image_prompt":"photo description"}   // "internet"/"stock"/"real" photo or video => internet_*
- {"op":"use_attachment","scene":N,"attachment":K}   // user attached their own image(s) to put into the video
- {"op":"set_overlay","scene":N,"element":"short description of ONE object","trigger_word":"word from that scene's narration","kind":"sticker"|"rounded_photo"|"square_photo","search_query"?:"English keywords if kind is a photo"}   // popup elements / PNG / emoji-like objects / popup photos
- {"op":"remove_overlay","scene":N}
- {"op":"set_headline","scene":N,"phrase":"2-6 consecutive words copied exactly from that scene's narration","highlight":"one word of phrase"}
- {"op":"remove_headline","scene":N}
- {"op":"narration","scene":N,"text":"new narration for that scene"}   // only when the user asks to change what is said
- {"op":"voice","voice":"alloy"|"echo"|"fable"|"onyx"|"nova"|"shimmer"}
- {"op":"rewrite"}   // ONLY if the user asks for a completely different video / new topic
If the user asks to change something "everywhere" or for "all scenes", emit one op per affected scene. If the user doesn't specify the scene, choose the scene(s) where it fits best by narration.
Return ONLY JSON: {"ops":[...],"summary":"one short sentence of what will change"}`;

export async function planCreatedEdit(p: CreatedProject, request: string, attachments: number, cost: CostTracker) {
  const scenes = p.scenes.map((s, i) => ({
    scene: i + 1, narration: s.voiceover_chunk, visual: s.visual_description,
    media: s.media ? `${s.media.kind} from ${s.media.source.startsWith('ai') ? 'AI generated' : s.media.source.replace(/:reused$/, ' (repeated)')}` : 'none',
    headline: s.headline || null, overlay: s.overlay ? { element: s.overlay.element, trigger_word: s.overlay.trigger_word, kind: (s.overlay as any).kind || 'sticker' } : null,
  }));
  const user = `Current style: ${JSON.stringify({ ...DEFAULT_STYLE, ...(p.style || {}) })}\nScenes:\n${JSON.stringify(scenes)}\nUser attached ${attachments} image(s).\n\nEdit request: "${request}"`;
  const j = await askPlanner(CREATE_EDIT_SYSTEM, user, cost, 'edit plan');
  return { ops: Array.isArray(j.ops) ? j.ops : [], summary: String(j.summary || '') };
}

type CreatedEditInput = {
  project: CreatedProject; request: string; attachments: string[]; workDir: string; outVideo: string; outPoster: string;
  cost: CostTracker; onProgress: Progress; ru: boolean;
};

/** Edits re-render in the project's own frame (vertical short or horizontal long). */
export function applyCreatedEdit(o: CreatedEditInput) {
  return withFrame(frameFor(o.project.aspect), () => applyCreatedEditInFrame(o));
}

async function applyCreatedEditInFrame(o: CreatedEditInput) {
  const { project: p, workDir, cost } = o;
  const say = (en: string, r: string) => (o.ru ? r : en);
  o.onProgress(10, say('Understanding your edit...', 'Разбираем правку...'));
  const { ops, summary } = await planCreatedEdit(p, o.request, o.attachments.length, cost);
  console.log('[edit] ops', JSON.stringify(ops));
  if (!ops.length) throw new Error('Could not understand the edit request — please describe the change more specifically.');
  if (ops.some((x: any) => x.op === 'rewrite')) {
    const r = await runVideoPipeline({
      projectId: 'edit', prompt: o.request, language: p.language || 'auto', format: p.format_id || 'auto', workDir, outVideo: o.outVideo, outPoster: o.outPoster,
      voice: p.voice, level: p.level, style: p.style, previous: { scenes: p.scenes, full_script: p.full_script, words: p.words }, onProgress: o.onProgress, cost,
      aspect: p.aspect,
    });
    return { scenes: r.scenes, words: r.words, full_script: r.full_script, style: p.style, audioFile: r.audioFile, duration: r.duration, ops, summary, notes: [] as string[] };
  }

  const scenes: SceneSpec[] = JSON.parse(JSON.stringify(p.scenes));
  let style = { ...DEFAULT_STYLE, ...(p.style || {}) };
  let voice = p.voice || 'alloy';
  let narrationChanged = false;
  const notes: string[] = [];
  const cfg = levelCfg(normLevel(p.level));
  const state = { ai: 0, exclude: new Set<string>() };
  const sceneAt = (n: any) => { const i = Math.round(Number(n)) - 1; return i >= 0 && i < scenes.length ? i : -1; };

  o.onProgress(25, say('Applying the change...', 'Применяем изменение...'));
  for (const op of ops) {
    const i = sceneAt(op.scene);
    switch (op.op) {
      case 'style': style = applyStyleOp(style, op); break;
      case 'voice': if (op.voice && op.voice !== voice) { voice = String(op.voice); narrationChanged = true; } break;
      case 'narration': if (i >= 0 && op.text) { scenes[i].voiceover_chunk = String(op.text).replace(/\s+/g, ' ').trim(); narrationChanged = true; } break;
      case 'remove_headline': if (i >= 0) scenes[i].headline = null; break;
      case 'set_headline': if (i >= 0 && op.phrase) scenes[i].headline = { phrase: String(op.phrase), highlight: String(op.highlight || '') }; break;
      case 'remove_overlay': if (i >= 0) scenes[i].overlay = null; break;
      case 'set_overlay':
        if (i >= 0 && op.element) {
          const kind = /rounded|square/.test(op.kind || '') ? op.kind : 'sticker';
          scenes[i].overlay = { trigger_word: String(op.trigger_word || scenes[i].voiceover_chunk.split(/\s+/)[0]), element: String(op.element), ...(kind !== 'sticker' ? { kind, search_query: op.search_query || op.element } : {}) } as any;
        }
        break;
      case 'use_attachment': {
        const f = o.attachments[(Number(op.attachment) || 1) - 1] || o.attachments[0];
        if (i >= 0 && f) scenes[i].media = { kind: 'photo', source: 'user', file: f };
        break;
      }
      case 'replace_visual': {
        if (i < 0) break;
        const s = scenes[i];
        const src = String(op.source || 'internet_photo');
        const spec: SceneSpec = { ...s, search_query: op.search_query || s.search_query, visual_description: op.visual_description || s.visual_description, ai_image_prompt: op.ai_image_prompt || op.visual_description || s.ai_image_prompt };
        const force = src === 'ai_photo' ? 'ai_photo' : src === 'internet_video' ? 'stock_video' : 'stock_photo';
        let m = await mediaForScene(spec, i, workDir, cost, { ...cfg, maxAiPhotos: force === 'ai_photo' ? 99 : 0 }, state, force);
        if (!m && force !== 'ai_photo') {
          // nothing relevant on the internet: try the other kind, then a photoreal AI photo — never a grey placeholder
          m = await mediaForScene(spec, i, workDir, cost, { ...cfg, maxAiPhotos: 0 }, state, force === 'stock_video' ? 'stock_photo' : 'stock_video');
          if (!m) { m = await mediaForScene(spec, i, workDir, cost, { ...cfg, maxAiPhotos: 99 }, state, 'ai_photo'); if (m) notes.push(`scene ${i + 1}: no matching internet media found, used a photoreal AI photo`); }
        }
        if (m) { s.media = m; s.search_query = spec.search_query; s.visual_description = spec.visual_description; s.media_type = force as any; }
        else notes.push(`scene ${i + 1}: could not find new media, kept the previous visual`);
        break;
      }
      default: break;
    }
  }

  // voice/narration: only regenerate when it really changed
  let words = p.words;
  let fullScript = scenes.map((s) => s.voiceover_chunk).join(' ');
  const prevAudio = path.join(workDir, 'prev_voiceover.mp3');
  const audioFile = path.join(workDir, `voiceover_${Date.now()}.mp3`);
  if (narrationChanged || !fs.existsSync(prevAudio) || !words?.length) {
    o.onProgress(40, say('Recording the voiceover...', 'Записываем озвучку...'));
    if (!(await generateSpeech(fullScript, audioFile, cost, voice, cfg.tts))) throw new Error('Voiceover generation failed');
    words = await alignWords(audioFile, fullScript, workDir, p.language);
  } else {
    fs.copyFileSync(prevAudio, audioFile);
    fullScript = p.full_script || fullScript;
  }
  const duration = await probeDuration(audioFile);
  const { ranges, boundaries, sceneFrames } = sceneTiming(scenes, words, duration);

  // photo-card overlays (popup photos) are prepared here; stickers are made by assembleVideo
  const extra: OverlayItem[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const ov: any = scenes[i].overlay;
    if (!ov || !ov.kind || ov.kind === 'sticker') continue;
    let card = ov.file && fs.existsSync(ov.file) ? ov.file : null;
    if (!card) {
      const m = await insertMedia({ media_type: 'stock_photo', search_query: ov.search_query || ov.element, visual_description: ov.element, ai_image_prompt: ov.element, context: scenes[i].voiceover_chunk }, `card${i}`, workDir, cost, cfg, state, true);
      card = m ? await makeCard(m.file, workDir, ov.kind === 'square_photo') : null;
    }
    if (!card) { notes.push(`scene ${i + 1}: popup photo not found`); scenes[i].overlay = null; continue; }
    ov.file = card;
    let wi = findWord(words, ranges[i].from, ranges[i].to, ov.trigger_word); if (wi < 0) wi = ranges[i].from;
    const win = overlayWindow(words, wi, duration, []);
    if (win) extra.push({ file: card, ...win, mode: 'card' });
  }

  await fillMissingMedia(scenes, workDir);
  o.onProgress(55, say('Re-rendering only what changed...', 'Перемонтируем только изменённое...'));
  const stickerScenes = scenes.map((s) => (s.overlay && (s.overlay as any).kind && (s.overlay as any).kind !== 'sticker' ? { ...s, overlay: null } : s));
  await assembleVideoWithExtra({ scenes: stickerScenes, words, duration, audioFile, workDir, outVideo: o.outVideo, outPoster: o.outPoster, cost, onProgress: o.onProgress, ru: o.ru, sceneFrames, ranges, style, maxOverlays: 4 }, extra);
  stickerScenes.forEach((s, i) => { if (s.overlay) scenes[i].overlay = s.overlay; });
  try { fs.copyFileSync(audioFile, prevAudio); } catch { /* ignore */ }
  scenes.forEach((s, i) => { s.text = s.headline?.phrase || s.voiceover_chunk.split(/\s+/).slice(0, 6).join(' '); (s as any).duration = +(boundaries[i + 1] - boundaries[i]).toFixed(2); });
  return { scenes, words, full_script: fullScript, style, voice, audioFile, duration, ops, summary, notes };
}

/** assembleVideo + additional overlay items (photo cards). */
async function assembleVideoWithExtra(a: Parameters<typeof assembleVideo>[0], extra: OverlayItem[]) {
  if (!extra.length) return assembleVideo(a);
  return assembleVideo({ ...a, extraOverlays: extra });
}

// ================================================================== 2. user footage editing
export interface SourcePlan {
  subtitles: boolean;
  translate_to?: string | null; dub?: boolean;
  headlines: { phrase: string; highlight: string; start_idx?: number; end_idx?: number; highlight_idx?: number }[];
  inserts: { phrase: string; display: 'fullscreen' | 'rounded' | 'square'; media_type: string; search_query: string; visual_description: string; ai_image_prompt: string; start?: number; end?: number; file?: string; clip?: string; source?: string }[];
  overlays: { trigger_word: string; element: string; start?: number; end?: number; file?: string }[];
}

export interface SourceState {
  base: string; audio: string; duration: number; words: Word[]; segments: { text: string; start: number; end: number; from: number; to: number }[];
  language?: string; plan: SourcePlan; style: CaptionStyle; level: Level;
  aspect?: '9:16' | '16:9'; layout?: SourceLayout; reframe?: ReframeResult | null;
  translated?: { lang: string; words: Word[]; dubAudio?: string } | null;
}

async function hasAudioStream(src: string) {
  const has = await run('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', src]);
  return !!has.out.trim();
}

/**
 * Fit the upload into the job's frame (curFrame): same shape -> cover; horizontal source + vertical frame
 * -> Smart Reframe (follows the subject); anything else -> whole picture on a blurred fill.
 */
async function normaliseSource(src: string, workDir: string, opts: { reframe?: boolean; maxSeconds?: number } = {}) {
  const base = path.join(workDir, 'src_base.mp4');
  const audio = path.join(workDir, 'src_audio.m4a');
  const { w: W, h: H } = curFrame();
  const maxS = String(Math.ceil(opts.maxSeconds || 300));
  let reframe: ReframeResult | null = null;
  if (!fs.existsSync(base)) {
    const pr = await probeVideo(src); // rotation-aware (iPhone .mov stores landscape clips rotated)
    const iw = pr.w, ih = pr.h;
    if (!(iw > 0 && ih > 0)) throw new Error('The uploaded file has no readable video track.');
    if (opts.reframe) {
      reframe = await smartReframe(src, base, workDir, { w: W, h: H }, Number(maxS), ['-r', String(FPS)]);
      if (!reframe.ok) console.warn('[reframe] fallback to fit:', reframe.method);
    }
    if (!reframe?.ok) {
      const ratio = iw / ih;
      const vf = Math.abs(ratio - W / H) < 0.12
        ? `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS}`
        : `split[a][b];[a]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:2,eq=brightness=-0.08[bg];[b]scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=${FPS}`;
      const r = await ffmpeg(withCleanOutput(['-i', src, '-t', maxS, '-filter_complex', `[0:v]${vf}[v]`, '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', base]), Math.max(10 * 60 * 1000, Number(maxS) * 2000));
      if (r.code !== 0) throw new Error('Could not read the uploaded video: ' + r.err.slice(-200));
    }
  }
  if (!fs.existsSync(audio)) {
    if (await hasAudioStream(src)) await ffmpeg(withCleanOutput(['-i', src, '-t', maxS, '-vn', '-c:a', 'aac', '-b:a', '192k', audio], { sei: false }));
    if (!fs.existsSync(audio)) await ffmpeg(withCleanOutput(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(await probeDuration(base)), '-c:a', 'aac', audio], { sei: false }));
    if (fs.existsSync(audio)) await stripProvenance(audio);
  }
  return { base, audio, duration: await probeDuration(base), reframe };
}

/** Keep only the given time ranges of the upload (video + audio), in order. */
async function cutSource(src: string, keep: { start: number; end: number }[], workDir: string): Promise<string> {
  const out = path.join(workDir, 'src_cut.mp4');
  const sel = keep.map((r) => `between(t,${r.start.toFixed(3)},${r.end.toFixed(3)})`).join('+');
  const audio = await hasAudioStream(src);
  const fc = [`[0:v]setpts=PTS-STARTPTS,fps=${FPS},select='${sel}',setpts=N/${FPS}/TB[v]`];
  if (audio) fc.push(`[0:a]asetpts=PTS-STARTPTS,aselect='${sel}',asetpts=N/SR/TB[a]`);
  const total = keep.reduce((n, r) => n + r.end - r.start, 0);
  const r = await ffmpeg(withCleanOutput(['-i', src, '-filter_complex', fc.join(';'), '-map', '[v]', ...(audio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k'] : []),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', out]), Math.max(10 * 60 * 1000, total * 4000));
  if (r.code !== 0 || !fs.existsSync(out)) throw new Error('Could not cut the video: ' + r.err.slice(-200));
  await stripProvenance(out);
  return out;
}

async function transcribe(media: string, workDir: string, name = 'transcript.json') {
  const out = path.join(workDir, name);
  if (!fs.existsSync(out)) {
    const r = await run(pyBin(), [HELPER, 'transcribe', media, out], { timeoutMs: 60 * 60 * 1000 });
    if (r.code !== 0) { console.warn('[transcribe]', r.err.slice(-300)); return { words: [] as Word[], segments: [] as any[], language: undefined }; }
  }
  const j = JSON.parse(fs.readFileSync(out, 'utf8'));
  return { words: (j.words || []).map((w: any) => ({ w: w.w, start: w.start, end: w.end })) as Word[], segments: j.segments || [], language: j.language || undefined };
}

const SOURCE_PLAN_SYSTEM = (cfg: LevelCfg) => `You are a professional short-form video editor. The user uploaded their own video. You get its word-timed transcript and the user's request.
Plan real edits on top of THEIR footage (their original audio is kept):
- subtitles: true unless the user says no subtitles (there must be speech).
- headlines: 1-3 key punchlines (big captions). phrase = 2-6 consecutive words copied EXACTLY from the transcript; highlight = one word of it.
- inserts: moments where an illustrating visual should appear while that thing is mentioned. phrase = 1-4 consecutive words copied EXACTLY from the transcript where it should appear. display: "fullscreen" (cutaway that covers the frame), "rounded" (popup photo card with rounded corners) or "square" (popup square photo). media_type: "stock_video" | "stock_photo" | "ai_photo". search_query = 2-4 English keywords, concrete nouns. ${cfg.level === 'low' ? 'COST-SAVING: use stock media only, at most 1 ai_photo, 2-3 inserts.' : cfg.level === 'high' ? 'HIGH QUALITY: 4-6 inserts. At least 3 of them (or 2 if the video is under ~35s) MUST be stock_video or stock_photo, preferring stock_video and HD real footage. Use ai_photo only when nothing real can show that moment.' : '3-5 inserts.'} Spread them out; no two within 2 seconds.
- overlays: 0-2 iconic popup objects (3D sticker style, e.g. "yellow warning triangle", "stack of dollar bills"). trigger_word = one word copied exactly from transcript.
- translate_to: null, or the target language ISO code if the user asks to translate. dub: true only if the user asks for voice-over/dubbing in the other language (otherwise translated subtitles).
- If the user's request only asks for specific things (e.g. "add subtitles"), do only those (empty arrays for the rest).
If there is no speech in the transcript, use the request alone (inserts/overlays can't be timed then: return empty arrays) and subtitles false.
Return ONLY JSON: {"subtitles":true,"translate_to":null,"dub":false,"headlines":[{"phrase":"","highlight":""}],"inserts":[{"phrase":"","display":"fullscreen","media_type":"stock_video","search_query":"","visual_description":"","ai_image_prompt":""}],"overlays":[{"trigger_word":"","element":""}],"style":null or ${STYLE_OP_DOC.replace('"op":"style", ', '')}}`;

function transcriptForLLM(words: Word[]) {
  // compact: sentences with time stamps
  const out: string[] = [];
  let cur: string[] = []; let t0 = 0;
  words.forEach((w, i) => {
    if (!cur.length) t0 = w.start;
    cur.push(w.w);
    if (/[.!?]$/.test(w.w) || cur.length >= 18 || i === words.length - 1) { out.push(`[${t0.toFixed(1)}s] ${cur.join(' ')}`); cur = []; }
  });
  return out.join('\n');
}

function locate(words: Word[], phrase: string, from = 0): number {
  if (!phrase) return -1;
  let i = findPhrase(words, from, words.length - 1, phrase);
  if (i < 0) i = findPhrase(words, 0, words.length - 1, phrase);
  if (i < 0) { const first = phrase.split(/\s+/)[0]; i = findWord(words, 0, words.length - 1, first); }
  return i;
}

/** Time the plan's items on the transcript, avoid overlaps. */
function timePlan(plan: SourcePlan, words: Word[], duration: number) {
  plan.headlines = (plan.headlines || []).map((h) => {
    const st = findPhrase(words, 0, words.length - 1, h.phrase);
    if (st < 0) return null;
    const en = st + h.phrase.split(/\s+/).filter(Boolean).length - 1;
    return { ...h, start_idx: st, end_idx: en, highlight_idx: findWord(words, st, en, h.highlight) };
  }).filter(Boolean) as any;
  const busy: [number, number][] = plan.headlines.map((h) => [words[h.start_idx!].start, words[h.end_idx!].end + 0.9]);
  plan.inserts = (plan.inserts || []).map((x) => {
    const i = locate(words, x.phrase);
    if (i < 0) return null;
    const start = Math.max(0, words[i].start - 0.05);
    const len = x.display === 'fullscreen' ? 2.6 : 2.8;
    const end = Math.min(duration - 0.05, start + len);
    if (end - start < 1.2) return null;
    return { ...x, start, end };
  }).filter(Boolean) as any;
  // drop inserts colliding with each other (keep earlier)
  const kept: typeof plan.inserts = [];
  for (const x of plan.inserts.sort((a, b) => a.start! - b.start!)) {
    if (kept.some((k) => x.start! < k.end! + 0.4 && x.end! > k.start! - 0.4)) continue;
    // a popup card on top of a headline would cover it: shift after the headline
    for (const [hs, he] of busy) if (x.display !== 'fullscreen' && x.start! < he && x.end! > hs) { x.start = he; x.end = Math.min(duration - 0.05, he + 2.4); }
    if (x.end! - x.start! >= 1.2) kept.push(x);
  }
  plan.inserts = kept;
  plan.overlays = (plan.overlays || []).map((o) => {
    const i = locate(words, o.trigger_word);
    if (i < 0) return null;
    const hl = plan.headlines.map((h) => ({ start_idx: h.start_idx!, end_idx: h.end_idx! }));
    const win = overlayWindow(words, i, duration, hl);
    if (!win) return null;
    if (plan.inserts.some((k) => win.start < k.end! && win.end > k.start!)) return null;
    return { ...o, ...win };
  }).filter(Boolean) as any;
}

async function prepareInsertMedia(plan: SourcePlan, words: Word[], workDir: string, cost: CostTracker, cfg: LevelCfg, notes: string[]) {
  const state = { ai: 0, exclude: new Set<string>() };
  await mapLimit(plan.inserts, 3, async (x, k) => {
    if (x.clip && fs.existsSync(x.clip)) return;
    if (x.file && fs.existsSync(x.file)) return;
    const ctx = words.filter((w) => w.start >= x.start! - 1.5 && w.end <= x.end! + 1.5).map((w) => w.w).join(' ');
    const wantPhoto = x.display !== 'fullscreen';
    const m = await insertMedia({ ...x, context: ctx }, `ins${k}_${Date.now()}`, workDir, cost, cfg, state, wantPhoto);
    if (!m) { notes.push(`no media found for "${x.phrase}"`); return; }
    x.source = m.source;
    if (wantPhoto) x.file = (await makeCard(m.file, workDir, x.display === 'square')) || undefined;
    else {
      const frames = Math.max(8, Math.round((x.end! - x.start!) * FPS));
      const out = path.join(workDir, `insert_${k}_${Date.now()}.mp4`);
      if (await renderSceneClip(m, k, frames, out)) x.clip = out;
    }
  });
  plan.inserts = plan.inserts.filter((x) => (x.file && fs.existsSync(x.file)) || (x.clip && fs.existsSync(x.clip)));
  await mapLimit(plan.overlays, 2, async (o) => { if (!o.file || !fs.existsSync(o.file)) o.file = (await makeOverlayElement(o.element, workDir, cost)) || undefined; });
  plan.overlays = plan.overlays.filter((o) => o.file);
}

function dubRoom(start: number, nextStart: number | undefined, duration: number) {
  return Math.max(0.6, (nextStart ?? duration) - start - 0.05);
}

/** ffmpeg atempo accepts 0.5–2.0; chain filters for a larger change. */
function atempoChain(tempo: number): string {
  const parts: string[] = [];
  let t = tempo;
  if (!isFinite(t) || t <= 0) return '';
  t = Math.min(4, Math.max(0.5, t));
  while (t > 2.0001) { parts.push('atempo=2.0'); t /= 2; }
  while (t < 0.4999) { parts.push('atempo=0.5'); t *= 2; }
  if (Math.abs(t - 1) >= 0.02) parts.push(`atempo=${t.toFixed(3)}`);
  return parts.join(',');
}

function normSpeak(s: string) {
  return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** End time of the expected line inside a whisper transcript, or null if the clip doesn't say it. */
function expectedLineEnd(words: Word[], expected: string): number | null {
  const etoks = normSpeak(expected).split(' ').filter(Boolean);
  const got = words.map((w) => ({ n: normSpeak(w.w), end: w.end }));
  if (!etoks.length || !got.length) return null;
  let best = { hits: 0, end: -1 };
  for (let start = 0; start < got.length; start++) {
    let j = 0, hits = 0, end = -1;
    for (let i = start; i < got.length && j < etoks.length; i++) {
      const g = got[i].n, e = etoks[j];
      if (!g) continue;
      if (g === e || (Math.min(g.length, e.length) >= 3 && (g.startsWith(e) || e.startsWith(g)))) {
        hits++; end = got[i].end; j++;
      } else if (hits > 0 && g.length <= 2) continue;
      else if (hits >= 2) continue;
      else if (hits > 0) break;
    }
    if (hits > best.hits) best = { hits, end };
    if (hits === etoks.length) break;
  }
  if (best.hits >= Math.max(2, Math.ceil(etoks.length * 0.7)) && best.end > 0) return best.end + 0.15;
  return null;
}

/** Keep a dubbed line inside its time window. cutAt (seconds) drops a rambling tail when known. */
async function fitDubClip(src: string, windowSec: number, cutAt?: number | null): Promise<string> {
  const room = Math.max(0.45, windowSec);
  let input = src;
  const d0 = await probeDuration(src);
  const cut = cutAt != null && cutAt > 0.3 && cutAt < d0 - 0.08 ? cutAt : null;
  if (cut != null) {
    const trimmed = src.replace(/(\.[^.]+)$/, '_trim$1');
    const r = await ffmpeg(withCleanOutput(['-i', src, '-t', cut.toFixed(3), '-c:a', 'libmp3lame', '-b:a', '192k', trimmed], { sei: false }));
    if (r.code === 0 && fs.existsSync(trimmed)) input = trimmed;
  }
  const d = await probeDuration(input);
  const fade = Math.min(0.08, room / 6);
  const filters: string[] = [];
  if (d > room * 1.03) {
    const chain = atempoChain(d / room);
    if (chain) filters.push(chain);
  }
  filters.push(`atrim=0:${room.toFixed(3)}`, `afade=t=out:st=${Math.max(0, room - fade).toFixed(3)}:d=${fade.toFixed(3)}`, 'asetpts=PTS-STARTPTS');
  const out = src.replace(/(\.[^.]+)$/, '_fit$1');
  const r = await ffmpeg(withCleanOutput(['-i', input, '-af', filters.join(','), '-c:a', 'libmp3lame', '-b:a', '192k', out], { sei: false }));
  if (r.code === 0 && fs.existsSync(out)) { await stripProvenance(out); return out; }
  console.warn('[dub] fit failed', r.err.slice(-200));
  return input;
}

const TTS_SPEAK_LINE_RETRY = (line: string) =>
  `${TTS_SPEAK_LINE_SYSTEM} The only words you may speak are exactly these: ${line}  If that is a question, read the question and stop. Do not answer, comment, continue, improvise or have a conversation. Speak those words, then immediately end the audio.`;

/** Translate transcript segments; returns pseudo-word timings for subtitles (+ optional dubbed audio). */
async function translate(st: SourceState, lang: string, dub: boolean, workDir: string, cost: CostTracker, voice: string, cfg: LevelCfg) {
  const segs = st.segments.length ? st.segments : [{ text: st.words.map((w) => w.w).join(' '), start: st.words[0]?.start || 0, end: st.words.at(-1)?.end || st.duration, from: 0, to: st.words.length - 1 }];
  const j = await askPlanner(`Translate each subtitle segment into language "${lang}". Keep meaning, natural spoken style, similar length. Return ONLY JSON {"t":["..."]} with exactly ${segs.length} items in order.`,
    JSON.stringify(segs.map((s) => s.text)), cost, 'translate');
  const t: string[] = Array.isArray(j.t) ? j.t : [];
  const words: Word[] = [];
  segs.forEach((s, i) => {
    const toks = String(t[i] || s.text).split(/\s+/).filter(Boolean);
    const total = toks.reduce((n, x) => n + x.length + 1, 0) || 1;
    let acc = 0;
    toks.forEach((x) => { const a = s.start + (acc / total) * (s.end - s.start); acc += x.length + 1; words.push({ w: x, start: +a.toFixed(3), end: +(s.start + (acc / total) * (s.end - s.start)).toFixed(3) }); });
  });
  let dubAudio: string | undefined;
  if (dub) {
    const parts: { file: string; start: number; len: number }[] = [];
    await mapLimit(segs.map((s, i) => ({ s, i })), 3, async ({ s, i }) => {
      const text = String(t[i] || s.text);
      const f = path.join(workDir, `dub_${i}.mp3`);
      const room = dubRoom(s.start, segs[i + 1]?.start, st.duration);
      const est = cfg.tts === MODELS.tts ? EST.ttsMini / 3 : EST.ttsHigh / 3;
      if (!reserve(cost, est)) return;
      try {
        if (!(await generateSpeech(text, f, cost, voice, cfg.tts, { system: TTS_SPEAK_LINE_SYSTEM }))) return;
        let said = await transcribe(f, workDir, `dubcheck_${i}.json`);
        let cut = expectedLineEnd(said.words, text);
        const d = await probeDuration(f);
        const bad = cut == null || d > Math.max(room * 2.2, (cut || 0) + 2.5);
        if (bad && reserve(cost, est)) {
          const f2 = path.join(workDir, `dub_${i}_retry.mp3`);
          try {
            if (await generateSpeech(`«${text}»`, f2, cost, voice, cfg.tts, { system: TTS_SPEAK_LINE_RETRY(text) })) {
              const said2 = await transcribe(f2, workDir, `dubcheck_${i}_retry.json`);
              const cut2 = expectedLineEnd(said2.words, text);
              const d2 = await probeDuration(f2);
              const better = (cut == null && cut2 != null) || (cut2 != null && d2 < d * 0.95) || (cut2 != null && cut == null);
              if (better || (cut == null && cut2 == null && d2 < d * 0.85)) {
                fs.copyFileSync(f2, f);
                cut = cut2;
              }
            }
          } finally { release(cost, est); }
        }
        if (cut == null) console.warn(`[dub] line ${i} may not match the script ("${text.slice(0, 80)}")`);
        const fitted = await fitDubClip(f, room, cut);
        parts.push({ file: fitted, start: s.start, len: room });
      } finally { release(cost, est); }
    });
    if (parts.length) {
      parts.sort((a, b) => a.start - b.start);
      const args: string[] = ['-i', st.audio];
      parts.forEach((p) => args.push('-i', p.file));
      const fc: string[] = ['[0:a]volume=0.12[bg]'];
      for (let k = 0; k < parts.length; k++) {
        const delay = Math.round(parts[k].start * 1000);
        fc.push(`[${k + 1}:a]adelay=${delay}|${delay}[d${k}]`);
      }
      fc.push(`[bg]${parts.map((_, k) => `[d${k}]`).join('')}amix=inputs=${parts.length + 1}:duration=first:normalize=0[a]`);
      dubAudio = path.join(workDir, `dub_mix_${Date.now()}.m4a`);
      const r = await ffmpeg(withCleanOutput([...args, '-filter_complex', fc.join(';'), '-map', '[a]', '-c:a', 'aac', '-b:a', '192k', dubAudio], { sei: false }));
      if (r.code !== 0) { console.warn('[dub]', r.err.slice(-300)); dubAudio = undefined; }
    }
  }
  return { lang, words, dubAudio };
}

async function renderSource(st: SourceState, workDir: string, outVideo: string, outPoster: string) {
  const plan = st.plan;
  const words = st.translated?.words || st.words;
  const headlines = st.translated ? [] : plan.headlines.map((h) => ({ start_idx: h.start_idx!, end_idx: h.end_idx!, highlight_idx: h.highlight_idx ?? -1 }));
  const style = { ...st.style, subtitles: (st.style.subtitles !== false) && plan.subtitles !== false && words.length > 0 };
  const ass = await buildAss(workDir, words, st.duration, headlines, style);
  const overlays: OverlayItem[] = [
    ...plan.inserts.map((x) => ({ file: (x.clip || x.file)!, start: x.start!, end: x.end!, mode: (x.display === 'fullscreen' ? 'fullscreen' : 'card') as OverlayItem['mode'] })),
    ...plan.overlays.map((o) => ({ file: o.file!, start: o.start!, end: o.end!, mode: 'sticker' as const })),
  ];
  await composeFinal({ baseVideo: st.base, overlays, assFile: ass, audioFile: st.translated?.dubAudio || st.audio, duration: st.duration, outVideo, outPoster });
}


/** High-level: at least 2 stock inserts on mid-length footage, 3 when the video is longer. */
export function highInsertTarget(durationSec: number, wordCount: number): number {
  if (durationSec >= 35 && wordCount >= 30) return 3;
  if (durationSec >= 12 && wordCount >= 16) return 2;
  return 0;
}

function userDeclinedInserts(request: string): boolean {
  const r = String(request || '').toLowerCase();
  if (/\bno\s+(inserts?|photos?|videos?|stock|media|footage|b-?roll)\b/.test(r)) return true;
  const onlyLite = /\b(only|just|только|лишь)\b/.test(r) && /\b(subtitle|caption|headline|transl|субтит|заголов|перевод)/.test(r);
  const wantsMedia = /\b(insert|stock|footage|photo|video|b-?roll|media|вставк|фото|видео)\b/.test(r);
  return onlyLite && !wantsMedia;
}

function insertPhrases(words: Word[]): { phrase: string; i: number }[] {
  const stop = new Set(['the','a','an','and','or','but','to','of','in','on','for','with','that','this','it','is','was','are','be','as','at','by','from','i','we','you','they','he','she','my','our','your','me','not','so','if','do','did','just','like','have','has','had','это','как','что','для','или','но','не','на','по','из','от','за','то','же','бы','меня','мне','мой','моя','мы','я','ты','вы','он','она','они','это']);
  const out: { phrase: string; i: number }[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i].w.replace(/[^\p{L}\p{N}-]/gu, '');
    if (w.length < 4 || stop.has(w.toLowerCase())) continue;
    const nxt = words[i + 1]?.w.replace(/[^\p{L}\p{N}-]/gu, '') || '';
    const phrase = nxt.length >= 3 && !stop.has(nxt.toLowerCase()) ? `${w} ${nxt}` : w;
    out.push({ phrase, i });
  }
  return out;
}

/** Upgrade or add stock inserts when the High planner returned too few. */
export function ensureHighEditStockInserts(plan: SourcePlan, words: Word[], duration: number, request: string): void {
  if (userDeclinedInserts(request)) return;
  const target = highInsertTarget(duration, words.length);
  if (!target) return;
  const isStock = (x: SourcePlan['inserts'][number]) => x.media_type === 'stock_video' || x.media_type === 'stock_photo';
  for (const x of plan.inserts) {
    if (x.media_type === 'ai_photo') {
      x.media_type = x.display === 'fullscreen' ? 'stock_video' : 'stock_photo';
      if (!String(x.search_query || '').trim()) x.search_query = deriveSearchQuery(x) || x.visual_description || x.phrase;
      console.log(`[high stock] upgraded insert "${x.phrase}" to ${x.media_type} query="${x.search_query}"`);
    } else if (!String(x.search_query || '').trim()) {
      x.search_query = deriveSearchQuery(x) || x.visual_description || x.phrase;
    }
    if (x.media_type === 'stock_photo' && x.display === 'fullscreen') x.media_type = 'stock_video';
  }
  let have = plan.inserts.filter(isStock).length;
  if (have >= target) return;
  const used = new Set(plan.inserts.map((x) => x.phrase.toLowerCase()));
  const busy: [number, number][] = [
    ...plan.inserts.filter((x) => x.start != null && x.end != null).map((x) => [x.start!, x.end!] as [number, number]),
    ...plan.headlines.filter((h) => h.start_idx != null).map((h) => [words[h.start_idx!]?.start ?? 0, (words[h.end_idx!]?.end ?? 0) + 0.9] as [number, number]),
  ];
  const cands = insertPhrases(words);
  const slots = target === 3 ? [0.22, 0.5, 0.78] : [0.3, 0.7];
  const displays: Array<'fullscreen' | 'rounded' | 'square'> = ['fullscreen', 'rounded', 'square'];
  for (const frac of slots) {
    if (have >= target) break;
    const t = duration * frac;
    const nearby = cands
      .filter((c) => !used.has(c.phrase.toLowerCase()))
      .sort((a, b) => Math.abs(words[a.i].start - t) - Math.abs(words[b.i].start - t));
    let picked: typeof cands[number] | null = null;
    for (const c of nearby) {
      const start = Math.max(0, words[c.i].start - 0.05);
      const end = Math.min(duration - 0.05, start + 2.6);
      if (end - start < 1.2) continue;
      if (busy.some(([s, e]) => start < e + 0.4 && end > s - 0.4)) continue;
      picked = c;
      break;
    }
    if (!picked) continue;
    const display = displays[plan.inserts.length % displays.length];
    const query = deriveSearchQuery({ search_query: '', visual_description: picked.phrase, voiceover_chunk: picked.phrase }) || picked.phrase;
    plan.inserts.push({
      phrase: picked.phrase,
      display,
      media_type: display === 'fullscreen' ? 'stock_video' : 'stock_photo',
      search_query: query,
      visual_description: picked.phrase,
      ai_image_prompt: picked.phrase,
    });
    used.add(picked.phrase.toLowerCase());
    have++;
    console.log(`[high stock] added insert "${picked.phrase}" as ${display === 'fullscreen' ? 'stock_video' : 'stock_photo'} query="${query}"`);
  }
  if (plan.inserts.filter(isStock).length < target) {
    console.warn(`[high stock] edit plan has ${plan.inserts.filter(isStock).length} stock inserts (target ${target})`);
  }
}

type SourceEditInput = {
  sourceFile: string; prompt: string; level?: Level; style?: CaptionStyle; voice?: string; workDir: string; outVideo: string; outPoster: string;
  cost: CostTracker; onProgress: Progress; ru: boolean;
};

/**
 * Output frame for an upload (the user's words always win):
 *  short horizontal -> vertical 9:16 with Smart Reframe; long horizontal -> horizontal 16:9;
 *  vertical (any length) -> vertical; "shorten / highlights / N seconds" -> cut to the best moments first.
 */
export async function runSourceEdit(o: SourceEditInput): Promise<{ state: SourceState; notes: string[]; title: string }> {
  const pr = await probeVideo(o.sourceFile);
  if (!(pr.w > 0 && pr.h > 0)) throw new Error('The uploaded file has no readable video track.');
  const layout = decideSourceLayout(pr, o.prompt);
  console.log(`[edit source] ${pr.w}x${pr.h} ${pr.duration.toFixed(1)}s -> ${layout.aspect}${layout.reframe ? ' +reframe' : ''}${layout.cutTo ? ` cut ${layout.cutTo}s` : ''} (${layout.reason})`);
  return withFrame(frameFor(layout.aspect), () => runSourceEditInFrame(o, layout));
}

async function runSourceEditInFrame(o: SourceEditInput, layout: SourceLayout): Promise<{ state: SourceState; notes: string[]; title: string }> {
  const { workDir, cost } = o;
  fs.mkdirSync(workDir, { recursive: true });
  const say = (en: string, r: string) => (o.ru ? r : en);
  const cfg = levelCfg(normLevel(o.level));
  const notes: string[] = [];
  o.onProgress(8, say('Preparing your video...', 'Готовим ваше видео...'));
  let srcFile = o.sourceFile;
  if (layout.cutTo) {
    // transcript of the whole upload first, then keep only the best moments
    const fullAudio = path.join(workDir, 'src_audio_full.m4a');
    if (!fs.existsSync(fullAudio) && await hasAudioStream(o.sourceFile)) { await ffmpeg(withCleanOutput(['-i', o.sourceFile, '-t', String(Math.ceil(layout.maxSeconds)), '-vn', '-c:a', 'aac', '-b:a', '192k', fullAudio], { sei: false })); if (fs.existsSync(fullAudio)) await stripProvenance(fullAudio); }
    o.onProgress(12, say('Transcribing speech...', 'Распознаём речь...'));
    const full = fs.existsSync(fullAudio) ? await transcribe(fullAudio, workDir, 'transcript_full.json') : { words: [] as Word[], segments: [] as any[], language: undefined };
    o.onProgress(20, say('Picking the best moments...', 'Выбираем лучшие моменты...'));
    const keep = await selectHighlights({ words: full.words, segments: full.segments, duration: layout.maxSeconds, target: layout.cutTo, prompt: o.prompt, cost });
    srcFile = await cutSource(o.sourceFile, keep, workDir);
    const words = remapToCut(full.words, keep);
    const segments = remapToCut(full.segments as any[], keep).map((sg: any) => {
      const from = words.findIndex((w) => w.start >= sg.start - 0.05);
      let to = from; while (to + 1 < words.length && words[to + 1].end <= sg.end + 0.05) to++;
      return { ...sg, from: Math.max(0, from), to: Math.max(0, to) };
    });
    fs.writeFileSync(path.join(workDir, 'transcript.json'), JSON.stringify({ words, segments, language: full.language }));
    const total = keep.reduce((n, r) => n + r.end - r.start, 0);
    notes.push(`cut to ${Math.round(total)}s (${keep.length} moment${keep.length > 1 ? 's' : ''} kept from ${Math.round(layout.maxSeconds)}s)`);
  }
  const { base, audio, duration, reframe } = await normaliseSource(srcFile, workDir, { reframe: layout.reframe, maxSeconds: layout.cutTo ? 0 : layout.maxSeconds });
  if (reframe?.ok) notes.push(`Smart Reframe: vertical crop follows the ${reframe.method === 'face' ? 'speaker\'s face' : reframe.method === 'person' ? 'person' : 'main action'}${reframe.shots && reframe.shots > 1 ? ` across ${reframe.shots} shots` : ''}`);
  o.onProgress(layout.cutTo ? 24 : 18, say('Transcribing speech...', 'Распознаём речь...'));
  const tr = await transcribe(audio, workDir);
  o.onProgress(30, say('Planning the edit...', 'Планируем монтаж...'));
  // long videos: scale the number of edits with the length (the rules' counts are for short clips)
  const mins = duration / 60;
  const lvlRate = cfg.level === 'low' ? 40 : cfg.level === 'high' ? 18 : 25;
  const scaleHint = duration > 150
    ? `\nThis video is ${mins.toFixed(1)} minutes long${curFrame().orientation === 'landscape' ? ' (horizontal 16:9 long-form)' : ''}: plan about ${Math.min(120, Math.round(duration / lvlRate))} inserts, ${Math.min(40, Math.max(3, Math.round(duration / 45)))} headlines and ${Math.min(30, Math.max(2, Math.round(duration / 90)))} overlays spread evenly over the WHOLE video (these counts override the numbers in the rules).`
    : '';
  const raw = await askPlanner(SOURCE_PLAN_SYSTEM(cfg), `Video duration: ${duration.toFixed(1)}s. Speech language: ${tr.language || 'none'}.${scaleHint}\nTranscript:\n${transcriptForLLM(tr.words) || '(no speech)'}\n\nUser request: "${o.prompt}"`, cost, 'edit plan (footage)');
  const maxOverlays = duration > 150 ? Math.max(cfg.maxOverlays, Math.min(30, Math.round(duration / 90))) : cfg.maxOverlays;
  const plan: SourcePlan = {
    subtitles: raw.subtitles !== false, translate_to: raw.translate_to || null, dub: !!raw.dub,
    headlines: Array.isArray(raw.headlines) ? raw.headlines.filter((h: any) => h?.phrase) : [],
    inserts: (Array.isArray(raw.inserts) ? raw.inserts : []).filter((x: any) => x?.phrase && (x.search_query || x.visual_description))
      .map((x: any) => ({ ...x, display: ['fullscreen', 'rounded', 'square'].includes(x.display) ? x.display : 'fullscreen', media_type: ['stock_video', 'stock_photo', 'ai_photo'].includes(x.media_type) ? x.media_type : 'stock_photo' })),
    overlays: (Array.isArray(raw.overlays) ? raw.overlays : []).filter((x: any) => x?.trigger_word && x?.element).slice(0, maxOverlays),
  };
  let style: CaptionStyle = { ...DEFAULT_STYLE, ...(o.style || {}) };
  if (raw.style) style = applyStyleOp(style, raw.style);
  timePlan(plan, tr.words, duration);
  if (cfg.level === 'high') {
    ensureHighEditStockInserts(plan, tr.words, duration, o.prompt);
    timePlan(plan, tr.words, duration);
  }
  o.onProgress(45, say('Finding matching footage and photos...', 'Подбираем подходящие видео и фото...'));
  await prepareInsertMedia(plan, tr.words, workDir, cost, cfg, notes);
  const st: SourceState = { base, audio, duration, words: tr.words, segments: tr.segments, language: tr.language, plan, style, level: cfg.level, translated: null, aspect: curFrame().aspect, layout, reframe };
  if (plan.translate_to && tr.words.length) {
    o.onProgress(70, say('Translating...', 'Переводим...'));
    st.translated = await translate(st, plan.translate_to, !!plan.dub, workDir, cost, o.voice || 'alloy', cfg);
  }
  o.onProgress(85, say('Rendering...', 'Рендерим...'));
  await renderSource(st, workDir, o.outVideo, o.outPoster);
  const title = (tr.words.slice(0, 6).map((w) => w.w).join(' ') || o.prompt).slice(0, 60);
  return { state: st, notes, title };
}

const SOURCE_EDIT_SYSTEM = `You convert a user's edit request for their already-edited video into a MINIMAL list of JSON operations. Change ONLY what was asked.
Operations:
- ${STYLE_OP_DOC}
- {"op":"add_insert","phrase":"1-4 words copied exactly from the transcript","display":"fullscreen"|"rounded"|"square","media_type":"stock_video"|"stock_photo"|"ai_photo","search_query":"English keywords","visual_description":"","ai_image_prompt":""}
- {"op":"remove_insert","n":N}  // N from the current inserts list
- {"op":"replace_insert","n":N,"media_type":"stock_video"|"stock_photo"|"ai_photo","search_query":"","visual_description":"","display"?:...}
- {"op":"add_overlay","trigger_word":"word from transcript","element":"one object"}
- {"op":"remove_overlay","n":N}
- {"op":"add_headline","phrase":"2-6 consecutive words from transcript","highlight":"one word"}
- {"op":"remove_headline","n":N}
- {"op":"translate","to":"ISO code or null to remove translation","dub":true|false}
Return ONLY JSON {"ops":[...],"summary":"..."}`;

type SourceReEditInput = { state: SourceState; request: string; workDir: string; outVideo: string; outPoster: string; cost: CostTracker; onProgress: Progress; ru: boolean; voice?: string };

export function applySourceEdit(o: SourceReEditInput) {
  return withFrame(frameFor(o.state.aspect), () => applySourceEditInFrame(o));
}

async function applySourceEditInFrame(o: SourceReEditInput) {
  const st: SourceState = JSON.parse(JSON.stringify(o.state));
  const { workDir, cost } = o;
  const say = (en: string, r: string) => (o.ru ? r : en);
  const cfg = levelCfg(normLevel(st.level));
  o.onProgress(10, say('Understanding your edit...', 'Разбираем правку...'));
  const cur = {
    style: st.style, subtitles: st.plan.subtitles, translate_to: st.translated?.lang || null,
    inserts: st.plan.inserts.map((x, i) => ({ n: i + 1, phrase: x.phrase, display: x.display, media: x.source, query: x.search_query })),
    overlays: st.plan.overlays.map((x, i) => ({ n: i + 1, element: x.element, trigger_word: x.trigger_word })),
    headlines: st.plan.headlines.map((x, i) => ({ n: i + 1, phrase: x.phrase, highlight: x.highlight })),
  };
  const j = await askPlanner(SOURCE_EDIT_SYSTEM, `Current edit: ${JSON.stringify(cur)}\nTranscript:\n${transcriptForLLM(st.words)}\n\nEdit request: "${o.request}"`, cost, 'edit plan');
  const ops: any[] = Array.isArray(j.ops) ? j.ops : [];
  console.log('[edit source] ops', JSON.stringify(ops));
  if (!ops.length) throw new Error('Could not understand the edit request — please describe the change more specifically.');
  const notes: string[] = [];
  const rmIns = new Set<number>(), rmOv = new Set<number>(), rmHl = new Set<number>();
  const newIns: any[] = []; const newOv: any[] = []; const newHl: any[] = [];
  let retranslate: { to: string | null; dub: boolean } | null = null;
  for (const op of ops) {
    const n = Math.round(Number(op.n)) - 1;
    if (op.op === 'style') st.style = applyStyleOp(st.style, op);
    else if (op.op === 'remove_insert' && n >= 0) rmIns.add(n);
    else if (op.op === 'remove_overlay' && n >= 0) rmOv.add(n);
    else if (op.op === 'remove_headline' && n >= 0) rmHl.add(n);
    else if (op.op === 'replace_insert' && st.plan.inserts[n]) {
      const x = st.plan.inserts[n];
      Object.assign(x, { media_type: op.media_type || x.media_type, search_query: op.search_query || x.search_query, visual_description: op.visual_description || x.visual_description, ai_image_prompt: op.ai_image_prompt || op.visual_description || x.ai_image_prompt, display: op.display || x.display });
      delete x.file; delete x.clip;
    } else if (op.op === 'add_insert' && op.phrase) newIns.push({ ...op, display: ['fullscreen', 'rounded', 'square'].includes(op.display) ? op.display : 'fullscreen', media_type: op.media_type || 'stock_photo' });
    else if (op.op === 'add_overlay' && op.element) newOv.push({ trigger_word: op.trigger_word, element: op.element });
    else if (op.op === 'add_headline' && op.phrase) newHl.push({ phrase: op.phrase, highlight: op.highlight || '' });
    else if (op.op === 'translate') retranslate = { to: op.to || null, dub: !!op.dub };
  }
  st.plan.inserts = st.plan.inserts.filter((_, i) => !rmIns.has(i));
  st.plan.overlays = st.plan.overlays.filter((_, i) => !rmOv.has(i));
  st.plan.headlines = st.plan.headlines.filter((_, i) => !rmHl.has(i));
  if (newIns.length || newOv.length || newHl.length) {
    const add: SourcePlan = { subtitles: true, headlines: newHl, inserts: newIns, overlays: newOv };
    timePlan(add, st.words, st.duration);
    // remove existing items that collide with the new ones (the new request wins)
    st.plan.inserts = st.plan.inserts.filter((k) => !add.inserts.some((x) => x.start! < k.end! && x.end! > k.start!));
    st.plan.inserts.push(...add.inserts); st.plan.overlays.push(...add.overlays); st.plan.headlines.push(...add.headlines);
    if (newIns.length && !add.inserts.length) notes.push('could not place the new insert on the transcript');
  }
  // re-time edited inserts whose clip was dropped (keep start/end)
  o.onProgress(35, say('Preparing new media...', 'Готовим новые материалы...'));
  await prepareInsertMedia(st.plan, st.words, workDir, cost, cfg, notes);
  if (retranslate) {
    st.translated = retranslate.to ? await translate(st, retranslate.to, retranslate.dub, workDir, cost, o.voice || 'alloy', cfg) : null;
  }
  o.onProgress(70, say('Re-rendering...', 'Перемонтируем...'));
  await renderSource(st, workDir, o.outVideo, o.outPoster);
  return { state: st, ops, summary: String(j.summary || ''), notes };
}
