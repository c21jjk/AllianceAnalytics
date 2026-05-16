/**
 * Typed, validated environment-variable loader.
 *
 * why: env vars are the single most common cause of "works locally,
 * breaks in prod" failures. Loading them through a zod schema at
 * startup means a missing/malformed var fails fast with a clear
 * message in `fly logs` instead of NPE'ing inside a request handler
 * 30 seconds later.
 */

import { z } from "zod";

/** Schema for all env vars the worker reads. */
const EnvSchema = z.object({
  /** Shared bearer secret. Main app (Vercel) sends this on every render
   *  call. Generated once via `openssl rand -hex 32` and stored as a
   *  Fly secret. */
  WORKER_AUTH_TOKEN: z.string().min(32, {
    message: "WORKER_AUTH_TOKEN must be at least 32 chars",
  }),
  /** Supabase project URL — used Day 2+ for Storage uploads. */
  SUPABASE_URL: z.string().url(),
  /** Service-role key — used Day 2+ for Storage uploads. The worker
   *  uses service-role (not anon) because it writes to a private bucket
   *  on behalf of an authenticated user without re-running RLS. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  /** TCP port for the HTTP server. Fly sets this implicitly via the
   *  fly.toml internal_port. Default 8080. */
  PORT: z.coerce.number().int().positive().default(8080),
  /** Verbosity. Today only "info" / "warn" / "error" are surfaced. */
  LOG_LEVEL: z
    .enum(["debug", "info", "warn", "error"])
    .default("info"),
});

/** Public, frozen view of the parsed env. */
export type Env = Readonly<z.infer<typeof EnvSchema>>;

/**
 * Parse process.env once and return a frozen Env object. Throws with a
 * formatted list of missing / invalid vars on failure.
 *
 * Call this from server.ts at boot. Don't call inside handlers — the
 * thrown error from a handler call would leak to a 500 response.
 */
export function loadEnv(): Env {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    // Pretty-print the field-level errors so Fly logs make the problem
    // obvious without grepping a giant JSON dump.
    const lines = result.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return `  - ${path}: ${issue.message}`;
    });
    throw new Error(
      `[env] Invalid or missing environment variables:\n${lines.join("\n")}\n` +
        `\nSet them with: fly secrets set KEY=value [...]`,
    );
  }
  return Object.freeze(result.data);
}
