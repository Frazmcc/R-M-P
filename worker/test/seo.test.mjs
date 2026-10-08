import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const ROOT = "https://www.rate-my-poo.com";
const PAGES = [
  ["../public/index.html", ROOT + "/"],
  ["../public/how-it-works/index.html", ROOT + "/how-it-works/"],
  ["../public/community-guidelines/index.html", ROOT + "/community-guidelines/"]
];

test("every search-facing page has a unique title, description and absolute canonical URL",()=>{
  const titles=new Set(),descs=new Set();
  for(const [path,canonical] of PAGES){
    const html=read(path);
    assert.match(html,/<html lang="en(?:-GB)?">/i);
    const title=html.match(/<title>([^<]+)<\/title>/i)?.[1];
    assert.ok(title?.length>=20 && title.length<=78, "Descriptive title needed: " + path);
    assert.ok(!titles.has(title),"Duplicate page title");
    titles.add(title);
    const description=html.match(/<meta name="description" content="([^"]+)"/i)?.[1];
    assert.ok(description?.length >=80 && description.length<=180,"Description missing or too long: "+path);
    assert.ok(!descs.has(description),"Duplicate meta description");
    descs.add(description);
    assert.ok(html.includes('<link rel="canonical" href="'+canonical+'">'),"Wrong canonical: "+path);
    assert.match(html,/<meta name="robots" content="index, follow/i);
    assert.match(html,/<h1>[^<]+<\/h1>/i);
    assert.match(html,/name="viewport"/i);
    assert.doesNotMatch(html,/meta name="robots" content="noindex"|adsbygoogle|<iframe/i);
  }
});
test("homepage has valid descriptive WebSite and WebPage structured data",()=>{
  const html=read("../public/index.html");
  const json=html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i)?.[1];
  assert.ok(json,"JSON-LD missing");
  const data=JSON.parse(json);
  assert.equal(data["@context"],"https://schema.org");
  assert.equal(data["@graph"].find(i=>i["@type"]==="WebSite")?.url,ROOT+"/");
  assert.equal(data["@graph"].find(i=>i["@type"]==="WebPage")?.url,ROOT+"/");
  assert.doesNotMatch(json,/"aggregateRating"|"ratingValue"|"reviewCount"/i,"Do not fake ratings");
});
test("sitemap URLs correspond to real pages and use canonical www hostname",()=>{
  const sitemap=read("../public/sitemap.xml");
  assert.match(sitemap,/^<\?xml version="1\.0"/);
  assert.match(sitemap,/xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
  const urls=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]);
  assert.equal(urls.length,PAGES.length);
  assert.equal(new Set(urls).size,urls.length);
  for(const [,canonical] of PAGES)assert.ok(urls.includes(canonical),"Missing sitemap page "+canonical);
  for(const url of urls)assert.ok(url.startsWith(ROOT+"/"),"Sitemap contains cross-domain URL");
});
test("robots.txt links to sitemap, allows approved images and discourages sensitive API crawls",()=>{
  const robots=read("../public/robots.txt");
  assert.match(robots,/^User-agent: \*/m);
  assert.match(robots,/^Allow: \/$/m);
  assert.match(robots,/^Disallow: \/api\/admin\/$/m);
  assert.match(robots,/^Disallow: \/api\/upload$/m);
  assert.match(robots,/^Sitemap: https:\/\/www\.rate-my-poo\.com\/sitemap\.xml$/m);
  assert.doesNotMatch(robots,/Disallow: \/api\/images/, "Approved WebP photos remain crawlable");
});
test("SEO information pages have internal navigation for users and crawlers",()=>{
  for(const [path] of PAGES.slice(1)){
    const html=read(path);
    assert.match(html,/<a href="\/">/);
    assert.match(html,/href="\/#upload"/);
    assert.match(html,/href="\/static\/site\.css"/);
  }
});
