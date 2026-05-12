import "server-only";
import path from "node:path";
import fs from "node:fs";
import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
  Image,
  pdf,
} from "@react-pdf/renderer";
import type { ReportPayload, ReportCampaign } from "./build";
import type { CompanyRollup } from "@/lib/data/company-rollup";
import {
  formatCompactNumber,
  formatCurrency,
  formatShortDate,
} from "@/lib/format";
import type { Platform } from "@/lib/types/post";

/**
 * Read the C21 seal once at module load and cache the bytes. Used on the
 * footer (Direction B) at 60% opacity. Returns null if the asset isn't
 * bundled (e.g. local dev with a missing public/brand directory) — the
 * footer still renders with just the wordmark in that case.
 */
function loadSealBuffer(): Buffer | null {
  try {
    const sealPath = path.join(process.cwd(), "public", "brand", "c21-seal.png");
    return fs.readFileSync(sealPath);
  } catch {
    return null;
  }
}

const SEAL_BUFFER: Buffer | null = loadSealBuffer();

/**
 * Server-side PDF rendering for property report flyers using
 * @react-pdf/renderer. The route handler at
 * app/r/[token]/flyer.pdf/route.ts calls renderReportPdf and streams the
 * bytes back as application/pdf.
 *
 * Direction B — "Compass / Minimal Modern" (LOCKED). Mirrors the live
 * web report at app/r/[token]/page.tsx:
 *   - Typography: Helvetica fallback for Barlow (see FONT NOTE below)
 *   - Weights 400/500 only — mapped to Helvetica + Helvetica-Bold
 *   - Gold (#C9A84C) reserved for 3 surfaces inside the PDF:
 *       1) 1pt gold rule between Performance and Marketing
 *       2) the word "does" in the Alliance closing line
 *       3) tiny C21 seal mark in the footer at 60% opacity
 *     (The 4th gold slot — the "Download PDF" link in the web action bar —
 *     has no analog inside a PDF and is intentionally unused.)
 *   - No card boxes; editorial post-rows with hairlines between them
 *   - Single break band (#fafafa) for the Alliance section
 *
 * If rendering throws (e.g. font issue, image fetch failure), the route
 * handler falls back to a 302-redirect to the print-styled HTML flyer at
 * /r/[token]/flyer?print=1, so the user always gets a printable view.
 *
 * FONT NOTE: Barlow registration via @react-pdf/renderer is brittle in a
 * Vercel serverless environment (font network fetches at render time can
 * race the function timeout and cause silent fallbacks to system fonts).
 * To keep the never-throw contract, we stick with the built-in PDF
 * Helvetica and use weight 700 ("Helvetica-Bold") to emulate Barlow 500.
 * If/when we ship a local Barlow .ttf with the deployment, swap in
 * Font.register here.
 */

// ---------------------------------------------------------------------------
// Brand tokens (Direction B)
// ---------------------------------------------------------------------------

const COLOR_BG = "#ffffff";
const COLOR_BG_ALLIANCE = "#fafafa";
const COLOR_TEXT = "#171717";
const COLOR_TEXT_BODY = "#404040";
const COLOR_TEXT_MUTED = "#737373";
const COLOR_TEXT_FAINT = "#a3a3a3";
const COLOR_HAIRLINE = "#ececec";
const COLOR_GOLD = "#C9A84C";

// Type scale (Letter page, ~548pt content area after tightened padding).
// Tightened from the original Direction B scale to fit more info per page
// without overwhelming the reader — the seller wants density, not a billboard.
const SIZE_DISPLAY_1 = 44; // Performance hero number
const SIZE_DISPLAY_2 = 22; // Property address
const SIZE_DISPLAY_3 = 24; // Alliance stat numbers
const SIZE_SECTION_H = 16; // Section headline
const SIZE_AGENT = 15; // Agent name
const SIZE_BODY_LG = 10;
const SIZE_BODY = 9.5;
const SIZE_BODY_SM = 9;
const SIZE_STAT_RIGHT = 13; // post-row right-aligned reach
const SIZE_PLATFORM_CHIP = 8.5; // per-platform breakdown chips
const SIZE_EYEBROW = 7;

