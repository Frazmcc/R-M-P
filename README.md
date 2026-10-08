# Rate My Poo 💩

A fresh, advert-free recreation inspired by the early-2000s RateMyPoo.com.

## Current status

**Front-end prototype.** The interface works as a standalone static website. All gallery items and scores are fictional examples; ratings are stored in memory only and reset when the page reloads. The submission page is intentionally disabled until a secure backend exists.

## Run locally

Open `index.html` in a modern browser, or use a local static HTTP server:

```bash
python -m http.server 8000
```

Then browse to http://localhost:8000.

## Included

- Responsive early-web style, with no adverts or analytics
- A 1–10 rating interface and next-entry navigation
- Top, Bottom, Staff Favourites and searchable gallery pages
- Placeholder submission page
- Accessible navigation and reduced-motion support

## Production requirements

Before permitting public uploads or shared votes:

1. Build a database for entries, votes, moderation decisions and abuse reports.
2. Use a private image-upload pipeline with format verification, file size limits, metadata stripping, malware scanning where available and moderation before public display.
3. Provide report, removal, takedown and contact mechanisms and clear rules for acceptable content.
4. Implement abuse-resistant votes (rate limits and server-side duplicate protection).
5. Implement privacy policy, terms, retention/deletion practices and appropriate age/access controls.
6. Keep secrets out of the client and repository. Use trusted object storage and serve images safely.
7. Introduce automated checks and review all changes before release.

Original historical images and database records are not included. Only use imagery you own or have permission to publish.
