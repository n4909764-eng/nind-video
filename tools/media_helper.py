#!/usr/bin/env python3
"""Local media helpers for the nind video pipeline (no paid APIs).

Subcommands:
  align  <audio> <script.txt> <out.json> [lang]   word-level timestamps (faster-whisper) aligned to the script text
  rembg  <in.png> <out.png>                      remove background -> transparent PNG, trimmed
  ass    <spec.json> <out.ass>                    build ASS subtitles (word-synced captions + headline captions)
  transcribe <media> <out.json> [lang]            word-level transcript of any audio/video (faster-whisper)
  card   <in> <out.png> <w> <h> <radius> [border]  photo card (cover-crop, rounded corners, white border) -> PNG
"""
import json, os, re, sys, difflib

FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fonts')


# ----------------------------------------------------------------- align
def _norm(w):
    return re.sub(r"[^\w]+", "", w.lower(), flags=re.UNICODE)


def cmd_align(audio, script_path, out_path, lang=None):
    from faster_whisper import WhisperModel
    script = open(script_path, encoding='utf-8').read().strip()
    tokens = script.split()
    model = WhisperModel(os.environ.get('WHISPER_MODEL', 'base'), device='cpu', compute_type='int8')
    import subprocess, numpy as np
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', audio, '-f', 's16le', '-ac', '1', '-ar', '16000', '-'],
                         capture_output=True, check=True).stdout
    samples = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768.0
    segs, info = model.transcribe(samples, word_timestamps=True, language=(lang or None),
                                  vad_filter=False, beam_size=5)
    hw = []
    for s in segs:
        for w in (s.words or []):
            hw.append({'w': w.word.strip(), 'start': float(w.start), 'end': float(w.end)})
    a = [_norm(t) for t in tokens]
    b = [_norm(x['w']) for x in hw]
    times = [None] * len(tokens)
    sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == 'equal':
            for k in range(i2 - i1):
                times[i1 + k] = (hw[j1 + k]['start'], hw[j1 + k]['end'])
        elif tag == 'replace' and j2 > j1:
            # spread the hypothesis span evenly over the script span
            st, en = hw[j1]['start'], hw[j2 - 1]['end']
            n = i2 - i1
            for k in range(n):
                times[i1 + k] = (st + (en - st) * k / n, st + (en - st) * (k + 1) / n)
    # interpolate gaps (deleted words)
    dur = hw[-1]['end'] if hw else 0.0
    i = 0
    while i < len(tokens):
        if times[i] is None:
            j = i
            while j < len(tokens) and times[j] is None:
                j += 1
            st = times[i - 1][1] if i > 0 else 0.0
            en = times[j][0] if j < len(tokens) else max(st + 0.3 * (j - i), dur)
            n = j - i
            for k in range(n):
                times[i + k] = (st + (en - st) * k / n, st + (en - st) * (k + 1) / n)
            i = j
        else:
            i += 1
    words = [{'w': t, 'start': round(times[k][0], 3), 'end': round(times[k][1], 3)} for k, t in enumerate(tokens)]
    matched = sum(1 for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag == 'equal' for _ in range(i2 - i1))
    json.dump({'words': words, 'language': info.language, 'matched_ratio': round(matched / max(1, len(tokens)), 3),
               'whisper_words': len(hw)}, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False)
    print(json.dumps({'ok': True, 'words': len(words), 'matched_ratio': round(matched / max(1, len(tokens)), 3)}))


# ----------------------------------------------------------------- rembg
def cmd_rembg(inp, out):
    from rembg import remove, new_session
    from PIL import Image
    im = Image.open(inp).convert('RGBA')
    res = remove(im, session=new_session('u2net'))
    bbox = res.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
    if bbox:
        res = res.crop(bbox)
    res.save(out)
    print(json.dumps({'ok': True, 'size': res.size}))


# ----------------------------------------------------------------- ass
class Measurer:
    def __init__(self, font_file):
        from fontTools.ttLib import TTFont
        from PIL import ImageFont
        f = TTFont(font_file)
        os2 = f['OS/2']
        self.ratio = f['head'].unitsPerEm / float(os2.usWinAscent + os2.usWinDescent)
        self.file = font_file
        self._cache = {}
        self.ImageFont = ImageFont

    def width(self, text, ass_size):
        em = max(1, int(round(ass_size * self.ratio)))
        if em not in self._cache:
            self._cache[em] = self.ImageFont.truetype(self.file, em)
        return self._cache[em].getlength(text)


