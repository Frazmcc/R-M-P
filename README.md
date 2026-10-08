# Rate My Poo 💩

An advert-free, early-2000s-inspired photo-rating community site with **real, moderated submissions**.

## How it works

Visitors can upload a JPEG, PNG or WebP photo (maximum 6 MB), without creating an account. Uploaded photos are verified, resized to WebP, stripped of embedded metadata and held **privately** until a moderator approves them. Approved photos appear in the gallery and can receive scores from 1–10. Visitors can report a photo for review. Moderators can approve, reject, remove and mark approved photos as Staff Favourites.

Community gallery and moderation data live in PostgreSQL in production. Photos are stored as WebP binary data inside the database rather than on an ephemeral web-service filesystem. SQLite is used for local development.

## Run locally

Using Python 3.12 or later:

```bash
python -m venv .venv
# Activate your virtual environment for your platform.
pip install -r requirements-dev.txt
export RMP_ADMIN_TOKEN="replace-with-a-long-random-secret"
export RMP_SECRET_KEY="replace-with-a-different-long-random-secret"
uvicorn app:app --reload --port 8000
```

On Windows PowerShell, use:

```powershell
$env:RMP_ADMIN_TOKEN = "replace-with-a-long-random-secret"
$env:RMP_SECRET_KEY = "replace-with-a-different-long-random-secret"
python -m uvicorn app:app --reload --port 8000
```

Open **http://localhost:8000**. Navigate to **Moderator** in the footer and use the configured token to review submissions. The local database is stored in `rmp-dev.sqlite3` (excluded from Git).

Run tests:

```bash
python -m pytest -q
node --check static/site.js
```

## Preferred free, fast backend: Cloudflare Workers

The **recommended** production approach is **GitHub Pages + Cloudflare Workers Free + your existing Neon Free database**. The older Python/Render option is retained in the repository as a fallback, but **Render is not required**.

- Worker code: [worker/src/index.mjs](worker/src/index.mjs)
- Neon migration/schema: [worker/schema.sql](worker/schema.sql)
- Worker configuration: [worker/wrangler.toml](worker/wrangler.toml)
- Node tests: [worker/test/api.test.mjs](worker/test/api.test.mjs)

**Benefits:** Worker scripts do not hibernate like a Render Free web service. Cloudflare's free tier includes 100,000 requests/day and its Images Free transformations include 5,000 unique transforms/month. Your Neon database can still scale to zero, so the first DB call after inactivity could have an unavoidable startup delay.

### Image lifecycle — strict data minimisation

1. Browser submits a JPEG, PNG, or WebP (6 MB maximum) to the Worker.
2. Cloudflare Images binding decodes the image and **converts it to an animated-frame-free WebP** at up to 1400×1400 and quality 76.
3. The Worker checks the output format and enforces a maximum WebP size of 750 KiB; duplicates are rejected using the **WebP** SHA-256.
4. **Only the converted WebP is saved** as `BYTEA` in Neon. There is no original-file archive, source-format database column, R2 object or original-copy backup. The raw request is processed transiently in memory/infrastructure only; it is not persisted by application code.
5. The saved WebP is initially private. Approving it makes that *same converted WebP* visible to site visitors. Rejecting or removing a photo clears its stored WebP bytes.

Photo storage is capped at 600 MB of encoded bytes to preserve headroom below your project's **1 GB** free-tier limit. Retained database history/backups may keep deleted data temporarily under Neon platform policies; immediate physical erasure from all backups cannot be promised.

### Cloudflare Free deployment steps

1. Have a **Cloudflare account on Workers Free** and access to the Cloudflare dashboard. A Cloudflare account has **not** been connected to this chat, so the Worker cannot be published through these tools yet.
2. In **Neon SQL Editor** for project `shiny-credit-60877803` on the `production` branch, execute the SQL in [worker/schema.sql](worker/schema.sql). The schema has not yet been applied by this chat.
3. From a local clone or CI, change to the `worker` directory and run:
   ```bash
   npm install
   npx wrangler login
   npx wrangler deploy
   ```
   Ensure the Cloudflare Images binding named **IMAGES** is enabled; the [wrangler.toml](worker/wrangler.toml) includes it.
4. In Cloudflare Workers **Settings → Variables and Secrets**, set these secrets (never commit them):
   - `DATABASE_URL`: your Neon pooled PostgreSQL connection URI for the provided project and production branch.
   - `RMP_SECRET_KEY`: a separate long cryptographically-random secret.
   - `RMP_ADMIN_TOKEN`: another separate long cryptographically-random moderator key.
   - Configure allowed website origins in `RMP_ALLOWED_ORIGINS` (already set for GitHub Pages and rate-my-poo.com).
5. Check the deployed Worker via `https://YOUR-WORKER.workers.dev/api/health`. It should respond with `{"status":"ok"}`.
6. Set the GitHub Pages `config.js` public API origin to the Worker URL, push your update, and verify the end-to-end visitor submission → pending moderation → approval → public rating flow.

Never add database passwords, API keys or moderator tokens to GitHub Pages `config.js`.

