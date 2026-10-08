import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const ROOT = "https://www.rate-my-poo.com/";
const html=read("../public/index.html");

test("one public page has descriptive SEO metadata and canonical URL",()=>{
  assert.match(html,/<html lang="en(?:-GB)?">/i);
  assert.match(html,/<title>Rate My Poo[^<]*<\/title>/i);
  assert.match(html,/<meta name="description" content="[^"]{80,180}"/i);
  assert.ok(html.includes('<link rel="canonical" href="'+ROOT+'">'));
  assert.match(html,/<meta name="robots" content="index, follow/i);
  assert.match(html,/name="viewport"/i);
  assert.doesNotMatch(html,/meta name="robots" content="noindex"|adsbygoogle|<iframe/i);
});
test("homepage structured data is valid and does not fabricate ratings",()=>{
  const json=html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(json);
  const data=JSON.parse(json);
  assert.equal(data["@context"],"https://schema.org");
  assert.equal(data["@graph"].find(i=>i["@type"]==="WebSite")?.url,ROOT);
  assert.equal(data["@graph"].find(i=>i["@type"]==="WebPage")?.url,ROOT);
  assert.doesNotMatch(json,/"aggregateRating"|"ratingValue"|"reviewCount"/i);
});
test("one-page sitemap contains only canonical root",()=>{
  const sitemap=read("../public/sitemap.xml");
  assert.match(sitemap,/^<\?xml version="1\.0"/);
  assert.match(sitemap,/xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
  const locs=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
  assert.deepEqual(locs,[ROOT]);
});
test("robots retains sitemap and keeps private API routes out of crawling",()=>{
  const robots=read("../public/robots.txt");
  assert.match(robots,/^User-agent: \*/m);
  assert.match(robots,/^Allow: \/$/m);
  assert.match(robots,/^Disallow: \/api\/admin\/$/m);
  assert.match(robots,/^Disallow: \/api\/upload$/m);
  assert.match(robots,/^Sitemap: https:\/\/www\.rate-my-poo\.com\/sitemap\.xml$/m);
  assert.doesNotMatch(robots,/Disallow: \/api\/images/);
});
test("all user-facing information stays on homepage without sub-page links",()=>{
  for(const section of ["how","guidelines","about","admin","home","upload"]){
    assert.ok(html.includes('id="'+section+'-page"'),"Missing on-page section: "+section);
  }
  assert.doesNotMatch(html,/href="\/(?:how-it-works|community-guidelines)\/?"/i);
  assert.doesNotMatch(html,/href="#(?:home|top|admin|upload)"/i);
  assert.match(html,/data-page="how"/);
  assert.match(html,/data-page="guidelines"/);
  assert.match(html,/data-page="admin"/);
});
