/**
 * nind long-form & format logic
 *  - detectIntent / planCreation: short (vertical, default) vs long-form (horizontal 16:9, ~5-50 min) from the prompt, any language
 *  - estimateCreation: cost / credit estimate that scales with length
 *  - runLongVideoPipeline: chaptered script -> chunked TTS + alignment -> scaled media -> 16:9 render
 *  - decideSourceLayout / selectHighlights: how a user's own upload is framed and (optionally) cut
 */
import fs from 'fs';
import path from 'path';
import {
  CostTracker, Level, LevelCfg, levelCfg, normLevel, MODELS, EST, SceneSpec, Word, PipelineInput, PipelineResult,
  orChat, extractJson, generateSpeech, alignWords, mediaForScene, fillMissingMedia, sceneTiming, assembleVideo,
  mapLimit, ffmpeg, probeDuration, reserve, release, withFrame, frameFor, ensureHighStockPlan, fulfillHighStock,
} from './videoPipeline';

// ================================================================== intent detection
export interface FormatIntent {
  orientation?: 'portrait' | 'landscape'; // explicit request only
  long: boolean;          // asked for a long / YouTube-style / documentary video
  seconds?: number;       // explicit duration
  shorten: boolean;       // edit: cut down / highlights / make it short
  keepFull: boolean;      // edit: keep the whole length
  shortsFormat: boolean;  // Shorts / Reels / TikTok / Stories (short vertical clip)
  signals: string[];
}

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, 'twenty-five': 25, thirty: 30, forty: 40, 'forty-five': 45, fifty: 50,
  'одну': 1, 'одна': 1, 'один': 1, 'две': 2, 'два': 2, 'три': 3, 'четыре': 4, 'пять': 5, 'шесть': 6, 'семь': 7, 'восемь': 8, 'девять': 9, 'десять': 10,
  'двенадцать': 12, 'пятнадцать': 15, 'двадцать': 20, 'тридцать': 30, 'сорок': 40, 'пятьдесят': 50,
};
const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const MIN_UNIT = String.raw`(?:min|mins|minute|minutes|minuten|minuto|minutos|minuti|минут\p{L}*|мин\b|хвилин\p{L}*)`;
const SEC_UNIT = String.raw`(?:s|sec|secs|second|seconds|sekunden|segundos|secondes|секунд\p{L}*|сек\b)`;

function parseSeconds(p: string): number | undefined {
  let t = ' ' + p.toLowerCase().replace(/ё/g, 'е') + ' ';
  for (const [w, n] of Object.entries(NUM_WORDS)) t = t.replace(new RegExp(`(^|[^\\p{L}])${w}(?=[\\s-]+${MIN_UNIT})`, 'giu'), `$1${n}`);
  if (/(half an hour|half-hour|полчаса|получас|media hora|halbe stunde|demi-heure)/u.test(t)) return 1800;
  const hr = t.match(new RegExp(String.raw`${NUM}?\s*-?\s*(?:hours?|час\p{L}*|hora\p{L}*|stunde\p{L}*|heures?)`, 'u'));
  if (hr && !/час\p{L}*\s+назад/u.test(t)) return Math.round((hr[1] ? parseFloat(hr[1].replace(',', '.')) : 1) * 3600);
  const rng = t.match(new RegExp(String.raw`${NUM}\s*(?:-|–|—|to|до|или|or|bis|a)\s*${NUM}\s*-?\s*${MIN_UNIT}`, 'u'));
  if (rng) return Math.round(((parseFloat(rng[1].replace(',', '.')) + parseFloat(rng[2].replace(',', '.'))) / 2) * 60);
  const m = t.match(new RegExp(String.raw`${NUM}\s*-?\s*${MIN_UNIT}`, 'u'));
  if (m) return Math.round(parseFloat(m[1].replace(',', '.')) * 60);
  const s = t.match(new RegExp(String.raw`${NUM}\s*-?\s*${SEC_UNIT}`, 'u'));
  if (s) return Math.round(parseFloat(s[1].replace(',', '.')));
  return undefined;
}

