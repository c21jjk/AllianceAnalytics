"use client";

/**
 * Tiny client island for the "Print" text link in the Direction B Owner
 * Report top action bar. Server components can't bind onClick, so we keep
 * this isolated and import it from app/r/[token]/page.tsx.
 *
 * Direction B link style: 12px, 0.14em letter-spacing, uppercase, weight 500,
 * primary text color (#171717).
 */
export default function PrintLink() {
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window !== "undefined") window.print();
      }}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: "pointer",
        color: "#171717",
        fontSize: 12,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        fontWeight: 500,
        fontFamily: "inherit",
      }}
    >
      Print
    </button>
  );
}
