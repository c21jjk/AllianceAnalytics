"use client";

/**
 * Seller-facing error boundary for the public property marketing report.
 * Same gentle treatment as /home/[token]: Barlow, white card, gold
 * accent, no links into the internal app. Inline-styled to match the
 * report's own look rather than the app theme.
 */

const GOLD = "#C9A84C";
const INK = "#252526";
const INK_SOFT = "#52525B";
const FONT_STACK = "'Barlow', system-ui, sans-serif";

export default function ReportError({
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
        background: "#FAFAF7",
        fontFamily: FONT_STACK,
        padding: 24,
      }}
    >
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #ECECEC",
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
