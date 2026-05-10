import { requireUser } from "@/lib/auth";
import { TopNav, BottomNav } from "@/components/Nav";
import { getNavItems } from "@/components/nav-config";

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
        {children}
      </main>
      <BottomNav items={items} />
      {/* @modal parallel slot: renders the post-detail drawer overlay when an
          intercepting (.)posts/[id] route is matched. Empty otherwise. */}
      {modal}
    </div>
  );
}
