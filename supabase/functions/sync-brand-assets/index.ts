/**
 * Brand Assets sync Edge Function (Phase 3, rev 2026-05-16).
 *
 * Pulls C21 logos + per-office agent headshots + partner co-brand marks
 * from two shared Google Drive folders, uploads each file to the
 * Supabase `brand-assets` Storage bucket, and upserts a row in the
 * `brand_assets` table. Idempotent by `drive_file_id` — re-runs skip
 * files whose `modifiedTime` hasn't changed.
 *
 * Drive folder topology (current as of 2026-05-14):
 *   - BRAND_LOGOS_FOLDER_ID — flat-ish; contains top-level logo files
 *     + variant subfolders (Seal Cropped, Letter Pattern Block, etc.).
 *     We recurse one level deep and use the subfolder name as
 *     `logo_category`.
 *   - BRAND_AGENTS_FOLDER_ID — 8 office subfolders ("1 - Wildwood Crest",
 *     etc.) + 1 "2 - Family of Services" partner folder. Files inside
 *     office folders → kind=agent_headshot with office_id resolved via
 *     the brand_drive_offices mapping table. Files inside Family of
 *     Services → kind=partner_logo with office_id NULL.
 *
 * Drift handling (added 2026-05-16):
 *   The previous rev had two silent-drift failure modes that were dropping
 *   the Studio Brand panel out of sync with Drive:
 *     (1) When a file was deleted/renamed/moved in Drive, its row stayed
 *         in `brand_assets` with status='active' forever — nothing in the
 *         function called for "remove me". Users saw old logos that no
 *         longer existed upstream.
 *     (2) `synced_at` was only written on insert/update, not on
 *         "unchanged" runs. There was no way to tell, looking at the row,
 *         whether the function had encountered it on the latest run.
 *   Both are now fixed:
 *     (1) We collect every `drive_file_id` we encounter into a Set, and
 *         after both walks complete, flip every active row NOT in that Set
 *         to status='archived' (with a guard: only when the walks
 *         themselves did not error, so a transient Drive failure doesn't
 *         mass-archive everything).
 *     (2) `synced_at` is now updated unconditionally on every encounter,
 *         including "unchanged". The Brand panel can use it as a true
 *         "last seen on Drive" timestamp.
 *
 * Last-sync metadata (added 2026-05-16):
 *   The function writes its outcome back to the `api_credentials` row for
 *   platform='google_drive':
 *     credentials.lastSyncAt = ISO timestamp of completion
 *     credentials.lastSyncOk = boolean
 *     credentials.lastSyncError = string | null
 *     credentials.lastSyncReport = { added, updated, unchanged, archived,
 *                                    skipped, scanned, durationMs }
 *   This surfaces drift in the Brand + Agent panel headers (a "Synced 12m
 *   ago" pill, red on failure) without needing a separate metadata table.
 *
 * Auth: Google service account JWT → exchange for an access_token. The
 * service account email must be granted Viewer access to both Drive
 * master folders.
 *
 * Required Edge Function secrets:
 *   - SUPABASE_URL                  (auto-injected)
 *   - SUPABASE_SERVICE_ROLE_KEY     (auto-injected)
 *   - Everything else (service-account JSON + folder IDs) comes from the
 *     api_credentials row with platform='google_drive'.
 *
 * Invocation:
 *   POST {} → runs a full sync, returns JSON report.
 *
 * Schedule: pg_cron @ 3:00 AM ET nightly. See migrations for the cron job
 * definition.
 */

// @ts-expect-error - Deno runtime
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
// @ts-expect-error - Deno-resolved import
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

// =============================================================================
// Types
// =============================================================================

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  parents?: string[];
}

