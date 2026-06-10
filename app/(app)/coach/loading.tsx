/** Loading skeleton for /coach while AI insights are fetched. */
export default function CoachLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading coach">
      <div className="space-y-3">
        <div className="h-3 w-20 animate-pulse rounded bg-neutral-200" />
        <div className="h-8 w-48 animate-pulse rounded-lg bg-neutral-200" />
      </div>
      <div className="h-40 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="h-32 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
        <div className="h-32 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
      </div>
    </div>
  );
}
