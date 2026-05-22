"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { saveTemplateSchemaForFormatAction } from "../../actions";
import TemplateCanvasEditor from "./TemplateCanvasEditor";
import type { TemplateDefinition } from "@/lib/template-builder";
import type {
  PostFormat,
  PostBuilderListing,
} from "@/lib/post-builder/types";

/**
 * Template visual editor — Session A.
 *
 * The page is now organized as:
 *   1. Header strip: template name + back link
 *   2. Format-switcher tabs (Square / Portrait / Story) with
 *      "defined" indicator dots
 *   3. Per-format card showing the current state + "Open visual editor"
 *      CTA that pops up the canvas overlay
 *   4. Collapsible "Raw schema (advanced)" panel — the JSON textarea
 *      fallback for admins who want to hand-author or paste a schema
 *      without the visual editor. Useful for debugging + power-user
 *      flows. Same save plumbing as the canvas editor.
 *   5. Placeholder reference sidebar (unchanged from foundation)
 *
 * The canvas editor mounts as a modal overlay (it IS the existing
 * CanvasEditorOverlay used by Post Builder Studio) — it's not inline
 * on this page.
 */

const FORMAT_TABS: Array<{ id: PostFormat; label: string; aspect: string }> = [
  { id: "portrait_4x5", label: "Portrait", aspect: "4:5" },
  { id: "story_9x16", label: "Story", aspect: "9:16" },
];

interface Props {
  template: TemplateDefinition;
  /** Sample listing fetched server-side. Used by the canvas editor as
   *  visual context (real photos, real text). Null when DB has no
   *  active listings. */
  sampleListing: PostBuilderListing | null;
}

export default function TemplateEditorClient({
  template,
  sampleListing,
}: Props) {
  const [activeFormat, setActiveFormat] = useState<PostFormat>("portrait_4x5");
  const [canvasOpen, setCanvasOpen] = useState(false);

  return (
    <div className="space-y-5">
      <div>
        <Link
          href={`/admin/templates/${template.id}`}
          className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900"
        >
          <span aria-hidden="true">←</span>
          Back to template detail
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.1em] text-gold-700 mb-1">
            Editing template
          </div>
          <h1 className="text-2xl font-bold text-neutral-900 leading-tight">
            {template.name}
          </h1>
          <div className="mt-1 text-xs text-neutral-500 max-w-2xl">
            Pick a format below and click <strong>Open visual editor</strong> to
            design with the Fabric.js canvas. Each format has its own schema —
            you save one at a time.
          </div>
        </div>
      </div>

      <FormatTabs
        active={activeFormat}
        onChange={setActiveFormat}
        schema={template.schema}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
        <div className="space-y-5">
          <ActiveFormatCard
            template={template}
            format={activeFormat}
            onOpenCanvas={() => setCanvasOpen(true)}
          />

          <RawSchemaPanel
            template={template}
            format={activeFormat}
          />
        </div>

        <PlaceholderReference />
      </div>

      <TemplateCanvasEditor
        template={template}
        format={activeFormat}
        sampleListing={sampleListing}
        open={canvasOpen}
        onClose={() => setCanvasOpen(false)}
      />
    </div>
  );
}

