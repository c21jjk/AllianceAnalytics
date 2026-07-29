# Post Builder + Template Audit, 2026-07-29

Scope: full post creation flow (build, render, caption, publish, schedule) plus all 9 published template_definitions rows and the in-code factory templates. Goal: Larissa builds a post daily with zero Studio detours. All findings verified against code (file:line) and live DB where noted.

DB reality check (last 30 days): 6 published posts have posted_at set but status is not 'posted' (bug A1 live in production). 18 rows carry an empty last_schedule_error object. 1 row (7/28) had post_type='open_house' with a non-OH design (bug B, root-caused below).

---

## A. Publish correctness

**A1. Post Now never sets status='posted'.** `app/api/post-builder/post/route.ts:541-560` updates posted_to/posted_at/permalinks but not status. `/saved-posts` filters on status (`lib/data/created-posts-db.ts:471-473`), so live posts show under Draft. Only the cron sets status. 6 affected rows in prod need backfill.

**A2. Double-publish window.** Post Now does not remove published platforms from scheduled_for, and the cron's due-platform scan (`cron/publish-scheduled/route.ts:287-294`) never consults posted_to. Schedule FB for 9:00, Post Now at 8:00, cron publishes FB again at 9:00. Fix both ends: Post Now strips published platforms from scheduled_for; cron skips platforms already in posted_to.

**A3. Cron caption gate disagrees with Post Now.** Post Now accepts any caption source (`post/route.ts:252-256`); the cron gates on the legacy caption column only (`cron:350-356`) and failAndClears, destroying the schedule for a row that has per-platform captions.

**A4. Caption wipe on failed regenerate.** `updatePostCaptionsAction` (`actions.ts:1955-1964`) writes captions with no empty-guard, and submitPostNow/submitSchedule always call it. Resume post, Generate, caption API fails (tabs blanked), Post Now: saved caption overwritten with empty, publish 412s. Also: it revalidates only /post-builder, and silently no-ops for non-owners (update matches 0 rows, no error).

**A5. Schedule success reported through the error banner.** `PostBuilderClient.tsx:3024` calls setError("Scheduled for ...") which renders in the rose alert banner with a warning icon.

**A6. Failed scheduled platforms retry every 5 minutes forever** (`cron:645-655`), no cap, no backoff, and last_schedule_error is never surfaced in the builder UI.

## B. The post_type mislabel (yesterday's bug), full root cause chain

**B1. Studio save trusts the canvas schema over the user.** `PostBuilderClient.tsx:1751/1759` writes `post_type: result.schema.category` and `template_id: result.schema.id`. The caption uses the postType state, so caption and row can disagree.

**B2. A library template's stored inner schema overrides id/category.** `schema-normalize.ts:124, 155-158` lets a template_definitions row tagged just_listed whose inner schema still says `{id:"open_house_square_v1", category:"open_house"}` win. That is exactly how JL Templates 2/3 were made (Studio duplicates of the OH design, layer ids still `oh_sq_*`). The normalizer already fixed this for `name`, not for id/category.

**B3. Render route echoes the inner schema id as template_id** (`render/route.ts:202-204, 264`), so even plain Generate stamps the wrong template_id.

**B4. Stale client state vectors.** generateFromDbTemplate does not clear aiDesign (`PostBuilderClient.tsx:3141-3153`), so Studio can open the previous AI schema after a template-card click (live mislabel path). activeDbTemplateId is never cleared on type/listing switch. localStorage restores last session's post_type on fresh mounts. Worst: `format` is restored from localStorage but the format picker was deleted, so one story_9x16 resume permanently traps the builder in 9:16 with no UI to escape and an empty template section.

**B5. Guard blast radius.** With a past OH row on the property, a mislabeled post is still hard-blocked (the 7/28 fix only covers the zero-rows case), and the cron failAndClears the schedule. Fixing B1-B4 removes the source.

**B6. No validation on template save.** `checkHardRules` (HR1 address fields, HR2 no agent on JL/JS/OH, HR3 logo >= 160px) runs only in the AI pipeline. It is never run when a template is saved to the library. HR2 also misses `hosting_agent_*` bound fields, which is what the stray layers actually use. Nothing checks layer bounds vs canvas or overlaps.

## C. Template data plumbing (why slides come out with holes)

**C1. Single-listing Open House renders with no date and no time.** generateFromDbTemplate sends no post_type and no OH window (`PostBuilderClient.tsx:3160-3169`), so hosting attribution resolves null (`render/route.ts:152-156`) and renderDbTemplate gets no open_house_start_utc/end_utc. Date and time layers drop; host phone/photo drop. Multi-OH, rerender-carousel, and mobile QuickCreate all pass the window; the main desktop path is the one that does not. Highest-value single fix.

