# Alliance Social Analytics: Full Platform Audit
**Date:** June 10, 2026
**Scope:** Entire codebase (app, Studio, Reel Studio, render worker, API/crons, edge functions, data layer, database). Five parallel deep-dive reviews plus live database verification and Supabase advisor scans. Read-only audit: no code was changed.

---

## Executive summary

The platform is in better shape than typical for its build velocity: strict TypeScript passes clean, secrets hygiene is solid, auth coverage on user-facing routes is complete, the hardest races (double-publish claim, Chromium serialization in rerender-carousel) are correctly solved, and the drawer/scroll-preservation UX discipline is consistently applied.

The audit found **1 confirmed critical production outage, 10 high-severity issues, and roughly 50 medium/low items**. The critical item explains several things that have silently never worked.

---

## CRITICAL: All five Vercel cron jobs have never executed

**Status: confirmed in code AND verified against the live database.**

`middleware.ts:16` matches `/api/*` and `lib/supabase/middleware.ts` has no API exemption in `isPublicPath()`. Every unauthenticated request to `/api/cron/*` gets a 307 redirect to `/login` before the route handler runs. Vercel cron does not follow auth redirects, so the CRON_SECRET checks inside the routes are dead code.

Live database evidence (checked 2026-06-10):

| Cron-fed table | Rows |
|---|---|
| coach_insights | 0 |
| owner_story_email_sends | 0 |
| office_post_announcements | 0 |
| generated_posts with status 'posted' (scheduler path) | 0 |

Every `last_schedule_error` is just the `{}` default. The pg_cron jobs (social syncs, RETS, ListTrac, brand assets) are unaffected because they invoke Supabase edge functions directly. Posts have been going out only because Larissa uses the immediate-publish path.

**Impact:** scheduled publishing, the AI Coach refresh, the Monday weekly social report, the Monday Owner Story emails, and daily office post announcements have never fired.

**Fix:** exempt `/api/` (or at minimum `/api/cron/`) in the middleware matcher or `isPublicPath()`, keeping each route's own CRON_SECRET check as the auth layer. One-line fix plus a smoke test.

---

## High-severity findings

### Security / data integrity

1. **4 of 5 cron routes accept a spoofed User-Agent as auth.** `coach-refresh`, `weekly-social-report`, `owner-story-weekly`, `office-post-announcements` all accept any request whose `user-agent` starts with `vercel-cron`. Once the middleware fix lands, anyone can fire the weekly report blast to leadership repeatedly (it has no send-dedupe) or burn Opus tokens via coach-refresh. Only `publish-scheduled` does strict Bearer CRON_SECRET. Fix both together with the middleware change.
2. **Owner-story unsubscribe is a destructive GET.** `app/api/owner-story/[token]/unsubscribe/route.ts` deletes the recipient on GET. Outlook SafeLinks and corporate link scanners follow GETs, so sellers can be silently unsubscribed without clicking. Convert to confirm-page GET + POST action.
3. **Edge functions are invokable with the public anon key.** Default JWT verification only checks signature, not role. Anyone with the anon key (it ships in the client bundle) can trigger RETS syncs against Paragon, 730-day ListTrac backfills, or TikTok token refreshes. Require the service-role key or a shared secret inside each handler.
4. **Supabase advisors flag 7 tables exposed via PostgREST with RLS disabled** (mls_agents including license_number, email_subscribers, listing_portal_metrics, office_post_announcements, render_schema_cache, portal_bundles, portal_bundle_members), plus 3 SECURITY DEFINER views and SECURITY DEFINER RPCs (`invoke_edge_function`, `run_auto_linker`, etc.) executable by anon. Since the app exclusively uses the service-role client server-side, enabling RLS with no policies (deny-all for anon/authenticated) is safe and closes all of these at once.

### Stability

