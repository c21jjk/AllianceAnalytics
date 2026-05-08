# Phase 2 — Morning summary (2026-05-09)

## TL;DR

Tonight I wrote every file needed to ingest real posts from Facebook,
Instagram, and TikTok into Supabase: five SQL migrations, three Edge
Functions plus shared helpers, the Next.js wiring (data-source switcher,
"Sync now" server action + button, stubbed DB query layer). **Nothing was
applied to Supabase or deployed** — Supabase's us-east-1 region went
down right after I confirmed the project shape and started creating the
dev branch. I pivoted to file-only mode so you wake up to a clean
reviewable diff with no half-applied schema changes anywhere.

`npx tsc --noEmit` is **clean (exits 0)**.
**Nothing has been committed** — your standing rule is GitHub Desktop only,
so the diff is sitting unstaged for your review.

---

## What's in the diff

### New SQL migrations (additive, safe to apply on prod after review)
```
supabase/migrations/20260508_001_enable_ingestion_extensions.sql
supabase/migrations/20260508_002_add_post_metrics_daily.sql
supabase/migrations/20260508_003_extend_posts_for_ingestion.sql
supabase/migrations/20260508_004_extend_reports_for_narrative.sql
supabase/migrations/20260508_005_add_report_deliveries.sql
supabase/migrations/20260508_006_schedule_daily_syncs.sql
```

| # | Adds | Notes |
|---|------|-------|
| 001 | `pg_cron`, `pg_net` extensions | Required by 006 cron schedule. Already available on the project, just not yet enabled. |
| 002 | `post_metrics_daily` table | Daily snapshots of post metrics. Powers sparklines + post detail time-series. PK is `(post_id, captured_date)` so syncs upsert cleanly. |
| 003 | `posts.hashtags`, `posts.audience`, `posts.thumbnail_url` columns | All `NOT NULL` with safe defaults. Backfill not needed. |
| 004 | `reports.period_start/end`, `post_ids[]`, `kpis`, `audience`, `narrative` | Caches the aggregates so the seller-facing report renders fast. |
| 005 | `delivery_channel` + `delivery_status` enums, `report_deliveries` table | Per-recipient delivery tracking. One row per send/forward. Has unique `share_token` for the public `/r/[token]` URL. |
| 006 | `pg_cron` job + helper function `invoke_sync_function()` | Schedules `ig-sync`, `fb-sync`, `tt-sync` daily at 04:00 ET (08:00 UTC). |

**Important — prerequisite to migration 006:** the cron helper reads two
Postgres GUCs that you must set ONCE via the dashboard SQL editor:

```sql
ALTER DATABASE postgres SET app.settings.service_role_key TO 'YOUR_SERVICE_ROLE_KEY';
ALTER DATABASE postgres SET app.settings.project_url     TO 'https://rhkgowpjfpqbrdmgsccx.supabase.co';
```

These are set out-of-band so the service role key never gets committed.
Until they're set, the cron jobs run but log a "Service role key not set"
notice and return.

### New Edge Functions
```
supabase/functions/_shared/types.ts       — shared NormalizedPost, NormalizedMetrics, NormalizedAudience, SyncResult
supabase/functions/_shared/db.ts          — service-role client, loadCredentials, autoLinkProperty, upsertPost, recordSyncRun
supabase/functions/_shared/parse.ts       — extractHashtags, computeEngagementRate, normalizeAudienceMap, buildAudience
supabase/functions/ig-sync/index.ts       — Instagram Graph (IG Business + Page-linked)
supabase/functions/fb-sync/index.ts       — Facebook Graph page posts + insights
supabase/functions/tt-sync/index.ts       — TikTok Display API + automatic OAuth refresh
```

Each function:
- Reads its credentials from `api_credentials` (already populated, validated 2026-05-08)
- Walks paginated post lists with a 365-day backfill window (configurable via `*_BACKFILL_DAYS` env)
- Hits insights endpoints per post; falls back to a minimum metric set if the platform rejects a metric
- Normalizes into the same `NormalizedPost` shape
- Calls shared `upsertPost()` which:
  1. Auto-links to a property via the `NJ[A-Z]{2}\d{5,8}` MLS regex on the caption
  2. Upserts the post by `(platform, platform_post_id)`
  3. Writes a `post_metrics_daily` row keyed by `(post_id, captured_date)`
- Records success/failure into the `notifications` table for in-app surfacing

**TikTok caveats** I hit while reviewing the API:
- The TikTok Display API doesn't expose reach distinct from views. We use `view_count` for both fields.
- Per-video audience demographics aren't available from the organic API (TikTok keeps these in TikTok Studio). The function leaves `audience: {}` for TT posts.
- Token refresh is wired up — function checks `obtained_at + expires_in` and refreshes via `https://open.tiktokapis.com/v2/oauth/token/` if within 24h of expiry. **Requires `TT_CLIENT_SECRET` env var on the Supabase project** (see step 5 below). Without it, refresh fails loudly rather than silently.

