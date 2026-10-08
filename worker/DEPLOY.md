# Deploy the free Cloudflare API

This is the deployment procedure for the **Rate My Poo** backend in `worker/`. The user-facing website remains on GitHub Pages. The Worker handles public uploads, private moderation, votes, image delivery and abuse reporting. **No Render service is required.**

The source branch currently containing this Worker is `feature/real-user-submissions`; it will be merged into `main` only after tests and live deployment verification. For initial testing, set Cloudflare's build branch to the feature branch, then change to `main` after merging.

## 1. Create the Neon tables

In your Neon project `shiny-credit-60877803` and branch `br-rough-night-b13fvzr0` (production), open the SQL Editor, paste [schema.sql](schema.sql) and run it **once**. The schema uses `CREATE TABLE IF NOT EXISTS` and is intended for the new empty database. Back up populated databases before applying migrations.

Verify that `entries`, `votes`, and `reports` exist. The initial migration could not be applied automatically through the connected database tool, so this step is pending.

## 2. Import the GitHub repository into Cloudflare

1. Open [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create application** → **Import a repository**.
2. Connect GitHub and choose `Frazmcc/R-M-P`.
3. Set Worker name exactly to **rate-my-poo-api** (matches `wrangler.toml`).
4. Set **Root directory** to **`worker`**. Without this, Wrangler will not find its configuration.
5. Set **Build branch** to `feature/real-user-submissions` for pre-merge verification.
6. Set the **Deploy command** to `npx wrangler deploy`. Install dependencies with `npm install` if Cloudflare asks for a build command.
7. Select the **Workers Free** plan, then save the Git integration. If it deploys before credentials exist, its health check may fail until secrets are configured; that is expected.

Official guide: https://developers.cloudflare.com/workers/ci-cd/builds/

## 3. Add private secrets to the Worker

In **Workers & Pages → rate-my-poo-api → Settings → Variables and Secrets**, add:

| Secret | Where to obtain it |
|---|---|
| `DATABASE_URL` | Neon Console → Connection Details → **pooled** PostgreSQL connection string for the production branch |
| `RMP_SECRET_KEY` | Separate 32-byte or longer random secret |
| `RMP_ADMIN_TOKEN` | Another long random secret; use this in the Moderator page |

Set as **Secrets**, not public/plain variables. No passwords or secrets belong in this repo or in GitHub Pages `config.js`. Do not transmit them in chat. The Worker already has a public origin allowlist and Images binding configured in `wrangler.toml`.

## 4. Verify the real upload flow

In the deployed Worker URL:

1. `/api/health` returns `{"status":"ok"}`.
2. `/api/items` returns a JSON gallery (initially `{"items":[],"total":0}`). This verifies the **schema**, not merely database reachability.
3. Submit an allowed sample image via the actual website after its `config.js` points to the Worker URL. Check that the original JPG/PNG is **not** stored in Neon; the `entries.image` column contains only WebP, pending approval.
4. Use the website Moderator page to approve the sample.
5. Verify it appears publicly as WebP and can be rated 1–10. Verify repeat votes are rejected.
6. Remove the test submission and confirm `/api/images/ID` returns 404; image bytes are cleared from the live table.

## 5. Activate the website

Once tests pass and the Worker is live, set the **public** origin in `config.js` to:

```js
window.RMP_API_BASE = "https://YOUR-EXACT-WORKER-HOST.workers.dev";
```

Never guess the subdomain. Merge the pull request only when both API and site flow pass. Cloudflare production branch can then move to `main`.

## Data lifecycle

Source photos are kept only transiently in the upload request and image converter. The application does **not** insert original image bytes into Neon or Cloudflare object storage. The Images binding converts the input to still WebP, discarding EXIF metadata, before storing the converted bytes. All images enter moderation first. Reject/remove clears the live image bytes, although provider-level backups/retained history may contain prior versions temporarily.

The Cloudflare Free limit of 5,000 unique image transformations per month and the Neon Free database quota can stop new submissions at scale; the application also stops at 600 MB image bytes. Cloudflare Workers do not sleep like free Render web instances, but Neon free compute may resume after idle periods. No truly instant latency guarantee is possible.

## Public launch readiness

Publish a real contact channel, clear user content rules, privacy and removal policies, and ensure moderation capacity before accepting submissions from the general public. No paid hosting resources are required for this planned small-scale deployment within free-tier limits.
