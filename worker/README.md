# alliance-reel-render — self-hosted Reel MP4 worker

HTTP service that accepts a `VideoComposition` payload from the main
AllianceAnalytics app, renders it to a 1080×1920 / 30fps MP4 using
Fabric (server-side, headless Chromium) + ffmpeg, uploads the result
to Supabase Storage, and returns a public URL.

**Status: Day 1 scaffold.** The /render endpoint accepts payloads and
returns a fake video URL after a 5-second simulated render. Real
rendering ships Day 2.

---

## Architecture

```
Main app (Vercel, Next 15)                  Worker (Fly.io)
─────────────────────────                   ────────────────
POST /api/reels/render        ─bearer auth─▶ POST /render        ─▶ runRenderJob (Day 1 stub / Day 2 Fabric+ffmpeg)
GET  /api/reels/status/:id    ─bearer auth─▶ GET  /render/:id    ─▶ in-memory job store
                                                                ─▶ Supabase Storage upload (Day 2)
                                                                ─▶ returns public MP4 URL
```

- Stateless aside from in-memory jobs (24h TTL). Day 5+ swaps in Redis
  for multi-worker scale; interface in `src/jobs/store.ts` stays.
- One Fly machine in `iad`, auto-stops on idle (saves ~$5-10/mo).
- Cold start is ~1-2s.

---

## Local dev

```bash
cd worker
npm install

# Set the three secrets the worker requires. Local dev value for the
# auth token can be anything >= 32 chars.
export WORKER_AUTH_TOKEN="local-dev-token-replace-with-random-hex-32"
export SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOi..."

npm run dev    # tsx watch — port 8080 by default
```

Verify:

```bash
curl http://localhost:8080/health
# → {"ok":true,"version":"0.1.0","jobs":{"queued":0,"processing":0,"succeeded":0,"failed":0}}
```

Smoke-test /render with a minimal valid composition:

```bash
TOKEN="local-dev-token-replace-with-random-hex-32"

curl -X POST http://localhost:8080/render \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "11111111-1111-1111-1111-111111111111",
    "composition": {
      "schemaVersion": 1,
      "width": 1080,
      "height": 1920,
      "frameRate": 30,
      "totalDurationMs": 5000,
      "scenes": [
        {
          "id": "scene-1",
          "startMs": 0,
          "durationMs": 2500,
          "content": { "kind": "design", "templateRef": "just_listed_v1_story_9x16" },
          "transitionIn": "cut",
          "transitionMs": 0
        },
        {
          "id": "scene-2",
          "startMs": 2500,
          "durationMs": 2500,
          "content": {
            "kind": "photo",
            "photoUrl": "https://example.com/photo.jpg",
            "motion": {
              "startRect": { "x": 0, "y": 0, "w": 1, "h": 1 },
              "endRect": { "x": 0.05, "y": 0.05, "w": 0.9, "h": 0.9 },
              "easing": "ease_in_out"
            }
          },
          "transitionIn": "fade",
          "transitionMs": 300
        }
      ],
      "audio": null,
      "updatedAt": "2026-05-16T12:00:00.000Z"
    }
  }'
```

Response (immediate):

```json
{ "job_id": "<uuid>", "status": "queued", "poll_url": "/render/<uuid>" }
```

Poll until succeeded:

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/render/<uuid>
```

After ~5s the response becomes:

```json
{
  "job_id": "<uuid>",
  "status": "succeeded",
  "progress_pct": 100,
  "video_url": "https://example.com/fake-reel.mp4",
  "video_path": "stub/fake-reel.mp4",
  "duration_ms": 7000,
  "error": null,
  "created_at": "...",
  "updated_at": "...",
  "idempotency_key": "11111111-1111-1111-1111-111111111111"
}
```

---

## Deploy to Fly.io

One-time setup:

```bash
brew install flyctl
fly auth signup    # or `fly auth login` if you already have an account
```

Set secrets (first deploy only — generate the auth token here, then
also save it as a Vercel env var so the main app can authenticate):

```bash
fly secrets set \
  WORKER_AUTH_TOKEN=$(openssl rand -hex 32) \
  SUPABASE_URL=https://YOUR_PROJECT.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi... \
  --app alliance-reel-render
```

Deploy:

```bash
cd worker
fly deploy
```

Verify:

```bash
curl https://alliance-reel-render.fly.dev/health
```

Read the generated auth token back so you can paste it into Vercel:

```bash
fly ssh console --app alliance-reel-render -C "printenv WORKER_AUTH_TOKEN"
```

---

## Project layout

```
worker/
├── README.md          — this file
├── package.json       — npm + scripts (dev / build / start / typecheck)
├── tsconfig.json      — strict, ES2022, NodeNext modules
├── Dockerfile         — multi-stage build, bookworm-slim base
├── .dockerignore
├── .gitignore
├── fly.toml           — Fly.io deploy config
└── src/
    ├── server.ts            — Express bootstrap + graceful shutdown
    ├── types.ts             — VideoComposition + zod schemas (mirrored from main app)
    ├── routes/
    │   ├── health.ts        — GET /health
    │   └── render.ts        — POST /render, GET /render/:job_id
    ├── jobs/
    │   ├── store.ts         — In-memory job store with 24h TTL
    │   └── render-job.ts    — Stub renderer (Day 1) → real impl (Day 2)
    └── lib/
        ├── env.ts           — Typed env loader (zod-validated)
        ├── logger.ts        — Minimal JSON logger to stdout
        └── auth.ts          — Bearer-token middleware (timingSafeEqual)
```

---

## Day 2+ roadmap

- **Day 2** — real renderer. Replace `runRenderJob` body with:
  - Headless Chromium (Playwright) loading the canvas-editor template
    pages, capturing PNG frames.
  - ffmpeg encode (libx264, faststart, CRF 22) of the frame sequence.
  - Supabase Storage upload to `reel_renders/` bucket. Returns public
    URL on completion.
- **Day 3** — timeline UI in Studio (drag-to-reorder scenes, motion
  preset picker, audio track selector).
- **Day 4** — Reel wizard (one-click "make a Reel from this listing"
  entry point + auto-composition).
- **Day 5+** — multi-worker scale (Redis-backed JobStore), captions
  burned in via SSML → ffmpeg drawtext, ListTrac/Reels analytics
  attribution.

---

## Operational notes

- **Where the worker is reachable.** Public URL is
  `https://alliance-reel-render.fly.dev`. The main app reads the
  worker URL from `WORKER_BASE_URL` env (set on Vercel) so we can
  point preview environments at a different worker if needed.
- **What happens on idle.** Fly auto-stops the machine after no
  traffic. The first /render call cold-starts in ~1-2s — fine for
  human-initiated rendering, but if Day 5+ traffic becomes
  user-facing we'll set `min_machines_running = 1`.
- **Where logs land.** `fly logs --app alliance-reel-render`. Every
  log line is JSON-per-line (see `src/lib/logger.ts`) so it pipes
  cleanly into any log aggregator we add later.
- **Where the auth token lives.** Generated once at first deploy,
  stored as a Fly secret + a Vercel env var. Rotation: `fly secrets
  set WORKER_AUTH_TOKEN=$(openssl rand -hex 32)`, then update Vercel.
