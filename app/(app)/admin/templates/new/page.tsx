import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import NewTemplateForm from "./NewTemplateForm";

export const metadata = {
  title: "New template — Admin — Alliance Social",
};

/**
 * Create-a-template page.
 *
 * Server component shell — auth is handled by the parent admin layout.
 * The form itself is a client component so it can manage local state
 * (which post-type checkboxes are ticked, inline error display) without
 * a server-round-trip per keystroke.
 *
 * On submit, the form invokes createTemplateAction; that action either
 * redirects (on success) or returns the error envelope which the form
 * surfaces inline.
 */
export default function NewTemplatePage() {
  return (
    <div className="space-y-6 max-w-2xl">
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
        eyebrow="Admin · Template Builder"
        title="New template"
        description="Create a draft template. You'll design its visual layout in the editor — but first, give it a name and pick which post types it applies to. You can change everything later."
      />

      <NewTemplateForm />
    </div>
  );
}