**C2. square_feet never renders.** The render page property select omits square_feet (`app/render/template/[token]/page.tsx:367`), same in multi-oh-generate (`:497`). Every Square Ft placeholder (all three JL templates) is guaranteed blank.

**C3. The photo picker is a no-op on library templates.** generateFromDbTemplate sends hero_image_urls but renderDbTemplate (`lib/template-builder/renderer.ts:62-106`) has no photo parameter; the render page uses properties.hero_image_url only. photo_2..photo_5 always null on this path.

**C4. Studio preview lies about empty fields.** Editor keeps design-time label text when a bound field resolves empty (`CanvasEditor.tsx:1316-1320`); headless render drops the layer (`headless-render.ts:163-192`). Larissa sees a complete slide, the published PNG has holes.

**C5. Multi-OH passes only the first OH session** (`multi-oh-generate/route.ts:834`), so Sat+Sun shows only Saturday.

## D. Template layout defects (live template_definitions rows)

Rules tested: street+city only; no agent on JL/JS/OH; logo >= 160px.

- **JL Template 1 (default):** no price layer; bound logo runs 47px off the right edge (left 629 + width 498 on 1080); square_feet dead (C2).
- **JL Template 2:** OH duplicate. Stray `hosting_agent_phone` layer (rule violation, prints "...(cell)" on a JL post) colliding with the Square Ft box; eyebrow clipped at top:-23; seal image 60px off-canvas bottom; hardcoded logo src (brand_assets/Excellence swap inert); no price.
- **JL Template 3:** OH duplicate. Same stray phone layer, three-way collision with city and stats; hero photo leaves bottom 208px bare; hardcoded logo.
- **JS Template 1:** four agent layers (host name, host phone, agent headshot with hideIfEmpty:false, agent phone), two phone layers overlapping at the same spot; no price of any kind on a Just Sold post; hardcoded logo. Worst offender.
- **JS Template 2:** agent headshot + name + phone (violation); address and city boxes overlap ~100px on the same baseline; close_price bound correctly.
- **OH Main 1 (default) + OH Main:** hosting-agent block present (John's 2026-05-27 override; conflicts with the written rule, needs an explicit decision); host name box overlaps city/address baseline on both; time layer authored at negative left; hardcoded grey logo.
- **Price Reduced (default):** no city layer at all (rule violation); otherwise clean.
- **Under Contract 1 (default):** address box fits ~17 chars then collides with the overlapping city box; price layer offset 15px left of center; hardcoded logo.
- **Just Sold has no published default** (the archived row still carries is_default=true); which JS design wins is created_at-ordered chance.
- **Story 9:16 has zero library templates**; any story render falls back to factory placeholders that stamp "TEMPLATE UNDER CONSTRUCTION" on the slide.
- 6 of 9 templates hardcode the logo src, bypassing brand_assets and the Excellence-tier ($949k+) logo swap.

## E. Misc correctness

- **E1.** multi-oh-generate inserts omit test_mode (ignores global publish_test_mode). Reel inserts also omit test_mode, and saveReelAction hardcodes post_type='just_listed'.
- **E2.** Schedule time helpers use browser-local getHours() while labeled "(ET)" (`PostBuilderClient.tsx:6048-6135`); token-expiry message renders server TZ (`actions.ts:2114`). Render-path formatters are correctly pinned; this is the input side.
- **E3.** CarouselStrip badge says "9 / 10" and Add stays enabled at the real cap of 9 (`CanvasEditor.tsx:4264` missing maxSlides; picker at `:4425` has 9). Multi-OH true cap is 10 (hero dropped at publish), under-filled by one.
- **E4.** runCarouselRerender fails completely silently (`PostBuilderClient.tsx:2295-2303`) after Studio already said "Applied to N slides"; per-slide failures self-clear in 1.2s.
- **E5.** AI Design stream has no timeout or cancel; a stalled stream wedges the Generate buttons until page reload.
- **E6.** "Regenerate" after picking a non-default template card silently renders the default template (template_id sent is the synthesized string, route falls to resolveTemplateForStatus).
- **E7.** "not owner" errors: if John saves a draft and Larissa opens it, Schedule fails with an unexplained "not owner"; caption save silently no-ops.
- **E8.** Reel worker resolver drift: worker/render-page/render.js is missing square_feet, beds/baths_labeled, hosting_agent_* resolvers and implements neither hideIfEmpty nor shrink-to-fit; any library template pushed to a Reel loses its stats/agent lines. (Larger follow-up, not in the quick-fix batch.)
- **E9.** alliance-template-author SKILL.md is stale: claims square was retired (it is the only live format), references a deleted factory file, checklist contradicts the DB-first flow.
- **E10.** Shrink-to-fit applies only to bound-field layers and derives allowed lines from authored box height, so 2-line-authored boxes still collide with layers below.

---

Proposed build batches and the one open decision are in the chat summary of 2026-07-29. Numbering there maps to sections here.