def ts(t):
    t = max(0.0, t)
    h = int(t // 3600); m = int((t % 3600) // 60); s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def esc(t):
    return t.replace('\\', '\\\\').replace('{', '(').replace('}', ')').replace('\n', ' ')


def _hex(h):
    h = str(h or '#FFFFFF').strip().lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    try:
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))
    except Exception:
        return (255, 255, 255)


def _lum(rgb):
    r, g, b = [x / 255.0 for x in rgb]
    return 0.299 * r + 0.587 * g + 0.114 * b


def _ass(rgb, alpha=0):
    r, g, b = rgb
    return f"&H{alpha:02X}{b:02X}{g:02X}{r:02X}"


def cmd_ass(spec_path, out_path):
    spec = json.load(open(spec_path, encoding='utf-8'))
    W, H = spec.get('width', 720), spec.get('height', 1280)
    words = spec['words']
    total = spec.get('duration', words[-1]['end'] + 0.5 if words else 1)
    headlines = spec.get('headlines', [])  # [{start_idx, end_idx, highlight_idx}]
    st = spec.get('style') or {}
    sub_fs = int(spec.get('sub_font_size', 62) * float(st.get('sub_scale', 1.0)))
    hl_fs = int(spec.get('headline_font_size', 104) * float(st.get('head_scale', 1.0)))
    sub_file = st.get('sub_font_file') or os.path.join(FONT_DIR, 'Inter-Bold.ttf')
    head_file = st.get('head_font_file') or os.path.join(FONT_DIR, 'Inter-ExtraBold.ttf')
    sub_fam = st.get('sub_font_family') or 'Inter'
    head_fam = st.get('head_font_family') or 'Inter ExtraBold'
    sub_b = '-1' if st.get('sub_bold', True) else '0'
    head_b = '-1' if st.get('head_bold', True) else '0'
    hi_rgb = _hex(st.get('highlight_color') or '#FFFFFF')
    hi_txt = _hex(st.get('highlight_text_color')) if st.get('highlight_text_color') else ((20, 20, 20) if _lum(hi_rgb) > 0.6 else (255, 255, 255))
    sub_rgb = _hex(st.get('subtitle_color') or '#FFFFFF')
    head_rgb = _hex(st.get('headline_color') or '#FFFFFF')
    show_subs = st.get('subtitles', True) is not False
    show_heads = st.get('headlines', True) is not False
    if not show_heads:
        headlines = []
    m_bold = Measurer(sub_file)
    m_xb = Measurer(head_file)

    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,{sub_fam},{sub_fs},{_ass(sub_rgb)},{_ass(sub_rgb)},&H00000000,&H00000000,{sub_b},0,0,0,100,100,0,0,1,0,0,5,20,20,20,1
