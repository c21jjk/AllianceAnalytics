import Link from "next/link";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { getTemplateById } from "@/lib/template-builder";

export const metadata = { title: "Template — Admin — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * Template detail / editor stub.
 *
 * Phase 1: read-only display of the row's metadata. Phase 2 replaces
 * this page with the WYSIWYG canvas editor (built on top of the existing
 * CanvasEditorOverlay). The route shell exists now so the admin list
 * view's "Open →" links land somewhere meaningful.
 *
 * See docs/adr/0001-template-builder.md.
 */
export default async function AdminTemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const template = await getTemplateById(id);
  if (!template) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/templates"
          className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900"
        >
          <span aria-hidden="true">←</span>
          Back to all templates
        </Link>
      </div>

      <PageHeader
        eyebrow="Template"
        title={template.name}
        description={
          template.description ??
          "No description. Add one when the visual editor lands in Phase 2."
        }
      />

      <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-900">
        <strong>Phase 1 stub.</strong> The visual editor is part of Phase 2 of
        the Template Builder rollout. For now this page just shows the row&apos;s
        stored metadata; schema editing requires SQL via the Supabase MCP.
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-5">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              State
            </dt>
            <dd className="mt-0.5 text-neutral-900">{template.publish_state}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Display order
            </dt>
            <dd className="mt-0.5 text-neutral-900 tabular-nums">
              {template.display_order}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Post types
            </dt>
            <dd className="mt-0.5 text-neutral-900">
              {template.post_types.join(", ")}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Supported formats
            </dt>
            <dd className="mt-0.5 text-neutral-900">
              {Object.keys(template.schema).length === 0
                ? "—"
                : Object.keys(template.schema).join(", ")}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Created
            </dt>
            <dd className="mt-0.5 text-neutral-900">
              {new Date(template.created_at).toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Updated
            </dt>
            <dd className="mt-0.5 text-neutral-900">
              {new Date(template.updated_at).toLocaleString()}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
