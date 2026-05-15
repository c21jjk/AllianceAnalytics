import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { Barlow } from "next/font/google";
import {
  fetchOwnerStoryByToken,
  logOwnerStoryView,
  type OwnerStoryData,
  type OwnerStoryOpenHouse,
  type OwnerStoryPhoto,
  type OwnerStoryPost,
  type Platform,
  type PropertyStatus,
} from "@/lib/data/owner-story-db";
import {
  formatCompactNumber,
  formatCurrency,
  formatNumber,
  formatShortDate,
} from "@/lib/format";
import ShareLinkButton from "./ShareLinkButton";

/**
 * Owner Story — the public, seller-facing "your home's marketing campaign"
 * page at /home/[token]. Anyone with the link can read; the token IS the
 * access control. The page is mobile-first; desktop just gets more breathing
 * room around the same content.
 *
 * Direction: story-format chapters, NOT a dashboard. Numbers are wrapped in
 * sentences. Company context is sprinkled inline; one big "the room behind us"
 * callout near the highlights. Status-adaptive ("Where it stands") swaps
 * tense + framing when the listing moves to Pending / Sold.
 *
 * Chapters (top → bottom on every viewport):
 *   1. Hero — optional personal note, listing photo, address, agent
 *   2. Launch moment — when posts started, how recently
 *   3. Reach chapter — total reach + one-line company context
 *   4. Highlights — top 3 posts by reach
 *   5. "The room behind us" — Alliance-wide reach callout
 *   6. Timeline — every post, newest first
 *   7. Conversation — engagement framed as people talking
 *   8. Where it stands — status-adaptive (active / pending / sold / expired)
 *   9. What now — text agent, share with family, ask about a post
 *
 * Portals chapter (Zillow / Realtor / etc.) is deferred until ListTrac.
 */

const barlow = Barlow({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
  variable: "--font-barlow",
});

export const dynamic = "force-dynamic";

const GOLD = "#C9A84C";
const INK = "#252526";
const INK_SOFT = "#525253";
const INK_MUTED = "#8a8a8c";
const RULE = "#ececec";
const BG = "#ffffff";
const BG_SOFT = "#fafafa";

interface PageProps {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { token } = await params;
  const data = await fetchOwnerStoryByToken(token);
  if (data?.listing.address) {
    return {
      title: `${data.listing.address} — Century 21 Alliance`,
      robots: { index: false, follow: false },
    };
  }
  return {
    title: "Your Home — Century 21 Alliance",
    robots: { index: false, follow: false },
  };
}

export default async function OwnerStoryPage({ params }: PageProps) {
  const { token } = await params;
  const data = await fetchOwnerStoryByToken(token);
  if (!data) notFound();

  // Fire-and-forget view log. Pull headers from the request so we can stash
  // a trimmed user-agent + referrer host without holding the render. Any
  // failure inside logOwnerStoryView is swallowed there.
  try {
    const hdrs = await headers();
    void logOwnerStoryView(
      data.report_id,
      hdrs.get("user-agent"),
      hdrs.get("referer"),
    );
  } catch {
    // headers() can throw outside a request scope — never block rendering.
  }

  return <StoryView data={data} />;
}

/* ----------------------------------------------------------------------- *
 *  Top-level layout
 * ----------------------------------------------------------------------- */

