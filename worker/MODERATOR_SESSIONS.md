# Moderator browser sessions

The moderator key stays in the Cloudflare secret `RMP_ADMIN_TOKEN`. It is **never** saved in HTML, localStorage, sessionStorage, a readable cookie or the Neon database.

## Signing in

1. Open `https://www.rate-my-poo.com/#admin` on a trusted browser.
2. Enter your current Cloudflare `RMP_ADMIN_TOKEN`.
3. Keep **Remember this browser** checked to receive a 30-day, automatically refreshed session cookie; leave it unchecked to sign in only for the browser session, with a 12-hour server-side expiry.
4. Click **Sign in securely**. Successful login erases the key from the form. Private moderation API calls use a cookie instead of repeating the key in JavaScript.

When reopening the moderator page, the site checks the existing session and refreshes it when valid. Active remembered browsers typically won't need the key again until the cookie is cleared, they sign out, their key is rotated or they go 30 days without returning.

**Important:** `rate-my-poo.com` and `www.rate-my-poo.com` use separate host-only cookies. Use the `www` address consistently.

## Security design

- Signed, random 256-bit session material; HMAC-SHA-256 signs a version, issue time, expiry, remember flag and random nonce.
- `__Host-` cookie with `Secure; HttpOnly; Path=/; SameSite=Strict`, scoped to this hostname; no `Domain` option.
- HTTPS and exact-match `Origin` are required for every state-changing private operation and login/logout.
- Cross-origin callers cannot read private API data using CORS credentials.
- Only `POST /api/admin/session` accepts the moderator key. All other private APIs require a valid signed session.
- Changing `RMP_ADMIN_TOKEN` automatically invalidates all sessions because signatures depend on the current admin key.
- Logging out clears the browser cookie. **Because these are stateless cookies**, logging out does not centrally revoke a previously copied cookie. If a computer is stolen, a session may have leaked or you need to sign out every device, **rotate `RMP_ADMIN_TOKEN` in Cloudflare**. Do not rotate `RMP_SECRET_KEY` just to end moderator sessions, as it is also used elsewhere.
- The session is a bearer credential: protect the PC with a screen lock and do not choose Remember on shared devices.
- Clearing site cookies, private browsing or a different browser requires signing in again.

## Compatibility

No database schema changes, new external services, or additional subscriptions are required.

## Verification

Run `npm test` under `worker/` for authentication and API security tests; `npm run test:mobile` runs Chromium checks including persistent login, no JavaScript-readable credential, wrong key, sign-out, and guest login.

Only deploy on the HTTPS Cloudflare custom domain or HTTPS workers.dev address; the signed `__Host-` cookie won't be sent over HTTP.
