/**
 * Global "Test mode is the default" banner. Renders on /post-builder,
 * /saved-posts, /settings while system_config.publish_test_mode = true.
 *
 * Three jobs:
 *   1. Make it obvious that the global default for new posts is test mode.
 *   2. Tell the user exactly where each platform's drafts live so they
 *      can verify a test post landed.
 *   3. Surface the toggle to flip the global default off when ready
 *      to go live. The per-post override stays available either way.
 */
"use client";

import { useTransition } from "react";

export default function TestModeBanner({
  testModeOn,
  onToggle,
}: {
  /** Current value of system_config.publish_test_mode. */
  testModeOn: boolean;
  /**
   * Server action wired by the parent. Receives the NEW value the user
   * wants to set. Banner handles the optimistic transition state.
   */
  onToggle?: (nextValue: boolean) => Promise<void>;
}) {
  const [isPending, startTransition] = useTransition();

  if (!testModeOn) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold tracking-tight">
            Test mode is the default for new posts.
          </p>
          <p className="mt-0.5 text-amber-800 text-xs leading-relaxed">
            Test publishes land in private surfaces only — no follower sees them:
          </p>
          <ul className="mt-1 ml-4 list-disc space-y-0.5 text-xs leading-relaxed text-amber-800">
            <li>
              <span className="font-medium">Facebook:</span> Page Manager → Drafts
              (photos) / Video Library → Drafts (videos)
            </li>
            <li>
              <span className="font-medium">Instagram:</span> nowhere visible —
              container is created server-side and expires in 24h
            </li>
            <li>
              <span className="font-medium">TikTok:</span> the TikTok app → "+"
              tab → Drafts (creator publishes manually)
            </li>
          </ul>
          <p className="mt-1 text-xs text-amber-800">
            Each post also has its own toggle in the Post Builder — override
            per-post when you want to publish for real.
          </p>
        </div>
        {onToggle ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await onToggle(false);
              })
            }
            className="btn-secondary text-xs whitespace-nowrap disabled:opacity-50"
          >
            {isPending ? "Switching…" : "Switch global default to Live"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
