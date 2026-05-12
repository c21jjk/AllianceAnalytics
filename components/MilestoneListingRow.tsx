import Link from "next/link";
import type { AllianceRole, ListingMilestone } from "@/lib/data/recently-sold";
import { formatCurrency } from "@/lib/format";

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
}

/**
 * Shared compact editorial row used inside both UnderContractRow and
 * RecentlySoldRow. Mirrors the Direction-A row shape used elsewhere in the
 * dashboard but trimmed for the smaller right-column cards:
 *
 *   [56×56 thumb]  ADDRESS LINE
 *                  $PRICE · EYEBROW DATE · short_code →
 *
 * Deep-links to /properties/[mls]. No actions on the row itself — the goal
 * is "click through and decide what to post."
 */
export default function MilestoneListingRow({
  listing,
  eyebrowPrefix,
  isFirst,
}: MilestoneListingRowProps) {
  const dateLabel = formatDateLabel(listing.reference_date);
  const cityState = [listing.city, listing.state].filter(Boolean).join(", ");

  return (
    <Link
      href={`/properties/${encodeURIComponent(listing.mls_number)}`}
      className="grid items-center hover:opacity-70 transition-opacity"
      style={{
        gridTemplateColumns: "56px 1fr auto",
        gap: 14,
        padding: "12px 0",
        borderTop: isFirst ? "none" : "1px solid #ececec",
      }}
    >
      {/* Hero */}
      <div
        style={{
          width: 56,
          height: 56,
          backgroundColor: "#f4f4f4",
          borderRadius: 2,
          overflow: "hidden",
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
      </div>

      {/* Body — address line + meta line + agent line. Truncates aggressively
          so it fits in the narrow card width. */}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
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
            <span style={{ color: "#737373", fontWeight: 400 }}>
              , {cityState}
            </span>
          ) : null}
        </div>
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
              <span style={{ color: "#737373" }}>{listing.office_short_code}</span>
            </>
          ) : null}
        </div>

        {/* Alliance role + agent line — shows which side(s) Alliance had
            and who the Alliance agent(s) are. Suppressed when no agent
            info is on file at all. */}
        <AllianceRoleLine
          allianceRole={listing.alliance_role}
          listingAgent={listing.agent_name}
          buyerAgent={listing.buyer_agent_name}
        />
      </div>

      {/* Right column — arrow chevron */}
      <div style={{ color: "#a3a3a3", fontSize: 14 }}>
        <ArrowIcon />
      </div>
    </Link>
  );
}

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
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
