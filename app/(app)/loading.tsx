/**
 * Group-level loading skeleton. Primarily covers the dashboard at
 * app/(app)/page.tsx (the group root cannot have a per-route loading
 * file of its own) and acts as the fallback for any route without a
 * closer loading.tsx. Routes with heavy fetches (posts, properties,
 * reports, coach) define their own tailored skeletons that win over
 * this one. The @modal parallel slot is unaffected: it has default.tsx
 * and this boundary wraps only the children slot.
 */
export default function AppLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <div className="space-y-3">
        <div className="h-3 w-28 animate-pulse rounded bg-neutral-200" />
        <div className="h-8 w-72 animate-pulse rounded-lg bg-neutral-200" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="h-28 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
        <div className="h-28 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
        <div className="h-28 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
      </div>
      <div className="h-64 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
    </div>
  );
}
