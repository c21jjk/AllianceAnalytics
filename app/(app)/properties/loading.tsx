/** Loading skeleton for /properties while listings are fetched. */
export default function PropertiesLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading properties">
      <div className="space-y-3">
        <div className="h-3 w-24 animate-pulse rounded bg-neutral-200" />
        <div className="h-8 w-64 animate-pulse rounded-lg bg-neutral-200" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="h-56 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
        <div className="h-56 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
        <div className="h-56 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
        <div className="h-56 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
        <div className="h-56 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
        <div className="h-56 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
      </div>
    </div>
  );
}
