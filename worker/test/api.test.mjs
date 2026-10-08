import test from "node:test";
import assert from "node:assert/strict";
import { handle, allowedOrigin, toHex, fromHex, isWebp, hash } from "../src/index.mjs";

const webp = Uint8Array.from([82,73,70,70,12,0,0,0,87,69,66,80,86,80,56,32,0,0,0,0]);
const env = {
  DATABASE_URL: "postgresql://redacted.invalid/db",
  RMP_SECRET_KEY: "testing-strong-secret",
  RMP_ADMIN_TOKEN: "testing-admin-token",
  RMP_ALLOWED_ORIGINS: "https://frazmcc.github.io",
  IMAGES: {
    input(stream) {
      return {transform(){return this;}, output(){
        return {response:()=>new Response(webp,{headers:{"Content-Type":"image/webp"}})};
      }};
    }
  }
};
const makeQuery = () => {
  const calls = [];
  const query = async (strings,...values) => {
    const source = strings.join("?");
    calls.push({sql:source,values});
    if(source.includes("COUNT(*)::int AS count"))return [{count:0}];
    if(source.includes("SELECT id FROM entries WHERE image_sha"))return [];
    if(source.includes("SUM(octet_length(image))"))return [{bytes:"0"}];
    if(source.includes("INSERT INTO entries("))return [{id:101}];
    if(source.includes("FROM entries WHERE id=") && source.includes("status='approved'"))return [];
    if(source.includes("SELECT 1"))return [{ok:1}];
    return [];
  };
  query.query=async (s,v)=>{calls.push({sql:s,values:v});return[];};
  return {query,calls};
};
test("WebP bytes round-trip without copying any JPEG original",()=>{
  assert.equal(isWebp(webp),true);
  assert.deepEqual(fromHex(toHex(webp)),webp);
  assert.equal(isWebp(new TextEncoder().encode("not an image")),false);
});
test("CORS accepts only allowlisted exact origins",()=>{
  assert.equal(allowedOrigin("https://frazmcc.github.io",env),true);
  assert.equal(allowedOrigin("https://frazmcc.github.io.evil.test",env),false);
  assert.equal(allowedOrigin(null,env),false);
});
test("hash is deterministic and keyed",async()=>{
  assert.equal(await hash("secret","address"),await hash("secret","address"));
  assert.notEqual(await hash("secret","address"),await hash("other","address"));
});
test("fails closed without connection secrets",async()=>{
  const reply=await handle(new Request("https://api.example/api/health"),{});
  assert.equal(reply.status,503);
});
test("upload accepts original once but INSERT persists WebP bytes only",async()=>{
  const fakePng=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0]);
  const form=new FormData();
  form.set("title","The Great Escape");form.set("nickname","Anon");
  form.set("agree","true");form.set("photo",new File([fakePng],"sample.png",{type:"image/png"}));
  const {query,calls}=makeQuery();
  const request=new Request("https://api.example/api/upload",{method:"POST",body:form,headers:{"CF-Connecting-IP":"203.0.113.2"}});
  const response=await handle(request,env,()=>query);
  assert.equal(response.status,202);
  const insertion=calls.find(c=>c.sql.includes("INSERT INTO entries("));
  assert.ok(insertion,"data inserted");
  const valueSet=insertion.values.map(String);
  assert.ok(valueSet.includes(toHex(webp)),"converted WebP is stored");
  assert.ok(!valueSet.includes(toHex(fakePng)),"original is not stored");
});
test("uploads require positive ownership confirmation",async()=>{
  const form=new FormData();form.set("title","My Photo");
  const {query}=makeQuery();
  const response=await handle(new Request("https://api.example/api/upload",{method:"POST",body:form}),env,()=>query);
  assert.equal(response.status,400);
});
test("original-format input over the maximum is rejected",async()=>{
  const form=new FormData();form.set("title","Huge Example");form.set("agree","true");
  form.set("photo",new File([new Uint8Array(6*1024*1024+1)],"huge.png",{type:"image/png"}));
  const {query}=makeQuery();
  const result=await handle(new Request("https://api.example/api/upload",{method:"POST",body:form}),env,()=>query);
  assert.equal(result.status,400);
});
test("pending images are never served through public route",async()=>{
  const {query}=makeQuery();
  const response=await handle(new Request("https://api.example/api/images/101"),env,()=>query);
  assert.equal(response.status,404);
});
test("moderator endpoint needs a token",async()=>{
  const {query}=makeQuery();
  const forbidden=await handle(new Request("https://api.example/api/admin/pending"),env,()=>query);
  assert.equal(forbidden.status,403);
});
