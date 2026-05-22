"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { saveTemplateSchemaForFormatAction } from "../../actions";
import type { TemplateDefinition } from "@/lib/template-builder";
import type { PostFormat } from "@/lib/post-builder/types";

/**
 * Template visual editor — Phase 2B FOUNDATION.
 *
 * What ships in 2B-foundation (this file):
 *   - Format-switcher tabs (Square 1:1, Portrait 4:5, Story 9:16)
 *   - Per-format JSON textarea authoring mode (paste valid JSON, save)
 *   - Save plumbing wired to saveTemplateSchemaForFormatAction
 *   - "Define this format" / "Remove this format" toggle so authors can
 *     add or drop format coverage one at a time
 *   - Live read-only preview of the parsed JSON (validates the paste)
 *
 * What ships in 2B-real (next session):
 *   - Replace the textarea with the Fabric.js canvas surface from
 *     lib/post-builder/canvas-editor/
 *   - Layer panel, placeholder picker dropdown, text/image/shape tools
 *   - Live preview against a sample listing (with bindings resolved)
 *
 * The JSON-textarea mode IS the schema-save contract — the canvas
 * editor (when it lands) will emit the same JSON shape into the same
 * server action. So Phase 2B-real becomes a UI swap, not a re-plumb.
 */

const FORMAT_TABS: Array<{ id: PostFormat; label: string; aspect: string }> = [
  { id: "square_1x1", label: "Square", aspect: "1:1" },
  { id: "portrait_4x5", label: "Portrait", aspect: "4:5" },
  { id: "story_9x16", label: "Story", aspect: "9:16" },
];

interface Props {
  template: TemplateDefinition;
}

