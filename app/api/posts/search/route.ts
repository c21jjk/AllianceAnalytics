import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { searchPosts } from "@/lib/data/search-posts";

export const dynamic = "force-dynamic";

const ALLOWED_PLATFORMS = new Set(["facebook", "instagram", "tiktok"]);

/**
 * GET /api/posts/search
 *   ?q=cape may waterfront
 *   &platform=instagram&platform=tiktok   (repeatable; absent = all)
 *   &from=2026-04-01                      (YYYY-MM-DD or full ISO)
 *   &to=2026-05-01
 *   &limit=10                             (default 10, cap 200)
 *
 * Backs the top-nav inline search dropdown. Auth-gated to signed-in Alliance
 * users. Returns `{ results, totalCount }` where totalCount is the full match
 * count (independent of limit) so the UI can render "See all N" links.
 */
export async function GET(request: Request) {
  await requireUser();

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();

  const platforms = searchParams
    .getAll("platform")
    .map((p) => p.trim().toLowerCase())
    .filter((p): p is "facebook" | "instagram" | "tiktok" =>
      ALLOWED_PLATFORMS.has(p),
    );

  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;

  const limitRaw = Number(searchParams.get("limit"));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), 200)
      : 10;

  try {
    const { results, totalCount } = await searchPosts({
      q,
      platforms: platforms.length > 0 ? platforms : undefined,
      dateFrom: isValidDateLike(from) ? from : undefined,
      dateTo: isValidDateLike(to) ? to : undefined,
      limit,
    });
    return NextResponse.json({ results, totalCount });
  } catch (e) {
    return NextResponse.json(
      {
        results: [],
        totalCount: 0,
        error: e instanceof Error ? e.message : "search failed",
      },
      { status: 500 },
    );
  }
}

/** Loose validation — Date.parse handles YYYY-MM-DD and full ISO 8601. */
function isValidDateLike(s: string | undefined): s is string {
  if (!s) return false;
  return !Number.isNaN(Date.parse(s));
}
