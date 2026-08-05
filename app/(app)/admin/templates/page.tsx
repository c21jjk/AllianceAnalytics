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
interface AdminTemplatesPageProps {
  searchParams?: Promise<{ source?: string | string[] }>;
}

export default async function AdminTemplatesPage({
  searchParams,
}: AdminTemplatesPageProps) {
  // why: layouts and pages render in parallel in the App Router, so the
  // admin layout's gate alone does not stop this page's data fetch. The
  // page must gate itself too.
  await requireAdmin();

  const templates = await listAllTemplates();

  // 2026-08-05 — /templates ("Custom Templates") was retired and now redirects
  // here with ?source=studio, which seeds the Source pill so the old view
  // lands exactly where it used to.
  const sp = (await searchParams) ?? {};
  const rawSource = Array.isArray(sp.source) ? sp.source[0] : sp.source;
  const initialSource =
    rawSource === "studio" || rawSource === "builder" ? rawSource : "all";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Template Builder"
        description="Browse, edit, and create visual templates for every post type. Each template can be tagged for one or more post types and reordered to control how it appears in the Post Builder picker. Designs saved from the Post Builder Studio live here too — filter by Saved from Studio."
      />

      <TemplateListClient templates={templates} initialSource={initialSource} />
    </div>
  );
}
