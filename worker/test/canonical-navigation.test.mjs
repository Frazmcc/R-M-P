import test from "node:test";
import assert from "node:assert/strict";
import { publicNavigation } from "../src/index.mjs";

const ROOT="https://www.rate-my-poo.com/";
const assets=[];
const env={ASSETS:{async fetch(request){assets.push(request.url);return new Response("homepage",{status:200,headers:{"Content-Type":"text/html"}})}}};
test("www homepage stays at canonical URL and uses Cloudflare assets",async()=>{
  assets.length=0;
  const response=await publicNavigation(new Request(ROOT),env);
  assert.equal(response.status,200);
  assert.equal(await response.text(),"homepage");
  assert.deepEqual(assets,[ROOT]);
});
test("bare domain and workers.dev root redirect permanently to www",async()=>{
  for(const address of ["https://rate-my-poo.com/","https://rate-my-poo.com/?utm_source=test","https://rate-my-poo-api.fraz-er.workers.dev/","http://www.rate-my-poo.com/"]){
    const response=await publicNavigation(new Request(address),env);
    assert.equal(response.status,301,address);
    assert.equal(response.headers.get("Location"),ROOT);
  }
});
test("legacy pages redirect to the homepage, dropping fragments and query parameters",async()=>{
  const paths=["/how-it-works/","/community-guidelines/","/how-it-works","/community-guidelines","/community-guidelines/index.html"];
  for(const path of paths){
    const response=await publicNavigation(new Request("https://www.rate-my-poo.com"+path+"?old=1"),env);
    assert.equal(response.status,301,path);
    assert.equal(response.headers.get("Location"),ROOT);
  }
});
test("API, image and asset paths are never redirected to HTML",async()=>{
  const paths=["/api/items","/api/health","/api/images/123","/api/admin/session","/api/admin/pending","/static/site.js","/static/site.css","/robots.txt","/sitemap.xml"];
  for(const path of paths){
    const response=await publicNavigation(new Request(ROOT.slice(0,-1)+path),env);
    assert.equal(response,null,path);
  }
});
test("non-GET public routes are left unchanged",async()=>{
  for(const method of ["POST","OPTIONS","DELETE"]){
    const response=await publicNavigation(new Request(ROOT,{method}),env);
    assert.equal(response,null);
  }
});
