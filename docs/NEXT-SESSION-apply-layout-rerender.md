# Next-session opener — "Apply layout to all slides" sibling PNG re-render

**Status as of 2026-05-28.** This is the ONE remaining piece of the multi-OH /
template-unification work. Everything else from that effort is shipped,
deployed, and live-verified. Start here with fresh budget.

---

## What's already done (shipped + deployed + live-verified)

- **Template unification (Phase 1).** Studio "Save as Template" now writes a
  published, `source='studio'` row into `template_definitions` (the admin
  Template Builder catalog). Verified live: a Studio save appears in
  `/admin/templates`. `custom_templates` is retired (migrated + no longer
  read/written). Render-path default lookup (`lib/data/custom-templates-db.ts`
  `fetchDefaultCustomTemplate`) reads the unified table.
- **No eject (Phase 2).** Removed `revalidatePath("/post-builder")` from
  `saveCustomTemplateAction` + `propagateCarouselLayoutAction` — the Studio
  overlay no longer tears down to "Final Review" on Save/Apply. Verified live.
- **Save confirmation + CORS error copy.** `SaveAsTemplateModal` shows "Saved ✓";
  preview-failure message now names the tainted-canvas/CORS cause.
- **Font-size input fix.** Typing a multi-digit size now works
  (`panels/FloatingToolbar.tsx`). Verified live.
- **Slide reorder persistence.** `reorderCarouselSlidesAction` reorders
  `additional_images` + `slide_metadata` + `hosting_agents_by_index` in lockstep
  (refuses on any id/length mismatch). Verified live: reorder, reload, DB
  confirmed all three aligned (host followed its property).
- **Apply-layout: 3 of 4 behaviors already work.** Eject fixed; the green
  "✓ Applied to N slides" pill shows; the override persists to
  `generated_posts.carousel_layout_overrides`; and the **consume path WORKS** —
  opening a sibling slide in Studio shows the propagated layout (verified live:
  moved "Open" on slide 1, opened slide 2, "Open" was moved there too with
  slide 2's own listing/host intact).

## The ONE remaining gap

The published slide PNGs (`additional_images`) are pre-rendered server-side and
are **not** re-rendered when the user clicks "Apply layout to all slides." So
Final Review and the posted carousel still show the OLD layout even though the
editor shows the new one. Need: re-render every sibling slide's PNG with the
stored overrides applied.

---

## How the render pipeline actually works

`lib/template-builder/renderer.ts` → `renderDbTemplate(input: RenderInput)`:
1. Loads template via `getTemplateById(template_id)`, picks `schema[format]`.
2. `signRenderToken({ template_id, listing_id, format, hosting_agent_name,
   hosting_agent_phone, hosting_agent_photo_url, oh_window })`
   (`lib/template-builder/render-token.ts`).
3. Headless Chromium screenshots `/render/template/<token>` (`screenshotHtml`,
   `lib/post-builder/chromium.ts`).
4. Uploads PNG to `post-builder-renders` bucket, returns `image_url` + `image_path`.

The render page (`app/render/template/[token]/page.tsx`) loads the schema fresh
from `template_id` and injects the per-slide bound data (host + OH window are
injected ~lines 113–119). **The token carries NO schema and NO overrides.**

Per-slide render loop lives in
`app/api/post-builder/multi-oh-generate/route.ts` (~lines 773–846), using helpers
`toRenderListing`, `formatOhWindowLabel`, `normalizeForAttributionKey`, and a
prebuilt `hostingAttribution` map; results assembled by `buildAdditionalImages`
(~line 995) + `buildSlideMetadata`.

---

## ⚠️ The date/time wrinkle (John flagged this)

`oh_window` (the "Saturday, May 30 · 10–1" text) is **NOT persisted** on the
`generated_posts` row — it was computed from the wizard input at generation
time. A re-render MUST re-resolve each slide's open-house window (fetch
`open_houses` by MLS, reformat via `formatOhWindowLabel`-equivalent). If it
doesn't, re-rendered slides will show the raw `{open_house_date}` /
`{open_house_time}` placeholder tokens — the exact bug John circled.

The SAME missing injection is why the **editor preview** shows the tokens: see
`handleSlideEditClick` in `PostBuilderClient.tsx` (~lines 1946–2088). It builds
the slide payload via `mapListingToPayload` (~line 2007) WITHOUT injecting the
OH date/time. Fix both together.

---

## Implementation plan (5 pieces)