function StoryView({ data }: { data: OwnerStoryData }) {
  const {
    listing,
    posts,
    highlights,
    photos,
    open_houses,
    totals,
    company,
    personal_note,
  } = data;
  const isFreshlyListed = posts.length === 0 && listing.status === "active";

  return (
    <div
      className={barlow.variable}
      style={{
        fontFamily: "'Barlow', system-ui, sans-serif",
        backgroundColor: BG,
        color: INK,
        minHeight: "100vh",
        fontWeight: 400,
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <Header />
      {/* Page-content container — mobile-first 720 cap, desktop bumps to 880
          so hero photo + highlights breathe; prose chapters stay capped at
          ~600 inside via their own constraints (see ChapterShell). */}
      <main
        style={{
          margin: "0 auto",
          maxWidth: 720,
        }}
        className="story-main"
      >
        <HeroChapter listing={listing} personalNote={personal_note} />
        {photos.length > 0 ? <PhotoGalleryStrip photos={photos} /> : null}
        {open_houses.length > 0 ? (
          <OpenHouseChapter openHouses={open_houses} />
        ) : null}
        {isFreshlyListed ? (
          <FreshlyListedChapter listingDate={listing.listing_date} />
        ) : null}
        {posts.length > 0 ? (
          <LaunchChapter
            firstPostAt={data.first_post_at}
            daysSinceLaunch={data.days_since_launch}
            postCount={totals.post_count}
          />
        ) : null}
        {totals.reach > 0 ? (
          <ReachChapter totalReach={totals.reach} company={company} />
        ) : null}
        {highlights.length > 0 ? (
          <HighlightsChapter highlights={highlights} company={company} />
        ) : null}
        {totals.reach > 0 ? (
          <CompanyCalloutChapter company={company} totalReach={totals.reach} />
        ) : null}
        {posts.length > 0 ? <TimelineChapter posts={posts} /> : null}
        {totals.engagements > 0 ? (
          <ConversationChapter
            engagements={totals.engagements}
            postCount={totals.post_count}
          />
        ) : null}
        {/* WhereItStands is suppressed for freshly-listed active homes — the
            FreshlyListedChapter already owns that moment and rendering both
            duplicates the "we're marketing your home" beat. */}
        {!isFreshlyListed ? (
          <WhereItStandsChapter
            status={listing.status}
            postCount={totals.post_count}
          />
        ) : null}
        <WhatNowChapter
          address={listing.address}
          agentName={listing.agent_name}
          agentEmail={listing.agent_email}
        />
        <Footer />
      </main>
      {/* Single global style block — desktop max-width bump and roomier
          chapter padding on >=768px. Kept inline so the public story page
          stays self-contained (no global CSS leak into the auth'd app). */}
      <style>{`
        .story-gallery::-webkit-scrollbar { display: none; }
        @media (min-width: 768px) {
          .story-main { max-width: 880px; }
          .story-chapter { padding-left: 48px !important; padding-right: 48px !important; padding-top: 56px !important; padding-bottom: 56px !important; }
          .story-hero { padding: 56px 48px 36px !important; }
          .story-footer { padding: 72px 48px 56px !important; }
          .story-callout { padding: 72px 48px !important; }
          .story-whatnow { padding: 64px 48px 36px !important; }
          .story-header { padding: 24px 48px !important; }
          .story-gallery { padding: 0 48px !important; }
        }
      `}</style>
    </div>
  );
}

/* ----------------------------------------------------------------------- *
 *  Chapters
 * ----------------------------------------------------------------------- */

function Header() {
  return (
    <header
      className="story-header"
      style={{
        padding: "20px 24px",
        borderBottom: `1px solid ${RULE}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <span
        style={{
          fontSize: 11,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          fontWeight: 500,
          color: INK_MUTED,
        }}
      >
        Century 21 Alliance
      </span>
      <C21Seal />
    </header>
  );
}

function HeroChapter({
  listing,
  personalNote,
}: {
  listing: OwnerStoryData["listing"];
  personalNote: string | null;
}) {
  const firstLine = firstLineOfAddress(listing.address);
  const secondLine = secondLineOfAddress(listing);

  return (
    <section className="story-hero" style={{ padding: "40px 24px 28px" }}>
      {personalNote ? (
        <div
          style={{
            marginBottom: 32,
            paddingLeft: 16,
            borderLeft: `2px solid ${GOLD}`,
          }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              fontWeight: 500,
              color: INK_MUTED,
              marginBottom: 8,
            }}
          >
            A note from {listing.agent_name?.split(" ")[0] ?? "your agent"}
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 16,
              lineHeight: 1.6,
              color: INK,
              fontWeight: 400,
            }}
          >
            {personalNote}
          </p>
        </div>
      ) : null}

      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          fontWeight: 500,
          color: INK_MUTED,
        }}
      >
        Here&apos;s how we&apos;re marketing your home
      </div>
      <h1
        style={{
          marginTop: 14,
          fontSize: "clamp(28px, 6vw, 38px)",
          lineHeight: 1.05,
          letterSpacing: "-0.025em",
          fontWeight: 500,
          color: INK,
        }}
      >
        {firstLine || "Your home"}
      </h1>
      {secondLine ? (
        <div
          style={{
            marginTop: 6,
            fontSize: "clamp(16px, 3.6vw, 18px)",
            lineHeight: 1.3,
            color: INK_SOFT,
            fontWeight: 400,
          }}
        >
          {secondLine}
        </div>
      ) : null}

      <FactsStrip listing={listing} />

      {/* Hero photo */}
      <div
        style={{
          marginTop: 28,
          width: "100%",
          aspectRatio: "4 / 3",
          backgroundColor: "#f4f4f4",
          overflow: "hidden",
          borderRadius: 4,
        }}
      >
        {listing.hero_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={listing.hero_image_url}
            alt={listing.address ?? "Your home"}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : (
          <div
            aria-hidden="true"
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: INK_MUTED,
              fontSize: 12,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            No cover photo on file
          </div>
        )}
      </div>

      {listing.agent_name ? (
        <AgentBlock
          agentName={listing.agent_name}
          agentEmail={listing.agent_email}
          listingOfficeName={listing.listing_office_name}
        />
      ) : null}
    </section>
  );
}

function AgentBlock({
  agentName,
  agentEmail,
  listingOfficeName,
}: {
  agentName: string;
  agentEmail: string | null;
  listingOfficeName: string | null;
}) {
  const officeDisplay = normalizeOfficeName(listingOfficeName);
  const initials = computeInitials(agentName);

  return (
    <div
      style={{
        marginTop: 32,
        paddingTop: 24,
        borderTop: `1px solid ${RULE}`,
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
    >
      {/* Initials medallion — placeholder for an eventual headshot.
          Gold-tinted ring keeps it on-brand without a real photo. */}
      <div
        aria-hidden="true"
        style={{
          width: 48,
          height: 48,
          borderRadius: "50%",
          backgroundColor: BG_SOFT,
          border: `1px solid ${RULE}`,
          color: INK,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 15,
          fontWeight: 500,
          letterSpacing: "0.02em",
          flexShrink: 0,
        }}
      >
        {initials}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            fontWeight: 500,
            color: INK_MUTED,
          }}
        >
          Your agent
        </div>
        <div
          style={{
            marginTop: 2,
            fontSize: 17,
            color: INK,
            fontWeight: 500,
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {agentName}
        </div>
        {officeDisplay ? (
          <div
            style={{
              marginTop: 2,
              fontSize: 13,
              color: INK_SOFT,
              fontWeight: 400,
              lineHeight: 1.3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {officeDisplay}
          </div>
        ) : null}
      </div>
      {agentEmail ? (
        <a
          href={`mailto:${agentEmail}`}
          aria-label={`Email ${agentName}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "10px 14px",
            border: `1px solid ${INK}`,
            color: INK,
            textDecoration: "none",
            fontSize: 12,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            fontWeight: 500,
            borderRadius: 2,
            flexShrink: 0,
          }}
        >
          Email
        </a>
      ) : null}
    </div>
  );
}

function computeInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "··";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (
    (parts[0]!.charAt(0) + (parts[parts.length - 1]?.charAt(0) ?? ""))
      .toUpperCase()
  );
}

/**
 * Paragon office names land here as `CENTURY 21 ALLIANCE wc` or similar —
 * caps + a short-code suffix. Pretty up for seller display: title-case the
 * brand and drop short-code-only fragments.
 */
function normalizeOfficeName(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Strip trailing 2-3 letter office short codes (e.g. "wc", "ws", "cmc")
  // when they're appended without a separating word.
  const withoutSuffix = trimmed.replace(/\s+[a-z]{2,4}$/i, "");
  // Title-case run of CENTURY 21 ALLIANCE → Century 21 Alliance
  const cased = withoutSuffix.replace(/\b[A-Z][A-Z]+\b/g, (word) =>
    word.charAt(0) + word.slice(1).toLowerCase(),
  );
  // "CENTURY" stays special because the regex above only catches all-caps
  // multi-letter runs; numbers like "21" pass through.
  return cased;
}

function PhotoGalleryStrip({ photos }: { photos: OwnerStoryPhoto[] }) {
  // Cap at 8 so the page doesn't turn into a photo album. Sellers can see
  // them all by clicking into Zillow / the MLS — this strip is just to
  // remind them their home looks great.
  const display = photos.slice(0, 8);
  return (
    <section
      aria-label="More photos of your home"
      style={{
        padding: "0 0 32px",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 12,
          overflowX: "auto",
          padding: "0 24px",
          scrollSnapType: "x mandatory",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
        }}
        className="story-gallery"
      >
        {display.map((photo, idx) => (
          <div
            key={idx}
            style={{
              flex: "0 0 auto",
              width: 220,
              aspectRatio: "4 / 3",
              backgroundColor: "#f4f4f4",
              borderRadius: 4,
              overflow: "hidden",
              scrollSnapAlign: "start",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.url}
              alt={photo.caption ?? `Listing photo ${idx + 2}`}
              loading="lazy"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
              }}
            />
          </div>
        ))}
      </div>
    </section>
  );
}