interface SyncReport {
  ok: boolean;
  durationMs: number;
  scanned: number;
  added: number;
  updated: number;
  unchanged: number;
  /** Rows whose drive_file_id was NOT seen on this run → flipped to status='archived'. */
  archived: number;
  skipped: number;
  errors: string[];
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

// =============================================================================
// Service account → Google access token
// =============================================================================
//
// We sign a JWT manually (RS256) and exchange it at the token endpoint for an
// OAuth access token scoped to drive.readonly. This is the official
// service-account OAuth flow; no SDK required, just Web Crypto + fetch.
// Token lifetime is 1 hour — way longer than a sync run, so we fetch once
// per invocation.

function base64UrlEncode(input: Uint8Array | string): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // why: strip PEM headers/footers + whitespace, decode base64 → DER bytes.
  const pkcs8 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pkcs8), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function getAccessToken(sa: ServiceAccountKey): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: sa.token_uri ?? "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claim))}`;
  const key = await importPrivateKey(sa.private_key);
  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${base64UrlEncode(new Uint8Array(sigBuf))}`;
  const tokenRes = await fetch(claim.aud, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!tokenRes.ok) {
    const txt = await tokenRes.text();
    throw new Error(`token exchange failed (${tokenRes.status}): ${txt}`);
  }
  const json = (await tokenRes.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("token exchange returned no access_token");
  return json.access_token;
}

// =============================================================================
// Drive API helpers
// =============================================================================
//
// We hit the REST v3 endpoints directly — no SDK needed. The "list children"
// query uses `q=` with `'PARENT_ID' in parents` syntax. Pagination via
// pageToken; we paginate exhaustively per folder.

const DRIVE_API = "https://www.googleapis.com/drive/v3";

async function listChildren(
  accessToken: string,
  folderId: string,
): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      fields:
        "nextPageToken, files(id, name, mimeType, modifiedTime, parents)",
      pageSize: "100",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`${DRIVE_API}/files?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(
        `Drive list failed (${res.status}) for folder ${folderId}: ${await res.text()}`,
      );
    }
    const json = (await res.json()) as {
      files: DriveFile[];
      nextPageToken?: string;
    };
    files.push(...json.files);
    pageToken = json.nextPageToken;
  } while (pageToken);
  return files;
}

async function downloadFile(
  accessToken: string,
  fileId: string,
): Promise<Uint8Array> {
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Drive download failed (${res.status}) for ${fileId}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

// =============================================================================
// Filename → label heuristic
// =============================================================================
//
// Strips file extension, replaces underscores/hyphens with spaces, title-cases.
// Used as the initial `label` value when a row is inserted; admins can
// override via the brand-assets admin UI.

function deriveLabel(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, "");
  const spaced = stem.replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
  return spaced
    .split(" ")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// =============================================================================
// Image MIME filter
// =============================================================================

const IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/svg+xml",
]);

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

function isImage(mime: string): boolean {
  return IMAGE_MIMES.has(mime);
}

// =============================================================================
// One-file sync — download + upload to Storage + upsert row
// =============================================================================