5. **Render worker has no job serialization.** `worker/src/routes/render.ts` fires jobs with no queue or mutex; concurrent renders share one cached Chromium page, and the first job to finish closes the browser out from under the other mid-render. One concurrent request away from failed reels. Fix: simple in-process promise-chain mutex.
6. **publish-scheduled can lose a scheduled post permanently.** Platform keys are removed from `scheduled_for` before publishing and only restored at the end. With up to 50 rows processed sequentially, IG polls up to 120s each, and `maxDuration: 60`, a timeout between claim and merge means the entry vanishes: nothing published, no error, no retry. Time-budget the loop or use a reclaimable lease. (Latent until the middleware fix activates this cron, then it matters immediately.)
7. **Zero fetch timeouts on any external API call** (Meta, TikTok, Resend, RETS, ListTrac). One hung socket stalls an entire cron tick or edge run and compounds finding 6. Add `AbortSignal.timeout()` per call.
8. **Studio: a failed image load can permanently overwrite a saved design.** On flaky-network open, the dashed placeholder Rect is serialized into `fabric_json` by autosave about 1s after hydration, baking the photo loss into the saved design. Gate autosave on first user edit and set `excludeFromExport` on placeholders.
9. **Studio: undo history survives template swaps.** The history hook has no reset; after switching templates or sizes, Cmd+Z replays the previous template's snapshot onto the new canvas. Add `history.reset()` on canvas init.
10. **Studio: async dispose race is the likely root of the known blank-on-reopen bug.** Fabric v6 defers `destroy()` a frame when a render is pending; the new Canvas can construct against a still-initialized element, throw, and leave the editor blank until refresh. Fix: key the canvas element per session (forces a virgin DOM node) or await dispose behind a generation token.

---

## Studio (canvas editor)

Beyond the three high items above:

- **No close confirmation + autosave disabled pre-save:** a stray backdrop click during a first-edit session discards everything silently (`CanvasEditorOverlay.tsx:256`).
- **Autosave races explicit saves** on the whole `slide_metadata` array (read-modify-write with no version check, `actions.ts:1041`). Use per-index `jsonb_set`.
- **~700 lines of dead matboard-crop code** still ship (`CanvasEditor.tsx:1556-2207` plus state and JSX). The crop UX was replaced by native crop on 2026-06-01; deleting this cuts CanvasEditor about 40% and removes a maintenance trap.
- **Sequential image loading:** template open pays the sum of per-photo latencies (each with its own 15s timeout). Parallelize with `Promise.all`, then add in z-order.
- **canvas-save route builds storage paths from unsanitized client strings** (`route.ts:137`): whitelist `[A-Za-z0-9_-]` on templateId and mlsNumber.
- **The known font-size readout bug appears already fixed.** FloatingToolbar now shows effective size (fontSize x scale) and CanvasEditor bakes residual scale on modify. Only legacy objects with uneven scaleX/scaleY misread. Recommend one live check, then close the item.
- Smaller: `initialFabricJson` missing from canvas init deps (same-template slide switches never rehydrate and can cross-save slide content), blanket `canvas.off("object:scaling")` removes ALL listeners (intentional today, foot-gun later), 15s image timers never cleared, `loadBackground` races `hydrateFromFabricJson`, export uses main-thread-blocking `toDataURL` + data-URL fetch, debug console.log in the slide-click path.

What's healthy: dispose/cancelled-flag discipline, native-crop math centralized in fabric-factory, no per-frame React thrash (object:moving stays out of React), `--studio-*` theme vars correctly quarantined, export CORS errors surfaced properly.

## Reel Studio + render worker

Beyond the serialization item above:

- **Editor can build compositions the worker will reject.** "Slow" pace at 6s/photo plus hero and outro exceeds the worker's 15s cap; carousel-to-reel maps every photo with no cap (9 slides = ~43s, double-violating 15s/8-scene limits). User gets a raw zod error after committing to an edit. Clamp in `applyPace` and slice photos in `build-from-carousel.ts`.
- **No render watchdog:** a hung image fetch wedges a job in `processing` forever with Chromium open. Add per-scene or per-job timeout.
- **`brokerage_logo` silently fails in worker single-image renders:** resolves to `/brand/c21-mark.svg` on a `file://` page, so the C21 logo drops from every worker-side render. Direct violation of Larissa's logo rule. Ship the SVG inside render-page/.
- **In-memory JobStore + Fly auto-stop + auto-deploy on push = renders silently lost mid-flight.** Graceful shutdown drains HTTP but kills background jobs. Track in-flight jobs and delay shutdown.
- **Frame buffers held fully in RAM** can approach the 2GB VM ceiling on max-length compositions; stream scene frames to disk instead.
- **Preview/export parity gaps:** `zoom_blur` previews as zoom but exports as a slide (xfade smoothleft); worker loops short audio but preview doesn't; the persisted `composition_json` drops the auto-attached audio track (saved row claims silence while the MP4 has music).
- **One bad photo URL fails the whole reel** while design-scene images degrade gracefully: inconsistent policy.
- **Every render re-downloads Fabric.js and fonts from CDNs** (browser closed after each job); a CDN hiccup fails all renders. Vendor them into render-page/.
- Smaller: single transient poll failure aborts the Generate flow; TimelineStrip nested `<button>` inside `<button>`; TimelineStrip transition cycle drifted to 5 of 13 transitions; duplicate SVG gradient ids; Playwright `^1.48.0` vs hard-pinned Docker image (pin exact); all worker `@font-face` weights point at one woff2 URL (bold may render regular in exports, verify once).

