import { requireUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAutoReelRenderUrl } from "@/lib/data/autoreel-db";
import PageHeader from "@/components/PageHeader";
import AutoReelHandoffClient, {
  type HandoffCandidate,
} from "./AutoReelHandoffClient";

export const metadata = { title: "Import from AutoReel — Alliance Social" };
export const dynamic = "force-dynamic";

/**
 * /autoreel/handoff — landing page for the helper extension's
 * "Send to Alliance Social" button (2026-08-05, tools/autoreel-helper).
 *
 * The extension opens this page with:
 *   ?video=<media.autoreelapp.com render URL>
 *   &project=<AutoReel project page URL>
 *   &title=<AutoReel project title, usually the address>
 *
 * The server resolves WHICH listing the video belongs to:
 *   1. tracked project match (autoreel_projects.project_url), else
 *   2. address match from the project title against properties.
 * One confident match → the client auto-imports and forwards to the review
 * page. Ambiguous or no match → the client shows a picker. why server-side:
 * the page lands cold from another origin; resolving before first paint
 * means the happy path never flashes a chooser.
 */
export default async function AutoReelHandoffPage({
  searchParams,
}: {
  searchParams: Promise<{
    video?: string | string[];
    project?: string | string[];
    title?: string | string[];
  }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) =>
    (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
  const videoUrl = one(sp.video).split("#")[0];
  const projectUrl = one(sp.project);
  const title = one(sp.title);

  const videoOk = isAutoReelRenderUrl(videoUrl);

  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbAny = supabase as any;

  let resolvedMls: string | null = null;
  const candidates: HandoffCandidate[] = [];

  if (videoOk) {
    // 1) Tracked project → certain match.
    if (projectUrl) {
      const { data: proj } = await sbAny
        .from("autoreel_projects")
        .select("mls_number")
        .eq("project_url", projectUrl)
        .maybeSingle();
      if (proj?.mls_number) resolvedMls = proj.mls_number as string;
    }

    // 2) Address match from the AutoReel project title ("211 S WILLIAM COOK
    //    BOULEVARD, MANAHAWKIN, NJ" → street segment before the first comma).
    if (!resolvedMls && title) {
      const street = title.split(",")[0]?.trim();
      if (street && street.length >= 4) {
        const { data: rows } = await supabase
          .from("properties")
          .select("mls_number, address, city, state, list_price, hero_image_url, status")
          .ilike("address", `%${street.replace(/[,%()]/g, " ").trim()}%`)
          .limit(5);
        const found = (rows ?? []) as Array<{
          mls_number: string;
          address: string | null;
          city: string | null;
          state: string | null;
          list_price: number | null;
          hero_image_url: string | null;
          status: string;
        }>;
        if (found.length === 1) {
          resolvedMls = found[0].mls_number;
        } else {
          candidates.push(...found);
        }
      }
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="AutoReel · video handoff"
        title="Import from AutoReel"
        description={
          videoOk
            ? "Bringing the finished video in and drafting captions from the listing."
            : "This link doesn't include a valid AutoReel video."
        }
      />
      <AutoReelHandoffClient
        videoUrl={videoOk ? videoUrl : null}
        projectUrl={projectUrl || null}
        title={title || null}
        resolvedMls={resolvedMls}
        candidates={candidates}
      />
    </div>
  );
}
