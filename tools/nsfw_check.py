#!/usr/bin/env python3
"""Local NSFW check for uploaded / generated media (free, CPU only).

Model: Falconsai/nsfw_image_detection (ViT-base) as int8 ONNX
(onnx-community/nsfw_image_detection-ONNX, ~85 MB). Weights are downloaded once
into NSFW_MODEL_DIR (default: <project>/models/nsfw) and reused.

Usage: nsfw_check.py <file> [<file> ...]
Prints one JSON object: {"ok": true, "results": [{"path", "kind", "frames", "max", "flagged", "scores"}], "ms": N}
Videos: up to 12 evenly spaced frames + keyframes (encoders put keyframes on scene
cuts), capped at NSFW_MAX_FRAMES (default 24), all at 224px.
"""
import json, os, subprocess, sys, tempfile, time, urllib.request, glob

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.environ.get('NSFW_MODEL_DIR') or os.path.join(os.path.dirname(HERE), 'models', 'nsfw')
MODEL_FILE = os.path.join(MODEL_DIR, 'model_quantized.onnx')
MODEL_URL = 'https://huggingface.co/onnx-community/nsfw_image_detection-ONNX/resolve/main/onnx/model_quantized.onnx'
MAX_FRAMES = int(os.environ.get('NSFW_MAX_FRAMES', '24'))
EVEN_FRAMES = 12
IMG_EXT = ('.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.heic', '.heif', '.avif')
VID_EXT = ('.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.3gp')


def ensure_model():
    if os.path.exists(MODEL_FILE) and os.path.getsize(MODEL_FILE) > 10_000_000:
        return
    os.makedirs(MODEL_DIR, exist_ok=True)
    tmp = MODEL_FILE + '.part'
    urllib.request.urlretrieve(MODEL_URL, tmp)
    os.replace(tmp, MODEL_FILE)


_sess = None
def session():
    global _sess
    if _sess is None:
        import onnxruntime as ort
        ensure_model()
        o = ort.SessionOptions()
        o.intra_op_num_threads = int(os.environ.get('NSFW_THREADS', '4'))
        _sess = ort.InferenceSession(MODEL_FILE, o, providers=['CPUExecutionProvider'])
    return _sess


def prep(img):
    import numpy as np
    from PIL import Image
    img = img.convert('RGB').resize((224, 224), Image.BILINEAR)
    a = (np.asarray(img, dtype=np.float32) / 255.0 - 0.5) / 0.5
    return a.transpose(2, 0, 1)


def score(images):
    import numpy as np
    if not images:
        return []
    s = session()
    name = s.get_inputs()[0].name
    out = []
    for i in range(0, len(images), 8):
        batch = np.stack([prep(im) for im in images[i:i + 8]]).astype(np.float32)
        logits = s.run(None, {name: batch})[0]
        e = np.exp(logits - logits.max(axis=1, keepdims=True))
        p = e / e.sum(axis=1, keepdims=True)
        out += [float(x) for x in p[:, 1]]  # label 1 = nsfw
    return out


def load_image(path):
    from PIL import Image
    try:
        return [Image.open(path)]
    except Exception:
        # HEIC/AVIF etc. without a Pillow plugin: let ffmpeg decode it
        return video_frames(path, still=True)


def duration(path):
    try:
        r = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                           capture_output=True, text=True, timeout=30)
        return float(r.stdout.strip() or 0)
    except Exception:
        return 0.0


def video_frames(path, still=False):
    from PIL import Image
    tmp = tempfile.mkdtemp(prefix='nsfw_')
    frames = []
    try:
        vf = 'scale=224:224:force_original_aspect_ratio=decrease'
        if still:
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', path, '-frames:v', '1', '-vf', vf, f'{tmp}/s.png'], timeout=60)
        else:
            d = duration(path)
            n = EVEN_FRAMES if d > 1 else 1
            procs = []
            # keyframes only (cheap: no full decode); x264/phone encoders place them on scene cuts
            procs.append(subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-skip_frame', 'nokey', '-i', path, '-vf', vf,
                                           '-vsync', 'vfr', '-frames:v', '400', f'{tmp}/k%04d.jpg']))
            # evenly spaced frames (fast input seeking), run in parallel
            for k in range(n):
                t = d * (k + 0.5) / n if d > 0 else 0
                procs.append(subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-threads', '1', '-ss', f'{t:.2f}', '-i', path,
                                               '-frames:v', '1', '-vf', vf, f'{tmp}/e{k:03d}.jpg']))
            deadline = time.time() + 300
            for pr in procs:
                try:
                    pr.wait(timeout=max(1, deadline - time.time()))
                except Exception:
                    pr.kill()
        files = sorted(glob.glob(f'{tmp}/e*.jpg')) + sorted(glob.glob(f'{tmp}/s.png'))
        keys = sorted(glob.glob(f'{tmp}/k*.jpg'))
        room = max(0, MAX_FRAMES - len(files))
        if len(keys) > room and room > 0:
            step = len(keys) / room
            keys = [keys[int(i * step)] for i in range(room)]
        elif room == 0:
            keys = []
        for f in files + keys:
            try:
                im = Image.open(f); im.load(); frames.append(im)
            except Exception:
                pass
    finally:
        for f in glob.glob(f'{tmp}/*'):
            try: os.remove(f)
            except Exception: pass
        try: os.rmdir(tmp)
        except Exception: pass
    return frames


def main():
    t0 = time.time()
    results = []
    for path in sys.argv[1:]:
        low = path.lower()
        kind = 'video' if low.endswith(VID_EXT) else 'image' if low.endswith(IMG_EXT) else 'other'
        if kind == 'other' or not os.path.exists(path):
            results.append({'path': path, 'kind': kind, 'frames': 0, 'max': 0.0, 'scores': []})
            continue
        imgs = video_frames(path) if kind == 'video' else load_image(path)
        sc = score(imgs)
        results.append({'path': path, 'kind': kind, 'frames': len(sc), 'max': max(sc) if sc else 0.0,
                        'scores': [round(x, 4) for x in sc]})
    print(json.dumps({'ok': True, 'results': results, 'ms': int((time.time() - t0) * 1000)}))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(json.dumps({'ok': False, 'error': str(e)[:300]}))
        sys.exit(1)
