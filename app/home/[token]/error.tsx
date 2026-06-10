"use client";

/**
 * Seller-facing error boundary for the Owner Story report. Sellers are
 * not app users, so the copy is extra gentle and there is no link into
 * the internal app. Styling mirrors the locked /home/[token] design
 * (Barlow, warm off-white page, white card, Relentless Gold accent),
 * inline-styled because the page itself does not use the app theme.
 */

const GOLD = "#C9A84C";
const INK = "#252526";
const INK_SOFT = "#52525B";
const PAGE_BG = "#FAFAF7";
const CARD_BG = "#FFFFFF";
const RULE = "#ECECEC";
const FONT_STACK = "'Barlow', system-ui, sans-serif";

export default function OwnerStoryError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: PAGE_BG,
        fontFamily: FONT_STACK,
        padding: 24,
      }}
    >
      <div
        style={{
          background: CARD_BG,
          border: `1px solid ${RULE}`,
          borderRadius: 14,
          padding: "40px 32px",
          maxWidth: 440,
          width: "100%",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: GOLD,
            marginBottom: 10,
          }}
        >
          Century 21 Alliance
        </div>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: INK,
            margin: 0,
          }}
        >
          One moment, please
        </h1>
        <p
          style={{
            fontSize: 15,
            color: INK_SOFT,
            lineHeight: 1.6,
            margin: "10px 0 0",
          }}
        >
          We hit a snag loading this report. Please try again in a moment.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            marginTop: 22,
            padding: "11px 26px",
            borderRadius: 8,
            border: "none",
            background: GOLD,
            color: "#FFFFFF",
            fontSize: 14,
            fontWeight: 600,
            fontFamily: "inherit",
            letterSpacing: "0.02em",
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
