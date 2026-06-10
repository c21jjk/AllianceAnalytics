/** Loading skeleton for /posts while the post list is fetched. */
export default function PostsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading posts">
      <div className="space-y-3">
        <div className="h-3 w-16 animate-pulse rounded bg-neutral-200" />
        <div className="h-8 w-44 animate-pulse rounded-lg bg-neutral-200" />
      </div>
      <div className="h-10 w-full max-w-xl animate-pulse rounded-lg bg-neutral-200" />
      <div className="space-y-3">
        <div className="h-24 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
        <div className="h-24 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
        <div className="h-24 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
        <div className="h-24 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
        <div className="h-24 animate-pulse rounded-xl border border-neutral-200 bg-neutral-100" />
      </div>
    </div>
  );
}
