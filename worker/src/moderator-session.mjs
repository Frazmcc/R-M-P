// Host-only signed moderator sessions. The administrator's real key never goes
// into localStorage, sessionStorage or JavaScript-readable cookies.
function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), byte=>byte.toString(16).padStart(2,"0")).join("");
}
async function hmac(secret, value) {
  const encoder=new TextEncoder();
  const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return toHex(await crypto.subtle.sign("HMAC",key,encoder.encode(value)));
}

const COOKIE = "__Host-rmp_moderator";
const PERSISTENT_SECONDS = 30 * 24 * 60 * 60;
const TEMPORARY_SECONDS = 12 * 60 * 60;
const VERSION = "v1";

export function sameOriginPost(request) {
  const target = new URL(request.url);
  return target.protocol === "https:" && request.headers.get("Origin") === target.origin;
}
function equalFixedLength(a, b) {
  if(typeof a!=="string" || typeof b!=="string" || a.length!==b.length) return false;
  let difference=0;
  for(let i=0;i<a.length;i++) difference |= a.charCodeAt(i)^b.charCodeAt(i);
  return difference===0;
}
function cookieValue(request) {
  const all=request.headers.get("Cookie")||"";
  const found=all.split(";").map(x=>x.trim()).find(x=>x.startsWith(COOKIE+"="));
  return found?.slice(COOKIE.length+1)||"";
}
function sign(payload, env) {
  // Rotating RMP_ADMIN_TOKEN invalidates every existing session without
  // affecting the upload, vote or report hashing key used in the database.
  return hmac(env.RMP_SECRET_KEY+":"+env.RMP_ADMIN_TOKEN,"moderator-session:"+payload);
}
function cookie(token, remember) {
  return COOKIE+"="+token+"; Path=/; Secure; HttpOnly; SameSite=Strict"+
    (remember ? "; Max-Age="+PERSISTENT_SECONDS : "");
}
export function clearModeratorCookie() {
  return COOKIE+"=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0";
}
export async function issueModeratorSession(env, remember=false, nonce=null) {
  if(!env.RMP_SECRET_KEY || !env.RMP_ADMIN_TOKEN) throw Error("Moderator authentication is not configured");
  const created=Math.floor(Date.now()/1000);
  const expires=created+(remember?PERSISTENT_SECONDS:TEMPORARY_SECONDS);
  const random=nonce || toHex(crypto.getRandomValues(new Uint8Array(32)));
  const payload=[VERSION,created,expires,remember?"1":"0",random].join(".");
  return cookie(payload+"."+await sign(payload,env), remember);
}
export async function validateModeratorSession(request, env) {
  if(!env.RMP_SECRET_KEY || !env.RMP_ADMIN_TOKEN) return null;
  const raw=cookieValue(request);
  if(raw.length>256) return null;
  const match=/^v1\.(\d{10})\.(\d{10})\.([01])\.([a-f0-9]{64})\.([a-f0-9]{64})$/.exec(raw);
  if(!match) return null;
  const issued=Number(match[1]),until=Number(match[2]),persistent=match[3]==="1";
  const now=Math.floor(Date.now()/1000), lifetime=persistent?PERSISTENT_SECONDS:TEMPORARY_SECONDS;
  if(issued>now+60 || until<=now || until-issued!==lifetime) return null;
  const payload=raw.slice(0,raw.lastIndexOf("."));
  const expected=await sign(payload,env);
  if(!equalFixedLength(match[5],expected))return null;
  return {remember:persistent};
}
export function validModeratorKey(request,env) {
  const actual=request.headers.get("X-Admin-Token")||"";
  return !!env.RMP_ADMIN_TOKEN && !!actual && equalFixedLength(actual,env.RMP_ADMIN_TOKEN);
}