### New Next.js code
```
lib/data/source.ts          — env-var-driven "fixtures" vs "db" switch
lib/data/posts-db.ts        — STUB returning empty arrays; full implementation preserved as a comment block
lib/data/index.ts           — getPosts() / getAccountHealth() entry points used by pages
lib/sync/actions.ts         — server actions: syncOne(platform), syncAll(), getSyncStatus()
components/SyncNowButton.tsx — admin-only client component; wires to syncAll()
```

The data-source switch defaults to `fixtures`. After the first successful
ingestion run, set `ALLIANCE_DATA_SOURCE=db` on Vercel and redeploy — every
page that calls `getPosts()` will switch to live DB reads. Pages still
import the fixture types directly today, but the switcher is in place
ready to flip.

### Modified files
```
tsconfig.json — excludes supabase/functions/** (Deno runtime, not Next typecheck)
```

That's the only existing-file change. The mock UI continues working
unchanged.

---

## What you need to do in the morning (in order)

### 1. Confirm Supabase region recovery
Visit https://status.supabase.com and check us-east-1. If healthy:

### 2. Create the dev branch
This was blocked tonight by the outage. Once region is back, in the
Supabase dashboard or via the MCP:
```
mcp__supabase__create_branch
  project_id: rhkgowpjfpqbrdmgsccx
  name: phase2-ingestion
```
Cost: ~$0.01/hour ≈ $9.67/month. Already cost-confirmed.

### 3. Apply migrations on the dev branch
Apply files 001 through 005 in numerical order via `apply_migration`. Skip
006 for now — that one needs the GUCs (step 5) and is best applied last.

### 4. Generate types from dev
```
mcp__supabase__generate_typescript_types  project_id: <dev-branch-id>
```
Replace `lib/supabase/types.ts` with the result.

### 5. Set the GUCs and the TT_CLIENT_SECRET
In the Supabase SQL Editor (dashboard):
```sql
ALTER DATABASE postgres SET app.settings.service_role_key TO '<service-role-key>';
ALTER DATABASE postgres SET app.settings.project_url     TO '<dev-or-prod-project-url>';
```
And in Vercel/Supabase project settings, set the Edge Function env var:
```
TT_CLIENT_SECRET = <your TikTok app's client secret>
```
The TikTok client secret is NOT in `api_credentials` (storing it there
would be a footgun — it's a long-lived app-level secret, not a per-user
credential). I expect this lives in your TikTok developer console.

### 6. Apply migration 006 (cron)
Now that the GUCs are set, apply the cron schedule.

### 7. Deploy the three Edge Functions
```
mcp__supabase__deploy_edge_function ig-sync
mcp__supabase__deploy_edge_function fb-sync
mcp__supabase__deploy_edge_function tt-sync
```
Each takes the corresponding `supabase/functions/*/index.ts` plus the
`_shared/` files.

### 8. Trigger the first sync (manually, one platform)
```
curl -X POST https://<project-ref>.supabase.co/functions/v1/ig-sync \
  -H "Authorization: Bearer <service-role-key>"
```
This is the moment of truth. Watch `mcp__supabase__get_logs service:edge-function`
for output. Expected response: a JSON SyncResult with `inserted: <some
non-zero number>`, `errors: []`. If errors come back, check:
- `api_credentials` is_active=true for instagram (yes per earlier inspection)
- `page_access_token` hasn't been rotated since 2026-05-08
- IG account is still Business-linked to the Page

If IG looks good, repeat for fb-sync and tt-sync.

### 9. Validate data landed
```sql
SELECT platform, count(*) FROM posts GROUP BY platform;
SELECT count(*) FROM post_metrics_daily;
```
Spot-check a few rows by visiting `/posts/<uuid>` in the app — but note
that pages still read from fixtures until step 10.

### 10. Uncomment the real DB reads in `lib/data/posts-db.ts`
The reference implementation is preserved as a comment block at the
bottom of the file. Move the `*Live` functions out of comments and into
the `fetchPosts` / `fetchAccountHealth` exports (or rename and re-export).
Run `npx tsc --noEmit` — should be clean now that types are regenerated.

### 11. Flip the env var and redeploy
On Vercel:
```
ALLIANCE_DATA_SOURCE = db
```
The next dashboard render reads from Postgres. The fall-back-to-fixtures
behavior in `lib/data/index.ts` means an empty DB still shows the mock
data, so you can flip without breaking the UI.

