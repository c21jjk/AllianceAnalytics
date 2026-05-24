/**
 * POST /api/post-builder/design
 *
 * Runs the AI design pipeline (composition → strategy → layout → critique)
 * against a listing + current canvas schema and streams progress events
 * back as NDJSON (newline-delimited JSON).
 *
 * Why NDJSON (not SSE):
 *   Each progress event is a single JSON object; the server emits one
 *   per line so the client can split-and-parse with `line.split("\n")`
 *   without needing the SSE event-id / event-name machinery. Works in
 *   both browser fetch (via ReadableStream) and CLI test scripts (via
 *   curl --no-buffer | jq). One fewer concern at the protocol layer.
 *
 * Why a long-running route (60s default):
 *   The pipeline is a 4-pass Claude call chain; each Opus pass can take
 *   20-30 seconds. Worst case end-to-end is ~90 seconds. We bump
 *   `maxDuration` to allow that on Vercel.
 *
 * Auth: same as the rest of post-builder — `getCurrentProfile()` must
 * return a signed-in Alliance user. The API key is read server-side
 * from `api_credentials` (see lib/ai/anthropic.ts).
 *
 * Phase 1 (2026-05-23) — no UI consumer yet. The route is callable from
 * a manual test script:
 *
 *   curl -X POST http://localhost:3000/api/post-builder/design \
 *     -H "Content-Type: application/json" \
 *     -H "Cookie: <session cookie>" \
 *     -d '{ "listing": {...}, "currentSchema": {...}, "format": "portrait_4x5", "photoUrls": ["..."] }' \
 *     --no-buffer
 */
import { NextResponse } from "next/server";

import { getCurrentProfile } from "@/lib/auth";
import { runDesignPipeline } from "@/lib/post-builder/canvas-editor/ai/design-pipeline";
import type {
  DesignPipelineInput,
  PipelineProgress,
} from "@/lib/post-builder/canvas-editor/ai/types";

// why: this route makes long-running Opus calls — disable Next.js's
// static caching, force Node runtime (Edge can't run our pipeline
// because of the Anthropic SDK), and allow up to 120 seconds for the
// full chain.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

interface DesignRequestBody {
  /** The hydrated canvas template schema to redesign. Required. */
  currentSchema?: DesignPipelineInput["currentSchema"];
  /** Listing payload. Required. */
  listing?: DesignPipelineInput["listing"];
  /** Target format. Required. */
  format?: DesignPipelineInput["format"];
  /** Photo URLs in priority order. photoUrls[0] is the hero (vision input). Required. */
  photoUrls?: readonly string[];
  /** Optional free-text intent. */
  intent?: string;
  /** Optional forced mood. */
  forceMood?: DesignPipelineInput["forceMood"];
}

/**
 * Validate the request body. Returns the typed input on success, or an
 * error message string on failure. We accept anything reasonable from
 * the client — the design pipeline does its own per-pass validation.
 */
function validateBody(body: DesignRequestBody): DesignPipelineInput | string {
  if (!body.currentSchema || typeof body.currentSchema !== "object") {
    return "currentSchema is required";
  }
  if (!body.listing || typeof body.listing !== "object") {
    return "listing is required";
  }
  if (!body.format || typeof body.format !== "string") {
    return "format is required";
  }
  if (!Array.isArray(body.photoUrls) || body.photoUrls.length === 0) {
    return "photoUrls must be a non-empty array";
  }
  if (!body.photoUrls.every((u) => typeof u === "string" && u.length > 0)) {
    return "photoUrls must contain non-empty strings";
  }

  return {
    currentSchema: body.currentSchema,
    listing: body.listing,
    format: body.format,
    photoUrls: body.photoUrls,
    intent: typeof body.intent === "string" ? body.intent : undefined,
    forceMood: body.forceMood,
  };
}

export async function POST(request: Request): Promise<Response> {
  // ---- Auth ----
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  // ---- Body parse + validate ----
  let body: DesignRequestBody;
  try {
    body = (await request.json()) as DesignRequestBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }
  const validated = validateBody(body);
  if (typeof validated === "string") {
    return NextResponse.json(
      { ok: false, error: validated },
      { status: 400 },
    );
  }

  // ---- Streaming setup ----
  // why: TransformStream wired to a ReadableStream lets us push NDJSON
  // lines into the response as the pipeline runs. The pipeline's
  // onProgress callback writes; the route's response reads.
  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();

  const writeEvent = async (evt: PipelineProgress): Promise<void> => {
    try {
      await writer.write(encoder.encode(JSON.stringify(evt) + "\n"));
    } catch {
      // why: client disconnected mid-stream — the pipeline keeps running
      // server-side (we can't safely cancel it from here without aborting
      // in-flight Anthropic calls). Just stop writing.
    }
  };

  // ---- Kick off the pipeline asynchronously ----
  // We do NOT await — the response returns immediately with the stream;
  // the pipeline runs in the background, emitting events through onProgress
  // until it finishes (or fails) and we close the stream.
  (async () => {
    try {
      const result = await runDesignPipeline(validated, (evt) => {
        // Fire-and-forget — writeEvent has its own error swallow.
        void writeEvent(evt);
      });
      // The pipeline emits its own "completed" / "failed" event before
      // returning, so we have nothing to write here. We just close the
      // stream.
      void result;
    } catch (e) {
      // why: defensive — if the pipeline threw an UNEXPECTED error past
      // its own try/catch boundaries, surface it as a final failed event
      // so the client sees something.
      const msg = e instanceof Error ? e.message : String(e);
      await writeEvent({
        type: "failed",
        error: `unexpected pipeline error: ${msg}`,
        ts: Date.now(),
      });
    } finally {
      try {
        await writer.close();
      } catch {
        // already closed
      }
    }
  })();

  return new Response(stream.readable, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson",
      // why: tell intermediate proxies + the browser NOT to buffer this
      // response so progress events stream live. Without these, Vercel
      // would batch the entire response before sending.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