What's healthy: auth chain (server-action-only token, timing-safe compare), idempotency dedupe, rerender-carousel's serialization + 40s timeouts + incremental persistence, callback-ref sizing, demo loop self-terminates, Fly health checks and secrets.

## App pages and UI

- **Zero error boundaries in the entire app** (no error.tsx, global-error.tsx, or not-found.tsx). Any uncaught throw shows Next's unstyled crash page, including to sellers on `/home/[token]`. Highest-value UI fix.
- **No loading.tsx or Suspense outside login.** Dashboard awaits 13 queries before first byte; every nav feels frozen. Conflicts with the no-hidden-state ADHD principle. Add skeletons for `(app)`, properties, reports, coach.
- **Double-fetch tax:** `generateMetadata` and page bodies each call the same uncached fetchers on `/r/[token]`, `/home/[token]`, `/posts/[id]`, `/properties/[mls]` (about 6 queries each, twice). Wrap fetchers in `React.cache()`. Same for `getCurrentProfile`/`requireUser` (5 auth round-trips per page view today).
- **~860 dead lines in `/r/[token]`:** the route unconditionally redirects to `/home/[token]`, so the old LOCKED Compass design below line 313 is unreachable yet still costs a double `loadLiveData` before redirecting.
- **recharts ships in the dashboard initial bundle** for a click-to-open dialog (MetricDetailDialog). `next/dynamic` it: about 100KB+ gz off first load.
- **`/outbox` is documented admin-only but only checks `requireUser`.** Any active user can browse and acknowledge by URL. Change to `requireAdmin()`.
- **`fetchPosts` loads the entire properties table** on every dashboard/posts render just to build a lookup map (two agents flagged independently). Scope with `.in(...)`; grows with RETS history.
- **`/home/[token]` logs a view row on every GET with no bot filtering or dedupe**, inflating the seller-facing story-views stat and the Morning Briefing count.
- Smaller: `maximumScale: 1` blocks pinch zoom site-wide (WCAG 1.4.4, applies to seller pages on Android); DetailDrawer lacks a focus trap; dashboard GET runs `backfillStatusFlipOutbox` (a write) on every render; up to 500 fully hydrated posts serialized for 30 visible; off-brand grays (`#e5e7eb` x24 in MetricDetailDialog vs brand `#E5E5E2`); 25-line portal-strip block byte-identical in drawer and standalone post detail; native `window.confirm` in 5 components; admin gating for /admin/templates lives only in the layout (pages fetch in parallel before redirect); DetailDrawer's 150ms back-fallback timer can double-navigate.

What's healthy: scroll preservation is exemplary across every filter/toggle, no div-onClick anti-patterns, consistent `Promise.all` batching, thorough server-action auth, brand palette properly in Tailwind, Barlow global.

## Backend, API, sync