async function syncOneFile(args: {
  supabase: SupabaseClient;
  accessToken: string;
  file: DriveFile;
  kind: "logo" | "agent_headshot" | "partner_logo";
  officeId: string | null;
  parentSubfolderName: string | null;
  logoCategory: string | null;
  storagePathPrefix: string;
}): Promise<"added" | "updated" | "unchanged"> {
  const { supabase, accessToken, file, kind, officeId, parentSubfolderName, logoCategory, storagePathPrefix } = args;

  // why: idempotency check — if we already synced this file at the same
  // modifiedTime, skip the download + upload entirely. Saves ~95% of Drive
  // API calls + Storage writes on steady-state syncs.
  const { data: existing } = await supabase
    .from("brand_assets")
    .select("id, drive_modified_at, storage_path, public_url, status")
    .eq("drive_file_id", file.id)
    .maybeSingle();

  if (existing && existing.drive_modified_at === file.modifiedTime) {
    // why: even on "unchanged" we now bump synced_at so it represents
    // "last seen on Drive", not "last had bytes uploaded". The Brand panel
    // reads max(synced_at) as the freshness signal. Also re-assert
    // status='active' in case the row was archived in a prior run and the
    // admin re-uploaded the exact same file (drive_modified_at matches but
    // we want it back in the active set).
    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = { synced_at: nowIso };
    if (existing.status !== "active") patch.status = "active";
    const { error } = await supabase
      .from("brand_assets")
      .update(patch)
      .eq("id", existing.id);
    if (error) {
      // why: don't fail the whole run for a synced_at touch — log it but
      // treat the file as unchanged from the report's perspective.
      console.warn(`synced_at touch failed for ${file.name}: ${error.message}`);
    }
    return "unchanged";
  }

  const bytes = await downloadFile(accessToken, file.id);
  const ext = MIME_EXT[file.mimeType] ?? "bin";
  const storagePath = `${storagePathPrefix}/${file.id}.${ext}`;

  // why: upload via storage REST. upsert=true so re-syncs overwrite cleanly.
  const { error: uploadErr } = await supabase.storage
    .from("brand-assets")
    .upload(storagePath, bytes, {
      contentType: file.mimeType,
      upsert: true,
      cacheControl: "31536000",
    });
  if (uploadErr) throw new Error(`Storage upload failed for ${file.name}: ${uploadErr.message}`);

  const { data: pub } = supabase.storage
    .from("brand-assets")
    .getPublicUrl(storagePath);

  const row = {
    kind,
    office_id: officeId,
    label: existing?.id ? undefined : deriveLabel(file.name), // why: don't overwrite admin's label edits on re-sync
    filename: file.name,
    logo_category: logoCategory,
    storage_path: storagePath,
    public_url: pub.publicUrl,
    drive_file_id: file.id,
    drive_folder_id: file.parents?.[0] ?? "",
    drive_parent_subfolder_name: parentSubfolderName,
    drive_modified_at: file.modifiedTime,
    synced_at: new Date().toISOString(),
  };

  // why: upsert by drive_file_id. On first sync inserts, on subsequent
  // syncs updates everything EXCEPT label (which the admin may have
  // customized). We omit `label` from the update payload when the row
  // already exists. Always re-assert status='active' here so a previously
  // archived row whose source file came back is flipped live again.
  if (existing?.id) {
    const { error } = await supabase
      .from("brand_assets")
      .update({
        kind: row.kind,
        office_id: row.office_id,
        filename: row.filename,
        logo_category: row.logo_category,
        storage_path: row.storage_path,
        public_url: row.public_url,
        drive_folder_id: row.drive_folder_id,
        drive_parent_subfolder_name: row.drive_parent_subfolder_name,
        drive_modified_at: row.drive_modified_at,
        synced_at: row.synced_at,
        status: "active",
      })
      .eq("id", existing.id);
    if (error) throw new Error(`DB update failed for ${file.name}: ${error.message}`);
    return "updated";
  } else {
    const { error } = await supabase.from("brand_assets").insert(row);
    if (error) throw new Error(`DB insert failed for ${file.name}: ${error.message}`);
    return "added";
  }
}

// =============================================================================
// Last-sync metadata writer
// =============================================================================
//
// We persist the run outcome onto the `api_credentials` row for
// platform='google_drive' (in the `credentials` JSONB). Doing this here
// instead of in a new table avoids a migration and keeps the Brand panel's
// freshness fetch to a single row read.

interface LastSyncMetadata {
  lastSyncAt: string;
  lastSyncOk: boolean;
  lastSyncError: string | null;
  lastSyncReport: {
    scanned: number;
    added: number;
    updated: number;
    unchanged: number;
    archived: number;
    skipped: number;
    durationMs: number;
    errorCount: number;
  };
}

async function writeLastSyncMetadata(
  supabase: SupabaseClient,
  report: SyncReport,
  fatalError: string | null,
): Promise<void> {
  // why: read the current credentials JSONB first so we can merge the new
  // metadata fields without clobbering service_account_json or folder IDs.
  // The Edge Function has service-role auth, so RLS is bypassed.
  const { data: row, error: readErr } = await supabase
    .from("api_credentials")
    .select("id, credentials")
    .eq("platform", "google_drive")
    .eq("is_active", true)
    .maybeSingle();
  if (readErr || !row) {
    console.warn(`writeLastSyncMetadata: cannot read api_credentials row: ${readErr?.message ?? "no row"}`);
    return;
  }

  const meta: LastSyncMetadata = {
    lastSyncAt: new Date().toISOString(),
    lastSyncOk: report.ok && fatalError === null,
    lastSyncError: fatalError ?? (report.errors.length > 0 ? report.errors[0] : null),
    lastSyncReport: {
      scanned: report.scanned,
      added: report.added,
      updated: report.updated,
      unchanged: report.unchanged,
      archived: report.archived,
      skipped: report.skipped,
      durationMs: report.durationMs,
      errorCount: report.errors.length,
    },
  };

  const merged = {
    ...(row.credentials as Record<string, unknown>),
    ...meta,
  };

  const { error: writeErr } = await supabase
    .from("api_credentials")
    .update({ credentials: merged })
    .eq("id", row.id);
  if (writeErr) {
    console.warn(`writeLastSyncMetadata: write failed: ${writeErr.message}`);
  }
}

