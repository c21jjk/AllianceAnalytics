/**
 * Express bootstrap for the Reel render worker.
 *
 * Boot sequence:
 *   1. Load + validate env (throws on missing vars — Fly logs the msg).
 *   2. Create the in-memory job store.
 *   3. Mount /health (no auth) and /render (auth-gated).
 *   4. Install a JSON-emitting global error handler.
 *   5. Bind the port and register SIGTERM/SIGINT graceful shutdown.
 *
 * why JSON body limit 1 MB: empirical — compositions today are ~30-50
 * KB. We size to 1 MB for headroom around audio metadata + future
 * features; an oversized POST gets a 413 before Express buffers
 * arbitrary memory.
 *
 * why graceful shutdown: Fly sends SIGTERM ~5s before SIGKILL when
 * stopping a machine. Catching it lets us stop accepting new
 * connections and finish in-flight requests cleanly. Without this
 * the machine appears to "drop requests" on every deploy.
 */

import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from "express";

import { loadEnv } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { makeAuthMiddleware } from "./lib/auth.js";
import { createJobStore } from "./jobs/store.js";
import { makeHealthRouter } from "./routes/health.js";
import { makeRenderRouter, makeRenderImageRouter } from "./routes/render.js";

function main(): void {
  // Throws on validation failure — leave to propagate so Fly logs the
  // formatted message at the very top of the run.
  const env = loadEnv();

  const store = createJobStore();
  const app = express();

  // why: tiny request log line for every inbound request. Fly already
  // has access logs at the proxy layer, but app-level logs let us
  // correlate route + status in one place.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      logger.info("http.request", {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: Date.now() - start,
      });
    });
    next();
  });

  // 1 MB JSON limit — see top of file for rationale.
  app.use(express.json({ limit: "1mb" }));

  // /health is unauthenticated — Docker + Fly hit it without creds.
  app.use(makeHealthRouter(store));

  // /render and /render/:id require the bearer token. why scope auth
  // to /render explicitly (not as app.use) — a blanket app.use would
  // also gate the 404 catch-all below, so an unknown route returns
  // 401 ("unauthorized") instead of 404 ("not found"). Confusing for
  // anyone smoke-testing the worker.
  const auth = makeAuthMiddleware(env);
  app.use("/render", auth, makeRenderRouter(store));
  // why a separate mount path: Express's app.use("/render", ...) only
  // matches "/render" as a whole path segment. "/render-image" with a
  // hyphen is a SIBLING route, not a sub-route, so it needs its own mount.
  // Same auth middleware (bearer token) so the security envelope is
  // identical — the main app holds one token for both endpoints.
  app.use("/render-image", auth, makeRenderImageRouter());

  // 404 for anything else under the worker — main app should only be
  // calling /health and /render*. Unauthenticated so it doesn't mask
  // genuinely-missing routes.
  app.use((req: Request, res: Response) => {
    res.status(404).json({ ok: false, error: `not found: ${req.path}` });
  });

  // why: a default Express error handler would leak the stack trace
  // in the response body. Our handler logs the trace server-side and
  // returns ONLY a generic message.
  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const message = err instanceof Error ? err.message : "internal error";
    const stack = err instanceof Error ? err.stack : undefined;
    logger.error("http.unhandled_error", { error: message, stack });
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: "internal error" });
    }
  };
  app.use(errorHandler);

  const server = app.listen(env.PORT, () => {
    logger.info("server.listening", { port: env.PORT });
  });

  /** Graceful shutdown — stop accepting new requests, stop the store
   *  sweep timer, then exit. Called on both SIGTERM (Fly stop) and
   *  SIGINT (Ctrl-C in local dev). */
  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info("server.shutdown_begin", { signal });
    server.close((err) => {
      if (err) {
        logger.error("server.shutdown_close_error", { error: err.message });
        process.exit(1);
        return;
      }
      store.stop();
      logger.info("server.shutdown_complete", { signal });
      process.exit(0);
    });
    // Hard timeout: if connections refuse to drain, kill the process
    // after 10s so Fly doesn't SIGKILL us mid-write.
    setTimeout(() => {
      logger.warn("server.shutdown_forced");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // why: an unhandled rejection in modern Node terminates the process
  // by default. We log it first so the cause is visible in Fly logs
  // before the restart.
  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    logger.error("process.unhandled_rejection", { error: message, stack });
  });
}

main();