function OpenHouseChapter({
  openHouses,
}: {
  openHouses: OwnerStoryOpenHouse[];
}) {
  const now = Date.now();
  const upcoming = openHouses.filter(
    (oh) => new Date(oh.start_at).getTime() >= now,
  );
  const past = openHouses.filter(
    (oh) => new Date(oh.start_at).getTime() < now,
  );

  if (upcoming.length === 0 && past.length === 0) return null;

  const eyebrow = upcoming.length > 0 ? "Open House" : "Open Houses Held";
  const heading =
    upcoming.length > 0
      ? past.length > 0
        ? "We’ve opened your home to buyers — and we’re doing it again."
        : "We’re opening your home to buyers."
      : past.length === 1
        ? "We opened your home to buyers."
        : "We opened your home to buyers more than once.";

  return (
    <ChapterShell eyebrow={eyebrow}>
      <h2 style={chapterHeadingStyle}>{heading}</h2>
      <div style={{ marginTop: 20 }}>
        {upcoming.map((oh) => (
          <OpenHouseRow key={oh.id} openHouse={oh} kind="upcoming" />
        ))}
        {past.map((oh) => (
          <OpenHouseRow key={oh.id} openHouse={oh} kind="past" />
        ))}
      </div>
    </ChapterShell>
  );
}

function OpenHouseRow({
  openHouse,
  kind,
}: {
  openHouse: OwnerStoryOpenHouse;
  kind: "upcoming" | "past";
}) {
  const date = formatShortDate(openHouse.start_at);
  const startTime = formatTimeOfDay(openHouse.start_at);
  const endTime = openHouse.end_at ? formatTimeOfDay(openHouse.end_at) : null;
  const timeLabel = endTime ? `${startTime} – ${endTime}` : startTime;

  return (
    <div
      style={{
        padding: "16px 0",
        borderTop: `1px solid ${RULE}`,
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 16,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 17,
            fontWeight: 500,
            color: INK,
            letterSpacing: "-0.01em",
          }}
        >
          {date}
        </div>
        <div
          style={{
            marginTop: 2,
            fontSize: 14,
            color: INK_SOFT,
          }}
        >
          {timeLabel}
        </div>
      </div>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          fontWeight: 500,
          color: kind === "upcoming" ? GOLD : INK_MUTED,
          flexShrink: 0,
        }}
      >
        {kind === "upcoming" ? "Upcoming" : "Held"}
      </div>
    </div>
  );
}

function formatTimeOfDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: d.getMinutes() === 0 ? undefined : "2-digit",
  });
}

