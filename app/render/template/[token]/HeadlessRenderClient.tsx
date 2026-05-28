"use client";

/**
 * Client-side companion to the headless render page.
 *
 * Mounts a single <canvas> element at the schema's exact dimensions and
 * delegates the schema-to-Fabric hydration to `renderSchemaHeadless`. Sets
 * `data-render-status="ready"` on the canvas once Fabric finishes drawing
 * — the screenshot pipeline polls for that attribute before snapping.
 *
 * Why this file is small: every concern that COULD live here (text effect
 * translation, image cover-fit math, bound-field resolution) lives in
 * `headless-render.ts` instead so the screenshot path and the
 * (eventual) Studio static-preview path share one implementation. This
 * component is just a mount harness.
 */

import { useEffect, useRef, useState } from "react";
import { renderSchemaHeadless } from "@/lib/post-builder/canvas-editor/headless-render";
import type { CanvasTemplateSchema, MLSListingPayload } from "@/lib/post-builder/canvas-editor/types";

// 2026-05-28 — CRITICAL fix for the multi-OH font race.
// fonts.css declares the @font-face rules for Allura, Playfair Display,
// Glacial Indifference, etc. CanvasEditor.tsx imports it for the Studio
// editor — but the headless render page (this client) was NOT importing
// it. Result: when Chromium loaded the render page, no @font-face was
// declared, `document.fonts.load("16px Allura")` resolved instantly with
// nothing, and Fabric painted text using the cursive fallback
// (Brush Script MT). Multi-OH slides drew the "Open" eyebrow in bold
// fallback instead of elegant Allura script. Importing fonts.css here
// declares the @font-face rules and lets the explicit document.fonts.load
// waits inside renderSchemaHeadless actually fetch the font files.
import "@/lib/post-builder/canvas-editor/fonts.css";

interface Props {
  schema: CanvasTemplateSchema;
  listing: MLSListingPayload;
  width: number;
  height: number;
}

export default function HeadlessRenderClient({
  schema,
  listing,
  width,
  height,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;

    void (async () => {
      try {
        await renderSchemaHeadless({ schema, listing, canvasEl });
        if (cancelled) return;
        setStatus("ready");
        // Flag the canvas so Chromium's polling loop sees it's done.
        // why DOM attribute (not React state): Puppeteer's waitForFunction
        // runs in the page's JS context and queries the DOM directly; the
        // React-managed status string would require a more elaborate
        // page.evaluate() loop with no real benefit.
        canvasEl.setAttribute("data-render-status", "ready");
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setErrorMsg(msg);
        setStatus("error");
        canvasEl.setAttribute("data-render-status", "error");
        canvasEl.setAttribute("data-render-error", msg);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [schema, listing]);

  return (
    <div
      className="headless-render-root"
      style={{
        position: "fixed",
        inset: 0,
        background: "#fff",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "flex-start",
      }}
    >
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        // Lock to logical dimensions so Chromium screenshots at native
        // resolution (the screenshot clip uses the same dims).
        style={{ width: `${width}px`, height: `${height}px`, display: "block" }}
        data-render-status="loading"
      />
      {status === "error" ? (
        <pre
          style={{
            position: "fixed",
            top: 16,
            left: 16,
            color: "#900",
            background: "#fff",
            padding: 8,
            zIndex: 999,
          }}
        >
          render error: {errorMsg}
        </pre>
      ) : null}
    </div>
  );
}
