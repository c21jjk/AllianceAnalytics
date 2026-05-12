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
import type { ReportPayload } from "./build";
import type { CompanyRollup } from "@/lib/data/company-rollup";
import {
  formatCompactNumber,
  formatCurrency,
  formatShortDate,
} from "@/lib/format";
import type { Platform } from "@/lib/types/post";

/**
 * Read the C21 seal once at module load and cache the bytes. Used by the
 * cover page only — other pages keep the plain gold "A" placeholder per
 * design spec. Returns null if the asset isn't bundled (e.g. local dev with
 * a missing public/brand directory) so render failures fall through to the
 * HTML print view.
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
 * Server-side PDF rendering for property report flyers, using
 * @react-pdf/renderer. The route handler at
 * app/r/[token]/flyer.pdf/route.ts calls renderReportPdf and streams the
 * resulting bytes back as application/pdf.
 *
 * If rendering throws (e.g. font issue, image fetch failure), the route
 * handler falls back to a 302-redirect to the print-styled HTML flyer at
 * /r/[token]/flyer?print=1, so the user always gets a printable view.
 */

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

// Obsessed Grey reserved for future dark accents — kept inline where used.
const COLOR_GOLD = "#C9A84C"; // Relentless Gold
const COLOR_GOLD_DARK = "#B78B3F";
const COLOR_TEXT = "#171717";
const COLOR_TEXT_MUTED = "#6b6b6b";
const COLOR_BORDER = "#e5e5e5";
const COLOR_PANEL = "#ffffff";
const COLOR_BG = "#ffffff";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  page: {
    backgroundColor: COLOR_BG,
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 44,
    fontFamily: "Helvetica",
    color: COLOR_TEXT,
    fontSize: 10,
  },

  // Brand header
  brandHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f1f1",
    marginBottom: 18,
  },
  brandLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  brandLogo: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: COLOR_GOLD,
    color: "#ffffff",
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    textAlign: "center",
    paddingTop: 6,
    marginRight: 10,
  },
  brandLogoSeal: {
    width: 30,
    height: 36,
    objectFit: "contain",
    marginRight: 10,
  },
  brandName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: COLOR_TEXT,
  },
  brandSub: {
    fontSize: 8,
    color: COLOR_TEXT_MUTED,
    marginTop: 2,
    letterSpacing: 1.2,
  },
  brandPeriod: {
    fontSize: 8,
    color: COLOR_TEXT_MUTED,
    letterSpacing: 1.2,
  },

  // Hero
  heroBox: {
    height: 280,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#f5f5f5",
    position: "relative",
    marginBottom: 18,
  },
  heroImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
  },
  heroFallback: {
    width: "100%",
    height: "100%",
    backgroundColor: COLOR_GOLD,
    alignItems: "center",
    justifyContent: "center",
  },
  heroFallbackMark: {
    fontFamily: "Helvetica-Bold",
    fontSize: 96,
    color: "#ffffff",
    opacity: 0.95,
  },
  heroOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 22,
    paddingVertical: 22,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  heroMls: {
    fontSize: 9,
    color: "#ffffff",
    opacity: 0.85,
    letterSpacing: 1.2,
    fontFamily: "Helvetica-Bold",
  },
  heroAddress: {
    fontFamily: "Helvetica-Bold",
    fontSize: 22,
    color: "#ffffff",
    marginTop: 6,
  },
  heroPriceRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
  },
  heroPriceChip: {
    flexDirection: "row",
    backgroundColor: "#ffffff",
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: "center",
  },
  heroPriceChipLabel: {
    fontSize: 8,
    color: COLOR_TEXT_MUTED,
    letterSpacing: 1.2,
    fontFamily: "Helvetica-Bold",
    marginRight: 8,
  },
  heroPriceChipValue: {
    fontSize: 11,
    color: COLOR_GOLD_DARK,
    fontFamily: "Helvetica-Bold",
  },

  // Callout
  callout: {
    marginTop: 4,
    padding: 16,
    borderWidth: 1,
    borderColor: "#efe2c4",
    backgroundColor: "#fffbf1",
    borderRadius: 6,
  },
  calloutKicker: {
    fontSize: 8,
    color: COLOR_TEXT_MUTED,
    letterSpacing: 1.2,
    fontFamily: "Helvetica-Bold",
  },
  calloutTitle: {
    marginTop: 4,
    fontFamily: "Helvetica-Bold",
    fontSize: 13,
    color: COLOR_TEXT,
  },
  calloutBody: {
    marginTop: 4,
    fontSize: 10,
    color: COLOR_TEXT_MUTED,
    lineHeight: 1.5,
  },

  // Section headings
  sectionH: {
    fontFamily: "Helvetica-Bold",
    fontSize: 18,
    color: COLOR_TEXT,
    marginBottom: 4,
  },
  sectionSub: {
    fontSize: 10,
    color: COLOR_TEXT_MUTED,
    marginBottom: 16,
  },

  // KPI grid
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -6,
  },
  kpiCol: {
    width: "33.333%",
    paddingHorizontal: 6,
    marginBottom: 12,
  },
  kpiColWide: {
    // Visually elevated "Total reach" tile spanning two columns.
    width: "66.666%",
    paddingHorizontal: 6,
    marginBottom: 12,
  },
  kpiCard: {
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    borderRadius: 6,
    padding: 14,
    backgroundColor: COLOR_PANEL,
  },
  kpiCardHero: {
    borderWidth: 1,
    borderColor: "#efe2c4",
    borderRadius: 6,
    padding: 16,
    backgroundColor: "#fffbf1",
  },
  kpiLabel: {
    fontSize: 8,
    color: COLOR_TEXT_MUTED,
    letterSpacing: 1.2,
    fontFamily: "Helvetica-Bold",
  },
  kpiValue: {
    marginTop: 6,
    fontFamily: "Helvetica-Bold",
    fontSize: 22,
    color: COLOR_TEXT,
  },
  kpiValueHero: {
    marginTop: 6,
    fontFamily: "Helvetica-Bold",
    fontSize: 36,
    color: COLOR_GOLD_DARK,
  },

  // Per-platform reach share bars (below KPI grid)
  shareList: {
    marginTop: 8,
  },
  shareRow: {
    marginBottom: 8,
  },
  shareRowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  shareLabel: {
    fontSize: 9,
    color: "#404040",
    fontFamily: "Helvetica-Bold",
  },
  shareValue: {
    fontSize: 9,
    color: COLOR_TEXT_MUTED,
  },
  shareTrack: {
    height: 6,
    backgroundColor: "#f1f1f1",
    borderRadius: 3,
    overflow: "hidden",
  },
  shareFill: {
    height: 6,
    backgroundColor: COLOR_GOLD,
    borderRadius: 3,
  },

  // Alliance Marketing Engine page
  engineGrid: {
    flexDirection: "row",
    marginHorizontal: -6,
    marginBottom: 14,
  },
  engineWindow: {
    flex: 1,
    paddingHorizontal: 6,
  },
  engineWindowLabel: {
    fontSize: 8,
    color: COLOR_TEXT_MUTED,
    letterSpacing: 1.2,
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },
  engineTile: {
    borderWidth: 1,
    borderColor: "#efe2c4",
    backgroundColor: "#fffbf1",
    borderRadius: 6,
    padding: 14,
    marginBottom: 10,
  },
  engineTileLabel: {
    fontSize: 8,
    color: COLOR_TEXT_MUTED,
    letterSpacing: 1.2,
    fontFamily: "Helvetica-Bold",
  },
  engineTileValue: {
    marginTop: 6,
    fontFamily: "Helvetica-Bold",
    fontSize: 26,
    color: COLOR_TEXT,
  },
  engineFollowerRow: {
    borderWidth: 1,
    borderColor: "#efe2c4",
    backgroundColor: "#fffbf1",
    borderRadius: 6,
    padding: 16,
    marginBottom: 14,
  },
  engineFollowerLabel: {
    fontSize: 8,
    color: COLOR_TEXT_MUTED,
    letterSpacing: 1.2,
    fontFamily: "Helvetica-Bold",
  },
  engineFollowerTopRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    marginTop: 6,
  },
  engineFollowerTotal: {
    fontFamily: "Helvetica-Bold",
    fontSize: 32,
    color: COLOR_GOLD_DARK,
  },
  engineFollowerBreakdown: {
    flexDirection: "row",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#efe2c4",
  },
  engineFollowerCell: {
    flex: 1,
  },
  engineFollowerCellLabel: {
    fontSize: 8,
    color: COLOR_TEXT_MUTED,
    letterSpacing: 1.2,
    fontFamily: "Helvetica-Bold",
  },
  engineFollowerCellValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    color: COLOR_TEXT,
    marginTop: 4,
  },
  engineQuote: {
    fontSize: 11,
    color: "#404040",
    lineHeight: 1.5,
    fontFamily: "Helvetica-Oblique",
    marginTop: 8,
  },

  // Campaigns
  campaign: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    borderRadius: 6,
    padding: 10,
    marginBottom: 12,
    backgroundColor: COLOR_PANEL,
  },
  campaignThumb: {
    width: 84,
    height: 84,
    borderRadius: 4,
    backgroundColor: "#f1f1f1",
    objectFit: "cover",
    marginRight: 12,
  },
  campaignThumbFallback: {
    width: 84,
    height: 84,
    borderRadius: 4,
    backgroundColor: COLOR_GOLD,
    marginRight: 12,
  },
  campaignBody: {
    flex: 1,
  },
  campaignLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: COLOR_TEXT,
    marginBottom: 6,
  },
  campaignTotalsRow: {
    flexDirection: "row",
    marginBottom: 6,
  },
  campaignTotalCell: {
    fontSize: 9,
    color: COLOR_TEXT_MUTED,
    marginRight: 16,
  },
  campaignTotalCellStrong: {
    fontFamily: "Helvetica-Bold",
    color: COLOR_TEXT,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  badge: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    backgroundColor: "#fafafa",
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginRight: 6,
    marginBottom: 4,
  },
  badgeText: {
    fontSize: 8,
    color: "#404040",
  },

  // Narrative
  narrative: {
    fontSize: 11,
    color: "#404040",
    lineHeight: 1.6,
    marginBottom: 12,
  },

  // Top locations list
  listKicker: {
    fontSize: 8,
    color: COLOR_TEXT_MUTED,
    letterSpacing: 1.2,
    fontFamily: "Helvetica-Bold",
    marginTop: 14,
    marginBottom: 6,
  },
  locRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#ececec",
    borderBottomStyle: "dashed",
  },
  locLabel: {
    fontSize: 10,
    color: "#404040",
  },
  locShare: {
    fontSize: 9,
    color: COLOR_TEXT_MUTED,
  },

  signoff: {
    marginTop: 28,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#efefef",
  },
  signoffMain: {
    fontSize: 10,
    color: "#404040",
  },
  signoffSub: {
    fontSize: 9,
    color: COLOR_TEXT_MUTED,
    marginTop: 2,
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
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

function loadNarrative(payload: ReportPayload): {
  hero?: string;
  reach_summary?: string;
  closing?: string;
} {
  // The build.ts payload doesn't currently expose `narrative`, but the
  // reports row in supabase carries one. We accept either by reading off
  // payload as a record. Defensive coercion keeps the doc happy if missing.
  const anyPayload = payload as unknown as {
    narrative?: { hero?: string; reach_summary?: string; closing?: string };
  };
  return anyPayload.narrative ?? {};
}

const DEFAULT_CLOSING =
  "Alliance Social put your home in front of a measured, qualified audience across the platforms most likely to drive serious buyer interest.";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface HeroImageProps {
  url?: string | null;
}

function HeroImage({ url }: HeroImageProps) {
  // Defensive: react-pdf will fetch the URL during render. If it fails, the
  // whole document throws — but the route handler has a try/catch fallback,
  // so a failing image just sends the user to the HTML print view. We still
  // render the gold block for the no-URL case directly here.
  if (!url) {
    return (
      <View style={styles.heroFallback}>
        <Text style={styles.heroFallbackMark}>A</Text>
      </View>
    );
  }
  return <Image src={url} style={styles.heroImage} />;
}

function BrandHeader({
  payload,
  withSeal = false,
}: {
  payload: ReportPayload;
  /**
   * When true, render the C21 seal image instead of the gold "A" placeholder.
   * Used on the cover (HeroPage) only; subsequent pages keep the placeholder
   * to preserve the report's lighter visual rhythm.
   */
  withSeal?: boolean;
}) {
  const periodText =
    payload.period_start && payload.period_end
      ? `${formatShortDate(payload.period_start)} – ${formatShortDate(payload.period_end)}`
      : "";
  return (
    <View style={styles.brandHeader}>
      <View style={styles.brandLeft}>
        {withSeal && SEAL_BUFFER ? (
          <Image src={SEAL_BUFFER} style={styles.brandLogoSeal} />
        ) : (
          <Text style={styles.brandLogo}>A</Text>
        )}
        <View>
          <Text style={styles.brandName}>Century 21 Alliance</Text>
          <Text style={styles.brandSub}>PROPERTY PERFORMANCE REPORT</Text>
        </View>
      </View>
      <Text style={styles.brandPeriod}>{periodText.toUpperCase()}</Text>
    </View>
  );
}

function HeroPage({ payload }: { payload: ReportPayload }) {
  const { property } = payload;
  return (
    <Page size="LETTER" style={styles.page} wrap={false}>
      <BrandHeader payload={payload} withSeal />

      <View style={styles.heroBox}>
        <HeroImage url={property.hero_image_url ?? null} />
        <View style={styles.heroOverlay}>
          <Text style={styles.heroMls}>MLS {property.mls}</Text>
          <Text style={styles.heroAddress}>{property.address}</Text>
          {typeof property.list_price === "number" ? (
            <View style={styles.heroPriceRow}>
              <View style={styles.heroPriceChip}>
                <Text style={styles.heroPriceChipLabel}>LIST PRICE</Text>
                <Text style={styles.heroPriceChipValue}>
                  {formatCurrency(property.list_price)}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.callout}>
        <Text style={styles.calloutKicker}>PREPARED FOR</Text>
        <Text style={styles.calloutTitle}>
          The seller of {property.address}
        </Text>
        <Text style={styles.calloutBody}>
          An Alliance Social marketing report covering every post we put behind
          your home across Instagram, Facebook, and TikTok.
        </Text>
      </View>
    </Page>
  );
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kpiCol}>
      <View style={styles.kpiCard}>
        <Text style={styles.kpiLabel}>{label.toUpperCase()}</Text>
        <Text style={styles.kpiValue}>{value}</Text>
      </View>
    </View>
  );
}