1. **`render-token.ts`** — add an optional field to the signed payload to carry
   layout overrides. Prefer `gp_id` (small + lets the render page fetch
   `carousel_layout_overrides` itself) over embedding the full overrides bag
   (token/URL size risk). Update `signRenderToken` + the verify side.
2. **`renderer.ts`** — add optional `gp_id` (or `layout_overrides`) to
   `RenderInput`; forward it into `signRenderToken`.
3. **`app/render/template/[token]/page.tsx`** — when overrides are present
   (fetch by `gp_id`, or read from token), apply
   `applyOverridesToSchema(schema, overrides)` (`lib/post-builder/canvas-editor/layout-delta.ts:316`)
   before the canvas mounts. `parseCarouselLayoutOverrides` (same file:361)
   coerces the DB JSON safely.
4. **New `reRenderCarouselSlidesAction(gp_id)`** in `actions.ts` — load the row
   (`additional_images`, `slide_metadata`, `hosting_agents_by_index`,
   `carousel_layout_overrides`, `format`). For each slide:
   - resolve listing by `slide_metadata[i].listing_mls` (+ source) from
     `properties` (need `.id` uuid for the token);
   - **re-resolve the OH window** (fetch `open_houses` by MLS — see wrinkle above);
   - host from `hosting_agents_by_index[i]` (already stored — name/phone/photo);
   - `db_template_id` from `slide_metadata[i].db_template_id`;
   - call `renderDbTemplate({ ..., gp_id })`, collect new `image_url`;
   - update `additional_images[i].url`. Validate permutation/lengths; abort
     cleanly on mismatch (mirror `reorderCarouselSlidesAction`'s safety). NO
     `revalidatePath("/post-builder")` (don't eject the overlay).
5. **Client** — after `propagateCarouselLayoutAction` succeeds in
   `PostBuilderClient.tsx` (`onApplyLayoutToSiblings`, ~lines 4564–4589), trigger
   the re-render with a progress indicator (3–9 headless screenshots ≈ several
   seconds each — consider streaming NDJSON like multi-oh-generate, or a simple
   "Re-rendering N slides…" spinner + refresh `carouselSlides` URLs on done).

## Bonus fixes to fold in (John spotted both)

- **Editor date/time hydration:** inject OH date/time into the slide payload in
  `handleSlideEditClick` so the editor preview matches the render (no raw
  `{open_house_date}` tokens). Needs the same OH-window resolution as #4.
- **Spurious "Unsaved changes from Nm ago — restore them?" banner:** the Studio
  autosave/draft-recovery prompt fires on nearly every open, even right after
  generation when there's nothing meaningful to restore. Make it appear only on
  a genuine unsaved delta (compare against the saved state), or suppress on a
  fresh post open.

---

## Test fixture + verification

- **Test post:** `gp=b17b3903-bdee-4c83-af91-b5bdb8f12629` — a 3-slide multi-OH
  Open House (Cape May / Wildwood), already has stored `carousel_layout_overrides`
  and was reordered (slide order: 102 E Primrose / 308 Osprey Ct / 308 Osprey
  Court). Open at `https://www.alliancesocialanalytics.com/post-builder?gp=…`.
- **Flow to verify:** open a slide → move a layer → "Apply layout to all slides"
  → trigger re-render → confirm Final Review slide PNGs reflect the new layout
  AND still show the correct date/time/host (no `{open_house_date}` tokens).
- Run `npx tsc --noEmit` clean before commit.

## Project rules (do not violate)

- Git: **GitHub Desktop only** — never shell git / web editor. Hand off to John
  to commit + push; deploy is Vercel-on-push.
- DB: **Supabase MCP** (`apply_migration` / `execute_sql`), project
  `rhkgowpjfpqbrdmgsccx` (analytics app DB). `wmocyvhxnfvtqtsvpsww` =
  AllianceDash listings DB (read-only — never write).
- Env vars: Vercel via Chrome MCP (no Vercel MCP env CRUD).
- Present a numbered plan and wait for "build it" before writing code.

## After this: Phase 4 (separate build)

Platform-wide correctness bugs from the original audit, in priority order:
manual Post-Now `posted_at` null-on-retry (`api/post-builder/post/route.ts:444`),
scheduled-publish double-publish risk, `active_listings.mls_number` global UNIQUE
→ composite `(mls_number, source_mls)`, RETS 5k-row pagination cap, weekly-report
YoY 364-day shift, flyer-PDF view misattribution, template-mutation ownership.
