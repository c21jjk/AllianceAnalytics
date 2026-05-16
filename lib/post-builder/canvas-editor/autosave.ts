/**
 * Canvas Studio autosave (Phase B.6).
 * --------------------------------------------------------------------------
 *
 * Persists the user's in-progress canvas to `localStorage` so an
 * accidentally-closed tab, a browser crash, or an unsaved Studio session
 * doesn't lose work.
 *
 * Storage shape:
 *   key:  cwk-studio-autosave-v1-<templateId>-<mlsNumber>
 *   val:  JSON-encoded AutosavePayload
 *
 * Why (template, mls) as the key:
 *   • template-only would collide across listings using the same template
 *     ("just_listed_v1_story_9x16" applies to every active listing).
 *   • A generated-post id (gp) is more specific, but is null for unsaved
 *     drafts — exactly the case autosave is supposed to protect.
 *   • The pair is unique enough in practice — one user, one template per
 *     listing in flight at a time — and self-cleans when the user picks a
 *     different template or listing.
 *
 * Why Fabric.toJSON() (not the canvas schema):
 *   The canvas-editor schema doesn't yet round-trip Fabric → schema (see
 *   handleExport's TODO). Fabric's `toJSON()` IS self-contained and
 *   re-hydratable via `canvas.loadFromJSON()`, so it's the only reliable
 *   "snapshot the user's edits" path available today. Phase 2 of the
 *   schema serialization work will replace this with a typed payload.
 */

const SCHEMA_VERSION = 1 as const;
const KEY_PREFIX = `cwk-studio-autosave-v${SCHEMA_VERSION}-`;

/** How long an autosave is considered valid. Older = ignored on restore. */
export const AUTOSAVE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * The persisted payload. Anything that comes back from `read` could have
 * been hand-edited or saved by an older schema version — callers must
 * defensively narrow before trusting individual fields.
 */
export interface AutosavePayload {
  /** Schema version. Bumped on breaking changes; reads of an older version
   *  silently return null so the user doesn't get a corrupt restore. */
  schemaVersion: typeof SCHEMA_VERSION;
  /** Template ID this autosave was captured against. Used by the consumer
   *  to verify the active template still matches before offering restore. */
  templateId: string;
  /** Listing MLS number this autosave was captured against. Same verify. */
  mlsNumber: string;
  /** When the autosave was written. ms since epoch. */
  savedAt: number;
  /** Fabric canvas state as toJSON(). Opaque to consumers — passed back
   *  into `canvas.loadFromJSON()` verbatim. */
  fabricJson: unknown;
}

/** Compute the storage key for a (template, mls) pair. */
export function autosaveKey(templateId: string, mlsNumber: string): string {
  return `${KEY_PREFIX}${templateId}-${mlsNumber}`;
}

/**
 * Safe localStorage access — wrapped in try/catch because:
 *   • Some browsers/contexts throw on access (Safari private mode, certain
 *     embed contexts, quota exceeded on write).
 *   • SSR/Node has no `window` global.
 */
function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Read the autosave for a (template, mls) pair. Returns null on:
 *   • storage unavailable
 *   • no key set
 *   • parse error
 *   • schema version mismatch
 *   • payload older than AUTOSAVE_TTL_MS
 */
export function readAutosave(
  templateId: string,
  mlsNumber: string,
): AutosavePayload | null {
  const storage = getStorage();
  if (!storage) return null;
  const key = autosaveKey(templateId, mlsNumber);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Partial<AutosavePayload>;
  if (candidate.schemaVersion !== SCHEMA_VERSION) return null;
  if (typeof candidate.templateId !== "string") return null;
  if (typeof candidate.mlsNumber !== "string") return null;
  if (typeof candidate.savedAt !== "number") return null;
  if (Date.now() - candidate.savedAt > AUTOSAVE_TTL_MS) return null;
  if (!candidate.fabricJson) return null;
  return candidate as AutosavePayload;
}

/**
 * Write or overwrite the autosave for a (template, mls) pair. Silently
 * swallows quota errors — autosave is best-effort, not load-bearing.
 */
export function writeAutosave(
  templateId: string,
  mlsNumber: string,
  fabricJson: unknown,
): void {
  const storage = getStorage();
  if (!storage) return;
  const payload: AutosavePayload = {
    schemaVersion: SCHEMA_VERSION,
    templateId,
    mlsNumber,
    savedAt: Date.now(),
    fabricJson,
  };
  try {
    storage.setItem(autosaveKey(templateId, mlsNumber), JSON.stringify(payload));
  } catch {
    // Quota exceeded or otherwise unwriteable — drop the autosave silently.
    // why no fallback: a single canvas's Fabric JSON is typically ~20-80KB.
    // Hitting the per-origin quota (5-10MB) would require ~100 distinct
    // (template, mls) keys, which is well past what one user accumulates.
  }
}

/**
 * Remove the autosave entry. Called by the editor after a successful Save —
 * the persisted DB row is now the source of truth and the localStorage
 * copy is just clutter.
 */
export function clearAutosave(templateId: string, mlsNumber: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(autosaveKey(templateId, mlsNumber));
  } catch {
    // best-effort
  }
}

/**
 * Format the "saved N minutes ago" string used by the restore banner.
 * Returns "just now" under 60s, "Nm ago" under 60min, "Nh ago" under 24h,
 * "Nd ago" otherwise. why: matches the project's other relative-time
 * helpers in tone without adding a date-fns dep.
 */
export function formatAutosaveAge(savedAt: number, now: number = Date.now()): string {
  const deltaMs = Math.max(0, now - savedAt);
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
