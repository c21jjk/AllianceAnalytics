import PageHeader from "@/components/PageHeader";
import { requireAdmin } from "@/lib/auth";
import { listAllTemplates } from "@/lib/template-builder";
import TemplateListClient from "./TemplateListClient";

export const metadata = { title: "Template Builder — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * Template Builder — admin list view.
 *
 * Server boundary fetches every template (any state) and hands them to
 * the client list for filtering + reorder + navigation. Lifecycle +
 * metadata editing lives on the detail page; the visual canvas editor
 * is Phase 2B (route `/admin/templates/[id]/edit`).
 *
 * See docs/adr/0001-template-builder.md.
 */
export default async function AdminTemplatesPage() {
  // why: layouts and pages render in parallel in the App Router, so the
  // admin layout's gate alone does not stop this page's data fetch. The
  // page must gate itself too.
  await requireAdmin();

  const templates = await listAllTemplates();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Template Builder"
        description="Browse, edit, and create visual templates for every post type. Each template can be tagged for one or more post types and reordered to control how it appears in the Post Builder picker."
      />

      <TemplateListClient templates={templates} />
    </div>
  );
}