### 12. Wire the SyncNowButton onto the dashboard
The component is built but not yet placed. Drop it into
`app/(app)/page.tsx` next to the `AccountSyncBar` for admin role. Two
lines:
```tsx
{profile.role === "admin" ? <SyncNowButton /> : null}
```
That gives you an admin-visible "Sync now" affordance to refresh on
demand without waiting for the 4am cron.

### 13. Apply migrations to PROD (when comfortable)
After the dev branch validates the full ingestion pipeline, apply the
same six migrations to the prod project. They're additive (no drops, no
renames) so this is safe — but you'll want to do it during a quiet window
since pg_cron will start firing immediately.

---

## What's tested vs untested

| | Status |
|---|---|
| TypeScript compiles | **Tested** — `npx tsc --noEmit` exits 0 |
| Migrations against dev branch | **Untested** — region outage |
| Edge Function deploy | **Untested** — region outage |
| Edge Function execution against real APIs | **Untested** — depends on deploy |
| Cron schedule fires correctly | **Untested** — depends on deploy |
| Auto-link to property by MLS regex | **Untested** — needs a sync run with NJ MLS in caption |
| Token refresh path on TikTok | **Untested** — needs an actual expired token to trigger |

Pre-flight risks I'm flagging now so you can plan around them:

1. **IG insights metric set may need adjustment.** Some metrics in the
   list (e.g., `ig_reels_video_view_total_time`) are deprecated in
   favor of newer names. The function falls back to a minimum metric set
   on rejection, but you'll want to watch the first run's logs and tighten
   the metric list.

2. **FB `post_reactions_by_type_total` returns a map keyed by
   reaction type** (`like`, `love`, `wow`, etc). I sum them to a single
   `likes` metric. If you want them broken out, that's a 3-line change
   in `fb-sync/index.ts:flattenInsights`.

3. **TikTok `view_count` doubles as `reach` and `impressions`**. Best
   approximation; will look weirdly correlated in the UI until we can
   get proper reach numbers (TikTok keeps these in-app only).

4. **Property auto-link is conservative** — only matches NJ MLS regex.
   Doesn't fall back to fuzzy address matching (too many false positives
   on common street names). Manual linking via the `/properties` page
   admin form is the planned alternative.

5. **No retries.** Edge Functions don't retry on transient API failures.
   First run will surface any flakiness. We can add exponential backoff
   in a follow-up if quotas/rate limits become an issue.

---

## Outstanding open questions (non-blocking, for later sessions)

1. **TikTok per-post audience.** Display API doesn't expose it. Worth
   investigating the Research API (different application process) for
   serious analytics use.
2. **IG audience demographics** are at the *account* level, not per-post.
   The current schema stores them on `posts.audience` but they'll be
   populated empty. Decision needed: aggregate at report time from the
   account-level `/insights?metric=audience_*` endpoint, or skip it
   entirely.
3. **FB Page audience** has the same shape problem.
4. **Token expiry monitoring.** No alerting yet for when an FB/IG page
   token nears expiry (60-day cycle for long-lived tokens). Consider a
   weekly `validate_credentials` Edge Function in a future phase.
5. **Property entry UX.** Per the earlier session, manual entry is the
   plan, but no admin form exists yet. `/properties/new` route is a
   future need.

---

## Nothing has been committed

GitHub Desktop will show roughly:

- **18 new files** under `supabase/migrations/`, `supabase/functions/`, `lib/data/`, `lib/sync/`, `components/SyncNowButton.tsx`
- **2 modified files** (`tsconfig.json`, `PHASE2-MORNING-SUMMARY.md`)

I'd suggest reviewing the diff in this order:
1. The migrations (read top to bottom — they tell the schema story)
2. `_shared/db.ts` and `_shared/parse.ts` (the helpers everything else builds on)
3. One of the platform syncs (probably `ig-sync` first; FB/TT follow the same shape)
4. `lib/sync/actions.ts` and `components/SyncNowButton.tsx` (the user-visible plumbing)
5. `lib/data/index.ts` and `lib/data/source.ts` (the env-flag switch)

Commit as one batch when you're satisfied, or split however you prefer.

---

## Suggested kick-off prompt for the next session

> Pick up Phase 2. Region should be back — apply migrations 001-005 on the
> phase2-ingestion dev branch, regenerate types, then deploy the three
> Edge Functions and trigger ig-sync as the first run. Walk me through
> the result before we touch fb-sync or tt-sync.

Or if everything checks out:

> Phase 2 sanity check: confirm us-east-1 is healthy, create the dev
> branch, apply migrations, deploy functions, trigger all three syncs in
> sequence. Show me sample rows from posts and post_metrics_daily after.

---

**Status: file-only delivery complete. `npx tsc --noEmit` clean.
Awaiting region recovery + your review before any DB or Edge Function
operations.**
