import Link from "next/link";
import type { AuthProfile } from "@/lib/auth";
import AccountMenu from "./AccountMenu";

/**
 * Global app header. Mobile shows a small logo + name; desktop relies on the
 * sidebar to brand the page. The right side hosts the account dropdown
 * (`<AccountMenu />`), which now owns My-account / Settings / Sign-out — none
 * of those live in the sidebar anymore.
 */
export default function Header({ profile }: { profile: AuthProfile }) {
  return (
    <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-neutral-200">
      <div className="px-4 md:px-8 h-14 flex items-center justify-between">
        {/* Mobile-only logo */}
        <Link
          href="/"
          className="md:hidden flex items-center gap-2 font-semibold text-neutral-900"
        >
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-gold-500 text-white text-xs font-semibold">
            A
          </span>
          <span className="text-sm tracking-tight">Alliance Social</span>
        </Link>

        {/* Spacer on desktop (sidebar shows the logo) */}
        <div className="hidden md:block" />

        <AccountMenu profile={profile} />
      </div>
    </header>
  );
}
