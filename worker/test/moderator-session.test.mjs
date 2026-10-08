import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/index.mjs";
import { validateModeratorSession, issueModeratorSession, clearModeratorCookie } from "../src/moderator-session.mjs";

const root="https://www.rate-my-poo.com";
const env={
  DATABASE_URL:"postgresql://test.invalid/db",
  RMP_SECRET_KEY:"test-only-signing-secret",
  RMP_ADMIN_TOKEN:"test-only-moderator-key"
};
function fakeSql() {
  const calls=[];
  const query=async (strings,...values)=>{
    const command=strings.join("?");
    calls.push({command,values});
    if(command.startsWith("UPDATE entries SET status='approved'"))return [{id:12}];
    return [];
  };
  query.query=async()=>[];
  return {sql:()=>query,calls};
}
function loginRequest(key=env.RMP_ADMIN_TOKEN,remember=true,origin=root){
  return new Request(root+"/api/admin/session",{
    method:"POST",
    headers:{"Content-Type":"application/json","X-Admin-Token":key,"Origin":origin},
    body:JSON.stringify({remember})
  });
}
async function login(remember=true){
  const response=await handle(loginRequest(env.RMP_ADMIN_TOKEN,remember),env,fakeSql().sql);
  assert.equal(response.status,200);
  const cookie=response.headers.get("Set-Cookie");
  assert.ok(cookie,"A cookie must be set after login");
  return {response,cookie,header:cookie.split(";")[0]};
}
test("moderator login refuses an incorrect key and browser-external origins",async()=>{
  const storage=fakeSql();
  const wrong=await handle(loginRequest("incorrect"),env,storage.sql);
  assert.equal(wrong.status,403);
  assert.equal(wrong.headers.get("Set-Cookie"),null);
  const crossSite=await handle(loginRequest(env.RMP_ADMIN_TOKEN,true,"https://evil.example"),env,storage.sql);
  assert.equal(crossSite.status,403);
  const noOrigin=await handle(new Request(root+"/api/admin/session",{
    method:"POST",headers:{"Content-Type":"application/json","X-Admin-Token":env.RMP_ADMIN_TOKEN},
    body:JSON.stringify({remember:true})
  }),env,storage.sql);
  assert.equal(noOrigin.status,403);
  const insecure=await handle(new Request("http://www.rate-my-poo.com/api/admin/session",{
    method:"POST",headers:{"Content-Type":"application/json","X-Admin-Token":env.RMP_ADMIN_TOKEN,
    "Origin":"http://www.rate-my-poo.com"},body:JSON.stringify({remember:true})
  }),env,storage.sql);
  assert.equal(insecure.status,403);
});
test("remembered moderator cookie is HttpOnly, Secure, SameSite Strict and does not store key",async()=>{
  const {cookie,header}=await login(true);
  assert.match(cookie,/^__Host-rmp_moderator=v1\./);
  assert.match(cookie,/; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000/);
  assert.doesNotMatch(cookie,/test-only-moderator-key|test-only-signing-secret/);
  const verified=await validateModeratorSession(new Request(root+"/api/admin/session",{headers:{"Cookie":header}}),env);
  assert.deepEqual(verified,{remember:true});
  const session=await handle(new Request(root+"/api/admin/session",{headers:{"Cookie":header}}),env,fakeSql().sql);
  assert.equal(session.status,200);
  assert.equal((await session.json()).authenticated,true);
  assert.ok(session.headers.get("Set-Cookie")?.includes("HttpOnly"));
  assert.ok(session.headers.get("Set-Cookie")?.includes("Max-Age=2592000"));
});
test("do not remember option uses browser-session cookie, not a persistent cookie",async()=>{
  const {cookie,header}=await login(false);
  assert.ok(!cookie.includes("Max-Age="));
  assert.deepEqual(await validateModeratorSession(new Request(root+"/api/admin/session",{headers:{"Cookie":header}}),env),{remember:false});
});
test("sessions are required for private images, moderation, reports and pending submissions",async()=>{
  const {header}=await login();
  const fixture=fakeSql();
  const unauthed=await handle(new Request(root+"/api/admin/pending",{
    headers:{"X-Admin-Token":env.RMP_ADMIN_TOKEN}
  }),env,fixture.sql);
  assert.equal(unauthed.status,401);
  const pending=await handle(new Request(root+"/api/admin/pending",{headers:{Cookie:header}}),env,fixture.sql);
  assert.equal(pending.status,200);
  const image=await handle(new Request(root+"/api/admin/image/123",{headers:{Cookie:header}}),env,fixture.sql);
  assert.equal(image.status,404); // Auth passed: the fake DB simply has no photo.
  const missing=await handle(new Request(root+"/api/admin/reports"),env,fixture.sql);
  assert.equal(missing.status,401);
});
test("all privileged POSTs enforce same-origin, not just a valid cookie",async()=>{
  const {header}=await login();
  const fixture=fakeSql();
  const outside=await handle(new Request(root+"/api/admin/12/approve",{
    method:"POST",headers:{"Cookie":header,"Origin":"https://evil.example"}
  }),env,fixture.sql);
  assert.equal(outside.status,403);
  const withoutOrigin=await handle(new Request(root+"/api/admin/12/approve",{
    method:"POST",headers:{"Cookie":header}
  }),env,fixture.sql);
  assert.equal(withoutOrigin.status,403);
  assert.equal(fixture.calls.length,0,"No database write should occur on invalid origins");
  const legitimate=await handle(new Request(root+"/api/admin/12/approve",{
    method:"POST",headers:{"Cookie":header,"Origin":root}
  }),env,fixture.sql);
  assert.equal(legitimate.status,200);
  assert.ok(fixture.calls.some(c=>c.command.startsWith("UPDATE entries")));
});
test("changing the Cloudflare moderator key immediately invalidates old sessions",async()=>{
  const {header}=await login();
  const rotated={...env,RMP_ADMIN_TOKEN:"new-key-after-cloudflare-rotation"};
  const oldSession=await handle(new Request(root+"/api/admin/pending",{headers:{Cookie:header}}),rotated,fakeSql().sql);
  assert.equal(oldSession.status,401);
  const reauth=await handle(loginRequest(rotated.RMP_ADMIN_TOKEN,true),rotated,fakeSql().sql);
  assert.equal(reauth.status,200);
});
test("malformed and tampered cookies cannot authorise moderation",async()=>{
  const {header}=await login();
  const altered=header.slice(0,-1)+(header.endsWith("a")?"b":"a");
  assert.equal(await validateModeratorSession(new Request(root+"/api/admin/pending",{headers:{Cookie:altered}}),env),null);
  assert.equal(await validateModeratorSession(new Request(root+"/api/admin/pending",{headers:{"Cookie":"__Host-rmp_moderator=garbage"}}),env),null);
});
test("sign out clears the host-only HttpOnly cookie without exposing its contents",async()=>{
  const {header}=await login();
  const response=await handle(new Request(root+"/api/admin/logout",{method:"POST",headers:{"Origin":root,"Cookie":header}}),env,fakeSql().sql);
  assert.equal(response.status,200);
  assert.equal(response.headers.get("Set-Cookie"),clearModeratorCookie());
  assert.match(response.headers.get("Set-Cookie"),/Max-Age=0/);
  const csrf=await handle(new Request(root+"/api/admin/logout",{method:"POST",headers:{"Origin":"https://evil.example","Cookie":header}}),env,fakeSql().sql);
  assert.equal(csrf.status,403);
});
test("expired cookie signatures are rejected",async()=>{
  const cookie=await issueModeratorSession(env,true);
  const header=cookie.split(";")[0];
  const original=Date.now;
  Date.now=()=>original()+31*24*60*60*1000;
  try{
    assert.equal(await validateModeratorSession(new Request(root+"/api/admin/pending",{headers:{"Cookie":header}}),env),null);
  }finally{Date.now=original;}
});
