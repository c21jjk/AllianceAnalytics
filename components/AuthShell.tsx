import type { ReactNode } from "react";

/**
 * Logged-out page frame for /set-password and /forgot-password. Same look as
 * /login (wordmark, gold-accent card, C21 footer) so the email link lands
 * somewhere that obviously belongs to the same app.
 */
export default function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-neutral-25 via-white to-gold-50/40">
      <div className="h-1 bg-gradient-to-r from-gold-500/0 via-gold-500/60 to-gold-500/0" />

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="mb-10 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/analytics-wordmark.png"
              alt="Alliance Social Analytics"
              className="h-40 w-auto opacity-95"
            />
          </div>

          <div className="mb-6 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-1.5 text-sm text-neutral-500">{subtitle}</p>
            ) : null}
          </div>

          <div className="relative rounded-2xl border border-neutral-200 bg-white shadow-xl shadow-gold-100/40 p-7 sm:p-8">
            <div
              aria-hidden="true"
              className="absolute top-0 left-6 right-6 h-0.5 rounded-full bg-gradient-to-r from-gold-300/0 via-gold-500/60 to-gold-300/0"
            />
            {children}
          </div>

          <div className="mt-10 flex items-center justify-center gap-2 opacity-70">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/c21-seal.png"
              alt=""
              aria-hidden="true"
              className="w-6 h-7 object-contain"
            />
            <span className="text-xs text-neutral-500">
              Powered by Century 21 Alliance
            </span>
          </div>
        </div>
      </main>

      <div className="h-px bg-gradient-to-r from-gold-500/0 via-gold-500/30 to-gold-500/0" />
    </div>
  );
}
