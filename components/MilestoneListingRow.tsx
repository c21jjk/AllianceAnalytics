import Link from "next/link";
import type { ReactNode } from "react";
import type { AllianceRole, ListingMilestone } from "@/lib/data/recently-sold";
import { formatCurrency } from "@/lib/format";
import OfficeThumbBadge from "./OfficeThumbBadge";
import PostedCheckbox, { type MilestonePostType } from "./PostedCheckbox";
import AutoReelLaunchButton from "./AutoReelPanel";
import {
  ListingHoldChip,
  ListingNoteButton,
  ListingNoteLine,
  ListingNotePanel,
  ListingNoteProvider,
} from "./ListingNote";

interface MilestoneListingRowProps {
  listing: ListingMilestone;
  /**
   * Eyebrow prefix shown ahead of the date — "Sold" for sold listings,
   * "Under contract · Listed" for pending listings, etc. Kept on the
   * parent so the row component doesn't have to branch on status.
   */
  eyebrowPrefix: string;
  /** Whether this is the first row (no top border) */
  isFirst: boolean;
  /**
   * 2026-08-04 (John): the row deep-links to the Post Builder with this post
   * type + the row's listing pre-selected (/post-builder?mls=X&postType=Y).
   *
   * 2026-08-05 (John): this prop now ALSO drives the per-milestone "Posted"
   * checkbox, so Just Listed / Under Contract / Just Sold / Price Change each
   * track independently. Every milestone section passes it.
   */
  postType: MilestonePostType;
  /** Optional extra meta line, e.g. the price-drop detail on Price Changes. */
  metaSuffix?: ReactNode;
  /**
   * Optional third control under the Posted checkbox. Recently Listed uses it
   * for its dismiss/reset kebab; the other sections pass nothing, so their
   * right column stays exactly two controls tall.
   */
  trailingAction?: ReactNode;
  /** Optional status ribbon overlaid on the thumbnail (Recently Listed). */
  ribbon?: ReactNode;
  /** Renders the row muted — used for dismissed listings. */
  dimmed?: boolean;
}

/**
 * Shared compact editorial row used by every milestone section (Recently
 * Listed, Under Contract, Recently Sold, Price Changes):
 *
 *   [56×56 thumb]  ADDRESS LINE                 [+ Build Studio Post ]
 *                  $PRICE · EYEBROW DATE · code [🎬 Build AutoReel Post]
 *                  #MLS copy chip               [☐ Not posted yet     ]
 *                  Listed by AGENT              [ Skip this listing   ]
 *
 * 2026-08-05 (John) — "each should have a Build Post tab and a simple checkbox
 * if a post for that property has been created". Previously the entire row was
 * one big link into the Post Builder and these sections had no controls at
 * all, while Just Listed had three per-platform chips. All milestone sections
 * now share the same two controls.
 *
 * The row is no longer a single <Link>: the address links to the property
 * detail page, "+ Build post" is the primary CTA into the builder, and the
 * checkbox is a button. Nesting those inside an outer anchor would be invalid
 * HTML and would swallow the clicks.
 */