// Page padding — tightened to give the content more room
const PAGE_PADDING_X = 32;
const PAGE_PADDING_Y_TOP = 36;
const PAGE_PADDING_Y_BOTTOM = 36;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  // Page shells
  page: {
    backgroundColor: COLOR_BG,
    paddingTop: PAGE_PADDING_Y_TOP,
    paddingBottom: PAGE_PADDING_Y_BOTTOM,
    paddingHorizontal: PAGE_PADDING_X,
    fontFamily: "Helvetica",
    color: COLOR_TEXT,
    fontSize: SIZE_BODY,
  },
  pageAlliance: {
    backgroundColor: COLOR_BG_ALLIANCE,
    paddingTop: PAGE_PADDING_Y_TOP + 20,
    paddingBottom: PAGE_PADDING_Y_BOTTOM,
    paddingHorizontal: PAGE_PADDING_X,
    fontFamily: "Helvetica",
    color: COLOR_TEXT,
    fontSize: SIZE_BODY,
  },

  // Eyebrow label — uppercase + bold + a tiny letter-spacing emulation
  // (react-pdf supports letterSpacing as a numeric pt offset)
  eyebrow: {
    fontFamily: "Helvetica-Bold",
    fontSize: SIZE_EYEBROW,
    color: COLOR_TEXT_MUTED,
    textTransform: "uppercase",
    letterSpacing: 1.6,
  },
  eyebrowFaint: {
    fontFamily: "Helvetica-Bold",
    fontSize: SIZE_EYEBROW,
    color: COLOR_TEXT_FAINT,
    textTransform: "uppercase",
    letterSpacing: 1.6,
  },

  // -------- Page 1: Property identity --------
  identityAddress: {
    marginTop: 10,
    fontFamily: "Helvetica-Bold",
    fontSize: SIZE_DISPLAY_2,
    color: COLOR_TEXT,
    lineHeight: 1.05,
    letterSpacing: -0.4,
  },
  identityAddressLine2: {
    marginTop: 4,
    fontFamily: "Helvetica",
    fontSize: 13,
    color: COLOR_TEXT_MUTED,
    lineHeight: 1.1,
    letterSpacing: -0.2,
  },
  identityStatRow: {
    marginTop: 18,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  identityStatCell: {
    marginRight: 32,
    marginBottom: 8,
  },
  identityStatValue: {
    marginTop: 4,
    fontFamily: "Helvetica-Bold",
    fontSize: SIZE_STAT_RIGHT,
    color: COLOR_TEXT,
    letterSpacing: -0.2,
  },

  identityHeroBox: {
    marginTop: 18,
    height: 200,
    backgroundColor: "#f4f4f4",
    overflow: "hidden",
  },
  identityHeroImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  identityHeroEmpty: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  identityHeroEmptyLabel: {
    fontSize: 10,
    color: COLOR_TEXT_FAINT,
    textTransform: "uppercase",
    letterSpacing: 1.8,
    fontFamily: "Helvetica-Bold",
  },

  // -------- Performance section (now lives on page 1, below identity) --------
  perfHeroRow: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "flex-end",
  },
  perfHeroNumber: {
    fontFamily: "Helvetica-Bold",
    fontSize: SIZE_DISPLAY_1,
    color: COLOR_TEXT,
    lineHeight: 0.98,
    letterSpacing: -1.4,
  },
  perfHeroLabel: {
    marginLeft: 12,
    paddingBottom: 6,
    fontFamily: "Helvetica",
    fontSize: 12,
    color: COLOR_TEXT_MUTED,
  },
  perfBody: {
    marginTop: 14,
    maxWidth: 440,
    fontFamily: "Helvetica",
    fontSize: SIZE_BODY_LG,
    lineHeight: 1.55,
    color: COLOR_TEXT_BODY,
  },
  perfBodyEmphasis: {
    fontFamily: "Helvetica-Bold",
    color: COLOR_TEXT,
  },

  goldRule: {
    marginTop: 22,
    height: 1,
    backgroundColor: COLOR_GOLD,
  },

  // -------- Marketing post feed (own page, wrappable) --------
  marketingHeadline: {
    marginTop: 8,
    fontFamily: "Helvetica-Bold",
    fontSize: SIZE_SECTION_H,
    color: COLOR_TEXT,
    lineHeight: 1.1,
    letterSpacing: -0.3,
  },
  postFeed: {
    marginTop: 14,
  },
  postRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: COLOR_HAIRLINE,
  },
  postRowLast: {
    borderBottomWidth: 1,
    borderBottomColor: COLOR_HAIRLINE,
  },
  postThumbBox: {
    width: 56,
    height: 56,
    marginRight: 14,
    backgroundColor: "#f4f4f4",
    overflow: "hidden",
  },
  postThumbImage: {
    width: 56,
    height: 56,
    objectFit: "cover",
  },
  postBody: {
    flex: 1,
    paddingRight: 12,
  },
  postCaption: {
    marginTop: 3,
    fontFamily: "Helvetica",
    fontSize: SIZE_BODY,
    color: COLOR_TEXT,
    lineHeight: 1.4,
  },
  // Per-platform breakdown chip strip — shows reach on each platform under
  // the caption. This is the fix for the "only TikTok shows" complaint: every
  // platform that ran this content appears here with its own number.
  postPlatformRow: {
    marginTop: 4,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  postPlatformChip: {
    marginRight: 10,
    fontFamily: "Helvetica",
    fontSize: SIZE_PLATFORM_CHIP,
    color: COLOR_TEXT_MUTED,
    letterSpacing: 0.2,
  },
  postPlatformChipValue: {
    fontFamily: "Helvetica-Bold",
    color: COLOR_TEXT,
  },
  postReachCell: {
    alignItems: "flex-end",
  },
  postReachValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: SIZE_STAT_RIGHT,
    color: COLOR_TEXT,
    letterSpacing: -0.2,
  },
  postReachLabel: {
    marginTop: 2,
    fontFamily: "Helvetica-Bold",
    fontSize: SIZE_EYEBROW,
    color: COLOR_TEXT_MUTED,
    textTransform: "uppercase",
    letterSpacing: 1.4,
  },
  emptyFeed: {
    paddingTop: 24,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: COLOR_HAIRLINE,
    borderBottomWidth: 1,
    borderBottomColor: COLOR_HAIRLINE,
    textAlign: "center",
    fontSize: SIZE_BODY,
    color: COLOR_TEXT_FAINT,
  },

  // -------- Page 4: Alliance --------
  allianceHeadline: {
    marginTop: 8,
    fontFamily: "Helvetica-Bold",
    fontSize: SIZE_SECTION_H,
    color: COLOR_TEXT,
    lineHeight: 1.15,
    letterSpacing: -0.3,
    maxWidth: 500,
  },
  allianceBody: {
    marginTop: 8,
    fontFamily: "Helvetica",
    fontSize: SIZE_BODY_LG,
    lineHeight: 1.55,
    color: COLOR_TEXT_BODY,
    maxWidth: 480,
  },
  allianceGrid: {
    marginTop: 18,
    flexDirection: "row",
    flexWrap: "wrap",
    width: 500,
  },
  allianceCell: {
    width: "50%",
    paddingRight: 18,
    paddingBottom: 14,
  },
  allianceCellValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: SIZE_DISPLAY_3,
    color: COLOR_TEXT,
    lineHeight: 1,
    letterSpacing: -0.6,
  },
  allianceCellLabel: {
    marginTop: 4,
    fontFamily: "Helvetica",
    fontSize: SIZE_BODY_SM,
    color: COLOR_TEXT_MUTED,
    lineHeight: 1.35,
  },
  allianceClosing: {
    marginTop: 12,
    fontFamily: "Helvetica",
    fontSize: SIZE_BODY_LG,
    color: COLOR_TEXT,
    lineHeight: 1.5,
    maxWidth: 500,
  },
  allianceClosingGold: {
    fontFamily: "Helvetica-Bold",
    color: COLOR_GOLD,
  },

  // -------- Agent + Footer --------
  agentBlock: {
    marginTop: 22,
  },
  agentName: {
    marginTop: 6,
    fontFamily: "Helvetica-Bold",
    fontSize: SIZE_AGENT,
    color: COLOR_TEXT,
    letterSpacing: -0.2,
  },
  agentOffice: {
    marginTop: 3,
    fontFamily: "Helvetica",
    fontSize: SIZE_BODY,
    color: COLOR_TEXT_MUTED,
    lineHeight: 1.35,
  },
  agentEmail: {
    marginTop: 8,
    fontFamily: "Helvetica-Bold",
    fontSize: SIZE_BODY,
    color: COLOR_TEXT,
    letterSpacing: 0.2,
  },

  footer: {
    marginTop: 22,
    alignItems: "center",
  },
  footerSealRow: {
    flexDirection: "row",
    alignItems: "center",
    opacity: 0.6,
  },
  footerSealImage: {
    width: 14,
    height: 17,
    marginRight: 8,
    objectFit: "contain",
  },
  footerSealFallback: {
    width: 14,
    height: 17,
    marginRight: 8,
    backgroundColor: COLOR_GOLD,
  },
  footerWordmark: {
    fontFamily: "Helvetica",
    fontSize: SIZE_BODY,
    color: COLOR_TEXT,
  },
  footerCaption: {
    marginTop: 14,
    fontFamily: "Helvetica-Bold",
    fontSize: SIZE_EYEBROW,
    color: COLOR_TEXT_FAINT,
    textTransform: "uppercase",
    letterSpacing: 1.6,
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function platformLabel(p: Platform): string {
  if (p === "facebook") return "Facebook";
  if (p === "instagram") return "Instagram";
  return "TikTok";
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  if (!t) return "No caption recorded.";
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

/** Best-effort 2-line address split mirroring the live web view. */
function firstLineOfAddress(address: string): string {
  if (!address) return "";
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? address;
  return parts[0];
}

function secondLineOfAddress(address: string): string {
  if (!address) return "";
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(1).join(", ");
}

interface PdfExtras {
  /** Optional recipient nameplate ("PREPARED FOR ..."). */
  recipient_name?: string | null;
  /** Optional agent contact info — falls back gracefully when absent. */
  agent_name?: string | null;
  agent_email?: string | null;
  /** Optional listing date for the property-identity stat row. */
  listing_date?: string | null;
}

function loadExtras(payload: ReportPayload): PdfExtras {
  // The build.ts payload doesn't expose these fields directly, but the public
  // route can attach them onto the payload before passing it in. Defensive
  // coercion keeps tsc + runtime happy if missing.
  const anyPayload = payload as unknown as { __pdf_extras?: PdfExtras };
  return anyPayload.__pdf_extras ?? {};
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function HeroImage({ url }: { url?: string | null }) {
  // No URL -> render the empty-state label like the live web view.
  if (!url) {
    return (
      <View style={styles.identityHeroEmpty}>
        <Text style={styles.identityHeroEmptyLabel}>No cover photo on file</Text>
      </View>
    );
  }
  return <Image src={url} style={styles.identityHeroImage} />;
}

function PropertyStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.identityStatCell}>
      <Text style={styles.eyebrow}>{label.toUpperCase()}</Text>
      <Text style={styles.identityStatValue}>{value}</Text>
    </View>
  );
}

