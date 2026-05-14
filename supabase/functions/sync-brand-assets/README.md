# sync-brand-assets — deployment runbook

One-time setup + ongoing operation for the brand assets Drive→Supabase
sync Edge Function.

## What this function does

Pulls C21 logos + per-office agent headshots + partner co-brand marks
from two shared Google Drive folders, uploads each file to the Supabase
`brand-assets` Storage bucket, and upserts a row in the `brand_assets`
table. Idempotent — re-runs skip files whose Drive `modifiedTime`
hasn't changed.

## One-time setup

### 1. Create a Google service account

1. Go to <https://console.cloud.google.com>
2. Create a new project (e.g. "Alliance Drive Sync") OR reuse an existing one
3. **APIs & Services → Library** → search "Google Drive API" → **Enable**
4. **IAM & Admin → Service Accounts → Create Service Account**
   - Name: `alliance-brand-sync`
   - Skip the optional grant/access steps
5. Click the new service account → **Keys** tab → **Add Key → Create new key → JSON**. A JSON file downloads. Treat as a secret.

### 2. Share the Drive folders with the service account

1. The JSON file has a `client_email` field. Copy that address (looks like
   `alliance-brand-sync@your-project.iam.gserviceaccount.com`).
2. In Google Drive, open the **Logos** folder → **Share** → add the service
   account email as **Viewer** → uncheck "Notify people" → **Send**.
3. Repeat for the **Agents/Headshots** master folder.

### 3. Set Edge Function secrets

Set these via Supabase MCP (or `supabase secrets set` if working locally):

```bash
# Paste the ENTIRE JSON file contents as the value:
GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'

# Drive folder IDs (these are the production values as of 2026-05-14):
BRAND_LOGOS_FOLDER_ID='1GHho_1EFajyVr2CQxtRuTHjB8TwP-Uhj'
BRAND_AGENTS_FOLDER_ID='1mdrg4G2WIo_HXs26kEKI62MJo0lZ6zDn'
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the
Edge Functions runtime — you don't set those manually.

### 4. Deploy the function

Via Supabase MCP (`deploy_edge_function`) or CLI:

```bash
supabase functions deploy sync-brand-assets
```

### 5. Trigger a test run

```bash
curl -X POST \
  https://rhkgowpjfpqbrdmgsccx.supabase.co/functions/v1/sync-brand-assets \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
```

Expect a JSON report like:

```json
{
  "ok": true,
  "durationMs": 47284,
  "scanned": 312,
  "added": 295,
  "updated": 0,
  "unchanged": 0,
  "skipped": 17,
  "errors": []
}
```

After the first run, the editor's left sidebar **Brand** and **Agents**
panels will populate with real assets.

## Scheduling the nightly cron

Apply this SQL via Supabase MCP after the function is deployed and tested:

```sql
-- Nightly sync at 3:00 AM ET (08:00 UTC during DST, 07:00 UTC during EST).
-- Conservative timing: well after midnight, well before East-Coast morning.
SELECT cron.schedule(
  'sync-brand-assets-nightly',
  '0 7 * * *', -- 7 AM UTC = 2-3 AM ET
  $$
  SELECT public.invoke_edge_function('sync-brand-assets');
  $$
);
```

(The `invoke_edge_function` Postgres helper already exists in your project — same one used by the MLS RETS sync cron.)

## Operations

**Re-runs are safe.** Files whose Drive `modifiedTime` matches the
already-synced row return `unchanged` and skip the download/upload.

**Admin-edited labels survive re-sync.** The function never overwrites
`label` on rows that already exist — only inserts use the auto-derived
label from the filename.

**Adding a new office.** Insert a row into `brand_drive_offices` mapping
the new Drive folder ID → office_id. The next sync run will pick up
that office's files. Until that row exists, files in the new folder
are skipped and logged as an error in the sync report.

**Removing assets.** If a file is deleted from Drive, the corresponding
`brand_assets` row stays (with `status='active'`) — manual cleanup via
the admin UI is intentional so accidental Drive deletions don't
silently disappear from posts. Future enhancement: mark missing
files as `status='archived'` automatically.
