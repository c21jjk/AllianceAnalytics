import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getCredential } from "@/lib/data/credentials";
import PageHeader from "@/components/PageHeader";
import CredentialForm from "@/components/CredentialForm";
import {
  getPlatformDef,
  type CredentialPlatform,
  PLATFORMS,
} from "../../../credentialSchemas";
import { upsertCredential } from "../../../actions";

interface PageProps {
  params: Promise<{ platform: string }>;
}

export const dynamic = "force-dynamic";

const VALID = new Set(PLATFORMS.map((p) => p.platform));

export async function generateMetadata({ params }: PageProps) {
  const { platform } = await params;
  return { title: `Edit ${platform} credentials — Alliance Social` };
}

export default async function EditCredentialPage({ params }: PageProps) {
  await requireAdmin();
  const { platform } = await params;
  const decoded = decodeURIComponent(platform);
  if (!VALID.has(decoded as CredentialPlatform)) notFound();

  const platformId = decoded as CredentialPlatform;
  const def = getPlatformDef(platformId);
  const row = await getCredential(platformId);

  // Server-only: split the credentials jsonb into non-secret echoes (which
  // we hand to the client form) and a presence map for secrets (so the form
  // can render "value on file" without ever shipping the secret).
  const credObj: Record<string, unknown> =
    row?.credentials && typeof row.credentials === "object"
      ? (row.credentials as Record<string, unknown>)
      : {};

  const initialNonSecret: Record<string, string> = {};
  const hasSecret: Record<string, boolean> = {};
  for (const field of def.fields) {
    const v = credObj[field.key];
    if (field.secret) {
      hasSecret[field.key] =
        typeof v === "string" ? v.trim().length > 0 : v != null;
    } else if (typeof v === "string") {
      initialNonSecret[field.key] = v;
    } else if (v != null) {
      initialNonSecret[field.key] = String(v);
    }
  }

  const isActive = row?.is_active ?? true;
  const boundAction = upsertCredential.bind(null, platformId);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/settings" className="hover:text-neutral-800">
          Settings
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-neutral-700">API credentials</span>
        <span aria-hidden="true">/</span>
        <span className="text-neutral-700 font-mono">{platformId}</span>
      </div>

      <PageHeader
        title={`Edit ${def.label} credentials`}
        description={def.description}
      />

      <div className="rounded-xl border border-neutral-200 bg-white shadow-card p-6">
        <CredentialForm
          def={def}
          initialNonSecret={initialNonSecret}
          hasSecret={hasSecret}
          isActive={isActive}
          action={boundAction}
        />
      </div>
    </div>
  );
}
