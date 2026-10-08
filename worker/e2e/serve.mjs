// Local browser-test server: never connects to production Neon or Cloudflare.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";

const root = resolve("public");
const types = {".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".xml":"application/xml; charset=utf-8",".txt":"text/plain; charset=utf-8"};
const fixture = {id:1,title:"The Mobile Test Poo",nickname:"Test Visitor",created:1,featured:false,votes:12,average:8.5,image:"/api/images/1"};
const json = (res,data,status=200)=>{res.writeHead(status,{"Content-Type":"application/json"});res.end(JSON.stringify(data));};
const server = http.createServer(async (req,res)=>{
  const uri = new URL(req.url, "http://127.0.0.1:4173");
  const path = uri.pathname;
  if(path==="/api/health"){json(res,{status:"ok"});return;}
  if(path==="/api/items"){json(res,{items:[fixture],total:1});return;}
  if(path==="/api/images/1"){
    res.writeHead(200,{"Content-Type":"image/svg+xml"});
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="#dd9c64"/></svg>');
    return;
  }
  if(path==="/api/upload" && req.method==="POST"){json(res,{id:2,message:"Photo received. It will appear after moderator approval."},202);return;}
  if(path==="/api/vote/1" && req.method==="POST"){json(res,{message:"Vote saved"});return;}
  // Local-only session simulation for browser UX tests. It deliberately does
  // not issue production auth cookies or accept the actual Cloudflare admin key.
  const loggedIn=(req.headers.cookie||"").includes("rmp_browser_test_session=1");
  if(path==="/api/admin/session" && req.method==="GET"){
    json(res,{authenticated:loggedIn,remember:loggedIn});return;
  }
  if(path==="/api/admin/session" && req.method==="POST"){
    if(req.headers["x-admin-token"]!=="test-e2e-moderator-key"){
      json(res,{detail:"Moderator credentials incorrect"},403);return;
    }
    let body="";for await(const chunk of req)body+=chunk;
    const remember=JSON.parse(body||"{}").remember===true;
    res.setHeader("Set-Cookie","rmp_browser_test_session=1; Path=/; HttpOnly; SameSite=Strict"+(remember?"; Max-Age=2592000":""));
    json(res,{authenticated:true,remember:true});return;
  }
  if(path==="/api/admin/logout" && req.method==="POST"){
    res.setHeader("Set-Cookie","rmp_browser_test_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
    json(res,{authenticated:false});return;
  }
  if(path==="/api/admin/pending"||path==="/api/admin/reports"||path==="/api/admin/approved"){
    if(!loggedIn){json(res,{detail:"Moderator session expired. Please sign in again."},401);return;}
    json(res,[]);return;
  }
  if(path.startsWith("/api/")){json(res,{detail:"Not available in browser-test fixture"},404);return;}
  const localPath = resolve(root, "." + (path.endsWith("/") ? path+"index.html" : path));
  if(localPath!==root && !localPath.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  try{
    const data = await readFile(localPath);
    res.writeHead(200,{"Content-Type":types[extname(localPath)]||"application/octet-stream"});
    res.end(data);
  }catch{res.writeHead(404);res.end("Not found");}
});
server.listen(4173,"127.0.0.1",()=>console.log("Mobile browser-test server on 4173"));