export default function TemplateEditorClient({ template }: Props) {
  const [activeFormat, setActiveFormat] = useState<PostFormat>("portrait_4x5");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Per-tab draft buffers — editing one format's JSON doesn't lose the
  // others' unsaved work. Initialized from the saved schema.
  const [drafts, setDrafts] = useState<Record<PostFormat, string>>(() => ({
    square_1x1: stringifyOrEmpty(template.schema.square_1x1),
    portrait_4x5: stringifyOrEmpty(template.schema.portrait_4x5),
    story_9x16: stringifyOrEmpty(template.schema.story_9x16),
  }));

  const activeDraft = drafts[activeFormat];
  const savedJson = stringifyOrEmpty(template.schema[activeFormat]);
  const dirty = activeDraft !== savedJson;

  // Parse the active draft — used for both validation feedback and the
  // "live preview" panel. We tolerate empty (= format not defined).
  const parsed = useMemo(() => {
    if (activeDraft.trim().length === 0) {
      return { ok: true, value: null as unknown };
    }
    try {
      const v = JSON.parse(activeDraft);
      if (typeof v !== "object" || v === null || Array.isArray(v)) {
        return {
          ok: false,
          error: "Schema must be a JSON object (got array or primitive).",
        };
      }
      return { ok: true, value: v };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Invalid JSON.",
      };
    }
  }, [activeDraft]);

  function onDraftChange(value: string): void {
    setDrafts((prev) => ({ ...prev, [activeFormat]: value }));
    setError(null);
    setSuccess(null);
  }

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
        activeFormat,
        parsed.value,
      );
      if (result.ok) {
        setSuccess(
          parsed.value === null
            ? "Format removed."
            : "Schema saved.",
        );
        setTimeout(() => setSuccess(null), 2500);
      } else {
        setError(result.error ?? "Failed to save.");
      }
    });
  }

  function onRemoveFormat(): void {
    const confirmed = window.confirm(
      `Remove "${labelForFormat(activeFormat)}" from this template? The picker will stop showing it for that format. You can add it back any time.`,
    );
    if (!confirmed) return;
    setDrafts((prev) => ({ ...prev, [activeFormat]: "" }));
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const result = await saveTemplateSchemaForFormatAction(
        template.id,
        activeFormat,
        null,
      );
      if (result.ok) {
        setSuccess("Format removed.");
        setTimeout(() => setSuccess(null), 2500);
      } else {
        setError(result.error ?? "Failed to remove format.");
      }
    });
  }

  function onInsertStarter(): void {
    const dims = STARTER_DIMS[activeFormat];
    const starter = {
      version: 1,
      width: dims.width,
      height: dims.height,
      layers: [],
    };
    setDrafts((prev) => ({
      ...prev,
      [activeFormat]: JSON.stringify(starter, null, 2),
    }));
    setError(null);
  }

  const formatDefined = savedJson.length > 0;

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
          <div className="mt-1 text-xs text-neutral-500">
            Phase 2B foundation — JSON-textarea authoring mode. The visual
            canvas editor lands in a follow-up session.
          </div>
        </div>
      </div>

      <FormatTabs
        active={activeFormat}
        onChange={setActiveFormat}
        schema={template.schema}
      />

      {/* Status alerts */}
      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">
        {/* Editor column */}
        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-neutral-900">
                {labelForFormat(activeFormat)} schema
              </h2>
              <div className="text-xs text-neutral-500 mt-0.5">
                JSON document conforming to the canvas-editor template
                schema. Phase 2B-real replaces this with a visual canvas.
              </div>
            </div>
            <div className="flex items-center gap-2">
              {activeDraft.trim().length === 0 ? (
                <button
                  type="button"
                  onClick={onInsertStarter}
                  disabled={pending}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 transition-colors"
                >
                  Insert starter
                </button>
              ) : null}
              {formatDefined ? (
                <button
                  type="button"
                  onClick={onRemoveFormat}
                  disabled={pending}
                  className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60 transition-colors"
                >
                  Remove format
                </button>
              ) : null}
              <button
                type="button"
                onClick={onSave}
                disabled={pending || !parsed.ok || !dirty}
                className="rounded-md bg-gold-500 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-gold-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                {pending ? "Saving…" : "Save schema"}
              </button>
            </div>
          </div>

          <textarea
            value={activeDraft}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder='{\n  "version": 1,\n  "width": 1080,\n  "height": 1350,\n  "layers": []\n}'
            spellCheck={false}
            className="block w-full rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 font-mono text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-gold-500 focus:outline-none focus:ring-2 focus:ring-gold-500/30"
            style={{ minHeight: 360, resize: "vertical" }}
          />

          {!parsed.ok ? (
            <div className="text-xs text-rose-700">
              <span className="font-semibold">JSON parse error:</span>{" "}
              {parsed.error}
            </div>
          ) : activeDraft.trim().length === 0 ? (
            <div className="text-xs text-neutral-500">
              Empty — this format will be undefined on the template (picker
              hides it for that aspect ratio).
            </div>
          ) : (
            <div className="text-xs text-emerald-700">Valid JSON.</div>
          )}
        </div>

        {/* Sidebar: placeholder reference */}
        <PlaceholderReference />
      </div>
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
        Tokens you can reference in text layers. At render time they&apos;re
        replaced with the live listing&apos;s values. See{" "}
        <code className="bg-neutral-100 px-1 rounded">bindings.ts</code> for
        the full contract.
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

/**
 * Stringify a schema-for-format into a textarea-ready string. Returns
 * empty string for null/undefined so the textarea reads as "format not
 * defined" rather than literal "null".
 */
function stringifyOrEmpty(value: unknown): string {
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function labelForFormat(f: PostFormat): string {
  const tab = FORMAT_TABS.find((t) => t.id === f);
  return tab ? `${tab.label} ${tab.aspect}` : f;
}

/** Canonical dimensions per format — used by the "Insert starter" button. */
const STARTER_DIMS: Record<PostFormat, { width: number; height: number }> = {
  square_1x1: { width: 1080, height: 1080 },
  portrait_4x5: { width: 1080, height: 1350 },
  story_9x16: { width: 1080, height: 1920 },
};
