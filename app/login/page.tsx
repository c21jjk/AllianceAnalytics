import { Suspense } from "react";
import LoginForm from "./LoginForm";

export const metadata = {
  title: "Sign in — Alliance Social Analytics",
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-neutral-25 via-white to-gold-50/40">
      {/* Top gold accent line — matches the dashboard nav cue so the visual
          handoff between login and the app feels seamless. */}
      <div className="h-1 bg-gradient-to-r from-gold-500/0 via-gold-500/60 to-gold-500/0" />

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Brand wordmark — bigger here than in the nav since this is a
              brand moment. Wide horizontal lockup centered. */}
          <div className="mb-10 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/analytics-wordmark.png"
              alt="Alliance Social Analytics"
              className="h-20 w-auto opacity-95"
            />
          </div>

          {/* Welcome message */}
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
              Welcome back
            </h1>
            <p className="mt-1.5 text-sm text-neutral-500">
              Sign in to your dashboard
            </p>
          </div>

          {/* Form card — slightly elevated with a soft gold-tinted glow so
              the brand follows through. Subtle border, generous padding. */}
          <div className="relative rounded-2xl border border-neutral-200 bg-white shadow-xl shadow-gold-100/40 p-7 sm:p-8">
            {/* Top gold accent strip on the card itself */}
            <div
              aria-hidden="true"
              className="absolute top-0 left-6 right-6 h-0.5 rounded-full bg-gradient-to-r from-gold-300/0 via-gold-500/60 to-gold-300/0"
            />
            <Suspense fallback={<div className="h-40" />}>
              <LoginForm searchParamsPromise={searchParams} />
            </Suspense>
          </div>

          {/* Footer — discreet attribution + admin note */}
          <div className="mt-10 flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 opacity-70">
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
            <p className="text-center text-xs text-neutral-400 max-w-sm">
              Accounts are provisioned by your administrator. If you need
              access, contact your Alliance broker.
            </p>
          </div>
        </div>
      </main>

      {/* Bottom accent line for visual balance with the top */}
      <div className="h-px bg-gradient-to-r from-gold-500/0 via-gold-500/30 to-gold-500/0" />
    </div>
  );
}
