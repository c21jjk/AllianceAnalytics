/**
 * Minimal structured logger. JSON-per-line to stdout.
 *
 * why: Fly's log aggregator + most log services (Datadog, Axiom, Better
 * Stack, etc.) consume JSON-per-line natively. Using pino would be a
 * 1.2 MB dep just for the formatter. This is six lines of code and
 * does everything we need for the render worker — no pretty printer,
 * no transports, no streams.
 *
 * If/when we outgrow this, swap to pino: the call sites use the same
 * `info(msg, fields?)` / `warn` / `error` shape pino exposes.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** Resolved at import time from LOG_LEVEL; defaults to "info". */
const currentLevel: Level = ((): Level => {
  const raw = process.env.LOG_LEVEL;
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
})();

/**
 * Emit a structured log line if the level is >= the configured floor.
 * `fields` is merged into the JSON object at the top level — no nesting,
 * so a log line is one-decode for downstream parsers.
 */
function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields ?? {}),
  };
  // Single stdout write per line keeps interleaving from concurrent
  // requests bounded — Node's console.log is line-buffered.
  console.log(JSON.stringify(line));
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>): void =>
    emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>): void =>
    emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>): void =>
    emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>): void =>
    emit("error", msg, fields),
} as const;

export type Logger = typeof logger;