- **TikTok refresh-token rotation race:** publish.ts and tt-sync both refresh and persist with last-writer-wins; TikTok invalidates the old refresh token on rotation, so a concurrent refresh can persist a dead token and kill TT publishing until manual re-auth. They also write incompatible credential shapes (publish.ts drops `obtained_at`/`expires_in`, which tt-sync's expiry check needs). Single shared refresh path.
- **Deactivated accounts keep API access** on all `getCurrentProfile`-gated routes (11 routes); only `requireUser` checks `is_active`. Add the check to `getCurrentProfile`.
- **multi-oh-generate still runs Chromium concurrency 5** (the exact ETXTBSY race rerender-carousel fixed with concurrency 1). Serialize or warm the first spawn.
- **RETS sync never downgrades listings that leave the feed:** expired/withdrawn listings stay `status='active'` forever, and owner-story emails plus listtrac-sync keep targeting phantom actives. Add a post-sync not-seen-this-run pass.
- **weekly-social-report has no send-dedupe** (a retry or double-fire blasts leadership twice); owner-story share endpoint lets any token holder send unlimited emails to arbitrary addresses.
- Smaller: ai/insight reads an agent's full post history unbounded then filters 30d in JS; owner-story weekly is a sequential N+1 over every active property; `classifyFBError` mislabels expired tokens (code 190) as scope errors, which will mislead debugging when the old IG Test1-app token eventually dies; publish-scheduled's final merge clobbers concurrent user edits; all-failed scheduled rows strand as 'scheduled'; `vercel.json` gives EVERY function a 300s ceiling (cost/DoS amplifier, scope it to render/report routes); Meta tokens passed in GET query strings (move to Authorization header); `requireAdmin` redirects API callers to HTML instead of 401; `ensure_owner_story_tokens` RPC and cron jobs exist only in the live DB, not in migrations (drift risk).

Verified clean: no service-role key client-side, no SQL injection surface, no secrets logged, the double-publish claim race correctly solved, RETS pagination/relogin robust.

## Data layer, config, dependencies

- `npx tsc --noEmit`: **0 errors.** Git tree clean and in sync with origin. No node_modules tracked.
- **Generated Supabase types are stale:** missing 6 tables/views, forcing `as any` client shims in portal-metrics-db.ts and owner-story-weekly-data.ts (entire ListTrac and Owner Story weekly paths untyped). Regenerate and delete the shims.
- **Pervasive error-swallowing:** a dozen `const { data } = await ...` sites with no error check render failures as empty states (properties-db, post-detail, agent-email-resolver, sync/actions, owner-story-weekly-data, posts-db). Destructure and log `error`.
- **Repo junk committed:** `.__deltest_2`, `.post-builder-preview.html`, the critique PDF, PHASE2-MORNING-SUMMARY.md, `supabase/.temp/*`. Also delete the local `public:brand:` directory (colon paths break Windows checkouts).
- Smaller: unused `archiver` dep (+@types in deps not devDeps); `@supabase/ssr` well behind current; non-null `!` on env in middleware (opaque crash if missing); `mlsNumber` canonical-lookup fallback swallows errors and can attribute SJSR traffic to the wrong MLS#.

## Database (Supabase advisors)

Security: covered in High item 4 above. Also enable leaked-password protection in Auth settings (one toggle).

Performance (all minor at current scale): 13 unindexed foreign keys (mostly `created_by`/`updated_by` audit columns, fine to ignore); 7 RLS policies re-evaluating `auth.uid()` per row (wrap in `(select auth.uid())`); 12 tables with duplicate permissive SELECT policies (admin-write policies also granting SELECT); ~25 never-used indexes (several belong to the never-fired crons and will become used once the middleware fix lands; re-check after).

---

## Recommended fix order

1. **Middleware cron exemption** + smoke-test all five crons (the critical).
2. **Cron route auth hardening** (delete the User-Agent bypass, require Bearer CRON_SECRET) + weekly-report send-dedupe. Must land with or before #1.
3. **publish-scheduled time-budgeting** (it goes live the moment #1 lands).
4. **Studio data-loss trio:** autosave-after-failed-hydration, history reset on template swap, canvas keying for the blank-on-reopen race.
5. **Worker render mutex** + per-job watchdog + brokerage-logo file:// fix.
6. **Reel cap enforcement** in pace/carousel seeding + persist the audio-attached composition.
7. **error.tsx/loading.tsx pass** + `React.cache()` on auth and token-page fetchers.
8. **RLS enable on the 7 exposed tables** + revoke anon EXECUTE on SECURITY DEFINER RPCs + unsubscribe GET-to-POST.
9. **TikTok refresh unification**, `is_active` in getCurrentProfile, fetch timeouts, RETS stale-listing downgrade, /outbox requireAdmin.
10. **Cleanup sprint:** dead matboard-crop code, dead /r design, repo junk, stale Supabase types, fetchPosts scoping, recharts dynamic import.

Items 1-3 are about an hour of work combined and turn on five product features that have silently never run.
