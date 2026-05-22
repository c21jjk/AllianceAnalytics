import { requireAdmin } from "@/lib/auth";

/**
 * Admin gate for the Template Builder routes.
 *
 * Anything under `/admin/templates/*` requires an admin role. requireAdmin
 * hard-redirects non-admins to `/`, so the rendered children only ever
 * appear for admins. Larissa's eventual `editor` role is plumbed in
 * Phase 3 of the Template Builder rollout — for now, John-only.
 *
 * See docs/adr/0001-template-builder.md Decision 12.
 */
export default async function AdminTemplatesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  return <>{children}</>;
}
