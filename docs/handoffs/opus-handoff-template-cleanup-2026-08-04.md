# Build Handoff: Template Library Cleanup + Code Fixes

**For:** Opus build session · **From:** investigation session 2026-08-04 (John approved the plan; rule change incorporated)
**Project:** AllianceAnalytics (Century 21 Alliance social tool) · repo `c21jjk/AllianceAnalytics`, Next.js 15 + Supabase + Vercel
**App:** https://www.alliancesocialanalytics.com · **Supabase project_id:** `rhkgowpjfpqbrdmgsccx` ("Alliance Social" — NOT "Alliance Listings"/"Alliance Dash")

---

## 0. Standing rules and environment (read first)

1. **Git commits/pushes: GitHub Desktop ONLY.** Never run shell git in the mounted repo. Any git operation on the Cowork mount leaves an undeletable `index.lock` that blocks GitHub Desktop (if it happens: `mv .git/index.lock _to_delete/` — mv works, rm does not). When code is done, tell John the files are ready to commit and push; Vercel deploys on push.
2. **DB changes: Supabase MCP** (`execute_sql` / `apply_migration`), project_id above. The 7/29 template repairs were applied via direct SQL with no migration files; that is the accepted pattern for `template_definitions` content edits.
3. **Repo on John's machine** is mounted at `/sessions/<session>/mnt/AllianceAnalytics` (device_bash) — `ls mnt/` from the device_bash home to confirm the session path. Edit flow that works: `device_stage_files` the target files → copy staged files from `/mnt/user-data/uploads/...` to /tmp (uploads dir is read-only) → Edit → `SendUserFile` → `device_commit_files` back to the device path. npm cannot install into the mount; don't try.
4. **Typecheck before handing files to John** — full `tsc` recipe that works from the cloud container:
   - `device_bash`: `cd <mount>/AllianceAnalytics && tar czf _to_delete_tscheck.tgz --exclude node_modules --exclude .next --exclude .git lib app components tsconfig.json next-env.d.ts package.json package-lock.json` then `mv _to_delete_tscheck.tgz _to_delete/` after staging.
   - Stage the tgz, extract to `/tmp/repo`, overlay your edited files, `npm ci --ignore-scripts` (~1 min), `npx tsc --noEmit`. Expect 0 errors. (A `/tmp/repo` from the prior session may already exist with node_modules installed; reuse it and just overlay.)
5. **Order of operations matters:** code fixes (Section 2) must be committed by John and DEPLOYED before you do the Studio re-saves in Section 5, because the current deployed hard-rule checker will *reject* saving a Just Sold template that carries agent layers (rule changed 8/04, see below), and the current deployed `listings.ts` bug makes the template editor preview OH templates against a non-OH listing.
6. Browser QA uses the claude-in-chrome tools (invoke the `claude-in-chrome` skill first; John must pick the browser if more than one is connected). John's Chrome is logged into the app as admin.
7. John's chat/docs style: **no em dashes**.

### Design rules in force (updated 2026-08-04)

