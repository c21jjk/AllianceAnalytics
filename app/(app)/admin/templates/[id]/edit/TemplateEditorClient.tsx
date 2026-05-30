"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import TemplateCanvasEditor from "./TemplateCanvasEditor";
import type { TemplateDefinition } from "@/lib/template-builder";
import type { PostBuilderListing } from "@/lib/post-builder/types";

/**
 * Template editor entry — opens straight into Studio.
 *
 * 2026-05-30 rework: the old intermediate "format-picker" page (Portrait /
 * Story tabs + per-format card + raw-schema box) is gone. Every template is a
 * single 1080×1080 square now, so there's nothing to pick — clicking
 * "Edit in Studio" on the detail page lands the admin directly in the Fabric
 * canvas with the template's EXISTING design loaded. Closing Studio returns to
 * the template detail page.
 *
 * The canvas overlay (CanvasEditorOverlay, via TemplateCanvasEditor) reads
 * `template.schema.square_1x1` and mounts it; the Save flow (save to this
 * template / save as new / set default) is unchanged.
 */

interface Props {
  template: TemplateDefinition;
  /** Sample listing fetched server-side — gives the canvas realistic photos
   *  and text while authoring. Null when the DB has no active listings. */
  sampleListing: PostBuilderListing | null;
}

export default function TemplateEditorClient({
  template,
  sampleListing,
}: Props) {
  const router = useRouter();

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      {/* Shown only behind the overlay (e.g. briefly while Studio mounts, or
          if the overlay is closing). */}
      <div className="text-center text-sm text-neutral-500">
        <p>
          Opening{" "}
          <span className="font-medium text-neutral-800">{template.name}</span>{" "}
          in Studio…
        </p>
        <Link
          href={`/admin/templates/${template.id}`}
          className="mt-2 inline-block text-gold-700 hover:text-gold-800"
        >
          ← Back to template detail
        </Link>
      </div>

      <TemplateCanvasEditor
        template={template}
        format="square_1x1"
        sampleListing={sampleListing}
        open
        onClose={() => router.push(`/admin/templates/${template.id}`)}
      />
    </div>
  );
}
