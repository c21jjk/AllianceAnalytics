"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Error boundary for every signed-in app route. Renders inside the
 * protected layout, so the nav stays up and only the page body is
 * replaced with this card. reset() re-renders the failed segment.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // why: surfaces the real error in the browser console (and Vercel logs
    // pick up the server-side digest) without exposing it in the UI.
    console.error(error);
  }, [error]);

  return (
    <div className="flex justify-center pt-12 md:pt-20">
      <div className="card w-full max-w-md p-8 text-center">
        <div className="eyebrow mb-2">Alliance Social</div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          This page hit an unexpected error. Your data is safe, and trying
          again usually clears it.
        </p>
        <div className="mt-6">
          <button type="button" onClick={reset} className="btn-primary">
            Try again
          </button>
        </div>
        <Link
          href="/"
          className="mt-4 inline-block text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-700"
        >
          Dashboard
        </Link>
      </div>
    </div>
  );
}