Style: SubShadow,{sub_fam},{sub_fs},&H90000000,&H90000000,&H00000000,&H00000000,{sub_b},0,0,0,100,100,0,0,1,0,0,5,20,20,20,1
Style: Head,{head_fam},{hl_fs},{_ass(head_rgb)},{_ass(head_rgb)},&H00000000,&H00000000,{head_b},0,0,0,100,100,0,0,1,0,0,5,20,20,20,1
Style: HeadShadow,{head_fam},{hl_fs},&H90000000,&H90000000,&H00000000,&H00000000,{head_b},0,0,0,100,100,0,0,1,0,0,5,20,20,20,1
Style: HeadBox,{head_fam},{hl_fs},{_ass(hi_txt)},{_ass(hi_txt)},{_ass(hi_rgb)},&H00000000,{head_b},0,0,0,100,100,0,0,3,12,0,5,20,20,20,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    ev = []
    in_head = [False] * len(words)
    for h in headlines:
        for k in range(h['start_idx'], h['end_idx'] + 1):
            if 0 <= k < len(words):
                in_head[k] = True

    def reveal_text(chunk, t0, shadow):
        parts = []
        for w in chunk:
            dt = int(round((w['start'] - t0) * 1000))
            if shadow:
                parts.append(f"{{\\1a&HFF&\\t({max(0,dt)},{max(0,dt)+90},\\1a&H90&)}}{esc(w['w'])}")
            else:
                parts.append(f"{{\\alpha&HFF&\\t({max(0,dt)},{max(0,dt)+90},\\alpha&H00&)}}{esc(w['w'])}")
        return ' '.join(parts)

    # --- regular subtitles: short chunks (<=3 words / ~20 chars), each word appears exactly when spoken
    sub_y = int(H * 0.72)
    chunks, cur = [], []
    for k, w in enumerate(words):
        if in_head[k]:
            if cur: chunks.append(cur); cur = []
            continue
        cand = cur + [w]
        txt = ' '.join(x['w'] for x in cand)
        if cur and (len(cand) > 3 or m_bold.width(txt, sub_fs) > W - 90 or re.search(r'[.!?;:,]$', cur[-1]['w'])):
            chunks.append(cur); cur = [w]
        else:
            cur = cand
    if cur: chunks.append(cur)
    starts = [c[0]['start'] for c in chunks]
    head_starts = sorted(words[h['start_idx']]['start'] for h in headlines if 0 <= h['start_idx'] < len(words))
    for ci, c in enumerate(chunks if show_subs else []):
        t0 = c[0]['start']
        nxt = [s for s in starts[ci + 1:ci + 2]] + [s for s in head_starts if s > t0]
        t1 = min([c[-1]['end'] + 0.35] + nxt + [total])
        ev.append(f"Dialogue: 0,{ts(t0)},{ts(t1)},SubShadow,,0,0,0,,{{\\pos({W//2},{sub_y+3})\\blur5}}{reveal_text(c, t0, True)}")
        ev.append(f"Dialogue: 1,{ts(t0)},{ts(t1)},Sub,,0,0,0,,{{\\pos({W//2},{sub_y})}}{reveal_text(c, t0, False)}")

    # --- headline captions: big stacked lines, key word gets a sharp white box wiping in left->right
    for hi, h in enumerate(headlines):
        si, ei, ki = h['start_idx'], h['end_idx'], h.get('highlight_idx', -1)
        if si < 0 or ei >= len(words) or si > ei:
            continue
        hw = words[si:ei + 1]
        lines, cur = [], []
        for k, w in enumerate(hw, start=si):
            if k == ki:
                if cur: lines.append(cur)
                lines.append([(k, w)]); cur = []
                continue
            cand = cur + [(k, w)]
            if cur and m_xb.width(' '.join(x[1]['w'] for x in cand), hl_fs) > W - 100:
                lines.append(cur); cur = [(k, w)]
            else:
                cur = cand
        if cur: lines.append(cur)
        t0 = hw[0]['start']
        later = [words[x['start_idx']]['start'] for x in headlines if words[x['start_idx']]['start'] > t0]
        nxt_sub = [s for s in starts if s > hw[-1]['end']]
        t1 = min([hw[-1]['end'] + 0.9] + later + nxt_sub[:1] + [total])
        t1 = max(t1, hw[-1]['end'] + 0.15)
        lh = hl_fs * 1.12
        top = H * 0.44 - lh * (len(lines) - 1) / 2
        for li, line in enumerate(lines):
            y = int(top + li * lh)
            fs = hl_fs
            txt_w = m_xb.width(' '.join(x[1]['w'] for x in line), fs)
            if txt_w > W - 60:  # very long single word: shrink
                fs = int(fs * (W - 60) / txt_w)
            ws = [x[1] for x in line]
            body = reveal_text(ws, t0, False)
            sh = reveal_text(ws, t0, True)
            ev.append(f"Dialogue: 2,{ts(t0)},{ts(t1)},HeadShadow,,0,0,0,,{{\\pos({W//2},{y+4})\\blur6\\fs{fs}}}{sh}")
            ev.append(f"Dialogue: 3,{ts(t0)},{ts(t1)},Head,,0,0,0,,{{\\pos({W//2},{y})\\fs{fs}}}{body}")
            if len(line) == 1 and line[0][0] == ki:
                w = line[0][1]
                ww = m_xb.width(w['w'], fs)
                pad = 12
                x0 = int(W / 2 - ww / 2 - pad - 6); x1 = int(W / 2 + ww / 2 + pad + 6)
                y0 = int(y - fs * 0.62); y1 = int(y + fs * 0.62)
                d0 = max(0, int(round((w['start'] - t0) * 1000)))
                d1 = d0 + 380
                ev.append(f"Dialogue: 4,{ts(t0)},{ts(t1)},HeadBox,,0,0,0,,{{\\pos({W//2},{y})\\fs{fs}\\clip({x0},{y0},{x0},{y1})\\t({d0},{d1},0.55,\\clip({x0},{y0},{x1},{y1}))}}{esc(w['w'])}")

    open(out_path, 'w', encoding='utf-8').write(head + '\n'.join(ev) + '\n')
    print(json.dumps({'ok': True, 'events': len(ev), 'chunks': len(chunks), 'headlines': len(headlines)}))


