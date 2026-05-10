import { redirect } from "next/navigation";

interface PageProps {
  params: Promise<{ mls: string }>;
}

/**
 * Legacy redirect — listing edit now lives at /properties/[mls]/edit.
 */
export default async function EditListingRedirectPage({ params }: PageProps) {
  const { mls } = await params;
  redirect(`/properties/${encodeURIComponent(mls)}/edit`);
}