- Address on cards = street + city ONLY. Never state/zip.
- **RULE CHANGE 8/04 (John):** "Just Sold & Open Houses can now have Agents photo & name." So: `agent_name` + `agent_photo` are now ALLOWED (optional) on **just_sold**. `agent_phone` was NOT mentioned — keep phone off Just Sold. **Just Listed stays 100% agent-free.** Open House keeps its REQUIRED hosting block (name + headshot + cell) — unchanged.
- Brokerage logo mandatory on every template, min width 160px (aim ≥280px), "C21" gold #C9A84C + "ALLIANCE" dark/white.
- No emojis in canvas text (captions may have them).
- Brand palette: Obsessed Grey `#252526`, Relentless Gold `#C9A84C`, white. Gold is an accent, never large blocks.
- Font tokens already in the app (see `lib/post-builder/canvas-editor/templates/tokens.ts` + `primitives/font-options.ts`): Kaushan Script (JL script), DM Serif Display (JS serif), Allura (OH script), Nunito (JL body), Glacial Indifference (JS body), Livvic (OH body).
- Per-type recipes (Larissa's gold standards): JL = photo ~85% + dark bottom band + huge script eyebrow; JS = full-bleed photo + white inset frame (stroke ~7, ~40px inset) + top-center C21 lockup + gold address pill + serif SOLD + price; OH = airy/white, rounded-corner photo ~50% of canvas, date/time top, script "Open" + sans "HOUSE", hosting block bottom-right, logo bottom. UC and PR have no reference recipe yet; derive from the brand DNA above, matter-of-fact tone for PR (never desperate).

---

## 1. Verified findings you are building against (do not re-investigate)

**Table `template_definitions`** (jsonb `schema.square_1x1.layers`; "uses" is computed from `generated_posts`, not a column):

| id | name | post_types | state | default | notes |
|---|---|---|---|---|---|
| 115a9e98 | Just Listed - Template 1 | just_listed | published | yes | CLEAN except price layer (id `jl1_price_20260729`) has wrong display name "Street Address" |
| eae49244 | Just Listed - Template 2 | just_listed | published | no | MISSING `price` boundField layer |
| 4e39f91a | Just Listed - Template 3 | just_listed | published | no | CLEAN |
| edbe758b | Just Sold - Template 1 | just_sold | published | yes | has agent_name + agent_phone + agent_photo; **NO brokerage_logo at all** |
| d374486e | Just Sold - Template 2 | just_sold | published | no | CLEAN (logo w477) |
| 68d0396e | Just Sold | just_sold | **archived** | no | salvageable: has close_price + logo(280), no agent layers; MISSING `city` layer |
| 66744851 | Open House - Main | open_house | published | no | 11 layers, full OH field set, 1 use; near-duplicate of 7c4a206b |
| 7c4a206b | Open House Template - Main 1 | open_house | published | **yes** | 11 layers, 8 uses, the proven default |
| c408e039 / 1ab42008 | Audit Test — Multi-OH Larissa / Retest Unified OH | open_house | archived | no | test debris, no logo layer; leave archived, do NOT resurrect |
| fa8915ec | Price Reduced | price_reduction | published | yes | CLEAN (9 layers: address_line1, city, price, hero_photo, logo w280) |
| 308792ec | Under Contract - Template 1 | under_contract | published | yes | CLEAN (12 layers incl. price, logo w348) |

- All rows define `square_1x1` only; `display_order` = 0 everywhere (picker order currently undefined beyond `is_default desc, created_at desc` in `listStudioTemplatesForSlot`, `lib/template-builder/storage.ts:560-581`).
- **Preview mismatch mechanism:** admin list thumbnail is ONLY the stored `preview_image_url` (`app/(app)/admin/templates/TemplateListClient.tsx:163-195`, dashed "None" fallback if null; no live render). Previews were snapshotted at first save with a real listing hydrated; the 7/29 direct-SQL repairs never regenerated them, so 9 of 12 are timestamp-stale. Regeneration works via the admin Studio save (`app/(app)/admin/templates/actions.ts:302-361`, `saveTemplateSchemaForFormatAction` uploads to `template-previews/…`) — proven working 8/04 on Just Sold - Template 1.
- **OH sample-listing bug (root cause, confirmed):** `lib/post-builder/listings.ts` applies `.limit(limit)` to the BASE properties query (line ~68) BEFORE the open_house post-filter (lines ~119-161). The template editor calls it with `limit: 1` (`app/(app)/admin/templates/[id]/edit/page.tsx:80-83`), so the one fetched active listing is almost never one with an upcoming OH → bucket returns `[]` → editor falls back to a just_listed sample → OH-bound layers show literal `{open_house_date}` tokens. The bucket data itself is fine (2 upcoming-OH listings verified: MLS 261962, 261877).
- **Pending publish-route bug (approved earlier, not yet built):** `app/api/post-builder/post/route.ts` fires `notifyListingAgentsForPost(..., send_emails: true)` at ~line 646 whenever `successResults.length > 0 && gp.property_id`, with NO test-mode gate (the auto-reel call ~line 719 HAS `!test_mode`). Test-mode publishes therefore email real agents about hidden posts. `const test_mode = gp.test_mode === true;` is defined at ~line 294.
- Canvas layers store bound-field fallback text as literal tokens like `{open_house_date}` — that is the normal storage format, not corruption. `fabric-factory.ts:524` renders `resolvedText || layer.text`.
- Studio "Save as Template" validation runs the extended hard-rule checker (`lib/post-builder/canvas-editor/ai/hard-rule-checker.ts`): HR2 agent restrictions, HR3 logo mandatory ≥160px, HR10 OH hosting block required, HR11 off-canvas check (4px tolerance, text + non-photo images only).
- Inner `schema.square_1x1.id` / `.category` must stay synced to the ROW's identity (7/28 mislabel root cause; `lib/template-builder/storage.ts:441-474` normalizes with the row winning). When you duplicate a row, update the inner schema id/category to the new row's identity convention.

---

## 2. Code fixes (build first; one batch for John to push)

### 2.1 `lib/post-builder/listings.ts` — OH bucket limit bug
- In `fetchListingsForPostBuilder`, stop letting the caller's `limit` truncate the open_house candidate pool before the OH filter: at the base query (`.limit(limit)`, ~line 68) use `.limit(opts.post_type === "open_house" ? Math.max(limit, 200) : limit)` (or equivalent), and enforce the caller cap at the end with `return listings.slice(0, limit)` (safe for all post types; place just before the final return, after the OH filter/attach block).
- Add `{ nullsFirst: false }` to the `.order("listing_date", { ascending: false })` calls in the open_house and price_reduction branches (~lines 96/103): a NULL `listing_date` row currently sorts first under DESC and can poison small-limit queries.
- Comment the why (this bug made the template editor sample a non-OH listing for OH templates on 8/04).

### 2.2 `lib/template-builder/storage.ts` — stale-thumbnail guard
- In `updateTemplate` (~lines 225-228): when `patch.schema !== undefined` and the caller did NOT supply a new `preview_image_url`, set `preview_image_url = null` in the update. Combined with the existing "None" fallback in `TemplateListClient.tsx:171-177`, a schema edit that can't produce a fresh preview shows an honest "None" instead of a stale image. Make sure the admin Studio save path (which DOES supply a preview) is unaffected, and that `saveStudioTemplate`'s existing "empty preview keeps old" behavior (storage.ts:545-548) is reconciled with this (an empty-string preview on a schema update should also null rather than keep).

### 2.3 `app/api/post-builder/post/route.ts` — test-mode agent-email guard
- Change the agent-notification gate at ~line 646 from `if (successResults.length > 0 && gp.property_id)` to also require `!test_mode`. Leave the `notifyAdmins` push alone. Comment: test-mode posts are hidden/draft on-platform; agents must not be told to engage with them (same rationale as the auto-reel guard ~line 719).

### 2.4 `lib/post-builder/canvas-editor/ai/hard-rule-checker.ts` — 8/04 rule change
- HR2 currently forbids agent_*/hosting_agent_* on restricted categories incl. just_sold. Update so **just_sold allows `agent_name` and `agent_photo`** (and their hosting_ equivalents if the checker treats them together) but still forbids `agent_phone` / `agent_email` / `agent_title` on just_sold, and still forbids ALL agent fields on just_listed. Open house rules unchanged (hosting block required).
- Also update the AI Design prompts so generated designs match policy: `lib/post-builder/canvas-editor/ai/brand-prompt.ts` — wherever LAYOUT_PROMPT / CRITIQUE_PROMPT states "no agent on Just Sold", amend to "agent name + photo optional on Just Sold (no phone); Just Listed stays agent-free".

### 2.5 Verify + hand off
- Full tsc per Section 0.4 (expect 0 errors). Commit files back to the device via `device_commit_files`. Tell John exactly which files changed and ask him to commit + push via GitHub Desktop. **Wait for the Vercel deploy to be live before starting Section 4/5** (check a deployed marker, e.g. fetch the template editor page for an OH template and confirm the sample listing now has OH data, or use the Vercel MCP list_deployments).

---

## 3. Naming + ordering scheme (target state)

Pattern: `<Category> - Template <N>`, `display_order` = N-1 within each category, exactly one `is_default` per category (keep current defaults unless noted):

| Category | Template 1 (default) | Template 2 | Template 3 |
|---|---|---|---|
| Just Listed | JL-1 (115a9e98) | JL-2 (eae49244) | JL-3 (4e39f91a) |
| Just Sold | JS-1 (edbe758b, fixed) | JS-2 (d374486e) | resurrected 68d0396e → "Just Sold - Template 3" |
| Open House | 7c4a206b → rename "Open House - Template 1" (stays default) | 66744851 → rename "Open House - Template 2" + visually differentiate | NEW row "Open House - Template 3" |
| Under Contract | 308792ec (rename "Under Contract - Template 1" if not already) | NEW "Under Contract - Template 2" | NEW "Under Contract - Template 3" |
| Price Reduction | fa8915ec → rename "Price Reduction - Template 1" (stays default) | NEW "Price Reduction - Template 2" | NEW "Price Reduction - Template 3" |

Leave archived test rows (c408e039, 1ab42008) archived. Do not delete anything.

---

## 4. DB template work (Supabase MCP, direct SQL on `template_definitions`)

General mechanics for every schema edit below:
- Edit `schema` jsonb (`square_1x1.layers` array). Bump the inner `updatedAt`. Keep inner `id`/`category` synced to row identity.
- After ANY schema change via SQL, set `preview_image_url = NULL` on that row (with fix 2.2 deployed the list will show "None" until the Studio re-save in Section 5 regenerates it).
- New rows: new UUID id, `publish_state='published'`, `source='builder'`, correct `post_types` array, `is_default=false`, set `display_order` per Section 3, `preview_image_url=NULL`.
- Layer objects follow the existing shape in each row's schema (copy a sibling layer and adjust). Respect HR11: keep text layers inside the 1080×1080 canvas (4px tolerance).
- Fetch each row's current schema first and work from it; do not write schemas blind.

### 4.1 Repairs to existing rows
1. **JS-1 (edbe758b):** remove the `agent_phone` layer only (agent_name + agent_photo now allowed and stay). ADD a `brokerage_logo` image layer, width ≥280px, placed per the JS recipe (top-center C21 lockup zone or wherever the current composition has room; mirror JS-2's logo styling, w477 there). Confirm close_price layer intact.
2. **JL-2 (eae49244):** add a `price` boundField text layer (list price), Nunito, styled/positioned consistent with JL-1/JL-3's price treatment.
3. **JL-1 (115a9e98):** rename the layer with id `jl1_price_20260729` from "Street Address" to "Price" (display name only).
4. **Resurrect 68d0396e:** add a `city` text layer (paired under/next to its address_line1 per the JS recipe), rename row to "Just Sold - Template 3", `publish_state='published'`, display_order=2.
5. **Renames/order only** (no schema change, so leave previews alone): 7c4a206b → "Open House - Template 1" (display_order 0, keep is_default), 66744851 → "Open House - Template 2" (display_order 1) BUT see 4.2.1 — it also gets a visual differentiation, which IS a schema change. fa8915ec → "Price Reduction - Template 1". 308792ec name already fine. Set display_order across all rows per Section 3.

### 4.2 New/differentiated designs (5 builds)
Each must contain: address_line1 + city, hero_photo, brokerage_logo ≥280px, price (list price; close_price for JS), and for OH: open_house_date, open_house_time, hosting_agent_name, hosting_agent_photo, hosting_agent_phone. No state/zip anywhere. No agent fields on UC/PR.

1. **Open House - Template 2 differentiation (66744851):** it is currently a near-pixel twin of Template 1. Make it visually distinct: invert to a dark variant — background Obsessed Grey #252526, white/gold text, keep the rounded-corner centered photo (~50%), Allura script "Open" + Livvic "HOUSE" in white, date/time in a gold pill top-left, hosting block bottom-right (headshot circle + name + cell in white), logo bottom-left in the white-on-dark lockup. Keep all 11 boundFields.
2. **Open House - Template 3 (new row):** photo-forward variant — hero photo ~70% top, white band bottom ~30%; script "Open House" overlapping the photo/band boundary (JL-style crossing trick but with Allura); date/time inline under the script; address + city left, hosting block right, logo centered-bottom.
3. **Under Contract - Template 2 (new):** adapt the JL recipe — photo 85%, dark #252526 bottom band, "Under Contract" as Kaushan Script eyebrow crossing the boundary in white, Nunito body (address, city, price), logo right side of band. Start from JL-1's schema as the skeleton (swap eyebrow text, keep field set minus beds/baths if crowded).
4. **Under Contract - Template 3 (new):** airy light variant — white background, rounded-corner photo ~55% centered-upper, "UNDER CONTRACT" in DM Serif Display tracking-wide over a thin gold rule, address/city/price stacked below photo, logo bottom-center.
5. **Price Reduction - Template 2 (new):** adapt the JS recipe — full-bleed photo, white inset frame (stroke 7, 40px inset), top-center C21 lockup, gold pill with address, "NEW PRICE" in DM Serif Display with the price beneath in Glacial Indifference. Matter-of-fact, not desperate; no strikethrough gimmicks (no old-price field exists anyway).
6. **Price Reduction - Template 3 (new):** derive from UC-2's dark-band layout with "Price Improved" script eyebrow (Kaushan), price prominent in the band in gold, address/city in white.

(That is 6 items because OH-2's differentiation replaced one "new build"; net published per category = 3/3/3/3/3.)

---

## 5. Preview regeneration + visual QA (Chrome, AFTER deploy of Section 2)

For each of the 15 published templates:
1. Admin → `/admin/templates` → Open → Edit in Studio. Confirm the canvas hydrates with a sensible sample listing (OH templates must now show real date/time/host thanks to fix 2.1). The amber strip, if shown, is dismissible and must not block the toolbar (shipped earlier 8/04).
2. Eyeball against the design rules (logo present + legible, street+city only, no forbidden agent fields, layers on-canvas).
3. Save via "Save Changes to Existing Template" — this uploads a fresh `template-previews/…` PNG and fixes the stale-thumbnail problem John screenshotted.
4. Back on the list page, confirm the thumbnail now matches what Studio shows.
Then spot-check the Post Builder: each category tab shows 3 template cards in the right order with correct previews; Generate one render for OH/JS/UC to confirm nothing regressed. Do NOT click Post Now on anything (and note the test-mode email fix only takes effect after John's push).

## 6. Report back to John
- List of changed code files (for GitHub Desktop), confirmation tsc was clean, per-template before/after summary, any template where you made a judgment call Larissa may want to restyle, and anything you could not complete. No em dashes in the writeup.
