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
| `WHOP_API_KEY` | – | Whop company API key (checkout links with the user id in metadata) |
| `WHOP_WEBHOOK_SECRET` | – | signing secret (`ws_…`) of the Whop webhook |
| `PUBLIC_URL` | request host | e.g. `https://nind.pro`, used for the post-checkout redirect |
| `WHOP_PLAN_*` | built-in ids | optional plan id overrides (see `.env.example`) |
| `WHOP_TOPUP_CHECKOUT_URL` | – | top-up checkout (TODO: Top Up prices not set yet; `/api/topup` is a stub) |
| `PORT` | 3000 | |

## Subscriptions (Whop)

Whop business **nind ai** (`biz_Vu32WsCrgz7wrb`), product **nind ai** (`prod_J9aUbijk5FI0G`). Plans (USD, from the Upgrade page; annual = monthly-equivalent annual price × 12, billed yearly):

| plan | credits / month | monthly | annual |
|---|---|---|---|
| Starter | 500 | $20 `plan_PEoFZUohfP7EQ` | $192 `plan_qhQsIcxcgw0K7` |
| Creator | 3000 | $69 `plan_TZOKWqftoUoDz` | $708 `plan_SbX1qP2M1PTDU` |
| Creator | 6000 | $119 `plan_8vgWPQY7cWOQB` | $1188 `plan_O1UuonQls7oeJ` |
| Creator | 9000 | $199 `plan_YCo3Tg5Bfz1gx` | $2028 `plan_xWkQKn3P9WH0Y` |

Flow: Upgrade → `POST /api/subscription/checkout` creates a Whop checkout configuration with metadata `{ nind_user_id, nind_plan }` (needs `WHOP_API_KEY`; without it the plain plan link is used and the buyer is matched by e-mail) → Whop checkout → redirect to `/subscription/success?session_id=…`, which polls `/api/subscription/status/:id`.

Webhook `POST /api/webhooks/whop` (Standard Webhooks signature with `WHOP_WEBHOOK_SECRET`, 5-minute timestamp tolerance, idempotent by `webhook-id` and payment id):
- `payment.succeeded` → activates the plan and starts a new credit month: unused subscription credits expire, purchased/welcome credits stay, plan credits are added. Monthly renewals do this every month; annual plans are refilled monthly by a timer.
- `membership.activated` / `membership.updated` → status sync (`past_due`, cancel at period end).
- `membership.updated` with `canceled` / `expired` (or `membership.deactivated`) → back to Free, subscription credits removed.
- Payments that can't be mapped to a user are kept in `db.whop_unmatched`.

Register after deploy: Whop dashboard → Developer → Webhooks → URL `https://nind.pro/api/webhooks/whop`, events `payment.succeeded`, `membership.activated`, `membership.updated` (and `membership.deactivated` if offered), API version v1; put its secret into `WHOP_WEBHOOK_SECRET`.
