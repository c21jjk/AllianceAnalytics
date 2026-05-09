import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { findManualMergeCandidatesForGroup } from "@/lib/data/groups";

export const dynamic = "force-dynamic";

/**
 * GET /api/groups/{id}/merge-candidates
 *
 * Returns up to 8 ungrouped (or singleton-in-another-auto-group) posts that
 * could plausibly be merged into the target group. Used by MergeWithDialog.
 *
 * Auth-gated to signed-in Alliance users — this is a read; the actual merge
 * server action is admin-only.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  await requireUser();
  const { id } = await context.params;

  // Synthetic singleton groups use a "solo-{post_id}" prefix and don't exist
  // in post_groups. Don't bother hitting the DB.
  if (!id || id.startsWith("solo-")) {
    return NextResponse.json({ candidates: [] });
  }

  try {
    const candidates = await findManualMergeCandidatesForGroup(id);
    return NextResponse.json({ candidates });
  } catch (e) {
    return NextResponse.json(
      {
        candidates: [],
        error: e instanceof Error ? e.message : "merge candidate lookup failed",
      },
      { status: 500 },
    );
  }
}