/**
 * Wide hero KPI tile that spans 2/3 of the grid width. Used to give "Total
 * reach" the visual emphasis John called for in the redesign spec.
 */
function HeroKpiCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kpiColWide}>
      <View style={styles.kpiCardHero}>
        <Text style={styles.kpiLabel}>{label.toUpperCase()}</Text>
        <Text style={styles.kpiValueHero}>{value}</Text>
      </View>
    </View>
  );
}

function KpiPage({
  payload,
  companyRollup,
}: {
  payload: ReportPayload;
  companyRollup: CompanyRollup;
}) {
  const k = payload.kpis;
  const platformShare = payload.audience.platform_share;
  return (
    <Page size="LETTER" style={styles.page} wrap={false}>
      <BrandHeader payload={payload} />
      <Text style={styles.sectionH}>Your home&apos;s performance</Text>
      <Text style={styles.sectionSub}>
        Aggregated across every post that ran for {payload.property.address}{" "}
        during the report period.
      </Text>

      <View style={styles.kpiGrid}>
        {/* Hero tile — emphasized total reach */}
        <HeroKpiCard
          label="Total reach"
          value={formatCompactNumber(k.total_reach)}
        />
        <KpiCard
          label="Total impressions"
          value={formatCompactNumber(k.total_impressions)}
        />
        <KpiCard
          label="Total engagements"
          value={formatCompactNumber(k.total_engagements)}
        />
        <KpiCard label="Posts" value={k.post_count.toString()} />
        <KpiCard
          label="Platforms"
          value={k.platforms_covered.toString()}
        />
        <KpiCard
          label="Audience"
          value={formatCompactNumber(companyRollup.followers.total)}
        />
      </View>

      {platformShare.length > 0 ? (
        <View style={styles.shareList}>
          <Text style={styles.listKicker}>REACH SHARE BY PLATFORM</Text>
          {platformShare.map((p) => (
            <View key={p.platform} style={styles.shareRow}>
              <View style={styles.shareRowHeader}>
                <Text style={styles.shareLabel}>{platformLabel(p.platform)}</Text>
                <Text style={styles.shareValue}>
                  {formatCompactNumber(p.reach)} reach {"·"}{" "}
                  {Math.round(p.share * 100)}%
                </Text>
              </View>
              <View style={styles.shareTrack}>
                <View
                  style={[
                    styles.shareFill,
                    {
                      width: `${Math.max(2, Math.round(p.share * 100))}%`,
                    },
                  ]}
                />
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </Page>
  );
}

function EnginePage({
  payload,
  companyRollup,
}: {
  payload: ReportPayload;
  companyRollup: CompanyRollup;
}) {
  const w30 = companyRollup.window_30d;
  const w365 = companyRollup.window_365d;
  const f = companyRollup.followers;
  return (
    <Page size="LETTER" style={styles.page} wrap={false}>
      <BrandHeader payload={payload} />
      <Text style={styles.sectionH}>The Alliance Marketing Engine</Text>
      <Text style={styles.sectionSub}>
        Your listing rides on the volume Alliance puts out every day. Here is the
        full body of work behind it.
      </Text>

      <View style={styles.engineGrid}>
        <View style={styles.engineWindow}>
          <Text style={styles.engineWindowLabel}>LAST 30 DAYS</Text>
          <View style={styles.engineTile}>
            <Text style={styles.engineTileLabel}>POSTS PUBLISHED</Text>
            <Text style={styles.engineTileValue}>
              {formatCompactNumber(w30.posts)}
            </Text>
          </View>
          <View style={styles.engineTile}>
            <Text style={styles.engineTileLabel}>PEOPLE REACHED</Text>
            <Text style={styles.engineTileValue}>
              {formatCompactNumber(w30.reach)}
            </Text>
          </View>
        </View>
        <View style={styles.engineWindow}>
          <Text style={styles.engineWindowLabel}>TRAILING 365 DAYS</Text>
          <View style={styles.engineTile}>
            <Text style={styles.engineTileLabel}>POSTS PUBLISHED</Text>
            <Text style={styles.engineTileValue}>
              {formatCompactNumber(w365.posts)}
            </Text>
          </View>
          <View style={styles.engineTile}>
            <Text style={styles.engineTileLabel}>PEOPLE REACHED</Text>
            <Text style={styles.engineTileValue}>
              {formatCompactNumber(w365.reach)}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.engineFollowerRow}>
        <Text style={styles.engineFollowerLabel}>
          FOLLOWERS ACROSS PLATFORMS
        </Text>
        <View style={styles.engineFollowerTopRow}>
          <Text style={styles.engineFollowerTotal}>
            {formatCompactNumber(f.total)}
          </Text>
          <Text style={styles.shareValue}>combined audience</Text>
        </View>
        <View style={styles.engineFollowerBreakdown}>
          <View style={styles.engineFollowerCell}>
            <Text style={styles.engineFollowerCellLabel}>FACEBOOK</Text>
            <Text style={styles.engineFollowerCellValue}>
              {formatCompactNumber(f.facebook ?? 0)}
            </Text>
          </View>
          <View style={styles.engineFollowerCell}>
            <Text style={styles.engineFollowerCellLabel}>INSTAGRAM</Text>
            <Text style={styles.engineFollowerCellValue}>
              {formatCompactNumber(f.instagram ?? 0)}
            </Text>
          </View>
          <View style={styles.engineFollowerCell}>
            <Text style={styles.engineFollowerCellLabel}>TIKTOK</Text>
            <Text style={styles.engineFollowerCellValue}>
              {formatCompactNumber(f.tiktok ?? 0)}
            </Text>
          </View>
        </View>
      </View>

      <Text style={styles.engineQuote}>
        Your listing is part of all of this. Other firms don&apos;t open the
        books like this — Alliance does.
      </Text>
    </Page>
  );
}

function CampaignsPage({ payload }: { payload: ReportPayload }) {
  const top = payload.campaigns.slice(0, 3);
  return (
    <Page size="LETTER" style={styles.page} wrap={false}>
      <BrandHeader payload={payload} />
      <Text style={styles.sectionH}>Top campaigns</Text>
      <Text style={styles.sectionSub}>
        The posts that drove the most reach for your home.
      </Text>

      {top.length === 0 ? (
        <Text style={styles.narrative}>
          No campaigns ran during this period.
        </Text>
      ) : (
        top.map((c) => (
          <View key={c.id} style={styles.campaign}>
            {c.thumbnail_url ? (
              <Image src={c.thumbnail_url} style={styles.campaignThumb} />
            ) : (
              <View style={styles.campaignThumbFallback} />
            )}
            <View style={styles.campaignBody}>
              <Text style={styles.campaignLabel}>{truncate(c.label, 120)}</Text>
              <View style={styles.campaignTotalsRow}>
                <Text style={styles.campaignTotalCell}>
                  <Text style={styles.campaignTotalCellStrong}>
                    {formatCompactNumber(c.total_reach)}
                  </Text>
                  {" reach"}
                </Text>
                <Text style={styles.campaignTotalCell}>
                  <Text style={styles.campaignTotalCellStrong}>
                    {formatCompactNumber(c.total_engagements)}
                  </Text>
                  {" engagements"}
                </Text>
              </View>
              <View style={styles.badgeRow}>
                {c.by_platform.map((p) => (
                  <View key={p.platform} style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {platformLabel(p.platform)} {"·"}{" "}
                      {formatCompactNumber(p.reach)} reach {"·"}{" "}
                      {formatCompactNumber(p.engagements)} eng
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        ))
      )}
    </Page>
  );
}

function NarrativePage({ payload }: { payload: ReportPayload }) {
  const narrative = loadNarrative(payload);
  const closing = narrative.closing ?? DEFAULT_CLOSING;
  return (
    <Page size="LETTER" style={styles.page} wrap={false}>
      <BrandHeader payload={payload} />
      <Text style={styles.sectionH}>What this means for your sale</Text>
      <Text style={styles.sectionSub}>
        Plain-English summary of the marketing effort behind your home.
      </Text>

      {narrative.hero ? (
        <Text style={styles.narrative}>{narrative.hero}</Text>
      ) : null}
      {narrative.reach_summary ? (
        <Text style={styles.narrative}>{narrative.reach_summary}</Text>
      ) : null}
      <Text style={styles.narrative}>{closing}</Text>

      {payload.audience.top_locations.length > 0 ? (
        <View>
          <Text style={styles.listKicker}>
            TOP LOCATIONS THE AUDIENCE CAME FROM
          </Text>
          {payload.audience.top_locations.slice(0, 5).map((loc) => (
            <View key={loc.label} style={styles.locRow}>
              <Text style={styles.locLabel}>{loc.label}</Text>
              <Text style={styles.locShare}>
                {Math.round(loc.share * 100)}%
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.signoff}>
        <Text style={styles.signoffMain}>
          Prepared by Alliance Social {"·"} Century 21 Alliance
        </Text>
        <Text style={styles.signoffSub}>
          Questions? Reply to the email this report came from, or contact your
          Alliance agent directly.
        </Text>
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
  return (
    <Document
      title={`Alliance Property Report — ${payload.property.mls}`}
      author="Century 21 Alliance"
      subject="Property marketing report"
    >
      <HeroPage payload={payload} />
      <KpiPage payload={payload} companyRollup={companyRollup} />
      <CampaignsPage payload={payload} />
      <EnginePage payload={payload} companyRollup={companyRollup} />
      <NarrativePage payload={payload} />
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
