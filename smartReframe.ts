/**
 * Smart Reframe: horizontal footage -> vertical 9:16 that follows the main subject
 * (faces -> people -> saliency, smoothed virtual camera; see tools/reframe.py).
 * Also: rotation-aware probing of uploaded videos.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { run, ffmpeg, pyBin, probeDuration, FPS, withCleanOutput, stripProvenance } from './videoPipeline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REFRAME_HELPER = path.resolve(__dirname, 'tools/reframe.py');

export interface VideoProbe { w: number; h: number; duration: number; rotation: number }

/** Display size (rotation applied, as ffmpeg autorotate renders it) and duration. */
export async function probeVideo(file: string): Promise<VideoProbe> {
  const r = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_tags=rotate:stream_side_data=rotation', '-of', 'json', file]);
  let w = 0, h = 0, rotation = 0;
  try {
    const s = JSON.parse(r.out).streams?.[0] || {};
    w = Number(s.width) || 0; h = Number(s.height) || 0;
    rotation = Number(s.tags?.rotate ?? (s.side_data_list || []).find((d: any) => d.rotation !== undefined)?.rotation ?? 0) || 0;
  } catch { /* no video stream */ }
  if (Math.abs(rotation) % 180 === 90) [w, h] = [h, w];
  return { w, h, duration: await probeDuration(file), rotation };
}

export interface ReframeResult { ok: boolean; method: string; samples?: number; shots?: number; methods?: Record<string, number>; cropW?: number }

/**
 * Render `src` as a vertical out.w x out.h video whose crop window follows the subject.
 * Returns ok=false when the source is not wider than 9:16 (caller falls back to its own fit).
 */
export async function smartReframe(src: string, outFile: string, workDir: string, out: { w: number; h: number }, maxSeconds = 0, extraArgs: string[] = []): Promise<ReframeResult> {
  const pr = await probeVideo(src);
  if (!(pr.w > 0 && pr.h > 0)) return { ok: false, method: 'no-video' };
  const cropW = Math.floor((pr.h * out.w) / out.h / 2) * 2;
  if (cropW >= pr.w - 4) return { ok: false, method: 'not-wide' };
  const json = path.join(workDir, 'reframe_track.json');
  const sampleFps = pr.duration > 600 ? 3 : pr.duration > 180 ? 4 : 6;
  const a = await run(pyBin(), [REFRAME_HELPER, 'analyze', src, json, String(pr.w), String(pr.h), String(cropW), String(sampleFps), String(maxSeconds || 0)],
    { timeoutMs: Math.max(5 * 60 * 1000, (maxSeconds || pr.duration) * 1500) });
  let xs: number[] = [];
  let info: any = {};
  if (a.code === 0 && fs.existsSync(json)) {
    try { info = JSON.parse(fs.readFileSync(json, 'utf8')); xs = info.x || []; } catch { /* ignore */ }
  } else console.warn('[reframe] analysis failed, using centre crop:', a.err.slice(-300));
  const center = Math.floor((pr.w - cropW) / 4) * 2;
  if (!xs.length) xs = [center];
  // per output frame command list (only when x changes), linear interpolation between samples
  const cmds: string[] = [];
  const total = Math.ceil((maxSeconds || pr.duration) * FPS);
  let lastX = -1;
  for (let f = 0; f < total; f++) {
    const t = f / FPS;
    const p = t * (info.fps || sampleFps);
    const i0 = Math.min(xs.length - 1, Math.floor(p));
    const i1 = Math.min(xs.length - 1, i0 + 1);
    const x = Math.round((xs[i0] + (xs[i1] - xs[i0]) * (p - i0)) / 2) * 2;
    if (x !== lastX) { cmds.push(`${t.toFixed(4)} crop@rf x ${x};`); lastX = x; }
  }
  const cmdFile = path.join(workDir, 'reframe_cmds.txt');
  fs.writeFileSync(cmdFile, cmds.join('\n') + '\n');
  const esc = (p: string) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const vf = `[0:v]setpts=PTS-STARTPTS,fps=${FPS},sendcmd=f='${esc(cmdFile)}',crop@rf=w=${cropW}:h=${pr.h}:x=${xs[0]}:y=0,scale=${out.w}:${out.h}:flags=lanczos,setsar=1[v]`;
  const r = await ffmpeg(withCleanOutput(['-i', src, ...(maxSeconds ? ['-t', String(maxSeconds)] : []), '-filter_complex', vf, '-map', '[v]', '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', ...extraArgs, outFile]), Math.max(10 * 60 * 1000, (maxSeconds || pr.duration) * 3000));
  if (r.code !== 0 || !fs.existsSync(outFile)) { console.warn('[reframe] render failed:', r.err.slice(-300)); return { ok: false, method: 'render-failed' }; }
  await stripProvenance(outFile);
  const m = info.methods || {};
  const method = (m.face || 0) >= (m.person || 0) && (m.face || 0) > 0 ? 'face' : (m.person || 0) > 0 ? 'person' : (m.saliency || 0) > 0 ? 'saliency' : 'center';
  return { ok: true, method, samples: info.n, shots: info.shots, methods: m, cropW };
}
