---
name: alliance-template-author
description: Author or modify a CanvasTemplateSchema for the AllianceSocialAnalytics Post Builder canvas editor (Path C, Fabric.js). Use whenever the request involves creating a new social-post template, porting an existing V1 template into the canvas editor, adding a category (Just Listed / Just Sold / Open House / Under Contract / Price Reduced), authoring a variant in a new aspect ratio (portrait 4:5 or story 9:16 — Square 1:1 was retired 2026-05-22), or fixing a template that fails the editor's dimension invariant. Also use when reviewing template code for brand/MLS-binding correctness. Even when the user says only "make a new post layout" or "I need a sold template", treat this as a template-authoring task — the canvas editor is the system of record for AllianceAnalytics post templates going forward.
---

# Alliance Template Author

You are authoring a `CanvasTemplateSchema` for the AllianceSocialAnalytics Post Builder canvas editor. This is the layer-tree JSON document that the Fabric.js-based editor consumes to render an editable post, with MLS listing data bound into placeholder fields.

**Where templates live now (2026-05-30 library-first consolidation).** The single source of truth for approved templates is the `template_definitions` Supabase table, not code files. Each row stores a per-format schema family (`schema[format]` is a `CanvasTemplateSchema`) and is what the "Choose a template" picker and the status-driven render path resolve. The old in-code factory registry (`lib/post-builder/canvas-editor/templates/`) is now a FROZEN hidden fallback only — do NOT add new templates there. Author the schema with this skill, then land it as a `template_definitions` row (see "Where the finished template goes" below). The schema-authoring craft in this skill is unchanged; only the destination moved from a `.ts` file to a DB row.

