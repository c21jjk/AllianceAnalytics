"use client";

/**
 * Last-resort error boundary. Replaces the ROOT layout when it (or
 * anything above the route-level boundaries) throws, so it must render
 * its own <html>/<body> and cannot rely on Tailwind or fonts loading.
 * Inline styles only, brand colors hardcoded on purpose.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#FCFCFB",
          color: "#252526",
          fontFamily: "'Barlow', system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", padding: 32, maxWidth: 420 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#C9A84C",
              marginBottom: 8,
            }}
          >
            Alliance Social
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, color: "#52525B", lineHeight: 1.5 }}>
            The app hit an unexpected error. Trying again usually clears it.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 16,
              padding: "10px 20px",
              borderRadius: 8,
              border: "none",
              background: "#C9A84C",
              color: "#FFFFFF",
              fontSize: 14,
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