export function detectIntent(prompt: string): FormatIntent {
  const raw = String(prompt || '');
  // drop phrases where "long" isn't about the video ("how long", "long ago", ...)
  const p = raw.toLowerCase().replace(/ё/g, 'е')
    .replace(/\b(how long|long ago|long time|long before|as long as|long-term|long term|long-lasting|long distance|long hair|long island|longer than)\b/g, ' ');
  const signals: string[] = [];
  const has = (re: RegExp, tag: string) => { const ok = re.test(p); if (ok) signals.push(tag); return ok; };
  const shortsFormat = /\b(shorts?|reels?|tiktok|stories|instagram story)\b|шортс|рилс|тикток|сторис/u.test(p);
  const vertical = has(/\b(vertical|portrait|9\s*[:x×/]\s*16|shorts?|reels?|tiktok|stories|instagram story)\b|вертикал|портретн|шортс|рилс|тикток|сторис|vertikal|verticale?/u, 'vertical');
  const horizontal = !vertical && has(/\b(horizontal|landscape|widescreen|wide[- ]screen|16\s*[:x×/]\s*9|youtube|you tube|querformat|paysage|apaisad[oa]|paisagem|orizzontale)\b|горизонт|альбомн|широкоформат|ютуб|горизонтальн/u, 'horizontal');
  const long = has(/\b(long(er)?[- ]?(form|video|version|youtube|documentary|explainer|film|episode)|longform|full[- ]length|feature[- ]length|documentary|video essay|deep[- ]dive)\b|длинн\p{L}*\s+(видео|ролик|формат|верси)|(видео|ролик)\s+(подлиннее|длинн\p{L}*)|лонг[- ]?форм|полноформатн|документальн|video largo|v[ií]deo longo|langes video|vid[ée]o longue/u, 'long');
  const shorten = has(/\b(shorten|shorter|cut (it )?down|trim (it|down)|highlights?|best (parts|moments|bits)|make (it )?(a )?short|condense|summari[sz]e)\b|сократ|укорот|покороче|короче|нарез|хайлайт|лучш\p{L}*\s+момент|обреж|выжимк/u, 'shorten');
  const keepFull = has(/\b(keep (the )?(full|whole|entire)|full length|(don'?t|do not) (cut|shorten)|without cutting|whole video|entire video)\b|не сокращ|не обреза|не укороч|целиком|полностью|без сокращ|все видео|всё видео/u, 'keep_full');
  const seconds = parseSeconds(raw);
  if (seconds) signals.push(`duration=${seconds}s`);
  return { orientation: vertical ? 'portrait' : horizontal ? 'landscape' : undefined, long, seconds, shorten: shorten && !keepFull, keepFull, shortsFormat, signals };
}

export interface CreationPlan {
  format: 'short' | 'long';
  aspect: '9:16' | '16:9';
  target_seconds: number | null; // null = the classic short-form default (15-40 s)
  chaptered: boolean;            // long script pipeline (>= 2.5 min)
  intent: FormatIntent;
  reason: string;
}

export const LONG_DEFAULT_SECONDS = 8 * 60;
export const LONG_MIN_SECONDS = 5 * 60;
export const MAX_SECONDS = 50 * 60;

/** Default = short vertical. Long/horizontal only when the prompt asks for it; explicit duration/orientation always win. */
export function planCreation(prompt: string): CreationPlan {
  const it = detectIntent(prompt);
  const notes: string[] = [];
  let secs = it.seconds;
  if (secs && secs > MAX_SECONDS) { notes.push(`capped ${Math.round(secs / 60)} min to ${MAX_SECONDS / 60} min`); secs = MAX_SECONDS; }
  const wantsLong = it.long || (!!secs && secs > 300) || (it.orientation === 'landscape' && !secs);
  let target: number | null = secs ?? null;
  if (!secs && wantsLong) target = LONG_DEFAULT_SECONDS;
  if (it.long && !secs && target! < LONG_MIN_SECONDS) target = LONG_MIN_SECONDS;
  const aspect: CreationPlan['aspect'] = it.orientation ? (it.orientation === 'landscape' ? '16:9' : '9:16') : wantsLong ? '16:9' : '9:16';
  const format: CreationPlan['format'] = aspect === '16:9' || (target ?? 0) > 300 ? 'long' : 'short';
  const chaptered = (target ?? 0) >= 150;
  const reason = [
    format === 'long' ? 'long-form' : 'short-form', aspect,
    target ? `${Math.round(target / 6) / 10} min${secs ? ' (as requested)' : ' (default)'}` : 'default short length',
    it.signals.length ? `signals: ${it.signals.join(', ')}` : 'no format signals',
    ...notes,
  ].join('; ');
  return { format, aspect, target_seconds: target, chaptered, intent: it, reason };
}

// ================================================================== cost estimate
export const WORDS_PER_MIN = 150;
const SCENE_SECONDS = 11; // long-form scene length (2-3 sentences)

export function longAiCap(level: Level, scenes: number) {
  return level === 'low' ? 2 : level === 'high' ? Math.max(4, Math.round(scenes * 0.3)) : Math.max(3, Math.round(scenes * 0.12));
}

export interface CreationEstimate { usd: number; essentialUsd: number; credits: number; minCredits: number; minutes: number; scenes: number; chapters: number }

/** Upper-bound-ish estimate for a chaptered video; "essential" = script + voice + stock checks (can't be skipped). */
export function estimateCreation(plan: CreationPlan, level: Level): CreationEstimate {
  const secs = plan.target_seconds || 40;
  const minutes = secs / 60;
  const scenes = Math.max(6, Math.round(secs / SCENE_SECONDS));
  const chapters = chapterCount(secs);
  const ttsPerMin = level === 'high' ? 0.06 : 0.015; // measured: gpt-audio-mini ~ $0.004/min (x3 headroom)
  const script = EST.script + chapters * 0.004;
  const tts = minutes * ttsPerMin;
  const vision = scenes * 0.4 * EST.vision; // measured ~ $0.0004 per scene (2 checks)
  const ai = longAiCap(level, scenes) * (level === 'low' ? EST.imageCheap : EST.image);
  const overlays = Math.ceil(chapters * (level === 'low' ? 0.34 : level === 'high' ? 1 : 0.67)) * EST.overlay;
  const essentialUsd = script + tts + vision;
  const usd = essentialUsd + ai + overlays;
  return {
    usd: +usd.toFixed(3), essentialUsd: +essentialUsd.toFixed(3), credits: Math.ceil(usd / 0.01),
    minCredits: Math.ceil((essentialUsd * 1.15) / 0.01), minutes: +minutes.toFixed(1), scenes, chapters,
  };
}

export const chapterCount = (secs: number) => Math.max(2, Math.min(25, Math.round(secs / 120)));

// ================================================================== long script
interface Outline { title: string; description: string; chapters: { title: string; points: string[]; words: number }[] }

function langLineFor(language: string) {
  const lang = String(language || 'auto').toLowerCase();
  return lang === 'auto' || !lang
    ? 'Language of the narration, chapter titles, headlines and overlays text: the same language the user wrote the prompt in.'
    : `Language of the narration and headlines: ${lang.startsWith('ru') ? 'Russian' : lang.startsWith('en') ? 'English' : lang}.`;
}

export async function writeOutline(o: { prompt: string; language: string; format: string; targetSeconds: number; cost: CostTracker; aspect: '9:16' | '16:9' }): Promise<Outline> {
  const n = chapterCount(o.targetSeconds);
  const totalWords = Math.round((o.targetSeconds / 60) * WORDS_PER_MIN);
  const system = `You are an elite ${o.aspect === '16:9' ? 'YouTube long-form (horizontal 16:9)' : 'long vertical'} video director and scriptwriter: documentaries, explainers, video essays.
${langLineFor(o.language)}
Format style: ${o.format}.
Plan a ${Math.round(o.targetSeconds / 60)}-minute narrated video (about ${totalWords} spoken words) as exactly ${n} chapters.
Chapter 1 opens with a strong hook and a short intro; the last chapter wraps up with a satisfying conclusion. Chapters must not repeat each other; build a clear arc.
"words" per chapter: integers that add up to about ${totalWords}.
Return ONLY JSON: {"title":"catchy video title","description":"2-3 sentence YouTube description","chapters":[{"title":"short chapter title","points":["3-6 concrete points, facts, examples or story beats to cover"],"words":${Math.round(totalWords / n)}}]}`;
  const res = await orChat({ model: MODELS.script, messages: [{ role: 'system', content: system }, { role: 'user', content: `User prompt: "${o.prompt}"` }], response_format: { type: 'json_object' }, temperature: 0.7 }, o.cost, 'outline');
  const j = extractJson(res?.choices?.[0]?.message?.content || '') || {};
  let chapters = (Array.isArray(j.chapters) ? j.chapters : []).filter((c: any) => c && c.title).map((c: any) => ({
    title: String(c.title).slice(0, 80), points: (Array.isArray(c.points) ? c.points : []).map(String).slice(0, 8), words: Math.max(60, Number(c.words) || Math.round(totalWords / n)),
  }));
  if (!chapters.length) throw new Error('Could not plan the long video (empty outline)');
  // re-scale chapter lengths to the requested total
  const sum = chapters.reduce((s: number, c: any) => s + c.words, 0) || 1;
  chapters = chapters.map((c: any) => ({ ...c, words: Math.max(60, Math.round((c.words * totalWords) / sum)) }));
  return { title: String(j.title || o.prompt.slice(0, 60)), description: String(j.description || ''), chapters };
}

const CHAPTER_SCHEMA = `{"scenes":[{"voiceover_chunk":"2-3 natural spoken sentences","visual_description":"literal, concrete description of what is on screen","media_type":"stock_video | stock_photo | ai_photo","search_query":"2-4 English keywords","ai_image_prompt":"real-looking photograph of this moment","headline":null or {"phrase":"2-6 consecutive words copied exactly from voiceover_chunk","highlight":"ONE key word of phrase"},"overlay":null or {"trigger_word":"one word copied exactly from voiceover_chunk","element":"one iconic object"}}]}`;

export async function writeChapterScenes(o: { outline: Outline; k: number; prompt: string; language: string; format: string; cfg: LevelCfg; cost: CostTracker; aspect: '9:16' | '16:9' }): Promise<SceneSpec[]> {
  const ch = o.outline.chapters[o.k];
  const n = o.outline.chapters.length;
  const scenesWanted = Math.max(3, Math.round(ch.words / 30));
  const system = `You are an elite ${o.aspect === '16:9' ? 'YouTube long-form (horizontal 16:9)' : 'long vertical'} video scriptwriter. You write ONE chapter of a longer narrated video.
${langLineFor(o.language)}
Format style: ${o.format}.
RULES:
1. Write about ${ch.words} spoken words (±10%) for this chapter, split into about ${scenesWanted} scenes of 2-3 sentences (25-40 words each). Natural, engaging spoken narration; no stage directions, no emojis, no "in this chapter".
2. ${o.k === 0 ? 'This is the FIRST chapter: open with a strong hook, then introduce the topic.' : o.k === n - 1 ? 'This is the LAST chapter: conclude the whole video and end with a satisfying closing line (you may invite viewers to subscribe).' : 'Middle chapter: continue seamlessly from the previous one; do NOT greet the viewer or re-introduce the video.'}
3. Every scene's visuals must literally match what is said at that moment. ai_image_prompt: a REAL photograph (${o.aspect === '16:9' ? 'horizontal 16:9' : 'vertical 9:16'} framing), never illustration/render/text.
4. ${o.cfg.scriptRule}
5. search_query: ALWAYS English, concrete nouns.
6. headline: exactly ${scenesWanted >= 10 ? 2 : 1} scene(s) of this chapter get a headline (key punchline). overlay: at most 1 scene (an obvious iconic object). Never both in one scene.
Return ONLY valid JSON: ${CHAPTER_SCHEMA}`;
  const user = `Video: "${o.outline.title}" (user prompt: "${o.prompt}")
All chapters: ${o.outline.chapters.map((c, i) => `${i + 1}. ${c.title}`).join(' | ')}
Write chapter ${o.k + 1}/${n}: "${ch.title}". Cover: ${ch.points.join('; ') || ch.title}`;
  const res = await orChat({ model: MODELS.script, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_object' }, temperature: 0.8, max_tokens: 6000 }, o.cost, `script ch${o.k + 1}`);
  const j = extractJson(res?.choices?.[0]?.message?.content || '') || {};
  return (Array.isArray(j.scenes) ? j.scenes : [])
    .filter((s: any) => s && typeof s.voiceover_chunk === 'string' && s.voiceover_chunk.trim())
    .map((s: any) => ({
      scene_num: 0,
      voiceover_chunk: s.voiceover_chunk.replace(/\s+/g, ' ').trim(),
      visual_description: String(s.visual_description || s.ai_image_prompt || s.voiceover_chunk),
      media_type: (['stock_video', 'stock_photo', 'ai_photo'].includes(s.media_type) ? s.media_type : 'stock_photo') as SceneSpec['media_type'],
      search_query: String(s.search_query || s.visual_description || '').slice(0, 80),
      ai_image_prompt: String(s.ai_image_prompt || s.visual_description || s.voiceover_chunk),
      headline: s.headline && s.headline.phrase ? { phrase: String(s.headline.phrase), highlight: String(s.headline.highlight || '') } : null,
      overlay: s.overlay && s.overlay.trigger_word && s.overlay.element ? { trigger_word: String(s.overlay.trigger_word), element: String(s.overlay.element) } : null,
      needs_new_visual: true,
      chapter: o.k,
    } as SceneSpec & { chapter: number }));
}

export async function writeLongScript(o: { prompt: string; language: string; format: string; targetSeconds: number; level: Level; cost: CostTracker; aspect: '9:16' | '16:9'; onChapter?: (done: number, total: number) => void }) {
  const cfg = levelCfg(o.level);
  const outline = await writeOutline(o);
  let done = 0;
  const perChapter = await mapLimit(outline.chapters, 3, async (_c, k) => {
    if (!reserve(o.cost, EST.script * 2)) throw new Error('Credit limit reached while writing the script');
    try {
      let sc = await writeChapterScenes({ outline, k, prompt: o.prompt, language: o.language, format: o.format, cfg, cost: o.cost, aspect: o.aspect });
      if (!sc.length) sc = await writeChapterScenes({ outline, k, prompt: o.prompt, language: o.language, format: o.format, cfg, cost: o.cost, aspect: o.aspect });
      return sc;
    } finally { release(o.cost, EST.script * 2); o.onChapter?.(++done, outline.chapters.length); }
  });
  const scenes = perChapter.flat();
  if (!scenes.length) throw new Error('Script generation returned no scenes');
  scenes.forEach((s, i) => { s.scene_num = i + 1; });
  // keep the AI-photo share (and cost) bounded for long videos
  const cap = longAiCap(o.level, scenes.length);
  let ai = 0;
  for (const s of scenes) if (s.media_type === 'ai_photo' && ++ai > cap) s.media_type = 'stock_photo';
  if (o.level === 'high') ensureHighStockPlan(scenes);
  const chapters = outline.chapters.map((c, k) => ({ title: c.title, first_scene: scenes.findIndex((s: any) => s.chapter === k) })).filter((c) => c.first_scene >= 0);
  return { outline, scenes, chapters, words: scenes.reduce((n, s) => n + s.voiceover_chunk.split(/\s+/).filter(Boolean).length, 0) };
}

// ================================================================== chunked voiceover
async function chunkedVoiceover(scenes: SceneSpec[], workDir: string, o: { cost: CostTracker; voice: string; tts: string; language: string; onProgress: (done: number, total: number) => void }) {
  const dir = path.join(workDir, 'tts');
  fs.mkdirSync(dir, { recursive: true });
  // chunks of whole scenes, <= ~170 words (~70 s) and never across chapters
  const chunks: { scenes: number[]; text: string }[] = [];
  let cur: number[] = []; let wc = 0;
  scenes.forEach((s: any, i) => {
    const n = s.voiceover_chunk.split(/\s+/).filter(Boolean).length;
    const newChapter = cur.length && (scenes[cur[0]] as any).chapter !== s.chapter;
    if (cur.length && (wc + n > 170 || newChapter)) { chunks.push({ scenes: cur, text: cur.map((j) => scenes[j].voiceover_chunk).join(' ') }); cur = []; wc = 0; }
    cur.push(i); wc += n;
  });
  if (cur.length) chunks.push({ scenes: cur, text: cur.map((j) => scenes[j].voiceover_chunk).join(' ') });
  const perWord = (o.tts === MODELS.tts ? EST.ttsMini : EST.ttsHigh) / 80;
  let done = 0;
  const files = await mapLimit(chunks, 3, async (c, k) => {
    const f = path.join(dir, `chunk_${String(k).padStart(3, '0')}.mp3`);
    const est = perWord * c.text.split(/\s+/).length * 1.2;
    if (!reserve(o.cost, est)) throw new Error('Not enough credits to record the whole voiceover');
    try {
      let ok = await generateSpeech(c.text, f, o.cost, o.voice, o.tts);
      if (!ok) ok = await generateSpeech(c.text, f, o.cost, o.voice, o.tts);
      if (!ok) throw new Error(`Voiceover generation failed (part ${k + 1}/${chunks.length})`);
    } finally { release(o.cost, est); }
    o.onProgress(++done, chunks.length);
    return f;
  });
  // align each chunk on its own, then shift by the running offset. Sequential: parallel CPU whisper runs were
  // measurably less stable; a weak match (whisper stopped early) is retried once.
  const aligned = await mapLimit(chunks, 1, async (c, k) => {
    const d = path.join(dir, `align_${k}`);
    fs.mkdirSync(d, { recursive: true });
    const ratio = () => { try { return Number(JSON.parse(fs.readFileSync(path.join(d, 'words.json'), 'utf8')).matched_ratio ?? 1); } catch { return 1; } };
    let words = await alignWords(files[k], c.text, d, o.language);
    if (ratio() < 0.85) { console.warn(`[long] weak alignment on part ${k + 1} (${ratio()}), retrying`); try { fs.unlinkSync(path.join(d, 'words.json')); } catch { /* ignore */ } words = await alignWords(files[k], c.text, d, o.language); }
    return { words, dur: await probeDuration(files[k]) };
  });
  const words: Word[] = [];
  let off = 0;
  aligned.forEach((a) => { for (const w of a.words) words.push({ w: w.w, start: +(w.start + off).toFixed(3), end: +(w.end + off).toFixed(3) }); off += a.dur; });
  const list = path.join(dir, 'list.txt');
  fs.writeFileSync(list, files.map((f) => `file '${f}'`).join('\n'));
  const audioFile = path.join(workDir, `voiceover_${Date.now()}.mp3`);
  const r = await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'libmp3lame', '-b:a', '192k', audioFile], 15 * 60 * 1000);
  if (r.code !== 0) throw new Error('voiceover concat failed: ' + r.err.slice(-200));
  return { audioFile, words, chunks: chunks.length };
}

// ================================================================== long pipeline
export interface LongPipelineInput extends PipelineInput { targetSeconds: number }
export interface LongPipelineResult extends PipelineResult { chapters: { title: string; start: number }[]; description: string }

export function runLongVideoPipeline(inp: LongPipelineInput): Promise<LongPipelineResult> {
  return withFrame(frameFor(inp.aspect || '16:9'), () => runLong(inp));
}

async function runLong(inp: LongPipelineInput): Promise<LongPipelineResult> {
  const { workDir, cost } = inp;
  fs.mkdirSync(workDir, { recursive: true });
  const ru = String(inp.language).toLowerCase().startsWith('ru');
  const say = (en: string, r: string) => (ru ? r : en);
  const level = normLevel(inp.level);
  const cfg = levelCfg(level);
  const mins = Math.round(inp.targetSeconds / 60);

  inp.onProgress(5, say(`Planning a ${mins}-minute video...`, `Планируем видео на ${mins} мин...`));
  const script = await writeLongScript({
    prompt: inp.prompt, language: inp.language, format: inp.format, targetSeconds: inp.targetSeconds, level, cost, aspect: inp.aspect || '16:9',
    onChapter: (d, t) => inp.onProgress(5 + Math.round((d / t) * 8), say(`Writing the script: chapter ${d}/${t}`, `Пишем сценарий: глава ${d}/${t}`)),
  });
  const scenes = script.scenes;
  const fullScript = scenes.map((s) => s.voiceover_chunk).join(' ');
  console.log(`[long] "${script.outline.title}": ${script.chapters.length} chapters, ${scenes.length} scenes, ${script.words} words`);

  inp.onProgress(14, say('Recording the voiceover...', 'Записываем озвучку...'));
  const vo = await chunkedVoiceover(scenes, workDir, {
    cost, voice: inp.voice || 'alloy', tts: cfg.tts, language: inp.language,
    onProgress: (d, t) => inp.onProgress(14 + Math.round((d / t) * 14), say(`Voiceover ${d}/${t}`, `Озвучка ${d}/${t}`)),
  });
  const duration = await probeDuration(vo.audioFile);
  const words = vo.words;
  const { ranges, boundaries, sceneFrames } = sceneTiming(scenes, words, duration);

  inp.onProgress(30, say('Finding real footage and generating photos...', 'Подбираем реальные видео/фото и генерируем кадры...'));
  const state = { ai: 0, exclude: new Set<string>() };
  const mcfg: LevelCfg = { ...cfg, maxAiPhotos: longAiCap(level, scenes.length) };
  let done = 0;
  await mapLimit(scenes, 4, async (s, i) => {
    if (inp.attachedImages?.[i] && fs.existsSync(inp.attachedImages[i])) s.media = { kind: 'photo', source: 'user', file: inp.attachedImages[i] };
    else s.media = (await mediaForScene(s, i, workDir, cost, mcfg, state)) || undefined;
    done++;
    if (done % 3 === 0 || done === scenes.length) inp.onProgress(30 + Math.round((done / scenes.length) * 36), say(`Visuals ${done}/${scenes.length}`, `Кадры ${done}/${scenes.length}`));
  });
  if (level === 'high') await fulfillHighStock(scenes, workDir, cost, mcfg, state);
  await fillMissingMedia(scenes, workDir);

  const maxOverlays = Math.ceil(script.chapters.length * (level === 'low' ? 0.34 : level === 'high' ? 1 : 0.67));
  await assembleVideo({ scenes, words, duration, audioFile: vo.audioFile, workDir, outVideo: inp.outVideo, outPoster: inp.outPoster, cost, onProgress: inp.onProgress, ru, sceneFrames, ranges, style: inp.style, maxOverlays });
  try { fs.copyFileSync(vo.audioFile, path.join(workDir, 'prev_voiceover.mp3')); } catch { /* ignore */ }

  scenes.forEach((s, i) => { s.text = s.headline?.phrase || s.voiceover_chunk.split(/\s+/).slice(0, 6).join(' '); (s as any).duration = +(boundaries[i + 1] - boundaries[i]).toFixed(2); });
  const chapters = script.chapters.map((c) => ({ title: c.title, start: +(boundaries[c.first_scene] || 0).toFixed(2) }));
  return { title: script.outline.title, description: script.outline.description, scenes, full_script: fullScript, words, audioFile: vo.audioFile, duration, ranges, sceneFrames, chapters };
}

// ================================================================== user uploads: layout + highlights
export interface SourceLayout {
  aspect: '9:16' | '16:9';
  reframe: boolean;            // horizontal source -> vertical output following the subject
  cutTo: number | null;        // target seconds when the video should be cut down (highlights)
  maxSeconds: number;
  reason: string;
}

export function decideSourceLayout(src: { w: number; h: number; duration: number }, prompt: string): SourceLayout {
  const it = detectIntent(prompt);
  const landscapeSrc = src.w > 0 && src.h > 0 && src.w / src.h > 1.05;
  const notes: string[] = [];
  const dur = Math.min(src.duration, MAX_SECONDS);
  if (src.duration > MAX_SECONDS) notes.push(`source longer than ${MAX_SECONDS / 60} min: only the first ${MAX_SECONDS / 60} min are used`);
  // 1. length: explicit duration > Shorts/Reels > "shorten/highlights" > keep everything
  let cutTo: number | null = null;
  if (it.seconds) {
    if (it.seconds < dur - 3) { cutTo = Math.max(5, it.seconds); notes.push(`cut to ${it.seconds}s as requested`); }
    else notes.push(`requested ${it.seconds}s >= source length: nothing cut`);
  } else if (!it.keepFull && it.shortsFormat && dur > 90) { cutTo = 60; notes.push('Shorts/Reels requested -> ~60s of highlights'); }
  else if (it.shorten) {
    const vertical = it.orientation ? it.orientation === 'portrait' : !(landscapeSrc && dur > 300);
    cutTo = vertical ? Math.round(Math.min(90, Math.max(Math.min(dur, 15), dur * 0.4))) : Math.round(Math.min(600, Math.max(60, dur * 0.4)));
    if (cutTo >= dur - 3) cutTo = null; else notes.push(`shorten requested -> ~${cutTo}s of highlights`);
  }
  const outLen = cutTo ?? dur;
  // 2. orientation: explicit request > (horizontal AND long result -> 16:9) > vertical short-form
  let aspect: SourceLayout['aspect'];
  if (it.orientation) { aspect = it.orientation === 'landscape' ? '16:9' : '9:16'; notes.push(`orientation requested (${it.orientation})`); }
  else if (landscapeSrc && outLen > 300) { aspect = '16:9'; notes.push('long horizontal source -> long-form 16:9'); }
  else { aspect = '9:16'; notes.push(landscapeSrc ? 'short horizontal result -> vertical short with Smart Reframe' : dur > 300 ? 'long vertical source -> vertical' : 'vertical short'); }
  if (!cutTo && dur > 300 && aspect === '9:16' && !it.keepFull) notes.push('no length instruction -> full length kept (ask to shorten / cut highlights to trim)');
  return { aspect, reframe: landscapeSrc && aspect === '9:16', cutTo, maxSeconds: dur, reason: notes.join('; ') };
}

function transcriptLines(words: Word[]) {
  const out: string[] = [];
  let cur: string[] = []; let t0 = 0;
  words.forEach((w, i) => {
    if (!cur.length) t0 = w.start;
    cur.push(w.w);
    if (/[.!?]$/.test(w.w) || cur.length >= 18 || i === words.length - 1) { out.push(`[${t0.toFixed(1)}-${w.end.toFixed(1)}s] ${cur.join(' ')}`); cur = []; }
  });
  return out.join('\n');
}

/** Pick the moments to keep (chronological ranges, total ~target seconds). Falls back to the opening when there is no speech. */
export async function selectHighlights(o: { words: Word[]; segments: { start: number; end: number }[]; duration: number; target: number; prompt: string; cost: CostTracker }): Promise<{ start: number; end: number }[]> {
  const fallback = [{ start: 0, end: Math.min(o.duration, o.target) }];
  if (!o.words.length) return fallback;
  let keep: { start: number; end: number }[] = [];
  try {
    const res = await orChat({
      model: MODELS.script, temperature: 0.2, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `You are a professional video editor cutting a long video down to about ${Math.round(o.target)} seconds. Pick the strongest, self-contained moments that best serve the user's request (hook first if possible), keep sentences whole (start/end on the [start-end] stamps), chronological order, each range 4-60 s, total close to ${Math.round(o.target)} s. Return ONLY JSON {"keep":[{"start":seconds,"end":seconds}]}` },
        { role: 'user', content: `Video duration: ${o.duration.toFixed(1)}s\nTranscript:\n${transcriptLines(o.words)}\n\nUser request: "${o.prompt}"` },
      ],
    }, o.cost, 'highlights');
    const j = extractJson(res?.choices?.[0]?.message?.content || '') || {};
    keep = (Array.isArray(j.keep) ? j.keep : []).map((r: any) => ({ start: Number(r.start), end: Number(r.end) }))
      .filter((r: any) => isFinite(r.start) && isFinite(r.end) && r.end - r.start >= 1);
  } catch (e) { console.warn('[highlights]', (e as Error).message); }
  if (!keep.length) return fallback;
  // snap to word boundaries, clamp, merge, cap the total
  const snapStart = (t: number) => { const w = o.words.find((x) => x.end > t); return Math.max(0, (w ? Math.min(w.start, t) : t) - 0.15); };
  const snapEnd = (t: number) => { const ws = o.words.filter((x) => x.start < t); const w = ws[ws.length - 1]; return Math.min(o.duration, (w ? Math.max(w.end, t) : t) + 0.25); };
  keep = keep.map((r) => ({ start: snapStart(Math.max(0, r.start)), end: snapEnd(Math.min(o.duration, r.end)) })).filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const r of keep) { const l = merged[merged.length - 1]; if (l && r.start <= l.end + 0.3) l.end = Math.max(l.end, r.end); else merged.push({ ...r }); }
  const out: { start: number; end: number }[] = [];
  let total = 0;
  for (const r of merged) { if (total >= o.target * 1.25) break; out.push(r); total += r.end - r.start; }
  return out.length ? out : fallback;
}

/** Move word/segment timings onto the cut timeline. */
export function remapToCut<T extends { start: number; end: number }>(items: T[], keep: { start: number; end: number }[]): T[] {
  const out: T[] = [];
  let off = 0;
  for (const r of keep) {
    for (const it of items) if (it.start >= r.start - 0.05 && it.end <= r.end + 0.05) out.push({ ...it, start: +(Math.max(0, it.start - r.start) + off).toFixed(3), end: +(Math.min(r.end, it.end) - r.start + off).toFixed(3) });
    off += r.end - r.start;
  }
  return out;
}
