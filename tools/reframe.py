"""
nind Smart Reframe: find the main subject of a horizontal video and produce a smooth
horizontal crop path for a vertical (9:16) output.

usage: reframe.py analyze <video> <out.json> <src_w> <src_h> <crop_w> [sample_fps] [max_seconds]

Frames are decoded by ffmpeg (so rotation is handled exactly like in the final render),
downscaled to 640px wide and analysed at `sample_fps` (default 6):
  1. faces (OpenCV Haar frontal + profile), 2. people (HOG), 3. saliency (motion + edges).
Shot changes (HSV histogram jumps) reset the virtual camera. Inside a shot the camera
holds still while the subject stays in a central dead-zone and otherwise follows with a
speed limit, then a gaussian pass removes jitter.
Output JSON: {"fps": sample_fps, "x": [crop left edge in source pixels per sample], ...}
"""
import json, subprocess, sys
import numpy as np
import cv2


def _frames(video, sw, sh, fps, max_s):
    cmd = ['ffmpeg', '-v', 'error', '-i', video]
    if max_s:
        cmd += ['-t', str(max_s)]
    cmd += ['-vf', f'fps={fps},scale={sw}:{sh}', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-']
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    n = sw * sh * 3
    while True:
        buf = p.stdout.read(n)
        if len(buf) < n:
            break
        yield np.frombuffer(buf, np.uint8).reshape(sh, sw, 3)
    p.wait()


def _gauss(a, sigma):
    if sigma <= 0 or len(a) < 3:
        return a
    r = int(sigma * 3)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    pad = np.pad(a, r, mode='edge')
    return np.convolve(pad, k, mode='valid')


def analyze(video, out_json, src_w, src_h, crop_w, fps='6', max_s='0'):
    src_w, src_h, crop_w, fps, max_s = int(src_w), int(src_h), int(crop_w), float(fps), float(max_s)
    sw = 640
    sh = max(2, int(round(sw * src_h / src_w / 2)) * 2)
    cw_n = crop_w / src_w  # crop width as a fraction of the frame width
    fr = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    pf = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_profileface.xml')
    hog = cv2.HOGDescriptor()
    hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

    raw, conf, methods, cuts = [], [], {'face': 0, 'person': 0, 'saliency': 0, 'none': 0}, [0]
    prev_gray, prev_hist, last_c = None, None, None
    for i, f in enumerate(_frames(video, sw, sh, fps, max_s)):
        gray = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY)
        hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0, 1], None, [32, 32], [0, 180, 0, 256])
        cv2.normalize(hist, hist)
        if prev_hist is not None and cv2.compareHist(prev_hist, hist, cv2.HISTCMP_CORREL) < 0.55:
            cuts.append(i)
            last_c = None
        prev_hist = hist
        eq = cv2.equalizeHist(gray)
        min_face = max(24, sh // 14)
        boxes = list(fr.detectMultiScale(eq, 1.1, 6, minSize=(min_face, min_face)))
        for flip in ((False, True) if not boxes else ()):  # profiles only when no frontal face
            img = cv2.flip(eq, 1) if flip else eq
            for (x, y, w, h) in pf.detectMultiScale(img, 1.1, 6, minSize=(min_face, min_face)):
                boxes.append((sw - x - w, y, w, h) if flip else (x, y, w, h))
        c, kind = None, None
        if boxes:
            # biggest face wins; a face close to the previous subject gets a bonus (no ping-pong between people)
            def score(b):
                x, y, w, h = b
                cx = (x + w / 2) / sw
                bonus = 1.0 if last_c is None else 1.0 + 1.5 * max(0.0, 1 - abs(cx - last_c) / 0.25)
                return w * h * bonus
            x, y, w, h = max(boxes, key=score)
            c, kind = (x + w / 2) / sw, 'face'
        else:
            people, weights = hog.detectMultiScale(f, winStride=(8, 8), padding=(8, 8), scale=1.06)
            good = [(b, wt) for b, wt in zip(people, np.ravel(weights) if len(people) else []) if wt > 0.6]
            if good:
                (x, y, w, h), _ = max(good, key=lambda t: t[0][2] * t[0][3] * t[1])
                c, kind = (x + w / 2) / sw, 'person'
        if c is None:
            # saliency: motion + edge energy per column, best crop-wide window
            gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
            gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
            energy = cv2.magnitude(gx, gy)
            if prev_gray is not None and (len(cuts) == 0 or cuts[-1] != i):
                energy = energy * 0.4 + cv2.absdiff(gray, prev_gray).astype(np.float32) * 4.0
            col = energy.sum(axis=0)
            win = max(3, int(cw_n * sw))
            if col.sum() > 1e-3:
                s = np.convolve(col, np.ones(win), mode='valid')
                c, kind = (int(np.argmax(s)) + win / 2) / sw, 'saliency'
        prev_gray = gray
        methods[kind or 'none'] += 1
        raw.append(np.nan if c is None else c)
        conf.append({'face': 1.0, 'person': 0.7, 'saliency': 0.25}.get(kind, 0.0))
        if kind in ('face', 'person'):
            last_c = c

    n = len(raw)
    if n == 0:
        json.dump({'fps': fps, 'x': [], 'n': 0}, open(out_json, 'w')); print(json.dumps({'ok': True, 'n': 0})); return
    raw, conf = np.array(raw, dtype=float), np.array(conf)
    cuts = sorted(set(cuts)) + [n]
    path = np.zeros(n)
    half = cw_n / 2
    for a, b in zip(cuts[:-1], cuts[1:]):
        seg, cf = raw[a:b].copy(), conf[a:b]
        strong = cf >= 0.7
        # inside a shot: trust faces/people; saliency only if the shot has no subject at all
        use = strong if strong.any() else ~np.isnan(seg)
        idx = np.where(use)[0]
        if len(idx) == 0:
            seg[:] = 0.5
        else:
            seg = np.interp(np.arange(len(seg)), idx, seg[idx])
        # median filter against single-frame false positives
        k = 2
        med = np.array([np.median(seg[max(0, j - k):j + k + 1]) for j in range(len(seg))])
        # virtual camera: dead-zone + speed limit (fraction of frame width per second)
        dead, vmax = cw_n * 0.18, 0.6 / fps
        cam = np.zeros(len(med)); p = med[0]
        for j, t in enumerate(med):
            d = t - p
            if abs(d) > dead:
                step = np.sign(d) * min(abs(d) - dead * 0.5, vmax)
                p += step
            cam[j] = p
        cam = _gauss(cam, sigma=max(1.0, fps * 0.35))
        path[a:b] = np.clip(cam, half, 1 - half)
    xs = [int(round((c - half) * src_w / 2)) * 2 for c in path]
    xs = [max(0, min(src_w - crop_w, x)) for x in xs]
    json.dump({'fps': fps, 'x': xs, 'n': n, 'shots': len(cuts) - 1, 'methods': methods, 'crop_w': crop_w,
               'src': [src_w, src_h]}, open(out_json, 'w'))
    print(json.dumps({'ok': True, 'n': n, 'shots': len(cuts) - 1, 'methods': methods}))


if __name__ == '__main__':
    if sys.argv[1] == 'analyze':
        analyze(*sys.argv[2:])
    else:
        raise SystemExit('unknown command')
