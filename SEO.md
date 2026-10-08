# Rate My Poo — organic search visibility

This project targets **honest, sustainable discoverability**, beginning with branded searches such as "Rate My Poo", "rate my poo website" and "Rate My Poo photos". Search engines control ranking positions and indexing; no rank can be guaranteed.

## Technical SEO built into the Cloudflare Worker

- Homepage title, unique description, correct canonical to `https://www.rate-my-poo.com/`.
- WebSite and WebPage structured data (no fabricated stars, rankings or endorsements).
- Social metadata for link previews.
- Crawlable, human-written pages at `/how-it-works/` and `/community-guidelines/`.
- `/robots.txt` blocks sensitive API endpoints without blocking public approved WebP images.
- `/sitemap.xml` lists the three public HTML pages with stable canonical URLs.
- HTTPS and public indexing require the Cloudflare custom domain to be correctly configured and publicly resolvable.

## Before submitting to search engines

1. Verify **both** `https://www.rate-my-poo.com/` and `https://www.rate-my-poo.com/sitemap.xml` load from a different network or public monitoring service. A recent Windows/Chrome session reported `DNS_PROBE_FINISHED_NXDOMAIN`, despite a successful lookup through `1.1.1.1`; until DNS resolution is consistent, search crawlers may be unable to index the site.
2. Verify `https://www.rate-my-poo.com/robots.txt` is readable and points to the sitemap.
3. Confirm all public pages return HTTP 200, with no login wall, redirect loops or `noindex` headers.
4. Check that the site offers safe moderation, an abuse contact method and a full privacy/takedown process before encouraging mass public submissions.

## Google Search Console

1. Sign in at https://search.google.com/search-console
2. Select **Add property → Domain** and enter `rate-my-poo.com`.
3. Google issues a unique TXT record; add it in Cloudflare **DNS → Records** for the root domain. **Never guess or commit this verification code.**
4. After verification succeeds, choose **Sitemaps**, submit `https://www.rate-my-poo.com/sitemap.xml`.
5. Use **URL Inspection** for `https://www.rate-my-poo.com/`; request indexing if it is eligible.
6. Review **Page indexing**, **Search results**, **Core Web Vitals**, duplicate-canonical reports and any manual-action/security warnings periodically.

Google official guide: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap

## Bing Webmaster Tools

1. Sign in at https://www.bing.com/webmasters.
2. Add `https://www.rate-my-poo.com/` or import verified data from Search Console.
3. Verify ownership, then submit `https://www.rate-my-poo.com/sitemap.xml`.
4. Use URL Inspection and search reports for indexing problems and user queries.

Bing official guidance: https://www.bing.com/webmasters/help/sitemaps-3b5cf6ed

## Ongoing improvements

- Encourage genuinely original, legal, moderated community submissions, not scraped content or purchased links.
- Ensure the public photo pages and rankings are crawlable if individual photos should rank; the initial photo gallery is JavaScript-rendered, so this requires future **server-rendered, stable per-photo URLs**. Don't pretend the current site has that feature.
- Add useful editorial content people are actually looking for, and keep it current.
- Monitor Search Console/Bing analytics: impressions, click-through rate, real queries, and indexing.
- Keep the site fast, accessible, mobile-friendly and free of intrusive advertising.

**Do not use:** paid ranking guarantees, hidden keyword blocks, link farms, fabricated AggregateRating schema, review manipulation, or doorway pages. These can harm search visibility.
