import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";

const src=(file)=>readFileSync(new URL(file,import.meta.url),"utf8");
test("Worker static site has upload and moderator forms",()=>{
  const html=src("../public/index.html");
  assert.match(html,/<form id="upload-form"/);
  assert.match(html,/id="admin-page"/);
  assert.match(html,/name="photo" type="file"/);
  assert.match(html,/type="checkbox" value="true"/);
  assert.match(html,/src="\.\/config\.js"/);
  assert.match(html,/static\/site\.js/);
  assert.doesNotMatch(html,/adsbygoogle|doubleclick\.net|<iframe/i);
});
test("Browser uses same-origin API and does not expose credentials",()=>{
  const js=src("../public/config.js");
  assert.match(js,/window\.RMP_API_BASE\s*=\s*window\.location\.origin/);
  assert.doesNotMatch(js,/postgres|neondb|RMP_ADMIN_TOKEN|RMP_SECRET_KEY|password/i);
  new vm.Script(js,{filename:"config.js"});
  new vm.Script(src("../public/static/site.js"),{filename:"site.js"});
});
test("Wrangler only routes API requests to Worker code",()=>{
  const conf=src("../wrangler.toml");
  assert.match(conf,/\[assets\]/);
  assert.match(conf,/directory\s*=\s*"\.\/public"/);
  assert.match(conf,/run_worker_first\s*=\s*\["\/api\/\*", "\/", "\/how-it-works\*", "\/community-guidelines\*"\]/);
  assert.match(conf,/\[images\][\s\S]*binding\s*=\s*"IMAGES"/);
});

test("Worker binds the public www hostname via managed Cloudflare custom domain",()=>{
  const conf=src("../wrangler.toml");
  assert.match(conf,/\[\[routes\]\][\s\S]*pattern\s*=\s*"www\.rate-my-poo\.com"[\s\S]*custom_domain\s*=\s*true/);
  assert.match(conf,/run_worker_first\s*=\s*\["\/api\/\*", "\/", "\/how-it-works\*", "\/community-guidelines\*"\]/);
});

test("Both apex and www hostnames use managed Cloudflare Worker domains",()=>{
  const conf=src("../wrangler.toml");
  for(const domain of ["www.rate-my-poo.com","rate-my-poo.com"]){
    assert.ok(conf.includes('pattern = "'+domain+'"\\ncustom_domain = true'.replace('\\n','\n')), "Missing managed domain: "+domain);
  }
});

test("retro favicon is linked and served from static assets",()=>{
  const html=src("../public/index.html");
  assert.match(html,/<link rel="icon" type="image\/svg\+xml" sizes="any" href="\/favicon\.svg\?v=1">/);
  assert.match(html,/<link rel="icon" type="image\/png" sizes="32x32" href="\/favicon-32\.png\?v=1">/);
  assert.match(html,/<link rel="apple-touch-icon" href="\/favicon-32\.png\?v=1">/);
  const vector=src("../public/favicon.svg");
  assert.match(vector,/<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(vector,/viewBox="0 0 64 64"/);
  assert.doesNotMatch(vector,/<script|<foreignObject|xlink:href=|href="https?:\/\//i);
  const raster=readFileSync(new URL("../public/favicon-32.png",import.meta.url));
  assert.deepEqual(raster.subarray(0,8),Buffer.from("89504e470d0a1a0a","hex"));
  assert.equal(raster.readUInt32BE(16),32);
  assert.equal(raster.readUInt32BE(20),32);
});
