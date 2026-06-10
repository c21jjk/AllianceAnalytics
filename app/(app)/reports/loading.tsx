/** Loading skeleton for /reports while report rows are fetched. */
export default function ReportsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading reports">
      <div className="space-y-3">
        <div className="h-3 w-24 animate-pulse rounded bg-neutral-200" />
        <div className="h-8 w-56 animate-pulse rounded-lg bg-neutral-200" />
      </div>
      <div className="space-y-3">
        <div className="h-20 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
        <div className="h-20 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
        <div className="h-20 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
        <div className="h-20 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
      </div>
    </div>
  );
}
