import { notFound } from "next/navigation";
import { getTemplateById } from "@/lib/template-builder";
import TemplateDetailClient from "./TemplateDetailClient";

export const metadata = { title: "Template — Admin — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * Template detail + edit page.
 *
 * Phase 2A: full metadata editing + lifecycle controls (rename, change
 * post-types, publish/draft/archive, clone, delete) live in the client
 * component below. The visual canvas editor at /edit lands in Phase 2B.
 *
 * Server boundary just fetches the row and hands it down — keeps auth
 * (via the admin layout) + data fetch on the server, interactive UI on
 * the client.
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

  return <TemplateDetailClient template={template} />;
}
