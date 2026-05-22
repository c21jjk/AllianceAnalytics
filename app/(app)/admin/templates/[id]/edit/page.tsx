import { notFound } from "next/navigation";
import { getTemplateById } from "@/lib/template-builder";
import TemplateEditorClient from "./TemplateEditorClient";

export const metadata = {
  title: "Editing template — Admin — Alliance Social",
};
export const dynamic = "force-dynamic";

/**
 * Template visual editor — Phase 2B foundation.
 *
 * Server boundary fetches the row + delegates to the client editor.
 * Phase 2B (this scaffold): format-switcher tab strip, per-format JSON
 * textarea authoring (so schemas can be saved before the visual canvas
 * editor lands), and the save-schema plumbing.
 *
 * Phase 2B-real (next session): replaces the JSON textarea with the
 * Fabric.js canvas via CanvasEditorOverlay-style integration.
 *
 * See docs/adr/0001-template-builder.md.
 */
export default async function TemplateEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const template = await getTemplateById(id);
  if (!template) notFound();

  return <TemplateEditorClient template={template} />;
}