This skill assumes you already understand: the project tech stack (Next.js 15, strict TS, Tailwind), the brand (Alliance gold #C9A961, Obsessed grey #18181B, Inter + Georgia type), and the Post Builder structure. Read those from the project's CLAUDE.md and memory if you don't.

## When to use this skill

Trigger this skill whenever the user asks to:

- Create a new template (any category × variant × format)
- Add a new aspect ratio of an existing variant
- Fix a template that errors on load or export
- Audit an existing template for brand/MLS-binding correctness

If the user is asking about the editor *runtime* (selection, layers, panels), not template content, that's a different task — defer to reading `lib/post-builder/canvas-editor/CanvasEditor.tsx`.

## Read these files first

Always start by reading the schema source-of-truth so you reference real type names, not your memory of them:

1. `lib/post-builder/canvas-editor/types.ts` — `CanvasTemplateSchema`, `CanvasLayer`, `TextLayer`, `ImageLayer`, `ShapeLayer`, `BoundField`, `PLATFORM_DIMENSIONS`
2. `lib/post-builder/canvas-editor/templates/tokens.ts` — `ALLIANCE_COLORS`, `ALLIANCE_FONTS`
3. The hero-editorial template factory — the canonical reference for v1 layouts across all 5 post types × 2 formats:
   - `lib/post-builder/canvas-editor/templates/hero-editorial-factory.ts` — single source of truth for the v1 schema, parameterized by `(postType, format)`. Contains the per-format layout numbers (1080×1350 portrait / 1080×1920 story) AND the per-post-type theming config (eyebrow text, price mode, optional badge stamp, optional open-house line).

Skip this step at your peril — type names, exact enum values, and tokens change as the project evolves, and templates that reference stale names won't compile.

## Reference the factory only as a STARTING POINT

The frozen factory schemas (`lib/post-builder/canvas-editor/templates/`, e.g. `hero-editorial-factory.ts`) are still the best canonical reference for a correct, on-brand `CanvasTemplateSchema` across the 5 post types × 2 formats. Read them to copy the layout numbers, theming config, and layer structure. But they are now a frozen fallback, not a destination — you are authoring a schema to store in a `template_definitions` row (see step 10), not adding to that registry. Treat the factory output as the shape your row's `schema[format]` should match.

## Authoring procedure

Follow these steps in order. Each is a real check the next step depends on.

### 1. Confirm the (category, variant, format) tuple with the user

Before writing anything, confirm:

- **Category** — one of `just_listed | just_sold | under_contract | open_house | price_reduction` (these are V1 `PostType` values, re-exported from canvas-editor types)
- **Variant** — `v1 | v2 | v3 | v4 | v5`. v1–v3 are single-photo designs; v4 takes 2 photos; v5 takes 3
- **Format** — `portrait_4x5 | story_9x16` (Square 1:1 was retired 2026-05-22)

If the user describes the intent in words ("a sold post with the stats prominent on Instagram feed"), translate to the tuple and confirm before authoring.

### 2. Verify the template doesn't already exist

Check `lib/post-builder/canvas-editor/templates/index.ts` and `findCanvasTemplate(category, variant, format)` — if a template for the tuple already exists, ask the user whether to replace it or duplicate as a new variant.

### 3. Use the platform-correct canvas dimensions

The editor enforces this invariant on load and refuses to export malformed templates:

```
portrait_4x5 → 1080 × 1350
story_9x16   → 1080 × 1920
```

Set `width` and `height` on the schema to match `PLATFORM_DIMENSIONS[format]` exactly. Do not improvise — even 1px off (`1081 × 1080`) breaks export.

### 4. Plan the layer tree before writing code

On paper or in a comment, list the layers in z-order from bottom to top. A typical "hero photo + scrim + type stack" layout looks like:

```
z=0  hero_photo            full-bleed listing photo, cover-fit, bound to hero_photo
z=1  dark_overlay          black rect at 0.65 opacity over the text band
z=2  gold_accent_rule      thin gold rect above the eyebrow label
z=3  status_label          "JUST LISTED" — bound to status_label
z=4  address               bound to address_line1
z=5  city_state_zip        bound to city_state_zip
z=6  price                 bound to price (gold)
z=7  beds_baths            bound to beds_baths
z=8  office_footer         bound to office_name
z=9  mls_number            small mono caption — bound to mls_number
```

Adjust for the design's intent. Keep z monotonically increasing — gaps are fine, ordering matters.

### 5. Respect aspect-ratio safe zones

The bottom-band-of-type pattern works at both formats, but the **safe zones** differ:

**Portrait 4:5 (1080 × 1350)** — generous vertical room. Photo can dominate the top ~65%; text band at the bottom ~35% (≈470px tall). Keep the gold accent and status label in the top 200px so they're visible even when the feed shows a smaller crop preview.

**Story 9:16 (1080 × 1920)** — has hard safe zones because IG/FB/TikTok overlay their own UI:

- **Top safe zone:** 0–250px. Avoid placing critical text here; this is where the profile chip + story progress bars sit. Place the eyebrow/status_label around y=140–200.
- **Bottom safe zone:** 1720–1920px (200px tall). Send-arrow / reply UI lives here. Never put price, address, or footer below y=1720.
- **Sweet spot:** y=1120–1700 for the dark scrim + type stack. Make the price huge here — thumb-stopping scale.

If you must place type outside the safe band (e.g., a centered eyebrow at the very top), bump it to at least y=140 and confirm with the user that they understand it may collide with platform UI on some devices.

### 6. Pick the right layer kind for each slot

The discriminated union enforces this at compile time, but plan ahead:

- **TextLayer** — any string from the listing or hand-authored ("LUNCH PROVIDED" etc.). All text bound fields are `TextBoundField` members.
- **ImageLayer** — listing photos, agent headshots, brokerage logos. All image bound fields are `ImageBoundField` members.
- **ShapeLayer** — rectangles (overlay scrims, dividers), circles (avatars, badges), ellipses, lines. No fill needed — set `fill: ""` for outlined-only.
- **GroupLayer** — reserved, do not use yet. The editor skips group layers silently in Phase 1.

### 7. Use the brand tokens, not raw hex

In every template file:

```ts
import { ALLIANCE_COLORS, ALLIANCE_FONTS } from "./tokens";
```

Then reference `ALLIANCE_COLORS.gold500`, `ALLIANCE_FONTS.displaySerif`, etc. Do not inline `"#C9A961"` even when correct — when the brand evolves, we want a single-file change.

If you genuinely need a non-brand color (a transparent-black overlay scrim that doesn't map to any token), use a literal hex and add a `// why:` comment explaining why a token wasn't appropriate.

### 8. Bind fields, don't hardcode

For any value that should come from the active listing, set `boundField` and leave `text` (or `src`) as a fallback that renders when the listing is null/empty.

```ts
{
  kind: "text",
  text: "$929,000",          // shown if price is null
  boundField: "price",       // resolves to formatted USD at hydration
  ...
}
```

The editor's hydrator prefers `boundField` and falls back to `text` only when the resolved value is empty. The "fallback" string is also what the user sees in the templates panel preview before a listing is selected.

**Bound field naming — exact strings only.** Refer to `TextBoundField` and `ImageBoundField` in `types.ts`. Common values:

Text: `price`, `close_price`, `address_line1`, `city_state_zip`, `beds_baths`, `mls_number`, `status_label`, `tagline`, `agent_name`, `office_name`, `open_house_date`, `open_house_time`.

Image: `hero_photo`, `photo_2`, `photo_3`, `photo_4`, `photo_5`, `agent_photo`, `office_logo`, `brokerage_logo`.

**TS will catch a typo at compile time.** If you write `"adress_line1"` (missing letter), the build fails with a clear union-mismatch error. Trust the compiler over your memory.

### 9. Always set `crossOrigin: "anonymous"` on ImageLayer

The type system requires this — the field is `"anonymous"` literal. The reason is critical: any image loaded without this flag taints the canvas, and `toDataURL()` throws SecurityError at export. We can't render the post.

If a future image source doesn't send `Access-Control-Allow-Origin` headers, the fix is server-side (proxy through Supabase Storage or a CORS-correct endpoint) — never `crossOrigin: undefined`.

### 10. Where the finished template goes — a `template_definitions` row

Approved templates live in the `template_definitions` table, NOT in a code file. The schema you authored becomes the row's `schema[format]` value. Two ways to land it, in order of preference:

1. **Admin Template Builder (recommended for humans).** `/admin/templates` → New template → open the canvas editor (the SAME `CanvasEditor`), paste/build the layout, set post type(s) + format, then publish. Saving there writes the `template_definitions` row directly.
2. **Studio "Save as Template."** From the Post Builder, open a listing in Studio, build the layout, and use "Save as Template" — it writes a `source='studio'`, published row via `saveStudioTemplate`.

If you must insert programmatically (e.g., seeding), write the row through the Supabase MCP (`apply_migration` / `execute_sql`) into `template_definitions` with: `post_types` (array), `schema` = `{ "<format>": <CanvasTemplateSchema> }`, `publish_state='published'`, `source` (`'builder'` or `'studio'`), and `is_default` only if it should be the slot's pre-selected pick. Never paste SQL into the Supabase web editor.

Do NOT add the template to `lib/post-builder/canvas-editor/templates/index.ts`. That factory registry is a frozen hidden fallback; new entries there will not appear in the picker (which reads `template_definitions`).

### 11. Validate the schema before saving

The CanvasEditor enforces the same invariants at load/export that the old factory's `validateCanvasTemplates` did: exact `PLATFORM_DIMENSIONS[format]` dimensions, non-empty layers, unique layer ids, a `hero_photo`-bound image layer, `schemaVersion: 1`, and well-formed gradient fills. If you authored the schema as a temporary `.ts` object to typecheck it, run `npx tsc --noEmit` (zero errors means bound-field names + dimensions are correct types) — but the file is scratch only; the deliverable is the `template_definitions` row. A malformed schema shows as a disabled Save button + red warning in the editor.

Do not finalize until the editor accepts it and tsc (if used for scratch validation) is clean — committing clean is a project standing rule.

## Common footguns

A list of mistakes I've seen or made. Read this before writing code.

**Dimension drift.** Setting `width: 1080, height: 1081` (or any off-by-one) is the #1 cause of "the editor opens but the Save button is disabled and there's a red warning at the top." The dimensions invariant is checked at runtime, not just at compile time, because nothing stops a literal `1081` from being a valid number. Match `PLATFORM_DIMENSIONS[format]` exactly.

**z-order vs array order.** The editor renders by `z`, not by array order in `layers`. If your hero photo has `z: 5` and your dark overlay has `z: 1`, the photo is on top and the overlay is invisible. Lower z = farther back.

**Forgetting `lineHeight` on text.** Default 1.0 looks cramped; 1.05–1.2 reads better. Display type (headlines) is closer to 1.05; body text wants 1.2–1.3.

**`charSpacing` units.** Fabric uses 1/1000 em, NOT pixels. `charSpacing: 200` is 0.2em — roughly the "letter-spacing: 0.2em" of CSS. For all-caps labels (status_label), 200–300 reads as proper editorial tracking. For body text, 0–100.

**`fontWeight` literals.** The type accepts only `100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900`. Don't write `"bold"` (string) — TS will reject it.

**Image `objectFit: "cover"` without clipping.** Cover-fit scales the image to fill, but Fabric draws beyond the layer bounds. The editor's createFabricImage handles this via a `clipPath` if `cornerRadius > 0` — for sharp-cornered cover crops where you genuinely want the overflow hidden, set `cornerRadius: 0` and trust the scrim/border layers above to mask the bleed visually.

**Hardcoding the agent or office.** Use `boundField: "agent_name"` and `boundField: "office_name"`. The MLSListingPayload mapper falls back to the listing's own `listing_office_name` if the agent context didn't pass an override — so don't hardcode "Century 21 Alliance" as literal text; bind and rely on the fallback chain.

**Status label literal vs bound.** "JUST LISTED" is the auto-generated label for `status: "active"`. If the user wants a different word ("NEW PRICE", "PENDING SALE"), they can edit the text in the canvas after open. Don't hardcode unusual labels in the template's `text` field unless that template is intentionally specific (e.g., a "Coming Soon" variant).

**Story format text too close to the top.** Top 100–140px is the Story safe zone. If the eyebrow's `top` is `60`, it'll overlap the profile chip on every Instagram render. Push to `top: 140` or below.

**Skipping `editable: true`.** The default for `editable` in a TextLayer should be `true` for fields the user can override (price, address, eyebrow). Setting `false` locks the text — useful for footer boilerplate like "MLS #" but counter-productive on the main fields.

## Layout patterns by format

A starting grid for each aspect ratio. These are reference points, not rules — break them when the design wants it, but explain why in a comment.

### Portrait 4:5 (1080 × 1350) — "hero + bottom band"

```
y=0     ┌────────────────────┐
        │                    │
        │   hero photo       │  (covers 0–1350)
        │                    │
        │                    │
y=880   ├────────────────────┤  ← dark overlay (h=470, opacity 0.65)
        │  STATUS LABEL      │  y≈80
        │  Address           │  y≈960, fontSize 56-64
        │  City, ST 00000    │  y≈1055, fontSize 24-28
        │  $XXX,000          │  y≈1125, fontSize 80-90 (gold)
        │  4 BR / 3 BA       │  y≈1255, fontSize 20-24
y=1350  └────────────────────┘
```

### Story 9:16 (1080 × 1920) — respect platform UI safe zones

```
y=0     ┌────────────────────┐  ← TOP SAFE: 0–250 (avoid critical content here)
y=140   │  ── status label   │
y=200   │                    │
        │   hero photo       │  (covers 0–1920)
        │                    │
        │                    │
y=1120  ├────────────────────┤  ← dark overlay (h=800, opacity 0.65)
        │  Address           │  y≈1220, fontSize 70-80
        │  City, ST 00000    │  y≈1340, fontSize 28-32
        │  $XXX,000          │  y≈1430, fontSize 96-120 (gold, thumb-stopping)
        │  4 BR / 3 BA       │  y≈1590, fontSize 24-32
        │  CENTURY 21 ALL.   │  y≈1700
y=1720  └────────────────────┘  ← BOTTOM SAFE: 1720–1920 (avoid all content)
```

## When the user describes "what they want" loosely

If the brief is "make a sold post with a big number that pops", translate before authoring:

1. Category → `just_sold`
2. The "big number that pops" → either `price` (list price) or `close_price` (final). Sold posts often emphasize close_price.
3. Format → ask, or default to portrait_4x5 (best IG feed performance)
4. Variant → if it's a single-photo design, v1. If they describe stats overlaid on the photo, v2 ("Bold Stats"). If side-by-side photo and data card, v3.

Confirm the tuple back with one short sentence and proceed: *"Authoring `just_sold v1 portrait_4x5` — sold post with close_price as the hero number. Will use the hero-band layout from `just-listed-hero-portrait.ts` as a starting frame. Sound good?"*

## What this skill does NOT cover

- **Editor runtime behavior** (selection, layer panel, export pipeline). Read `CanvasEditor.tsx`.
- **The overlay shell or how the editor is launched.** Read `CanvasEditorOverlay.tsx` + the variant-card wiring in `PostBuilderClient.tsx`.
- **Server-side persistence** (uploading the rendered PNG, saving the schema to Supabase). That's Step 3+ — not in scope yet.
- **V1 Post Builder render pipeline.** The headless-Chromium renderer under `lib/post-builder/render.ts` and the `lib/post-builder/templates/registry.ts` system is a separate, V1-locked path. Don't touch it.

## After authoring — checklist

Before reporting "done" to the user, run through:

- [ ] `width` and `height` exactly match `PLATFORM_DIMENSIONS[format]`
- [ ] Every `ImageLayer` has `crossOrigin: "anonymous"` (TS-enforced, but visually verify)
- [ ] All `boundField` values are exact members of `TextBoundField` / `ImageBoundField`
- [ ] All colors use `ALLIANCE_COLORS.*` tokens (exception: scrim overlays, with a why-comment)
- [ ] All fonts use `ALLIANCE_FONTS.*` tokens
- [ ] Story templates respect top (≤250px) and bottom (≥1720px) safe zones
- [ ] Template is imported and registered in `templates/index.ts`
- [ ] `npx tsc --noEmit` is clean
- [ ] Each text layer has `editable: true` unless intentionally locked
- [ ] z-order ascends bottom-to-top with no overlapping critical layers

Show the user the file paths you created/modified and the verification output. Don't commit — the user runs commits manually through GitHub Desktop per the project's standing rules.
