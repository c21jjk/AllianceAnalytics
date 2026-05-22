import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { listAllTemplates } from "@/lib/template-builder";
import type { TemplateMeta } from "@/lib/template-builder";

export const metadata = { title: "Template Builder — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * Template Builder — admin list view.
 *
 * Phase 1: read-only browse of every template in the DB. No editor yet
 * (that's Phase 2). Empty state on first load since the table starts
 * empty. The admin can seed templates by inserting rows via the
 * Supabase MCP until the visual editor ships.
 *
 * See docs/adr/0001-template-builder.md.
 */
export default async function AdminTemplatesPage() {
  const templates = await listAllTemplates();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Template Builder"
        description="Browse, edit, and create visual templates for every post type. Templates are organized by status — each one can be tagged for one or more post types and reordered to control how it appears in the Post Builder picker."
      />

      <div className="flex items-center justify-between gap-4">
        <div className="text-sm text-neutral-600">
          {templates.length === 0
            ? "No templates yet."
            : `${templates.length} template${templates.length === 1 ? "" : "s"}`}
        </div>
        {/* Phase 2 wires this to /admin/templates/new. Phase 1 stub so the
            affordance is visible. */}
        <button
          type="button"
          disabled
          title="The visual editor lands in Phase 2 — until then templates can be seeded via SQL."
          className="inline-flex items-center gap-1.5 rounded-md bg-neutral-200 px-3 py-1.5 text-sm font-medium text-neutral-500 cursor-not-allowed"
        >
          <span aria-hidden="true">＋</span>
          New template
        </button>
      </div>

      {templates.length === 0 ? <EmptyState /> : <TemplateTable templates={templates} />}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50/60 px-6 py-12 text-center">
      <div className="text-base font-semibold text-neutral-900">
        No templates created yet.
      </div>
      <div className="mt-1 text-sm text-neutral-600 max-w-md mx-auto">
        The visual editor lands in Phase 2 of the Template Builder rollout. Until
        then, the Post Builder + multi-OH wizard continue to use the existing
        hand-coded variants (v2 / v3 / v6 / v8). New DB-defined templates
        seeded here will appear in the picker the moment they&apos;re marked
        published.
      </div>
    </div>
  );
}

function TemplateTable({
  templates,
}: {
  templates: readonly TemplateMeta[];
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-xs uppercase tracking-wider text-neutral-600">
          <tr>
            <th className="px-4 py-2.5 text-left font-semibold">Name</th>
            <th className="px-4 py-2.5 text-left font-semibold">Post types</th>
            <th className="px-4 py-2.5 text-left font-semibold">Formats</th>
            <th className="px-4 py-2.5 text-left font-semibold">State</th>
            <th className="px-4 py-2.5 text-left font-semibold">Order</th>
            <th className="px-4 py-2.5 text-left font-semibold">Updated</th>
            <th className="px-4 py-2.5 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200">
          {templates.map((t) => (
            <TemplateRow key={t.id} template={t} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TemplateRow({
  template,
}: {
  template: TemplateMeta;
}) {
  return (
    <tr className="hover:bg-neutral-50/60 transition-colors">
      <td className="px-4 py-3">
        <div className="font-medium text-neutral-900">{template.name}</div>
        {template.description ? (
          <div className="text-xs text-neutral-500 mt-0.5 line-clamp-1">
            {template.description}
          </div>
        ) : null}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {template.post_types.map((pt) => (
            <span
              key={pt}
              className="inline-flex items-center rounded-full bg-gold-50 px-2 py-0.5 text-[11px] font-medium text-gold-800 ring-1 ring-gold-200"
            >
              {prettyPostType(pt)}
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-1">
          {template.supported_formats.length === 0 ? (
            <span className="text-xs text-neutral-400 italic">
              No formats defined
            </span>
          ) : (
            template.supported_formats.map((fmt) => (
              <FormatChip key={fmt} format={fmt} />
            ))
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <PublishStateBadge state={template.publish_state} />
      </td>
      <td className="px-4 py-3 text-neutral-700 tabular-nums">
        {template.display_order}
      </td>
      <td className="px-4 py-3 text-neutral-600 text-xs">
        {new Date(template.updated_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </td>
      <td className="px-4 py-3 text-right">
        {/* Phase 2 wires this link to the editor route. Phase 1 it's a stub
            placeholder so the row's action column doesn't read empty. */}
        <Link
          href={`/admin/templates/${template.id}`}
          className="text-xs font-semibold text-gold-700 hover:text-gold-900 hover:underline"
        >
          Open →
        </Link>
      </td>
    </tr>
  );
}

function FormatChip({ format }: { format: string }) {
  const label =
    format === "square_1x1"
      ? "1:1"
      : format === "portrait_4x5"
        ? "4:5"
        : format === "story_9x16"
          ? "9:16"
          : format;
  return (
    <span className="inline-flex items-center rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-mono font-medium text-neutral-700">
      {label}
    </span>
  );
}

function PublishStateBadge({ state }: { state: string }) {
  const styles =
    state === "published"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
      : state === "draft"
        ? "bg-amber-50 text-amber-800 ring-amber-200"
        : "bg-neutral-100 text-neutral-600 ring-neutral-200";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${styles}`}
    >
      {state}
    </span>
  );
}

function prettyPostType(pt: string): string {
  switch (pt) {
    case "just_listed":
      return "Just Listed";
    case "open_house":
      return "Open House";
    case "under_contract":
      return "Under Contract";
    case "just_sold":
      return "Just Sold";
    case "price_reduction":
      return "Price Reduced";
    default:
      return pt;
  }
}