export default function MilestoneListingRow({
  listing,
  eyebrowPrefix,
  isFirst,
  postType,
  metaSuffix,
  trailingAction,
  ribbon,
  dimmed = false,
}: MilestoneListingRowProps) {
  const dateLabel = formatDateLabel(listing.reference_date);
  // 2026-07-17 (approved mockup v2) — state dropped from all dashboard
  // property chips: every listing is NJ. Name kept; carries just the town.
  const cityState = listing.city ?? "";
  const mls = encodeURIComponent(listing.mls_number);

  // 2026-08-07 (John) — shared team notes. The provider wraps the whole row
  // because its two visible pieces live in DIFFERENT grid columns: the quiet
  // one-liner under the agent name, and the labelled NOTES control under the
  // Posted checkbox. See components/ListingNote.tsx.
  const noteLatest = listing.notes?.note_latest
    ? {
        id: listing.notes.note_latest.id,
        body: listing.notes.note_latest.body,
        created_at: listing.notes.note_latest.created_at,
        author_name: listing.notes.note_latest.author.name,
      }
    : null;

  return (
    <ListingNoteProvider
      mlsNumber={listing.mls_number}
      latest={noteLatest}
      count={listing.notes?.note_count ?? 0}
      hold={listing.notes?.on_hold ?? null}
    >
    <div
      className={dimmed ? "grid items-center opacity-60" : "grid items-center"}
      style={{
        gridTemplateColumns: "56px 1fr 156px",
        gap: 14,
        padding: "12px 0",
        borderTop: isFirst ? "none" : "1px solid #ececec",
      }}
    >
      {/* Hero — office short_code strip pinned to the bottom edge so every
          section reads office attribution the same way Recently Listed does. */}
      <Link
        href={`/properties/${mls}`}
        className="hover:opacity-70 transition-opacity"
        style={{
          width: 56,
          height: 56,
          backgroundColor: "#f4f4f4",
          borderRadius: 2,
          overflow: "hidden",
          position: "relative",
          display: "block",
        }}
      >
        {listing.hero_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.hero_image_url}
            alt=""
            className="text-transparent"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : null}
        <OfficeThumbBadge code={listing.office_short_code} />
        {ribbon}
      </Link>

      {/* Body — address line + meta line + agent line. Truncates aggressively
          so it fits in the narrow card width. */}
      <div style={{ minWidth: 0 }}>
        <Link
          href={`/properties/${mls}`}
          className="hover:opacity-70 transition-opacity"
          style={{
            display: "block",
            fontSize: 13,
            lineHeight: 1.3,
            color: "#171717",
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {listing.address ?? "Unknown address"}
          {cityState ? (
            // why: town steps down a size so the address owns the line —
            // approved mockup v2, consistent with the OH + Recently Listed chips.
            <span style={{ color: "#737373", fontWeight: 400, fontSize: 11.5 }}>
              , {cityState}
            </span>
          ) : null}
          {/* The one element on this row allowed to catch the eye: missing a
              "don't post this yet" is the expensive mistake this whole feature
              exists to prevent. */}
          <ListingHoldChip />
        </Link>
        <div
          style={{
            marginTop: 3,
            fontSize: 11,
            color: "#737373",
            fontWeight: 400,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {listing.display_price !== null ? (
            <span
              style={{
                color: "#171717",
                fontWeight: 500,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {formatCurrency(listing.display_price)}
            </span>
          ) : (
            <span style={{ color: "#a3a3a3" }}>—</span>
          )}
          <span style={{ color: "#d4d4d4" }}> · </span>
          <span style={{ color: "#737373" }}>
            {eyebrowPrefix} {dateLabel}
          </span>
          {listing.office_short_code ? (
            <>
              <span style={{ color: "#d4d4d4" }}> · </span>
              <span className="text-gold-700 font-semibold uppercase tracking-wide">
                {listing.office_short_code}
              </span>
            </>
          ) : null}
        </div>

        {metaSuffix}

        {/* Alliance role + agent line — shows which side(s) Alliance had
            and who the Alliance agent(s) are. Suppressed when no agent
            info is on file at all. */}
        <AllianceRoleLine
          allianceRole={listing.alliance_role}
          listingAgent={listing.agent_name}
          buyerAgent={listing.buyer_agent_name}
        />

        {/* Renders nothing at all on listings with no notes and no hold, so
            untouched rows look exactly as they did before 8/07. */}
        <ListingNoteLine />
      </div>

      {/* Right column, rebuilt 2026-08-05 (John): "Build Post and Build Auto
          Reel need to be listed 1st." The two things that MAKE something now
          sit together at the top as a matched pair, and the bookkeeping sits
          underneath as quiet status text instead of alternating with them.

          Naming: "Build Studio Post" and "Build AutoReel Post" — John, same
          day. "Reel" alone was ambiguous because Alliance Social has its own
          native Reel builder (Reel Studio); each button now names the tool it
          actually opens.

          Full-width stacked rather than side by side: "Build AutoReel Post"
          is too long to sit beside anything without truncating. */}
      <div className="flex flex-col items-stretch gap-1.5">
        <Link
          href={`/post-builder?mls=${mls}&postType=${postType}`}
          className={
            listing.post_made
              ? // Already handled — go quiet so a finished row stops competing
                // for attention. Still clickable; nothing is hidden.
                "inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-neutral-600 hover:border-gold-300 hover:text-gold-800 transition-colors"
              : "inline-flex items-center justify-center gap-1.5 rounded-md bg-gold-500 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-gold-600 transition-colors"
          }
          title="Open the Post Builder with this listing pre-selected"
        >
          <PlusGlyph />
          Build Studio Post
        </Link>
        {/* 2026-08-05 (John): "AutoReel is only for Recently Listed posts,
            not Just Sold, UC or Price Reductions. We will only use studio for
            those posts." Gated on post type here rather than at the four call
            sites so the rule lives in one place and can't be forgotten when a
            new section is added. */}
        {postType === "just_listed" ? (
          <AutoReelLaunchButton
            variant="row"
            listing={{
              mls_number: listing.mls_number,
              source_mls: listing.source_mls,
              address: listing.address,
              city: listing.city,
              state: listing.state,
              list_price: listing.list_price,
              hero_image_url: listing.hero_image_url,
            }}
          />
        ) : null}
        {/* Status line + the Notes control share a row: the checkbox answers
            "did this go out", the note answers "should it". */}
        <div className="flex items-start gap-1.5">
          <PostedCheckbox
            mlsNumber={listing.mls_number}
            postType={postType}
            checked={listing.post_made}
            autoDetected={listing.post_auto_detected}
            markedAt={listing.post_marked_at}
          />
          <ListingNoteButton className="ml-auto" />
        </div>
        {trailingAction}
      </div>
    </div>
    {/* Full row width, below the grid — the body column is far too narrow to
        read a thread in. Renders nothing when closed. */}
    <ListingNotePanel />
    </ListingNoteProvider>
  );
}

function PlusGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={11}
      height={11}
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/**
 * Renders the Alliance agent line below the price/date row. Output depends
 * on which side(s) Alliance had:
 *
 *   listing → "Listed by [A]"
 *   buyer   → "Buyer's agent: [B]"          (Alliance was on the buyer side
 *                                            even though listed by another
 *                                            brokerage)
 *   both    → "Listed by [A] · Buyer's agent: [B]"
 *
 * Suppressed entirely when there's nothing to show.
 */
function AllianceRoleLine({
  allianceRole,
  listingAgent,
  buyerAgent,
}: {
  allianceRole: AllianceRole;
  listingAgent: string | null;
  buyerAgent: string | null;
}) {
  const showListing = allianceRole !== "buyer" && !!listingAgent;
  const showBuyer = allianceRole !== "listing" && !!buyerAgent;
  if (!showListing && !showBuyer) return null;
  return (
    <div
      style={{
        marginTop: 2,
        fontSize: 11,
        color: "#737373",
        fontWeight: 400,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {showListing ? (
        <span>
          <span style={{ color: "#a3a3a3" }}>Listed by </span>
          <span style={{ color: "#171717", fontWeight: 500 }}>
            {listingAgent}
          </span>
        </span>
      ) : null}
      {showListing && showBuyer ? (
        <span style={{ color: "#d4d4d4" }}> · </span>
      ) : null}
      {showBuyer ? (
        <span>
          <span style={{ color: "#a3a3a3" }}>Buyer&rsquo;s agent: </span>
          <span style={{ color: "#171717", fontWeight: 500 }}>{buyerAgent}</span>
        </span>
      ) : null}
    </div>
  );
}

function formatDateLabel(isoDate: string | null): string {
  if (!isoDate) return "—";
  const d = new Date(
    isoDate.length <= 10 ? `${isoDate}T00:00:00` : isoDate,
  );
  if (Number.isNaN(d.getTime())) return "—";
  const month = d.toLocaleDateString(undefined, { month: "short" });
  const day = d.toLocaleDateString(undefined, { day: "numeric" });
  return `${month} ${day}`;
}