function FactsStrip({ listing }: { listing: OwnerStoryData["listing"] }) {
  const facts: { label: string; value: string }[] = [];

  if (listing.bedrooms !== null && listing.bedrooms !== undefined) {
    facts.push({
      label: listing.bedrooms === 1 ? "bedroom" : "bedrooms",
      value: String(listing.bedrooms),
    });
  }
  const bathTotal =
    (listing.bathrooms_full ?? 0) + 0.5 * (listing.bathrooms_half ?? 0);
  if (bathTotal > 0) {
    facts.push({
      label: bathTotal === 1 ? "bath" : "baths",
      value: bathTotal % 1 === 0 ? String(bathTotal) : bathTotal.toFixed(1),
    });
  }
  if (listing.list_price !== null && listing.list_price !== undefined) {
    facts.push({
      label: "listed",
      value: formatCurrency(listing.list_price),
    });
  }
  if (listing.property_type) {
    facts.push({
      label: "type",
      value: listing.property_type,
    });
  }

  if (facts.length === 0) return null;

  return (
    <div
      style={{
        marginTop: 24,
        display: "flex",
        flexWrap: "wrap",
        gap: "16px 28px",
      }}
    >
      {facts.map((fact, idx) => (
        <div
          key={`${fact.label}-${idx}`}
          style={{ display: "flex", flexDirection: "column", gap: 2 }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              fontWeight: 500,
              color: INK_MUTED,
            }}
          >
            {fact.label}
          </div>
          <div
            style={{
              fontSize: 17,
              fontWeight: 500,
              color: INK,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.01em",
              lineHeight: 1.1,
            }}
          >
            {fact.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function FreshlyListedChapter({
  listingDate,
}: {
  listingDate: string | null;
}) {
  const listedOn = listingDate ? formatShortDate(listingDate) : null;
  return (
    <ChapterShell eyebrow="Just Listed">
      <h2 style={chapterHeadingStyle}>
        Your home is officially on the market.
      </h2>
      <p style={{ ...proseStyle, marginTop: 16 }}>
        {listedOn ? (
          <>
            We brought your listing live on{" "}
            <strong style={strongStyle}>{listedOn}</strong>.{" "}
          </>
        ) : null}
        Your agent and the Alliance social team are preparing your first round
        of posts — Instagram, TikTok, and Facebook all start here. This page
        will update with every post that goes out, so feel free to keep it
        bookmarked.
      </p>
    </ChapterShell>
  );
}

function LaunchChapter({
  firstPostAt,
  daysSinceLaunch,
  postCount,
}: {
  firstPostAt: string | null;
  daysSinceLaunch: number | null;
  postCount: number;
}) {
  if (!firstPostAt) return null;
  const launchDate = formatShortDate(firstPostAt);
  const ago =
    daysSinceLaunch === null
      ? null
      : daysSinceLaunch === 0
        ? "today"
        : daysSinceLaunch === 1
          ? "yesterday"
          : `${daysSinceLaunch} days ago`;

  return (
    <ChapterShell eyebrow="Launch">
      <p style={proseStyle}>
        We started marketing your home on{" "}
        <strong style={strongStyle}>{launchDate}</strong>
        {ago ? <> ({ago})</> : null}. Since then, we&apos;ve put{" "}
        <strong style={strongStyle}>
          {formatNumber(postCount)} {postCount === 1 ? "post" : "posts"}
        </strong>{" "}
        in front of Century 21 Alliance&apos;s combined Instagram, TikTok, and
        Facebook audience.
      </p>
    </ChapterShell>
  );
}

function ReachChapter({
  totalReach,
  company,
}: {
  totalReach: number;
  company: OwnerStoryData["company"];
}) {
  // Comparison line — only when listing's per-post reach beats the 30-day
  // company baseline. Honest framing: don't say "above average" unless it is.
  const baseline =
    company.window_30d.posts > 0
      ? company.window_30d.reach / company.window_30d.posts
      : 0;
  const showBeat = baseline > 0 && totalReach >= baseline;

  return (
    <ChapterShell eyebrow="Reach">
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "baseline",
          gap: "0 20px",
        }}
      >
        <div
          style={{
            fontSize: "clamp(56px, 13vw, 84px)",
            lineHeight: 0.95,
            letterSpacing: "-0.04em",
            fontWeight: 500,
            color: INK,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatCompactNumber(totalReach)}
        </div>
        <div
          style={{
            fontSize: 18,
            color: INK_SOFT,
            fontWeight: 400,
          }}
        >
          people reached so far
        </div>
      </div>
      <p style={{ ...proseStyle, marginTop: 24 }}>
        Every one of those views is a real person on Instagram, TikTok, or
        Facebook seeing your home in their feed.
        {showBeat ? (
          <>
            {" "}
            That&apos;s already{" "}
            <strong style={strongStyle}>
              above what an Alliance listing typically reaches
            </strong>{" "}
            in this window.
          </>
        ) : null}
      </p>
    </ChapterShell>
  );
}

function HighlightsChapter({
  highlights,
  company,
}: {
  highlights: OwnerStoryPost[];
  company: OwnerStoryData["company"];
}) {
  const baseline =
    company.window_30d.posts > 0
      ? company.window_30d.reach / company.window_30d.posts
      : 0;
  const singular = highlights.length === 1;

  return (
    <ChapterShell eyebrow={singular ? "Standout" : "Highlights"}>
      <h2 style={chapterHeadingStyle}>
        {singular
          ? "The post that broke through."
          : "The posts that broke through."}
      </h2>
      <p style={{ ...proseStyle, marginTop: 16 }}>
        {singular
          ? "Here's the moment that pulled the most eyes onto your home so far."
          : "These are the moments that pulled the most eyes onto your home."}
      </p>
      <div style={{ marginTop: 24 }}>
        {highlights.map((post) => (
          <HighlightPost key={post.id} post={post} baseline={baseline} />
        ))}
      </div>
    </ChapterShell>
  );
}

function HighlightPost({
  post,
  baseline,
}: {
  post: OwnerStoryPost;
  baseline: number;
}) {
  const thumb = post.thumbnail_url;
  const beats = baseline > 0 && post.reach >= baseline;
  return (
    <div
      style={{
        marginBottom: 24,
        borderTop: `1px solid ${RULE}`,
        paddingTop: 20,
      }}
    >
      {thumb ? (
        <div
          style={{
            width: "100%",
            aspectRatio: "1 / 1",
            backgroundColor: "#f4f4f4",
            overflow: "hidden",
            position: "relative",
            borderRadius: 4,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumb}
            alt=""
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: "blur(16px)",
              transform: "scale(1.15)",
              opacity: 0.55,
            }}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={thumb}
            alt={`Post from ${formatShortDate(post.posted_at ?? new Date().toISOString())}`}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "contain",
            }}
          />
        </div>
      ) : null}
      <div style={{ marginTop: 14 }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            fontWeight: 500,
            color: INK_MUTED,
          }}
        >
          {platformLabel(post.platform)}
          {post.posted_at ? ` · ${formatShortDate(post.posted_at)}` : ""}
        </div>
        <p
          style={{
            ...proseStyle,
            marginTop: 8,
            fontSize: 16,
            lineHeight: 1.55,
          }}
        >
          Reached{" "}
          <strong style={strongStyle}>
            {formatCompactNumber(post.reach)} people
          </strong>
          {beats ? (
            <>
              {" "}
              — about{" "}
              {formatCompactNumber(Math.max(1, Math.round(post.reach / Math.max(1, baseline))))}× what an Alliance post typically does.
            </>
          ) : null}
          {post.engagements > 0 ? (
            <>
              {" "}
              {formatNumber(post.engagements)}{" "}
              {post.engagements === 1 ? "engagement" : "engagements"} so far.
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}

function CompanyCalloutChapter({
  company,
  totalReach,
}: {
  company: OwnerStoryData["company"];
  totalReach: number;
}) {
  const yearly = company.window_365d.reach;
  const listings = company.active_listings;
  if (yearly === 0) return null;

  return (
    <section
      className="story-callout"
      style={{
        padding: "56px 24px",
        margin: "32px 0",
        backgroundColor: BG_SOFT,
        borderTop: `1px solid ${RULE}`,
        borderBottom: `1px solid ${RULE}`,
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          fontWeight: 500,
          color: INK_MUTED,
        }}
      >
        Behind your campaign
      </div>
      <p
        style={{
          ...proseStyle,
          marginTop: 16,
          fontSize: 18,
          lineHeight: 1.55,
        }}
      >
        Your home isn&apos;t being marketed in a silo. Alliance has reached{" "}
        <strong style={strongStyle}>
          {formatCompactNumber(yearly)} people
        </strong>{" "}
        across our active listings in the last year.{" "}
        <strong style={strongStyle}>
          {formatCompactNumber(totalReach)}
        </strong>{" "}
        of those views were for your home
        {listings > 0 ? (
          <>
            {" "}
            — one of <strong style={strongStyle}>{formatNumber(listings)}</strong>{" "}
            we&apos;re actively marketing right now
          </>
        ) : null}
        .
      </p>
      <p
        style={{
          marginTop: 16,
          fontSize: 14,
          color: INK_SOFT,
          fontWeight: 400,
        }}
      >
        Other firms don&apos;t open the books like this.{" "}
        <span style={{ color: GOLD, fontWeight: 500 }}>Alliance does.</span>
      </p>
    </section>
  );
}

function TimelineChapter({ posts }: { posts: OwnerStoryPost[] }) {
  return (
    <ChapterShell eyebrow="The Campaign">
      <h2 style={chapterHeadingStyle}>Every post we&apos;ve put behind your home.</h2>
      <p style={{ ...proseStyle, marginTop: 16 }}>
        Newest first. Nothing hidden.
      </p>
      <ol
        style={{
          marginTop: 24,
          listStyle: "none",
          padding: 0,
        }}
      >
        {posts.map((post, idx) => (
          <TimelineRow
            key={post.id}
            post={post}
            isFirst={idx === 0}
            isLast={idx === posts.length - 1}
          />
        ))}
      </ol>
    </ChapterShell>
  );
}

function TimelineRow({
  post,
  isFirst,
  isLast,
}: {
  post: OwnerStoryPost;
  isFirst: boolean;
  isLast: boolean;
}) {
  const thumb = post.thumbnail_url;
  const caption = post.caption || "No caption recorded.";
  return (
    <li
      style={{
        display: "grid",
        gridTemplateColumns: "72px minmax(0, 1fr)",
        gap: 16,
        padding: "20px 0",
        borderTop: isFirst ? `1px solid ${RULE}` : undefined,
        borderBottom: `1px solid ${isLast ? RULE : RULE}`,
        alignItems: "flex-start",
      }}
    >
      <div
        style={{
          position: "relative",
          width: 72,
          height: 72,
          overflow: "hidden",
          backgroundColor: "#f4f4f4",
          borderRadius: 4,
        }}
      >
        {thumb ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumb}
              alt=""
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter: "blur(12px)",
                transform: "scale(1.2)",
                opacity: 0.55,
              }}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumb}
              alt=""
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "contain",
              }}
            />
          </>
        ) : null}
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            fontWeight: 500,
            color: INK_MUTED,
          }}
        >
          {platformLabel(post.platform)}
          {post.posted_at ? ` · ${formatShortDate(post.posted_at)}` : ""}
        </div>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 14,
            lineHeight: 1.55,
            color: INK,
            fontWeight: 400,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {caption}
        </p>
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            color: INK_SOFT,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatCompactNumber(post.reach)} reached
          {post.engagements > 0 ? (
            <>
              <span style={{ color: INK_MUTED }}> · </span>
              {formatCompactNumber(post.engagements)}{" "}
              {post.engagements === 1 ? "engagement" : "engagements"}
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function ConversationChapter({
  engagements,
  postCount,
}: {
  engagements: number;
  postCount: number;
}) {
  return (
    <ChapterShell eyebrow="Conversation">
      <p style={proseStyle}>
        People aren&apos;t just scrolling past. Across{" "}
        <strong style={strongStyle}>
          {formatNumber(postCount)} {postCount === 1 ? "post" : "posts"}
        </strong>
        , your home has earned{" "}
        <strong style={strongStyle}>
          {formatNumber(engagements)} engagements
        </strong>{" "}
        — likes, comments, shares, and saves from real people in the Alliance
        audience.
      </p>
    </ChapterShell>
  );
}

function WhereItStandsChapter({
  status,
  postCount,
}: {
  status: PropertyStatus;
  postCount: number;
}) {
  let eyebrow = "Where it stands";
  let heading = "We’re continuing to market your home.";
  let body =
    "Each week brings new posts and new eyes on your listing — we’ll keep this page fresh as the campaign continues.";

  if (status === "pending") {
    eyebrow = "Under contract";
    heading = "Your home found its buyer.";
    body =
      postCount > 0
        ? "Here’s the full campaign that got it there — every post is preserved above. We’ll keep this page live through closing."
        : "We’ll keep this page live through closing.";
  } else if (status === "sold") {
    eyebrow = "Sold";
    heading = "Mission accomplished.";
    body =
      postCount > 0
        ? "This is the campaign that sold your home. Thank you for trusting Alliance with one of the biggest decisions you’ll make."
        : "Thank you for trusting Alliance with one of the biggest decisions you’ll make.";
  } else if (status === "expired") {
    // Gracefully degrade to active framing — don't read tragic.
    eyebrow = "Where it stands";
    heading = "Here’s the campaign so far.";
    body =
      "Talk to your agent about next steps — the work that went into this page is preserved.";
  }

  return (
    <ChapterShell eyebrow={eyebrow}>
      <h2 style={chapterHeadingStyle}>{heading}</h2>
      <p style={{ ...proseStyle, marginTop: 16 }}>{body}</p>
    </ChapterShell>
  );
}

function WhatNowChapter({
  address,
  agentName,
  agentEmail,
}: {
  address: string | null;
  agentName: string | null;
  agentEmail: string | null;
}) {
  const firstName = agentName?.split(" ")[0] ?? "your agent";
  const subjectLine = address
    ? `Question about ${address}`
    : "Question about my listing";
  const mailto = agentEmail
    ? `mailto:${agentEmail}?subject=${encodeURIComponent(subjectLine)}`
    : null;
  const askMailto = agentEmail
    ? `mailto:${agentEmail}?subject=${encodeURIComponent(
        address ? `Question about a post — ${address}` : "Question about a post",
      )}`
    : null;

  return (
    <section
      className="story-whatnow"
      style={{ padding: "48px 24px 24px" }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          fontWeight: 500,
          color: INK_MUTED,
        }}
      >
        What now
      </div>
      <h2 style={{ ...chapterHeadingStyle, marginTop: 14 }}>
        Got a thought, a question, or want to share this?
      </h2>
      <div
        style={{
          marginTop: 24,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {mailto ? (
          <a
            href={mailto}
            style={primaryActionStyle}
          >
            Text or email {firstName}
            <ArrowRight />
          </a>
        ) : null}
        <ShareLinkButton style={secondaryActionStyle} address={address} />
        {askMailto ? (
          <a
            href={askMailto}
            style={secondaryActionStyle}
          >
            Ask about a specific post
          </a>
        ) : null}
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer
      className="story-footer"
      style={{
        padding: "56px 24px 40px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          opacity: 0.7,
        }}
      >
        <C21Seal />
        <span style={{ fontSize: 13, color: INK }}>Century 21 Alliance</span>
      </div>
      <div
        style={{
          marginTop: 20,
          fontSize: 10,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          fontWeight: 500,
          color: INK_MUTED,
        }}
      >
        This page updates automatically
      </div>
    </footer>
  );
}

/* ----------------------------------------------------------------------- *
 *  Shared atoms
 * ----------------------------------------------------------------------- */

function ChapterShell({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section className="story-chapter" style={{ padding: "44px 24px" }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          fontWeight: 500,
          color: INK_MUTED,
        }}
      >
        {eyebrow}
      </div>
      <div style={{ marginTop: 18 }}>{children}</div>
    </section>
  );
}

// Prose stays readable even when the outer container grows to 880px on
// desktop. Caps the line length at ~64-70ch so paragraphs don't sprawl.
const proseStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 17,
  lineHeight: 1.6,
  color: INK,
  fontWeight: 400,
  maxWidth: 600,
};

const strongStyle: React.CSSProperties = {
  fontWeight: 500,
  color: INK,
};

const chapterHeadingStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "clamp(24px, 5vw, 30px)",
  lineHeight: 1.1,
  letterSpacing: "-0.02em",
  fontWeight: 500,
  color: INK,
  maxWidth: 600,
};

const primaryActionStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  padding: "16px 24px",
  backgroundColor: INK,
  color: "#ffffff",
  textDecoration: "none",
  fontSize: 14,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  fontWeight: 500,
  borderRadius: 2,
};

const secondaryActionStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  padding: "14px 24px",
  border: `1px solid ${INK}`,
  backgroundColor: "transparent",
  color: INK,
  textDecoration: "none",
  fontSize: 13,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  fontWeight: 500,
  borderRadius: 2,
  cursor: "pointer",
  fontFamily: "inherit",
};

function ArrowRight() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" aria-hidden="true">
      <path
        d="M5 12h14m0 0l-5-5m5 5l-5 5"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function C21Seal() {
  return (
    <svg width={20} height={24} viewBox="0 0 20 24" aria-hidden="true">
      <rect width={20} height={24} fill={GOLD} />
      <text
        x="50%"
        y="58%"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="'Barlow', system-ui, sans-serif"
        fontSize={10}
        fontWeight={500}
        fill="#ffffff"
        letterSpacing="0.04em"
      >
        21
      </text>
    </svg>
  );
}

/* ----------------------------------------------------------------------- *
 *  Helpers
 * ----------------------------------------------------------------------- */

function platformLabel(p: Platform): string {
  if (p === "facebook") return "Facebook";
  if (p === "instagram") return "Instagram";
  return "TikTok";
}

function firstLineOfAddress(address: string | null): string {
  if (!address) return "";
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return address;
  return parts[0] ?? "";
}

function secondLineOfAddress(listing: OwnerStoryData["listing"]): string {
  // Prefer the explicit city/state/zip fields when available — the
  // properties table carries them separately and it's cleaner than re-parsing
  // a comma-joined address string.
  const city = listing.city?.trim();
  const state = listing.state?.trim();
  const zip = listing.zip?.trim();
  if (city && state) {
    return [`${city}, ${state}`, zip].filter(Boolean).join(" ");
  }
  if (city) return city;
  if (!listing.address) return "";
  // Fallback: pull everything after the first comma in the joined address.
  const parts = listing.address
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(1).join(", ");
}
