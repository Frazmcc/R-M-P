import { neon } from "@neondatabase/serverless";
import { sameOriginPost, issueModeratorSession, validateModeratorSession, validModeratorKey, clearModeratorCookie } from "./moderator-session.mjs";

const MAX_ORIGINAL = 6 * 1024 * 1024;
const MAX_WEBP = 750 * 1024;
const MAX_STORED_BYTES = 600_000_000;
const MAX_ITEM = 20;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let result = "";
  for (let i = 0; i < bytes.length; i++) result += bytes[i].toString(16).padStart(2, "0");
  return result;
}
export function fromHex(value) {
  if (typeof value !== "string" || value.length % 2) throw Error("Invalid image response");
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
export async function hash(secret, identifier) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(identifier)));
}
export function isWebp(bytes) {
  const a = new Uint8Array(bytes);
  return a.length >= 16 &&
    String.fromCharCode(...a.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...a.slice(8, 12)) === "WEBP";
}
export function allowedOrigin(origin, env) {
  const defaults = "https://frazmcc.github.io,https://rate-my-poo.com,https://www.rate-my-poo.com";
  return (env.RMP_ALLOWED_ORIGINS || defaults).split(",").map(s => s.trim()).includes(origin);
}
function reply(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}
function failure(status, detail) { return reply({ detail }, status); }
function validText(s, min, max) {
  return typeof s === "string" && s.trim().length >= min &&
    s.trim().length <= max && !/[\u0000-\u001f\u007f<>]/.test(s);
}
function visitor(request) {
  const id = request.headers.get("X-Voter-ID") || "";
  if (!UUID.test(id)) throw Object.assign(new Error("A valid anonymous visitor ID is required"), { status: 400 });
  return id.toLowerCase();
}
function item(row) {
  return { id: Number(row.id), title: row.title, nickname: row.nickname, created: Number(row.created),
    featured: row.featured, votes: Number(row.votes || 0), average: Number(Number(row.average || 0).toFixed(1)),
    image: "/api/images/" + row.id };
}
function numberId(path, pattern) {
  const match = pattern.exec(path);
  if (!match) return null;
  const id = Number(match[1]);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return id;
}
async function list(sql, requestUrl, admin = false) {
  const u = new URL(requestUrl), sort = u.searchParams.get("sort") || "new";
  if (!["new", "top", "bottom", "featured"].includes(sort)) return failure(400, "Invalid gallery options");
  const limit = Number(u.searchParams.get("limit") || MAX_ITEM);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return failure(400, "Invalid limit");
  const search = (u.searchParams.get("q") || "").slice(0, 80).trim();
  const orders = {
    new: "e.created DESC",
    top: "AVG(v.score) DESC NULLS LAST, COUNT(v.id) DESC, e.created DESC",
    bottom: "AVG(v.score) ASC NULLS LAST, e.created DESC",
    featured: "e.created DESC",
  };
  const rows = await sql.query(
    `SELECT e.id,e.title,e.nickname,e.created,e.featured,COUNT(v.id)::int AS votes,AVG(v.score)::float AS average
    FROM entries e LEFT JOIN votes v ON e.id=v.entry_id
    WHERE e.status='approved' AND ($1::text='' OR e.title ILIKE '%' || $1 || '%')
    AND ($2::bool=false OR e.featured=true)
    GROUP BY e.id ORDER BY ${orders[sort]} LIMIT $3`,
    [search, sort === "featured", limit]
  );
  const [total] = await sql`SELECT COUNT(*)::int AS total FROM entries WHERE status='approved'`;
  return reply({ items: rows.map(item), total: Number(total.total) });
}
function imageResponse(data, privateImage) {
  const bytes = fromHex(data);
  return new Response(bytes, { status: 200, headers: {
    "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff",
    "Cache-Control": privateImage ? "private, no-store" : "public, max-age=300"
  } });
}
async function processPhoto(file, env) {
  if (!(file instanceof File) || !TYPES.has(file.type) || file.size === 0)
    throw Object.assign(new Error("Choose a JPEG, PNG or WebP under 6 MB"), {status: 400});
  if (file.size > MAX_ORIGINAL)
    throw Object.assign(new Error("Image must be under 6 MB"), {status: 413});
  if (!env.IMAGES) throw Object.assign(new Error("Server image converter is not configured"), {status:503});
  // Source image is streamed to the Images transformation service; it is NEVER uploaded to permanent storage.
  const conversion = await env.IMAGES.input(file.stream())
    .transform({ width: 1400, height: 1400, fit: "scale-down" })
    .output({ format: "image/webp", quality: 76, anim: false });
  const response = conversion.response();
  if (!response.ok) throw Object.assign(new Error("Image conversion failed"), {status: 400});
  const output = new Uint8Array(await response.arrayBuffer());
  if (!isWebp(output)) throw Object.assign(new Error("Invalid converted image"), {status: 400});
  if (output.length > MAX_WEBP) throw Object.assign(new Error("Image remains too large after conversion; try a smaller photo"), {status:413});
  return output;
}
export async function handle(request, env, makeSql = neon) {
  if (!env.DATABASE_URL || !env.RMP_SECRET_KEY) return failure(503, "API database configuration is incomplete");
  const sql = makeSql(env.DATABASE_URL);
  const url = new URL(request.url), path = url.pathname;
  if (request.method === "GET" && path === "/api/health") {
    await sql`SELECT 1`;
    return reply({status:"ok"});
  }
  if (request.method === "GET" && path === "/api/items") return list(sql, request.url);
  if (request.method === "GET" && /^\/api\/images\/\d+$/.test(path)) {
    const id = numberId(path, /^\/api\/images\/(\d+)$/);
    const rows = await sql`SELECT encode(image,'hex') AS data FROM entries WHERE id=${id} AND status='approved' AND image IS NOT NULL`;
    return rows.length ? imageResponse(rows[0].data, false) : failure(404, "Photo not available");
  }
  if (request.method === "POST" && path === "/api/upload") {
    const size = Number(request.headers.get("content-length") || 0);
    if (size > MAX_ORIGINAL + 100000) return failure(413, "Image must be under 6 MB");
    if (!(request.headers.get("content-type") || "").startsWith("multipart/form-data")) return failure(415, "Expected multipart upload");
    const form = await request.formData();
    if (form.get("website")) return failure(400, "Invalid submission");
    if (form.get("agree") !== "true") return failure(400, "Confirm ownership, age and publishing consent");
    const title = form.get("title"), nickname = form.get("nickname") || "Anonymous";
    if (!validText(title, 3, 90) || !validText(nickname, 1, 35)) return failure(400, "Invalid title or nickname");
    // Reject repeat uploads before the image is converted.
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const ipHash = await hash(env.RMP_SECRET_KEY, "ip:" + ip);
    const now = Math.floor(Date.now()/1000);
    const [recent] = await sql`SELECT COUNT(*)::int AS count FROM entries WHERE ip_hash=${ipHash} AND created > ${now - 86400}`;
    if (Number(recent.count) >= 5) return failure(429, "Daily submission limit reached");
    const webp = await processPhoto(form.get("photo"), env);
    // Original JPG/PNG/WebP file was used only to produce this transient WebP array.
    const checksum = toHex(await crypto.subtle.digest("SHA-256", webp));
    const [duplicate] = await sql`SELECT id FROM entries WHERE image_sha=${checksum} AND status!='rejected' LIMIT 1`;
    if (duplicate) return failure(409, "This photo has already been submitted");
    const [used] = await sql`SELECT COALESCE(SUM(octet_length(image)),0)::bigint AS bytes FROM entries`;
    if (Number(used.bytes) + webp.length > MAX_STORED_BYTES) return failure(507, "Photo storage is full; submissions are temporarily closed");
    // Only the converted WebP is inserted into Neon. No original-format column, file or object is created.
    const bytesHex = toHex(webp);
    const rows = await sql`INSERT INTO entries(title,nickname,created,status,featured,image,image_sha,ip_hash)
      VALUES(${title.trim()},${nickname.trim()},${now},'pending',false,decode(${bytesHex},'hex'),${checksum},${ipHash})
      RETURNING id`;
    return reply({id:Number(rows[0].id), message:"Photo received. It will appear after moderator approval."},202);
  }
  const voteId = numberId(path, /^\/api\/vote\/(\d+)$/);
  if (request.method === "POST" && voteId) {
    const form = await request.formData(), score=Number(form.get("score"));
    if (!Number.isInteger(score) || score<1 || score>10) return failure(400,"Vote must be between 1 and 10");
    const id = await hash(env.RMP_SECRET_KEY, "voter:" + visitor(request));
    const approved=await sql`SELECT 1 FROM entries WHERE id=${voteId} AND status='approved'`;
    if (!approved.length) return failure(404,"Photo not available");
    const result=await sql`INSERT INTO votes(entry_id,voter_hash,score) VALUES(${voteId},${id},${score}) ON CONFLICT DO NOTHING RETURNING id`;
    return result.length?reply({message:"Vote saved"}):failure(409,"You have already rated this photo");
  }
  const reportId = numberId(path, /^\/api\/report\/(\d+)$/);
  if (request.method === "POST" && reportId) {
    const form=await request.formData(), reason=form.get("reason");
    if (!validText(reason,5,200))return failure(400,"Please provide a reason (5–200 characters)");
    const id=await hash(env.RMP_SECRET_KEY,"report:"+visitor(request));
    const rows=await sql`INSERT INTO reports(entry_id,reporter_hash,reason,created)
      SELECT id,${id},${reason.trim()},${Math.floor(Date.now()/1000)} FROM entries
      WHERE id=${reportId} AND status='approved'
      ON CONFLICT DO NOTHING RETURNING id`;
    return rows.length?reply({message:"Report received for moderator review"},202):failure(409,"Photo unavailable or already reported");
  }

  // Moderation cookies are accepted only over HTTPS, and any privileged
  // state-changing request must have the exact same Origin as the destination.
  if (path === "/api/admin/session") {
    if (request.method === "GET") {
      const session=await validateModeratorSession(request,env);
      if(!session) return reply({authenticated:false});
      return reply({authenticated:true,remember:session.remember},200,{
        "Set-Cookie":await issueModeratorSession(env,session.remember)
      });
    }
    if (request.method === "POST") {
      if(!sameOriginPost(request)) return failure(403,"Cross-origin moderator login blocked");
      if(!validModeratorKey(request,env)) return failure(403,"Moderator credentials incorrect");
      if(!(request.headers.get("Content-Type")||"").startsWith("application/json"))return failure(415,"Expected JSON");
      const options=await request.json().catch(()=>null);
      if(!options || typeof options.remember!=="boolean")return failure(400,"Invalid session options");
      return reply({authenticated:true,remember:options.remember},200,{
        "Set-Cookie":await issueModeratorSession(env,options.remember)
      });
    }
    return failure(405,"Method not allowed");
  }
  if (path === "/api/admin/logout") {
    if(request.method!=="POST")return failure(405,"Method not allowed");
    if(!sameOriginPost(request))return failure(403,"Cross-origin moderator logout blocked");
    return reply({authenticated:false},200,{"Set-Cookie":clearModeratorCookie()});
  }
  if (path.startsWith("/api/admin/")) {
    if(request.method==="POST" && !sameOriginPost(request))return failure(403,"Cross-origin moderator request blocked");
    if(!await validateModeratorSession(request,env))return failure(401,"Moderator session expired. Please sign in again.");
    if (request.method === "GET" && path === "/api/admin/pending") {
      const rows=await sql`SELECT id,title,nickname,created FROM entries WHERE status='pending' ORDER BY created ASC LIMIT 100`;
      return reply(rows);
    }
    if (request.method === "GET" && path === "/api/admin/approved") {
      const rows=await sql`SELECT e.id,e.title,e.nickname,e.created,e.featured,COUNT(v.id)::int AS votes,AVG(v.score)::float AS average
        FROM entries e LEFT JOIN votes v ON e.id=v.entry_id WHERE e.status='approved'
        GROUP BY e.id ORDER BY e.created DESC LIMIT 100`;
      return reply(rows.map(item));
    }
    if(request.method==="GET" && path==="/api/admin/reports"){
      const rows=await sql`SELECT id,entry_id,reason,created FROM reports ORDER BY created DESC LIMIT 100`;
      return reply(rows);
    }
    const adminImage = numberId(path, /^\/api\/admin\/image\/(\d+)$/);
    if(request.method==="GET" && adminImage){
      const rows=await sql`SELECT encode(image,'hex') AS data FROM entries WHERE id=${adminImage} AND image IS NOT NULL`;
      return rows.length?imageResponse(rows[0].data,true):failure(404,"Photo not available");
    }
    const dismissal = numberId(path,/^\/api\/admin\/reports\/(\d+)\/dismiss$/);
    if(request.method==="POST" && dismissal){
      const rows=await sql`DELETE FROM reports WHERE id=${dismissal} RETURNING id`;
      return rows.length?reply({message:"Report dismissed"}):failure(404,"Report not found");
    }
    const match=/^\/api\/admin\/(\d+)\/(approve|reject|remove|feature|unfeature)$/.exec(path);
    if(request.method==="POST" && match){
      const eid=Number(match[1]), action=match[2];
      let result;
      if(action==="approve") result=await sql`UPDATE entries SET status='approved' WHERE id=${eid} AND status='pending' RETURNING id`;
      else if(action==="reject") result=await sql`UPDATE entries SET status='rejected',image=NULL,featured=false WHERE id=${eid} AND status='pending' RETURNING id`;
      else if(action==="remove") result=await sql`UPDATE entries SET status='rejected',image=NULL,featured=false WHERE id=${eid} AND status='approved' RETURNING id`;
      else result=await sql`UPDATE entries SET featured=${action==="feature"} WHERE id=${eid} AND status='approved' RETURNING id`;
      if(!result.length)return failure(409,"Action not permitted for this entry");
      if(action==="remove"||action==="reject")await sql`DELETE FROM reports WHERE entry_id=${eid}`;
      return reply({message:action+" complete"});
    }
  }
  return failure(404,"Route not found");
}
// Keep the visible site on one public homepage. The API and static asset
// URLs remain internal resources; they must never be redirected to HTML.
export async function publicNavigation(request, env) {
  if(request.method!=="GET" && request.method!=="HEAD")return null;
  const target=new URL(request.url);
  const oldEditorial=/^\/(?:how-it-works|community-guidelines)(?:\/.*)?$/.test(target.pathname);
  const isHomepage=target.pathname==="/";
  if(!isHomepage && !oldEditorial)return null;
  const www="https://www.rate-my-poo.com/";
  if(oldEditorial || target.hostname!=="www.rate-my-poo.com" || target.protocol!=="https:" || target.search) {
    return Response.redirect(www,301);
  }
  // The root homepage uses the static edge asset. The Worker is only invoked
  // so the bare domain, old URLs and stale query strings can be canonicalized.
  return env.ASSETS.fetch(request);
}
export default {
  async fetch(request, env) {
    const canonical=await publicNavigation(request,env);
    if(canonical)return canonical;
    const origin = request.headers.get("Origin");
    const cors = allowedOrigin(origin,env)?{
      "Access-Control-Allow-Origin":origin,
      "Access-Control-Allow-Headers":"Content-Type,X-Voter-ID,X-Admin-Token",
      "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
      "Access-Control-Max-Age":"7200", "Vary":"Origin"
    }:{"Vary":"Origin"};
    if (request.method === "OPTIONS") return new Response(null,{status:204,headers:cors});
    let result;
    try {
      result = await handle(request,env);
    } catch(err) {
      // Never reveal privileged SQL, secrets or stack traces to visitors.
      const status=err.status||500;
      if(status>=500)console.error("RMP edge API error:",err?.message||"unknown");
      result = failure(status,status>=500?"Service is temporarily unavailable":err.message);
    }
    // Error responses need the same allowlisted CORS headers as successful ones.
    for(const [k,v] of Object.entries(cors))result.headers.set(k,v);
    return result;
  }
};
