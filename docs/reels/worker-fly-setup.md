# Stand up the Reel render worker on Fly.io

One-time setup so "Generate Reel" produces a real MP4. Mostly web dashboards — the GitHub Action does the actual deploy. ~15 minutes.

Two values you'll paste in a few places (keep this file handy):

- **WORKER_AUTH_TOKEN** = `cffe4cc7f46d859042efb5703e779211a05acc7b84d79e7e22fb282ee952a2de`
  (a shared password between the worker and the app — I generated it; it just has to match on both sides)
- **SUPABASE_URL** = `https://rhkgowpjfpqbrdmgsccx.supabase.co`

---

## 1. Get a Fly deploy token → add it to GitHub

1. In the **Fly dashboard**, go to your account → **Tokens** (or **fly.io/tokens**). Create a new token (a personal/account access token — it needs to be able to *create* the app the first time). Name it `github-deploy`. **Copy it.**
2. In the **GitHub repo** (`AllianceAnalytics`): **Settings → Secrets and variables → Actions → New repository secret**.
   - Name: `FLY_API_TOKEN`
   - Secret: paste the Fly token
   - **Add secret**

## 2. Trigger the deploy (creates the app + ships the worker)

The workflow `fly-deploy-worker.yml` deploys whenever `worker/` changes — and on first run it **creates the Fly app** for you.

- Easiest: in GitHub → **Actions** tab → "Deploy Reel Worker to Fly" → **Run workflow** (the `workflow_dispatch` button). Or just push any change under `worker/`.
- Watch the run. It should create `alliance-reel-render` and deploy. (If it fails saying the **app name is taken**, tell me — I'll switch it to a unique name and you re-run. The name is global across all of Fly.)

## 3. Set the worker's secrets in the Fly dashboard

Once the app exists (after step 2), open it in the **Fly dashboard → your app → Secrets** and add these three (web UI, no terminal):

| Name | Value |
|---|---|
| `WORKER_AUTH_TOKEN` | `cffe4cc7f46d859042efb5703e779211a05acc7b84d79e7e22fb282ee952a2de` |
| `SUPABASE_URL` | `https://rhkgowpjfpqbrdmgsccx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | *(from Supabase → Project Settings → API → `service_role` secret key — copy it from there; don't share it with me)* |

Setting secrets restarts the worker so it picks them up.

## 4. Point the app (Vercel) at the worker

In the **Vercel dashboard** for the main app → **Settings → Environment Variables** (Production), add:

| Name | Value |
|---|---|
| `REEL_WORKER_URL` | `https://alliance-reel-render.fly.dev` |
| `REEL_WORKER_AUTH_TOKEN` | `cffe4cc7f46d859042efb5703e779211a05acc7b84d79e7e22fb282ee952a2de` |

Then **redeploy** the Vercel app so the new vars take effect (Deployments → ⋯ → Redeploy, or push a commit).

> `REEL_WORKER_AUTH_TOKEN` (Vercel) MUST equal `WORKER_AUTH_TOKEN` (Fly) — that's how they authenticate to each other.

## 5. Test

1. Open the Reel editor, pick a listing, hit **Generate Reel**.
2. It submits to the worker, polls, and after ~10–30s should return a real MP4 you can preview and publish.
3. If the Studio shows **"REEL_WORKER_URL is not set"** → step 4 didn't take (or Vercel wasn't redeployed). If it shows an **auth error** → the two tokens don't match. If it **times out / worker unreachable** → the Fly app didn't deploy (check the Actions run) or its secrets are missing (step 3).

---

## After this, it's automatic

Once it's up, the GitHub workflow redeploys the worker on every push that touches `worker/`. So all the render-side work (motion, transitions, text overlays, stickers, end-card) goes live without you doing anything else.

**Cost:** the worker auto-stops when idle and wakes to render, so it's roughly **$3–10/month**.