// =============================================================================
// Main entry — orchestration
// =============================================================================

async function runSync(): Promise<SyncReport> {
  const start = Date.now();
  const report: SyncReport = {
    ok: true,
    durationMs: 0,
    scanned: 0,
    added: 0,
    updated: 0,
    unchanged: 0,
    archived: 0,
    skipped: 0,
    errors: [],
  };

  // why: every drive_file_id we successfully encounter on this run. After
  // the walks complete, any active row whose drive_file_id is NOT in this
  // set gets flipped to status='archived'. We only do this when BOTH walks
  // completed without a fatal error (`report.ok === true`), because a
  // partial Drive failure (rate limit, auth blip) would otherwise mass-
  // archive everything.
  const seenDriveFileIds = new Set<string>();

  // ---- Config ----
  // why: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected at
  // runtime. Everything else (service account JSON + Drive folder IDs) is
  // pulled from the api_credentials table — same pattern the FB/IG/TT
  // syncs use. This avoids depending on Edge Function secrets management
  // which the MCP doesn't expose.
  // @ts-expect-error - Deno global
  const supabaseUrl = Deno.env.get("SUPABASE_URL") as string;
  // @ts-expect-error - Deno global
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: credRow, error: credErr } = await supabase
    .from("api_credentials")
    .select("credentials")
    .eq("platform", "google_drive")
    .eq("is_active", true)
    .maybeSingle();
  if (credErr) throw new Error(`credential load failed: ${credErr.message}`);
  if (!credRow) {
    throw new Error(
      "No active google_drive credentials in api_credentials table. " +
      "Insert a row with the service-account JSON + folder IDs first.",
    );
  }
  const creds = credRow.credentials as {
    service_account_json: ServiceAccountKey;
    logos_folder_id: string;
    agents_folder_id: string;
  };
  if (!creds.service_account_json) throw new Error("service_account_json missing in credentials");
  if (!creds.logos_folder_id) throw new Error("logos_folder_id missing in credentials");
  if (!creds.agents_folder_id) throw new Error("agents_folder_id missing in credentials");

  const sa = creds.service_account_json;
  const logosFolderId = creds.logos_folder_id;
  const agentsFolderId = creds.agents_folder_id;
  const accessToken = await getAccessToken(sa);

  // ---- Load office mapping ----
  // why: cached locally so each agent-folder walk does an O(1) lookup
  // instead of querying per file.
  const { data: officeMappings, error: mappingErr } = await supabase
    .from("brand_drive_offices")
    .select("folder_id, office_id, subfolder_name");
  if (mappingErr) throw new Error(`office mapping load failed: ${mappingErr.message}`);
  const folderToOffice = new Map<string, { officeId: string; subfolderName: string }>();
  for (const m of (officeMappings ?? []) as Array<{ folder_id: string; office_id: string; subfolder_name: string }>) {
    folderToOffice.set(m.folder_id, { officeId: m.office_id, subfolderName: m.subfolder_name });
  }

  // ===========================================================================
  // Phase 1 — Logos master folder (recurse one level into subfolders)
  // ===========================================================================
  // why: track per-walk success so we don't mass-archive on a partial
  // failure. If the logos walk threw, only the agents walk's seen-set is
  // trustworthy for archival of agent_headshot/partner_logo rows, and
  // vice-versa.
  let logosWalkOk = true;
  let agentsWalkOk = true;
  try {
    const logosTopLevel = await listChildren(accessToken, logosFolderId);
    for (const entry of logosTopLevel) {
      if (entry.mimeType === "application/vnd.google-apps.folder") {
        // recurse one level — sub-files get logo_category = subfolder name
        const subfiles = await listChildren(accessToken, entry.id);
        for (const f of subfiles) {
          report.scanned += 1;
          if (!isImage(f.mimeType)) {
            report.skipped += 1;
            continue;
          }
          try {
            const result = await syncOneFile({
              supabase,
              accessToken,
              file: f,
              kind: "logo",
              officeId: null,
              parentSubfolderName: entry.name,
              logoCategory: entry.name,
              storagePathPrefix: `logos/${entry.id}`,
            });
            report[result] += 1;
            seenDriveFileIds.add(f.id);
          } catch (err) {
            report.errors.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } else if (isImage(entry.mimeType)) {
        report.scanned += 1;
        try {
          const result = await syncOneFile({
            supabase,
            accessToken,
            file: entry,
            kind: "logo",
            officeId: null,
            parentSubfolderName: null,
            logoCategory: null,
            storagePathPrefix: "logos/root",
          });
          report[result] += 1;
          seenDriveFileIds.add(entry.id);
        } catch (err) {
          report.errors.push(`${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      } else {
        report.scanned += 1;
        report.skipped += 1;
      }
    }
  } catch (err) {
    report.errors.push(`logos folder walk failed: ${err instanceof Error ? err.message : String(err)}`);
    report.ok = false;
    logosWalkOk = false;
  }

  // ===========================================================================
  // Phase 2 — Agents master folder (each child is an office subfolder OR partner folder)
  // ===========================================================================
  try {
    const officeFolders = await listChildren(accessToken, agentsFolderId);
    for (const officeFolder of officeFolders) {
      if (officeFolder.mimeType !== "application/vnd.google-apps.folder") {
        report.scanned += 1;
        report.skipped += 1;
        continue;
      }
      const mapping = folderToOffice.get(officeFolder.id);
      const isPartnerFolder = officeFolder.name.toLowerCase().includes("family of services");
      // Recursive walk so nested folders (e.g. "Mount Laurel" under
      // Moorestown) get captured. Two-deep is enough for current data.
      const innerFiles = await listChildren(accessToken, officeFolder.id);
      for (const innerEntry of innerFiles) {
        if (innerEntry.mimeType === "application/vnd.google-apps.folder") {
          const nested = await listChildren(accessToken, innerEntry.id);
          for (const f of nested) {
            report.scanned += 1;
            if (!isImage(f.mimeType)) {
              report.skipped += 1;
              continue;
            }
            try {
              const result = await syncOneFile({
                supabase,
                accessToken,
                file: f,
                kind: isPartnerFolder ? "partner_logo" : "agent_headshot",
                officeId: isPartnerFolder ? null : (mapping?.officeId ?? null),
                parentSubfolderName: `${officeFolder.name}/${innerEntry.name}`,
                logoCategory: null,
                storagePathPrefix: isPartnerFolder
                  ? `partners/${officeFolder.id}`
                  : `agents/${officeFolder.id}`,
              });
              report[result] += 1;
              seenDriveFileIds.add(f.id);
            } catch (err) {
              report.errors.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        } else if (isImage(innerEntry.mimeType)) {
          report.scanned += 1;
          // why: agent_headshot rows require office_id (DB constraint).
          // Skip rather than fail if no mapping is set yet — admin needs
          // to set one in brand_drive_offices first.
          if (!isPartnerFolder && !mapping) {
            report.skipped += 1;
            report.errors.push(
              `Skipped ${innerEntry.name} — no office mapping for folder "${officeFolder.name}" (${officeFolder.id})`,
            );
            continue;
          }
          try {
            const result = await syncOneFile({
              supabase,
              accessToken,
              file: innerEntry,
              kind: isPartnerFolder ? "partner_logo" : "agent_headshot",
              officeId: isPartnerFolder ? null : (mapping?.officeId ?? null),
              parentSubfolderName: officeFolder.name,
              logoCategory: null,
              storagePathPrefix: isPartnerFolder
                ? `partners/${officeFolder.id}`
                : `agents/${officeFolder.id}`,
            });
            report[result] += 1;
            seenDriveFileIds.add(innerEntry.id);
          } catch (err) {
            report.errors.push(`${innerEntry.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        } else {
          report.scanned += 1;
          report.skipped += 1;
        }
      }
    }
  } catch (err) {
    report.errors.push(`agents folder walk failed: ${err instanceof Error ? err.message : String(err)}`);
    report.ok = false;
    agentsWalkOk = false;
  }

  // ===========================================================================
  // Phase 3 — Archive rows whose source file disappeared from Drive
  // ===========================================================================
  //
  // why: this is the drift fix. Anything still status='active' in
  // brand_assets but whose drive_file_id was NOT encountered above is no
  // longer in Drive. Flip it to 'archived' so the Brand/Agent panels
  // (which filter to status='active') stop showing it.
  //
  // Safety guards:
  //   - Only scope the archive to the kinds whose walk succeeded. If only
  //     the agents walk failed, we still archive missing logos but leave
  //     agent_headshot/partner_logo rows alone — and vice-versa.
  //   - We never touch rows already status='archived' (the WHERE clause
  //     filters to 'active' only), so re-runs are idempotent.
  //
  // We do this in a single SQL update via .not("drive_file_id", "in", ...)
  // — Supabase's PostgREST takes the list as a comma-separated string in
  // the URL. For our scale (350 rows, ~330 active) this is well under any
  // URL-length limit.
  try {
    const seenList = [...seenDriveFileIds];
    if (seenList.length > 0) {
      // why: build the kind filter dynamically based on which walks
      // succeeded. If both succeeded, archive across all three kinds. If
      // only logos succeeded, archive only kind='logo'. Etc.
      const kindsToSweep: Array<"logo" | "agent_headshot" | "partner_logo"> = [];
      if (logosWalkOk) kindsToSweep.push("logo");
      if (agentsWalkOk) kindsToSweep.push("agent_headshot", "partner_logo");

      if (kindsToSweep.length > 0) {
        // why: PostgREST `not.in` expects a parenthesized comma list. We
        // use the supabase-js helper which formats it for us; the values
        // are drive_file_ids (alphanumeric Drive IDs, no special chars).
        const { data: archived, error: archiveErr } = await supabase
          .from("brand_assets")
          .update({ status: "archived", updated_at: new Date().toISOString() })
          .in("kind", kindsToSweep)
          .eq("status", "active")
          .not("drive_file_id", "in", `(${seenList.map((id) => `"${id}"`).join(",")})`)
          .select("id");
        if (archiveErr) {
          report.errors.push(`archive sweep failed: ${archiveErr.message}`);
        } else {
          report.archived = archived?.length ?? 0;
        }
      }
    }
  } catch (err) {
    report.errors.push(`archive sweep threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  report.durationMs = Date.now() - start;
  return report;
}

// =============================================================================
// HTTP entry
// =============================================================================
//
// Accepts POST only. Returns the sync report as JSON. If a fatal error
// escapes runSync, returns 500 with the error message.
// Always writes last-sync metadata to api_credentials before returning,
// regardless of success/failure, so the Brand panel can read the failure
// state for the next user that opens it.

// @ts-expect-error - Deno global
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST only" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }
  // why: we need a supabase client to write metadata even when runSync
  // throws before it can construct its own. Create one up front.
  // @ts-expect-error - Deno global
  const supabaseUrl = Deno.env.get("SUPABASE_URL") as string;
  // @ts-expect-error - Deno global
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const report = await runSync();
    // why: persist the run outcome (success or partial-error). Even when
    // report.ok is true with errors[] non-empty (partial failure), this
    // call records the first error string so the UI can surface it.
    await writeLastSyncMetadata(supabase, report, null);
    return new Response(JSON.stringify(report), {
      status: report.ok ? 200 : 207, // 207 Multi-Status when partial errors
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // why: persist the fatal failure too — this is exactly the case the
    // Brand panel's "Last sync failed" badge exists to surface. Build a
    // minimal report shape so writeLastSyncMetadata still has the fields
    // it expects.
    const fatalReport: SyncReport = {
      ok: false,
      durationMs: 0,
      scanned: 0,
      added: 0,
      updated: 0,
      unchanged: 0,
      archived: 0,
      skipped: 0,
      errors: [message],
    };
    try {
      await writeLastSyncMetadata(supabase, fatalReport, message);
    } catch {
      // why: a metadata-write failure on top of the run failure isn't
      // worth crashing harder — just log and move on.
      console.error("metadata write failed after fatal sync error");
    }
    return new Response(
      JSON.stringify({ ok: false, error: `Sync threw: ${message}` }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
});