/**
 * Page 1 — combined identity + performance. Packs the property hero, three
 * key facts (price/MLS/listed), the photo, and the headline reach/posts/
 * engagements numbers onto a single sheet so the seller sees the headline
 * story at a glance, then dives into the per-post detail on page 2+.
 */
function IdentityAndPerformancePage({
  payload,
  companyRollup,
  extras,
}: {
  payload: ReportPayload;
  companyRollup: CompanyRollup;
  extras: PdfExtras;
}) {
  const { property } = payload;
  const recipientLabel = extras.recipient_name
    ? `Prepared for ${extras.recipient_name}`
    : "Prepared for the owner";
  const k = payload.kpis;
  const postCount = k.post_count;
  const totalEngagements = k.total_engagements;
  const audienceTotal = companyRollup.followers.total;

  return (
    <Page size="LETTER" style={styles.page} wrap>
      <Text style={styles.eyebrow}>{recipientLabel.toUpperCase()}</Text>

      <Text style={styles.identityAddress}>
        {firstLineOfAddress(property.address)}
      </Text>
      {secondLineOfAddress(property.address) ? (
        <Text style={styles.identityAddressLine2}>
          {secondLineOfAddress(property.address)}
        </Text>
      ) : null}

      <View style={styles.identityStatRow}>
        <PropertyStat
          label="List Price"
          value={
            typeof property.list_price === "number"
              ? formatCurrency(property.list_price)
              : "—"
          }
        />
        <PropertyStat label="MLS" value={property.mls} />
        <PropertyStat
          label="Listed"
          value={
            extras.listing_date ? formatShortDate(extras.listing_date) : "—"
          }
        />
      </View>

      <View style={styles.identityHeroBox}>
        <HeroImage url={property.hero_image_url ?? null} />
      </View>

      {/* Performance summary — same data shape as the standalone page,
          but tightened to fit alongside the identity block. */}
      <Text style={[styles.eyebrow, { marginTop: 20 }]}>PERFORMANCE</Text>

      <View style={styles.perfHeroRow}>
        <Text style={styles.perfHeroNumber}>
          {formatCompactNumber(k.total_reach)}
        </Text>
        <Text style={styles.perfHeroLabel}>people reached</Text>
      </View>

      <Text style={styles.perfBody}>
        We published{" "}
        <Text style={styles.perfBodyEmphasis}>
          {formatCompactNumber(postCount)} {postCount === 1 ? "post" : "posts"}
        </Text>{" "}
        behind your home, generating{" "}
        <Text style={styles.perfBodyEmphasis}>
          {formatCompactNumber(totalEngagements)} engagements
        </Text>{" "}
        across an audience of{" "}
        <Text style={styles.perfBodyEmphasis}>
          {formatCompactNumber(audienceTotal)}
        </Text>{" "}
        on Instagram, Facebook, and TikTok.
      </Text>

      {/* Gold accent #1 — single 1pt rule */}
      <View style={styles.goldRule} />
    </Page>
  );
}

