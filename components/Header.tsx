import Link from "next/link";
import { signOut } from "@/app/login/actions";
import type { AuthProfile } from "@/lib/auth";

export default function Header({ profile }: { profile: AuthProfile }) {
  const initials =
    (profile.full_name ?? profile.email)
      .split(/\s+/)
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";

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

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col items-end leading-tight">
            <span className="text-sm font-medium text-neutral-800">
              {profile.full_name ?? profile.email.split("@")[0]}
            </span>
            <span className="text-xs text-neutral-500 capitalize">
              {profile.role}
            </span>
          </div>
          <span
            className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-gold-100 text-gold-700 text-xs font-semibold"
            aria-hidden="true"
          >
            {initials}
          </span>
          <form action={signOut}>
            <button type="submit" className="btn-secondary text-xs px-3 py-1.5">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
