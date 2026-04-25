import { requireUser } from "@/lib/auth";

export const metadata = {
  title: "Dashboard — Alliance Social",
};

export default async function DashboardPage() {
  const profile = await requireUser();
  const firstName =
    profile.full_name?.split(" ")[0] ?? profile.email.split("@")[0];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-neutral-500">
          {new Date().toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </p>
        <h1 className="mt-1 text-2xl md:text-3xl font-semibold tracking-tight text-neutral-900">
          Welcome back, {firstName}.
        </h1>
        <p className="mt-2 text-neutral-600 max-w-xl">
          Alliance Social is up and running. The full dashboard — post
          performance, property-linked metrics, and weekly digests — comes
          online in Phase 3.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <PlaceholderCard
          title="Posts"
          description="Aggregated post performance across Facebook, Instagram, and TikTok."
          phase="Phase 2 + 3"
        />
        <PlaceholderCard
          title="Properties"
          description="Listings linked to social posts via MLS number."
          phase="Phase 2"
        />
        <PlaceholderCard
          title="Reports"
          description="Per-property performance reports for agents and sellers."
          phase="Phase 5"
        />
      </div>
    </div>
  );
}

function PlaceholderCard({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <h3 className="font-semibold text-neutral-900">{title}</h3>
        <span className="badge-neutral text-[10px]">{phase}</span>
      </div>
      <p className="mt-1.5 text-sm text-neutral-500">{description}</p>
    </div>
  );
}