function PostRow({
  campaign,
  isLast,
}: {
  campaign: ReportCampaign;
  isLast: boolean;
}) {
  const date = campaign.posted_at ? formatShortDate(campaign.posted_at) : "";
  const platformCount = campaign.by_platform.length;
  const eyebrowText = [
    date,
    `${platformCount} ${platformCount === 1 ? "platform" : "platforms"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  // Sort by reach DESC so the strongest platform reads first.
  const platforms = [...campaign.by_platform].sort(
    (a, b) => b.reach - a.reach,
  );

  return (
    <View
      style={[styles.postRow, isLast ? styles.postRowLast : {}]}
      wrap={false}
    >
      <View style={styles.postThumbBox}>
        {campaign.thumbnail_url ? (
          <Image src={campaign.thumbnail_url} style={styles.postThumbImage} />
        ) : null}
      </View>
      <View style={styles.postBody}>
        <Text style={styles.eyebrow}>{eyebrowText.toUpperCase()}</Text>
        <Text style={styles.postCaption}>{truncate(campaign.label, 140)}</Text>
        {/* Per-platform breakdown — the fix for "only TikTok shows": every
            platform that ran this content gets its own visible number, so the
            seller sees the full picture instead of just the dominant one. */}
        {platforms.length > 0 ? (
          <View style={styles.postPlatformRow}>
            {platforms.map((p) => (
              <Text key={p.platform} style={styles.postPlatformChip}>
                {platformLabel(p.platform)}{" "}
                <Text style={styles.postPlatformChipValue}>
                  {formatCompactNumber(p.reach)}
                </Text>
              </Text>
            ))}
          </View>
        ) : null}
      </View>
      <View style={styles.postReachCell}>
        <Text style={styles.postReachValue}>
          {formatCompactNumber(campaign.total_reach)}
        </Text>
        <Text style={styles.postReachLabel}>TOTAL REACH</Text>
      </View>
    </View>
  );
}

function MarketingPage({ payload }: { payload: ReportPayload }) {
  const campaigns = payload.campaigns;

  return (
    <Page size="LETTER" style={styles.page} wrap>
      <Text style={styles.eyebrow}>MARKETING</Text>
      <Text style={styles.marketingHeadline}>
        Every post we put behind your home.
      </Text>

      <View style={styles.postFeed}>
        {campaigns.length === 0 ? (
          <Text style={styles.emptyFeed}>
            No posts attached to this listing yet.
          </Text>
        ) : (
          campaigns.map((c, idx) => (
            <PostRow
              key={c.id}
              campaign={c}
              isLast={idx === campaigns.length - 1}
            />
          ))
        )}
      </View>
    </Page>
  );
}

function AllianceStatCell({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  return (
    <View style={styles.allianceCell}>
      <Text style={styles.allianceCellValue}>{value}</Text>
      <Text style={styles.allianceCellLabel}>{label}</Text>
    </View>
  );
}

function AlliancePage({
  companyRollup,
  extras,
}: {
  companyRollup: CompanyRollup;
  extras: PdfExtras;
}) {
  const w30 = companyRollup.window_30d;
  const w365 = companyRollup.window_365d;

  // Derive a polite office line — the PDF doesn't get the agent_email host
  // unless extras provides it. Fall back to the brand name.
  const agentName = extras.agent_name ?? "Your Alliance agent";
  const officeLine = "Century 21 Alliance";

  return (
    <Page size="LETTER" style={styles.pageAlliance} wrap>
      <Text style={styles.eyebrow}>ALLIANCE</Text>
      <Text style={styles.allianceHeadline}>
        Your home isn&apos;t being marketed in a silo.
      </Text>
      <Text style={styles.allianceBody}>
        It&apos;s part of an audience built over years — and the work has shown
        up every month.
      </Text>

      <View style={styles.allianceGrid}>
        <AllianceStatCell
          value={formatCompactNumber(w30.posts)}
          label="Posts in the last 30 days"
        />
        <AllianceStatCell
          value={formatCompactNumber(w30.reach)}
          label="People reached in the last 30 days"
        />
        <AllianceStatCell
          value={formatCompactNumber(w365.posts)}
          label="Posts in the last 365 days"
        />
        <AllianceStatCell
          value={formatCompactNumber(w365.reach)}
          label="People reached in the last 365 days"
        />
      </View>

      <Text style={styles.allianceClosing}>
        Other firms don&apos;t open the books like this. Alliance{" "}
        <Text style={styles.allianceClosingGold}>does</Text>.
      </Text>

      <View style={styles.agentBlock}>
        <Text style={styles.eyebrow}>YOUR AGENT</Text>
        <Text style={styles.agentName}>{agentName}</Text>
        <Text style={styles.agentOffice}>{officeLine}</Text>
        {extras.agent_email ? (
          <Text style={styles.agentEmail}>{extras.agent_email}</Text>
        ) : null}
      </View>

      <View style={styles.footer}>
        <View style={styles.footerSealRow}>
          {SEAL_BUFFER ? (
            <Image src={SEAL_BUFFER} style={styles.footerSealImage} />
          ) : (
            <View style={styles.footerSealFallback} />
          )}
          <Text style={styles.footerWordmark}>Century 21 Alliance</Text>
        </View>
        <Text style={styles.footerCaption}>PREPARED BY ALLIANCE SOCIAL</Text>
      </View>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

function ReportDocument({
  payload,
  companyRollup,
}: {
  payload: ReportPayload;
  companyRollup: CompanyRollup;
}) {
  const extras = loadExtras(payload);
  return (
    <Document
      title={`Alliance Property Report — ${payload.property.mls}`}
      author="Century 21 Alliance"
      subject="Property marketing report"
    >
      <IdentityAndPerformancePage
        payload={payload}
        companyRollup={companyRollup}
        extras={extras}
      />
      <MarketingPage payload={payload} />
      <AlliancePage companyRollup={companyRollup} extras={extras} />
    </Document>
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render a property report payload to a PDF byte array.
 *
 * Throws on any rendering failure (font load, image fetch error, layout
 * overflow). Callers should wrap this in try/catch and fall back to the
 * HTML print view via getPdfRedirectTarget.
 */
export async function renderReportPdf(
  payload: ReportPayload,
  companyRollup: CompanyRollup,
): Promise<Uint8Array> {
  const instance = pdf(
    <ReportDocument payload={payload} companyRollup={companyRollup} />,
  );
  // @react-pdf/renderer v4 returns a NodeJS.ReadableStream from toBuffer().
  // Older versions returned a Buffer directly. Handle both shapes so this
  // code keeps working across patch upgrades.
  const result = (await instance.toBuffer()) as unknown;

  // Buffer / Uint8Array fast path: it's already bytes if it has a numeric
  // length and no `on` event-emitter method.
  const maybeBytes = result as
    | (Uint8Array & { on?: unknown })
    | { length?: number; on?: unknown };
  if (
    result instanceof Uint8Array ||
    (typeof maybeBytes === "object" &&
      maybeBytes !== null &&
      typeof (maybeBytes as { length?: unknown }).length === "number" &&
      typeof (maybeBytes as { on?: unknown }).on !== "function" &&
      typeof (maybeBytes as { byteLength?: unknown }).byteLength === "number")
  ) {
    const bytes = result as Uint8Array;
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  // ReadableStream path — consume into a single Uint8Array.
  const stream = result as NodeJS.ReadableStream;
  const chunks: Uint8Array[] = [];
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    stream.on("data", (chunk: Buffer | Uint8Array | string) => {
      const u8 =
        typeof chunk === "string"
          ? new TextEncoder().encode(chunk)
          : chunk instanceof Uint8Array
            ? chunk
            : new Uint8Array(chunk as ArrayBufferLike);
      chunks.push(u8);
      total += u8.byteLength;
    });
    stream.on("end", () => resolve());
    stream.on("error", (err: Error) => reject(err));
  });
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/**
 * @deprecated Use renderReportPdf and stream the bytes back as
 * application/pdf instead. Kept for back-compat with callers that need the
 * HTML print fallback.
 *
 * Returns the URL the .pdf route should redirect to when PDF rendering
 * fails. Today: /r/{token}/flyer?print=1.
 */
export function getPdfRedirectTarget(token: string): string {
  return `/r/${encodeURIComponent(token)}/flyer?print=1`;
}
