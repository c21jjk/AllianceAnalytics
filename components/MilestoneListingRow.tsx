import Link from "next/link";
import type { ReactNode } from "react";
import type { AllianceRole, ListingMilestone } from "@/lib/data/recently-sold";
import { formatCurrency } from "@/lib/format";
import OfficeThumbBadge from "./OfficeThumbBadge";
import PostedCheckbox, { type MilestonePostType } from "./PostedCheckbox";

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
 * Shared compact editorial row used inside UnderContractRow, RecentlySoldRow
 * and PriceChangeRow:
 *
 *   [56×56 thumb]  ADDRESS LINE                    [+ Build post]
 *                  $PRICE · EYEBROW DATE · code    [☑ Posted    ]
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

  return (
    <div
      className={dimmed ? "grid items-center opacity-60" : "grid items-center"}
      style={{
        gridTemplateColumns: "56px 1fr auto",
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
      </div>

      {/* Right column — the two controls every milestone section now shares:
          the primary "+ Build post" CTA and the "Posted" checkbox. Stacked
          vertically to mirror the Recently Listed and Open Houses chips. */}
      <div className="flex flex-col items-end gap-1 shrink-0">
        <Link
          href={`/post-builder?mls=${mls}&postType=${postType}`}
          className="inline-flex items-center gap-1 rounded-md bg-gold-500 px-2 py-1 text-[11px] font-semibold text-white hover:bg-gold-600 transition-colors"
          title="Open the Post Builder with this listing pre-selected"
        >
          <PlusGlyph />
          Build post
        </Link>
        <PostedCheckbox
          mlsNumber={listing.mls_number}
          postType={postType}
          checked={listing.post_made}
          autoDetected={listing.post_auto_detected}
        />
        {trailingAction}
      </div>
    </div>
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