# ----------------------------------------------------------------- transcribe
def cmd_transcribe(media, out_path, lang=None):
    from faster_whisper import WhisperModel
    import subprocess, numpy as np
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', media, '-vn', '-f', 's16le', '-ac', '1', '-ar', '16000', '-'],
                         capture_output=True).stdout
    words, segs_out, language = [], [], None
    if len(pcm) > 32000:
        samples = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768.0
        model = WhisperModel(os.environ.get('WHISPER_MODEL', 'base'), device='cpu', compute_type='int8')
        segs, info = model.transcribe(samples, word_timestamps=True, language=(lang or None), vad_filter=True, beam_size=5)
        language = info.language
        for s in segs:
            seg_words = []
            for w in (s.words or []):
                t = w.word.strip()
                if not t:
                    continue
                seg_words.append(len(words))
                words.append({'w': t, 'start': round(float(w.start), 3), 'end': round(float(w.end), 3), 'p': round(float(w.probability or 0), 3)})
            if seg_words:
                segs_out.append({'text': s.text.strip(), 'start': round(float(s.start), 3), 'end': round(float(s.end), 3),
                                 'from': seg_words[0], 'to': seg_words[-1]})
    # very low confidence => treat as no speech (music only)
    if words and sum(w['p'] for w in words) / len(words) < 0.35:
        words, segs_out = [], []
    json.dump({'words': words, 'segments': segs_out, 'language': language}, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False)
    print(json.dumps({'ok': True, 'words': len(words), 'language': language}))


# ----------------------------------------------------------------- card
def cmd_card(inp, out, w, h, radius, border='6'):
    from PIL import Image, ImageDraw, ImageOps
    w, h, radius, border = int(w), int(h), int(radius), int(border)
    im = Image.open(inp).convert('RGB')
    im = ImageOps.fit(im, (w, h), method=Image.LANCZOS)
    W2, H2 = w + 2 * border, h + 2 * border
    canvas = Image.new('RGBA', (W2, H2), (0, 0, 0, 0))
    mask_outer = Image.new('L', (W2, H2), 0)
    ImageDraw.Draw(mask_outer).rounded_rectangle([0, 0, W2 - 1, H2 - 1], radius=radius + border if radius else 0, fill=255)
    white = Image.new('RGBA', (W2, H2), (255, 255, 255, 255))
    canvas.paste(white, (0, 0), mask_outer)
    mask_in = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask_in).rounded_rectangle([0, 0, w - 1, h - 1], radius=radius, fill=255)
    canvas.paste(im, (border, border), mask_in)
    canvas.save(out)
    print(json.dumps({'ok': True, 'size': [W2, H2]}))


if __name__ == '__main__':
    c = sys.argv[1]
    if c == 'align':
        cmd_align(*sys.argv[2:])
    elif c == 'rembg':
        cmd_rembg(*sys.argv[2:])
    elif c == 'ass':
        cmd_ass(*sys.argv[2:])
    elif c == 'transcribe':
        cmd_transcribe(*sys.argv[2:])
    elif c == 'card':
        cmd_card(*sys.argv[2:])
    else:
        sys.exit('unknown command')
