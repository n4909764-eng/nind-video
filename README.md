# nind ai

Create video content. Edit video content. With nind AI.

React 19 + Vite front end, Express API (`server.ts`, run with `tsx`), ffmpeg rendering, OpenRouter models, local Python helpers (faster-whisper, rembg, fontTools/Pillow).

## Run locally

```bash
npm install
python3 -m venv .venv && .venv/bin/pip install faster-whisper "rembg[cpu]" fonttools pillow numpy
cp .env.example .env   # set OPENROUTER_API_KEY and MEDIA_PYTHON=.venv/bin/python
npm run build && npm start          # production (serves dist/) on $PORT
# or: npm run dev                   # Vite middleware
```
ffmpeg/ffprobe must be on PATH.

## Pipelines

* **Create** (`POST /api/video/generate`): script → TTS → whisper word timing → per-scene media (relevance-checked stock video/photo, photoreal AI photo fallback) → overlays → word-synced subtitles + headline captions.
  `level`: `low` (stock first, ≤2 cheap AI photos), `default`, `high` (`openai/gpt-audio`, HD stock, stricter vision threshold, more AI photos).
* **Edit a created video** (`POST /api/video/:id/modify`): the request is turned into minimal JSON ops (`style`, `replace_visual`, `set_overlay`, `set_headline`, `narration`, `voice`, …) and only changed assets are re-made; scene clips are cached, voice/timings are reused. A failed edit keeps the previous video.
* **Edit the user's own footage** (generate with `source_video_url`): normalise to 9:16, whisper transcript, planned headlines / popup photo cards (rounded, square) / fullscreen stock cut-aways / sticker overlays, original audio kept; `translate_to` gives translated subtitles or AI dubbing.
* Caption fonts (OFL, bundled in `fonts/`): Inter, Montserrat, Roboto, Oswald, Bebas Neue, Playfair Display, Anton. Highlight colour, subtitle/headline colour and size can be changed by edit request.

## Credits

$0.01 of real API cost = 1 credit, charged after the job; each job has a spending budget = the user's available balance (capped per level), so a welcome user with 20 credits can always finish a video (fewer AI images when the balance is low).

## Environment

| var | default | |
|---|---|---|
| `OPENROUTER_API_KEY` | – | required |
| `MEDIA_PYTHON` | `python3` | python with the helpers' packages |
| `PEXELS_API_KEY`, `PIXABAY_API_KEY` | – | optional stock sources (Wikimedia + Openverse need no key) |
| `SCRIPT_MODEL` / `TTS_MODEL` / `TTS_MODEL_HIGH` / `IMAGE_MODEL` / `IMAGE_MODEL_LOW` / `OVERLAY_IMAGE_MODEL` / `VISION_MODEL` | gpt-4o-mini / gpt-audio-mini / gpt-audio / gemini-3.1-flash-image / gemini-2.5-flash-image / gemini-2.5-flash-image / gemini-2.5-flash-lite | |
| `WHISPER_MODEL` | `base` | |
| `WELCOME_CREDITS` | 20 | |
| `MIN_GENERATION_CREDITS` / `MIN_EDIT_CREDITS` | 10 / 3 | |
| `WHOP_TOPUP_CHECKOUT_URL` | – | top-up checkout (TODO: real Whop integration in `/api/topup`) |
| `PORT` | 3000 | |
