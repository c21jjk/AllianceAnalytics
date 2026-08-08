import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { listAllListingSkipMarks } from "@/lib/data/listing-skip-marks";
import PageHeader from "@/components/PageHeader";
import DismissedListingsTable, {
  type DismissedListingRow,
} from "@/components/DismissedListingsTable";

export const metadata = { title: "Dismissed listings — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * Admin audit view for listings that were manually dismissed from the
 * dashboard "needs Larissa's attention" strip. Shows who dismissed each
 * listing, when, and why — with a one-click Restore action that puts the
 * listing back in the strip if it still has no Just Listed post.
 */
export default async function PromotionsPage() {
  await requireAdmin();

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("properties")
    .select(
      "id, mls_number, source_mls, address, city, state, list_price, listing_date, hero_image_url, agent_name, promotion_dismissed_at, promotion_dismissed_by, promotion_dismissed_reason",
    )
    .not("promotion_dismissed_at", "is", null)
    .order("promotion_dismissed_at", { ascending: false })
    .limit(200);

  const dismissedRows = (rows ?? []) as Array<{
    id: string;
    mls_number: string;
    source_mls: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    list_price: number | null;
    listing_date: string | null;
    hero_image_url: string | null;
    agent_name: string | null;
    promotion_dismissed_at: string | null;
    promotion_dismissed_by: string | null;
    promotion_dismissed_reason: string | null;
  }>;

  // Resolve dismissed_by uuids → display names + emails.
  const dismisserIds = Array.from(
    new Set(
      dismissedRows
        .map((r) => r.promotion_dismissed_by)
        .filter((x): x is string => !!x),
    ),
  );
  const profilesById = new Map<string, { email: string; full_name: string | null }>();
  if (dismisserIds.length > 0) {
    const { data: profileRows } = await admin
      .from("profiles")
      .select("id, email, full_name")
      .in("id", dismisserIds);
    for (const p of profileRows ?? []) {
      profilesById.set(p.id, { email: p.email, full_name: p.full_name });
    }
  }

  const tableRows: DismissedListingRow[] = dismissedRows.map((r) => {
    const dismisser = r.promotion_dismissed_by
      ? profilesById.get(r.promotion_dismissed_by) ?? null
      : null;
    return {
      mls_number: r.mls_number,
      source_mls: r.source_mls,
      address: r.address,
      city: r.city,
      state: r.state,
      list_price: r.list_price === null ? null : Number(r.list_price),
      listing_date: r.listing_date,
      hero_image_url: r.hero_image_url,
      agent_name: r.agent_name,
      dismissed_at: r.promotion_dismissed_at,
      dismissed_reason: r.promotion_dismissed_reason,
      dismissed_by_name: dismisser?.full_name ?? dismisser?.email ?? null,
      post_type: "just_listed" as const,
    };
  });

  // 2026-08-07 (John) — per-milestone skips now live in listing_skip_marks,
  // and this page is the ONLY way back once a skipped row ages past the 7-day
  // window and leaves its dashboard card. Merged in alongside the legacy
  // property-wide dismissals above.
  const skipRows = await listAllListingSkipMarks(200);
  const skipMls = Array.from(new Set(skipRows.map((r) => r.mls_number)));
  const propsByMls = new Map<
    string,
    {
      mls_number: string;
      source_mls: string | null;
      address: string | null;
      city: string | null;
      state: string | null;
      list_price: number | null;
      listing_date: string | null;
      hero_image_url: string | null;
      agent_name: string | null;
    }
  >();
  if (skipMls.length > 0) {
    const { data: skipProps } = await admin
      .from("properties")
      .select(
        "mls_number, source_mls, address, city, state, list_price, listing_date, hero_image_url, agent_name",
      )
      .in("mls_number", skipMls);
    for (const p of skipProps ?? []) {
      propsByMls.set(p.mls_number, p as never);
    }
  }

  for (const skip of skipRows) {
    // A just_listed skip may ALSO have a legacy row above; don't list it twice.
    if (
      skip.post_type === "just_listed" &&
      tableRows.some((t) => t.mls_number === skip.mls_number)
    ) {
      continue;
    }
    const p = propsByMls.get(skip.mls_number);
    tableRows.push({
      mls_number: skip.mls_number,
      source_mls: p?.source_mls ?? null,
      address: p?.address ?? null,
      city: p?.city ?? null,
      state: p?.state ?? null,
      list_price: p?.list_price === null || p?.list_price === undefined ? null : Number(p.list_price),
      listing_date: p?.listing_date ?? null,
      hero_image_url: p?.hero_image_url ?? null,
      agent_name: p?.agent_name ?? null,
      dismissed_at: skip.skipped_at,
      dismissed_reason: skip.reason,
      dismissed_by_name: null,
      post_type: skip.post_type,
    });
  }

  tableRows.sort((a, b) =>
    (b.dismissed_at ?? "").localeCompare(a.dismissed_at ?? ""),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-neutral-500">
        <Link href="/settings" className="hover:text-neutral-800">
          Settings
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-neutral-700">Dismissed listings</span>
      </div>

      <PageHeader
        title="Dismissed listings"
        description="Listings staff have skipped from a dashboard milestone card. Skips are per milestone, so skipping a Just Sold leaves that listing's Price Change alone. Restore puts it back."
      />

      <section>
        <DismissedListingsTable rows={tableRows} />
      </section>
    </div>
  );
}
