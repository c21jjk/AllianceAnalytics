import { requireUser } from "@/lib/auth";
import { TopNav, BottomNav } from "@/components/Nav";
import { getNavItems } from "@/components/nav-config";
import BackButton from "@/components/BackButton";
import LastActiveBeacon from "@/components/LastActiveBeacon";

export default async function ProtectedLayout({
  children,
  modal,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
}) {
  const profile = await requireUser();
  const items = getNavItems(profile.role);

  return (
    <div className="min-h-screen bg-gradient-to-br from-neutral-25 via-white to-gold-50/30">
      <TopNav items={items} profile={profile} />
      <main className="px-4 md:px-8 pt-6 pb-24 md:pb-12 max-w-7xl mx-auto">
        {/* Sitewide Back — auto-hides on the dashboard root. Sits above every
            page's own header/breadcrumb so it's always in the same spot. */}
        <div className="mb-4">
          <BackButton />
        </div>
        {children}
      </main>
      <BottomNav items={items} />
      {/* @modal parallel slot: renders the post-detail drawer overlay when an
          intercepting (.)posts/[id] route is matched. Empty otherwise. */}
      {modal}
      {/* Invisible heartbeat — bumps profiles.last_active_at every 5 min while
          the tab is visible so the Users page shows "Most Recent Activity"
          based on real in-app usage, not just login timestamps. */}
      <LastActiveBeacon />
    </div>
  );
}
