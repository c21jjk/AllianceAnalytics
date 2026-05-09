import { redirect } from "next/navigation";

/**
 * Legacy redirect: the standalone Posts tab was consolidated into the
 * Dashboard list view (`/?view=list`). Anyone landing on /posts goes there.
 *
 * Per-post detail at /posts/[id] still resolves through the standalone
 * route (or via the @modal intercept when navigated to from inside (app)).
 */
export default function PostsRedirectPage() {
  redirect("/?view=list");
}