### Known free-plan restrictions

Free Workers are capped at 10 milliseconds of Worker CPU time per request; the platform Images binding performs transcoding outside the JavaScript CPU budget. Exhausting a free usage allowance can cause errors rather than paid usage, depending on account settings. The 5,000 monthly unique image transformation quota includes new submissions. Neon may suspend its database compute on inactivity. Implement appropriate moderation and privacy policies before announcing the site to the public.

## Alternative legacy hosting: Render Free + Neon Free

**Plan:** GitHub Pages for the static website (free) + **Render Free** for the Python API (free) + **Neon Free PostgreSQL** for persistent submissions (free). No Render PostgreSQL, paid compute, paid image service or credit card is needed for the proposed code deployment. Hosting providers impose resource limits and may restrict or suspend free services.

- GitHub Pages: hosts frontend HTML/CSS/JS with HTTPS.
- Render Free: runs the FastAPI backend (sleeps after 15 minutes idle; cold starts can take ~1 minute). **Never stores production photos in SQLite or on the temporary Render disk.** The API refuses to start on Render without a configured DATABASE_URL.
- Neon Free: as of 2 October 2026, **1 GB of PostgreSQL storage per project** with free compute allowance. The database stores resized/metadata-stripped WebP images as well as submissions and ratings. This is enough for a modest community site but **not unlimited media storage**. Monitor the quota and back up what matters.

Useful provider information:
- https://render.com/docs/free
- https://neon.com/blog/neon-free-plan-1-gb-per-project

### Initial free deployment checklist

1. Create/authorize a **Neon** account and create a project on the **Free** plan (https://console.neon.tech). Copy its PostgreSQL **pooled connection string** securely. Never commit or paste the password into GitHub files.
2. In the confirmed Render workspace, create a **Blueprint** from this GitHub repository using `render.yaml`. Choose **Free**; the Blueprint has no Render database or paid services.
3. Provide the private `DATABASE_URL` from Neon and create your own long random `RMP_ADMIN_TOKEN` secret when Render prompts for environment variables; `RMP_SECRET_KEY` is autogenerated.
4. Check the Render app's actual address: `https://YOUR-RENDER-HOST.onrender.com/api/health` should respond with `{"status":"ok"}`.
5. Test the full website **at the Render web-service root URL** first. It serves `index.html` itself, and `/config.js` automatically points its frontend to the same host. Try a small submission, visit **MODERATOR** in the footer, approve it, and rate it.
6. To use the **GitHub Pages** version as the public frontend, edit `config.js` to set `window.RMP_API_BASE = "https://YOUR-RENDER-HOST.onrender.com";` (the actual HTTPS URL), then merge the green PR/deploy Pages. This public API origin is safe to publish; database credentials and moderator tokens are not.
7. To use **rate-my-poo.com**, configure DNS and custom-domain HTTPS for either your chosen frontend host. Add the exact domain to `RMP_ALLOWED_ORIGINS` if needed.
8. Leave paid upgrades/auto-overages disabled. In Render, **don't add a payment method** if you want it to suspend rather than charge after free allowances are exhausted. Keep Neon on the Free plan.

**Limits:** the free database has 1 GB total, not 1 GB per user, and pictures take much of it. The API caps stored photo bytes at **600 MB** to leave substantial space for votes, indexes, reports and database overhead. It returns HTTP 507 and stops accepting new submissions at the cap rather than silently exceeding the budget. This is not an exact PostgreSQL on-disk quota measurement; monitor actual Neon usage separately. Production backups, abuse prevention and uptime guarantees are not provided by these free tiers. Treat this as a moderated small-scale launch; review provider quotas regularly.

Environment variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Private pooled Neon PostgreSQL connection string, mandatory on Render |
| `RMP_ADMIN_TOKEN` | Private long random moderator secret |
| `RMP_SECRET_KEY` | Stable randomly generated secret used to hash anti-abuse identifiers |
| `RMP_ALLOWED_ORIGINS` | Comma-separated public frontend origins for CORS |

## Responsible public operation

This code provides server-side pending moderation, file validation, 5 submissions/IP per day, image de-duplication, one rating per browser ID per photo, reporting and a private moderation interface. **These are basic safeguards, not a complete anti-abuse or legal-compliance programme.** In particular, browser-ID vote protection can be bypassed by a determined attacker, and there is no automated harmful-image detection.

Before public launch:

- Add a working abuse/takedown contact route, full privacy policy, publication rules and retention/deletion procedure.
- Review legal obligations for the jurisdictions where the service operates, including user-generated-content rules, and design appropriate age assurance and safeguarding.
- Set up ongoing human moderation, incident response, backups and monitoring.
- Consider rate limiting at the edge, audit logs and stronger vote anti-abuse controls before high traffic.
- Do not recover or publish historical images without permission from rights holders.

## Development workflow

GitHub Actions runs frontend syntax checks and backend integration tests on pushes and pull requests. Keep public deployment changes behind code review and green checks.

The site is a new recreation inspired by the historic website; no original database, photographs or source code are included.