function FormatTabs({
  active,
  onChange,
  schema,
}: {
  active: PostFormat;
  onChange: (f: PostFormat) => void;
  schema: TemplateDefinition["schema"];
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg bg-neutral-100 p-1">
      {FORMAT_TABS.map((t) => {
        const isActive = t.id === active;
        const isDefined = schema[t.id] !== null && schema[t.id] !== undefined;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={[
              "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-white text-neutral-900 shadow-sm"
                : "text-neutral-600 hover:text-neutral-900",
            ].join(" ")}
          >
            {t.label}
            <span className="text-[10px] font-mono text-neutral-500">
              {t.aspect}
            </span>
            {isDefined ? (
              <span
                aria-hidden="true"
                className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500"
                title="Defined"
              />
            ) : (
              <span
                aria-hidden="true"
                className="inline-block w-1.5 h-1.5 rounded-full bg-neutral-300"
                title="Not defined"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

function ActiveFormatCard({
  template,
  format,
  onOpenCanvas,
}: {
  template: TemplateDefinition;
  format: PostFormat;
  onOpenCanvas: () => void;
}) {
  const formatTab = FORMAT_TABS.find((t) => t.id === format);
  const defined = template.schema[format] !== null && template.schema[format] !== undefined;

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">
            {formatTab?.label} {formatTab?.aspect}
          </h2>
          <div className="text-xs text-neutral-500 mt-0.5">
            {defined
              ? "This format has a saved schema. Open the visual editor to make changes."
              : "This format isn't defined yet. Opening the editor will start you with a blank canvas at the right dimensions — design from scratch."}
          </div>
        </div>
        <span
          aria-hidden="true"
          className={[
            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
            defined
              ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
              : "bg-neutral-100 text-neutral-600 ring-neutral-200",
          ].join(" ")}
        >
          {defined ? "Defined" : "Not defined"}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onOpenCanvas}
          className="inline-flex items-center gap-1.5 rounded-md bg-gold-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-gold-600 transition-colors"
        >
          <CanvasIcon />
          {defined ? "Open visual editor" : "Start designing this format"}
        </button>
      </div>
    </div>
  );
}

/**
 * Raw JSON view — collapsible. Useful for:
 *   • Power users who want to author/paste a schema directly
 *   • Debugging when the canvas editor produces unexpected output
 *   • Bulk find/replace edits
 *
 * Lives in a <details> so it's hidden by default — visual editor is the
 * primary surface.
 */
function RawSchemaPanel({
  template,
  format,
}: {
  template: TemplateDefinition;
  format: PostFormat;
}) {
  const savedJson = stringifyOrEmpty(template.schema[format]);
  const [draft, setDraft] = useState(savedJson);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = draft !== savedJson;

  const parsed = useMemo(() => {
    if (draft.trim().length === 0) {
      return { ok: true, value: null as unknown };
    }
    try {
      const v = JSON.parse(draft);
      if (typeof v !== "object" || v === null || Array.isArray(v)) {
        return {
          ok: false,
          error: "Schema must be a JSON object.",
        };
      }
      return { ok: true, value: v };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Invalid JSON.",
      };
    }
  }, [draft]);

  function onSave(): void {
    if (!parsed.ok) {
      setError(parsed.error ?? "Invalid JSON.");
      return;
    }
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await saveTemplateSchemaForFormatAction(
        template.id,
        format,
        parsed.value,
      );
      if (result.ok) {
        setSuccess("Schema saved.");
        setTimeout(() => setSuccess(null), 2500);
      } else {
        setError(result.error ?? "Failed to save.");
      }
    });
  }

  return (
    <details className="card p-5 group">
      <summary className="cursor-pointer text-sm font-semibold text-neutral-700 hover:text-neutral-900 select-none flex items-center gap-2">
        <span className="text-neutral-400 group-open:rotate-90 transition-transform inline-block">
          ▸
        </span>
        Raw schema (advanced)
      </summary>

      <div className="mt-4 space-y-3">
        <div className="text-xs text-neutral-500">
          Hand-author or paste a CanvasTemplateSchema JSON document. Same save
          plumbing as the visual editor — handy for debugging, bulk
          find/replace, or working without the canvas.
        </div>

        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
            setSuccess(null);
          }}
          placeholder="(empty — format not defined)"
          spellCheck={false}
          className="block w-full rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/30"
          style={{ minHeight: 220, resize: "vertical" }}
        />

        {!parsed.ok ? (
          <div className="text-xs text-rose-700">
            <span className="font-semibold">JSON error:</span> {parsed.error}
          </div>
        ) : draft.trim().length === 0 ? (
          <div className="text-xs text-neutral-500">
            Empty — saving will undefine this format.
          </div>
        ) : (
          <div className="text-xs text-emerald-700">Valid JSON.</div>
        )}

        {error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
            {error}
          </div>
        ) : null}
        {success ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {success}
          </div>
        ) : null}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onSave}
            disabled={pending || !parsed.ok || !dirty}
            className="rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-neutral-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {pending ? "Saving…" : "Save raw schema"}
          </button>
        </div>
      </div>
    </details>
  );
}

function PlaceholderReference() {
  // Mirrors lib/template-builder/bindings.ts. Listed here for author
  // discoverability — Phase 2B-real wires this into a dropdown picker.
  const groups = [
    {
      label: "Address",
      items: [
        ["{address}", "Street address (+ unit suffix)"],
        ["{city}", "City"],
        ["{state}", "State"],
        ["{zip}", "ZIP"],
        ["{unit_number}", "Unit identifier alone"],
      ],
    },
    {
      label: "Price + specs",
      items: [
        ["{price}", "List price ($1,234,567)"],
        ["{sold_price}", "Sold price ($1,234,567)"],
        ["{beds}", "Bedroom count"],
        ["{baths}", "Full baths"],
        ["{half_baths}", "Half baths"],
        ["{property_type}", "Property type"],
      ],
    },
    {
      label: "Agent + OH",
      items: [
        ["{agent_name}", "Listing or hosting agent"],
        ["{hosting_agent}", "Open House host"],
        ["{oh_window}", "Sat · 10 AM–12 PM"],
        ["{oh_day}", "Sat"],
        ["{oh_time}", "10 AM–12 PM"],
      ],
    },
    {
      label: "Imagery",
      items: [
        ["{hero_photo}", "Listing hero image URL"],
        ["{photo_1}–{photo_5}", "Additional photos"],
        ["{brand_logo}", "C21 Alliance logo"],
        ["{agent_headshot}", "Agent headshot"],
      ],
    },
    {
      label: "MLS",
      items: [["{mls_hashtag}", "#CMC261228 / #NJBL2078123"]],
    },
  ];

  return (
    <aside className="card p-5">
      <h2 className="text-sm font-semibold text-neutral-900 mb-3">
        Placeholders
      </h2>
      <p className="text-xs text-neutral-600 mb-3">
        Tokens you can use in text layers. At render time they&apos;re replaced
        with the live listing&apos;s values. (Type the token literally for now;
        a dropdown picker lands in a follow-up session.)
      </p>
      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">
              {g.label}
            </div>
            <dl className="space-y-0.5">
              {g.items.map(([token, desc]) => (
                <div
                  key={token}
                  className="flex items-baseline gap-2 text-xs"
                >
                  <dt>
                    <code className="bg-neutral-100 px-1 py-0.5 rounded font-mono text-[11px] text-neutral-800">
                      {token}
                    </code>
                  </dt>
                  <dd className="text-neutral-600 truncate">{desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </aside>
  );
}

function CanvasIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
      <path d="M2.5 11l3.5-3.5 3 3 4-4" />
      <circle cx="11" cy="5.5" r="1" />
    </svg>
  );
}

function stringifyOrEmpty(value: unknown): string {
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}
