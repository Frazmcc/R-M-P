"use strict";
document.documentElement.classList.add("js");
const API = String(window.RMP_API_BASE || "").replace(/\/+$/, "");
const PAGES = new Set(["home", "top", "bottom", "featured", "new", "upload", "how", "guidelines", "about", "admin"]);
const state = {items: [], index: 0, page: "home", adminImages: []};
const $ = s => document.querySelector(s);
const menuToggle = $("#mobile-menu-toggle");
const primaryNav = document.querySelector(".nav");
function setMobileMenu(open) {
  primaryNav.classList.toggle("is-open", open);
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  menuToggle.querySelector(".menu-symbol").textContent = open ? "✕" : "☰";
}
menuToggle.addEventListener("click", () => setMobileMenu(menuToggle.getAttribute("aria-expanded") !== "true"));
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && menuToggle.getAttribute("aria-expanded") === "true") {
    setMobileMenu(false);
    menuToggle.focus();
  }
});
window.matchMedia("(min-width: 761px)").addEventListener("change", event => {
  if (event.matches) setMobileMenu(false);
});
const escapeHTML = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const url = path => API + path;
function alertMessage(msg, error=false) {
  const el = $("#message"); el.textContent=msg; el.className="message"+(error?" error":""); el.hidden=false;
}
async function request(path, options={}) {
  if (!API) throw Error("The upload server has not been connected yet.");
  let response;
  try { response = await fetch(url(path), { credentials:"same-origin", ...options }); } catch { throw Error("Unable to reach the upload server. Please try again shortly."); }
  const type = response.headers.get("content-type") || "";
  const result = type.includes("application/json") ? await response.json() : null;
  if (!response.ok) throw Error(typeof result?.detail==="string" ? result.detail : "Request failed ("+response.status+")");
  return result;
}
function voterId() {
  let id;
  try {
    id = localStorage.getItem("rmp-anonymous-visitor");
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      id = crypto.randomUUID();
      localStorage.setItem("rmp-anonymous-visitor", id);
    }
  } catch { id = crypto.randomUUID(); }
  return id;
}
function photo(item) { return '<div class="photo"><img loading="eager" decoding="async" fetchpriority="high" src="'+escapeHTML(url(item.image))+'" alt="Submission: '+escapeHTML(item.title)+'"></div>'; }
function renderViewer() {
  const node=$("#viewer"), item=state.items[state.index];
  if (!item) {
    node.innerHTML='<p class="notice">No approved photos yet. The gallery will fill up as submissions are reviewed.</p><div class="actions"><button class="btn" data-page="upload">Be the first to submit →</button></div>';
    return;
  }
  node.innerHTML=photo(item)+'<h3 class="viewer-title">'+escapeHTML(item.title)+'</h3><div class="meta">Submitted by '+escapeHTML(item.nickname)+' • '+item.votes+' votes • Average '+Number(item.average).toFixed(1)+'/10</div><div class="voting"><strong>YOUR VERDICT?</strong><div class="vote-buttons" aria-label="Rate from 1 to 10">'+Array.from({length:10},(_,i)=>'<button type="button" data-vote="'+(i+1)+'" aria-label="Score '+(i+1)+' out of 10">'+(i+1)+'</button>').join("")+'</div><div class="actions"><button class="btn" data-next>Next poo →</button><button class="btn secondary" data-report="'+item.id+'">Report photo</button></div></div>';
}
function renderGallery() {
  const node=$("#gallery");
  if (!state.items.length) { node.innerHTML='<p>No approved submissions found yet.</p>'; return; }
  node.innerHTML=state.items.map(x=>'<button class="tile" data-entry="'+x.id+'"><img loading="lazy" decoding="async" src="'+escapeHTML(url(x.image))+'" alt=""><strong>'+escapeHTML(x.title)+'</strong><small>'+escapeHTML(x.nickname)+' • ⭐ '+Number(x.average).toFixed(1)+' ('+x.votes+' votes)</small></button>').join("");
}
async function loadEntries() {
  const sort = ({top:"top",bottom:"bottom",featured:"featured",new:"new"})[state.page] || "new";
  const search = state.page==="new" || ["top","bottom","featured"].includes(state.page) ? $("#search").value.trim() : "";
  const result = await request("/api/items?sort="+sort+"&limit=20&q="+encodeURIComponent(search));
  state.items = result.items; state.index=0; $("#total-count").textContent=result.total;
  if(state.page==="home")renderViewer();else renderGallery();
}
async function go(page) {
  if (!PAGES.has(page))page="home";
  state.page=page;
  $("#message").hidden=true;
  document.querySelectorAll(".page").forEach(x=>x.hidden=x.id!==((page==="top"||page==="bottom"||page==="featured"||page==="new")?"list":page)+"-page");
  document.querySelectorAll("#nav button, .mobile-quick-nav button").forEach(x=>{
    const active = x.dataset.page === page;
    x.classList.toggle("active", active);
    if (active) x.setAttribute("aria-current", "page");
    else x.removeAttribute("aria-current");
  });
  if(["top","bottom","featured","new"].includes(page)) {
    $("#list-title").textContent=({top:"TOP 20",bottom:"BOTTOM 20",featured:"STAFF FAVOURITES",new:"LATEST PHOTOS"})[page];
    $("#search").value="";
  }
  if (page==="home"||["top","bottom","featured","new"].includes(page)) {
    try { await loadEntries(); } catch(e) {
      alertMessage(e.message,true);
      if(page==="home")$("#viewer").textContent=e.message; else $("#gallery").textContent=e.message;
    }
  }
  if(page==="admin"){
    clearPreviews();
    await checkModeratorSession();
  }
  if(page==="upload")$("#upload-submit").disabled=!API;
}
function clearPreviews(){
  for(const blobUrl of state.adminImages) URL.revokeObjectURL(blobUrl);
  state.adminImages=[];
}

function setModeratorView(active) {
  $("#admin-login").hidden=active;
  $("#admin-logged-in").hidden=!active;
  $("#admin-session-status").textContent=active?"Moderator session active on this browser.":"Sign in to access private submissions.";
  if(!active){
    clearPreviews();
    $("#admin-token").value="";
    for(const sel of ["#pending-list","#published-list","#report-list"])$(sel).replaceChildren();
  }
}
async function checkModeratorSession() {
  $("#admin-session-status").textContent="Checking this browser's moderator session…";
  try {
    const session=await request("/api/admin/session");
    setModeratorView(session.authenticated===true);
    if(session.authenticated===true)await loadModeration();
  } catch {
    setModeratorView(false);
    $("#admin-session-status").textContent="Cannot verify your session. Please try signing in.";
  }
}
async function signInModerator(event) {
  event.preventDefault();
  const input=$("#admin-token");
  const token=input.value;
  if(!token){alertMessage("Enter your moderator key.",true);return;}
  const button=$("#load-pending");
  button.disabled=true;
  try {
    await request("/api/admin/session",{
      method:"POST",
      headers:{"Content-Type":"application/json","X-Admin-Token":token},
      body:JSON.stringify({remember:$("#remember-browser").checked})
    });
    input.value=""; // Secret cleared from JavaScript-accessible form immediately.
    $("#message").hidden=true;
    setModeratorView(true);
    await loadModeration();
  } catch(error) {
    alertMessage(error.message,true);
  } finally {
    button.disabled=false;
  }
}
async function signOutModerator() {
  const button=$("#admin-signout");
  button.disabled=true;
  try {
    await request("/api/admin/logout",{method:"POST"});
    setModeratorView(false);
    $("#message").hidden=true;
  } catch(error) {
    alertMessage(error.message,true);
  } finally { button.disabled=false; }
}
$("#admin-login-form").addEventListener("submit",signInModerator);
$("#admin-signout").addEventListener("click",signOutModerator);

async function loadModeration(){
  if($("#admin-logged-in").hidden)return;
  clearPreviews();$("#pending-list").textContent="Loading submissions…";
  try {
    const [entries,reports,published]=await Promise.all([
      request("/api/admin/pending"),
      request("/api/admin/reports"),
      request("/api/admin/approved")
    ]);
    const list=$("#pending-list");list.textContent="";
    if(!entries.length)list.textContent="Nothing awaiting approval.";
    for(const item of entries){
      const card=document.createElement("div");card.className="mod-card";
      const img=document.createElement("img");img.alt="Pending photo "+item.id;
      try {
        const r=await fetch(url("/api/admin/image/"+item.id),{credentials:"same-origin"});
        if(r.ok){const blobUrl=URL.createObjectURL(await r.blob());state.adminImages.push(blobUrl);img.src=blobUrl;}
      }catch{ /* Image preview unavailable; moderation remains usable. */ }
      const title=document.createElement("strong");title.textContent=item.title+" — "+item.nickname;
      const approve=document.createElement("button");approve.className="btn";approve.textContent="Approve";approve.dataset.moderate=item.id;approve.dataset.action="approve";
      const reject=document.createElement("button");reject.className="btn secondary";reject.textContent="Reject";reject.dataset.moderate=item.id;reject.dataset.action="reject";
      card.append(img,title,document.createElement("br"),approve,reject);list.append(card);
    }
    const pub=$("#published-list");pub.textContent="";
    if(!published.length)pub.textContent="No published photos yet.";
    for(const item of published){
      const card=document.createElement("div");card.className="mod-card";
      const img=document.createElement("img");img.alt="Published photo "+item.id;img.src=url(item.image);
      const title=document.createElement("strong");title.textContent=item.title+(item.featured?" ⭐":"");
      const fav=document.createElement("button");fav.className="btn";
      fav.textContent=item.featured?"Unfeature":"Staff favourite";
      fav.dataset.moderate=item.id;fav.dataset.action=item.featured?"unfeature":"feature";
      const remove=document.createElement("button");remove.className="btn secondary";
      remove.dataset.moderate=item.id;remove.dataset.action="remove";remove.textContent="Remove";
      card.append(img,title,document.createElement("br"),fav,remove);pub.append(card);
    }
    const reportsNode=$("#report-list");reportsNode.textContent="";
    if(!reports.length)reportsNode.textContent="No reports.";
    for(const item of reports){
      const p=document.createElement("p");p.textContent="Photo #"+item.entry_id+": "+item.reason+" ";
      const remove=document.createElement("button");remove.className="btn secondary";remove.dataset.moderate=item.entry_id;remove.dataset.action="remove";remove.textContent="Remove photo";
      const dismiss=document.createElement("button");dismiss.className="btn secondary";dismiss.dataset.dismissReport=item.id;dismiss.textContent="Dismiss report";p.append(remove,dismiss);reportsNode.append(p);
    }
  }catch(e){
    if(/session expired|credentials|sign in/i.test(e.message))setModeratorView(false);
    alertMessage(e.message,true);
    $("#pending-list").textContent="Unable to load moderation queue.";
  }
}
document.addEventListener("click", async e=>{
  const nav=e.target.closest("[data-page]");
  if(nav){
    e.preventDefault();
    setMobileMenu(false);
    go(nav.dataset.page);
    window.scrollTo(0, 0);
    return;
  }
  if(e.target.closest("[data-next]")){if(state.items.length){state.index=(state.index+1)%state.items.length;renderViewer();}return;}
  const entry=e.target.closest("[data-entry]");
  if(entry){const selected=state.items.find(x=>x.id===Number(entry.dataset.entry));if(selected){await go("home");state.items=[selected,...state.items.filter(x=>x.id!==selected.id)];state.index=0;renderViewer();}return;}
  const vote=e.target.closest("[data-vote]");
  if(vote){
    const item=state.items[state.index];if(!item)return;
    document.querySelectorAll("[data-vote]").forEach(b=>b.disabled=true);
    const form=new FormData();form.set("score",vote.dataset.vote);
    try{await request("/api/vote/"+item.id,{method:"POST",headers:{"X-Voter-ID":voterId()},body:form});alertMessage("Thanks! Your rating has been saved.");await loadEntries();}
    catch(err){alertMessage(err.message,true);}return;
  }
  const report=e.target.closest("[data-report]");
  if(report){
    const reason=window.prompt("Why should a moderator review this photo? (5–200 characters)");
    if(reason===null)return;
    const form=new FormData();form.set("reason",reason);
    try{await request("/api/report/"+report.dataset.report,{method:"POST",headers:{"X-Voter-ID":voterId()},body:form});alertMessage("Report sent for review.");}
    catch(err){alertMessage(err.message,true);}return;
  }
  const dismiss=e.target.closest("[data-dismiss-report]");
  if(dismiss){
    try{await request("/api/admin/reports/"+dismiss.dataset.dismissReport+"/dismiss",{method:"POST"});alertMessage("Report dismissed.");await loadModeration();}
    catch(err){alertMessage(err.message,true);}
    return;
  }
  const mod=e.target.closest("[data-moderate]");
  if(mod){
    if(mod.dataset.action==="remove" && !confirm("Remove this published photo?"))return;
    try{await request("/api/admin/"+mod.dataset.moderate+"/"+mod.dataset.action,{method:"POST"});alertMessage("Moderation action completed.");await loadModeration();}
    catch(err){alertMessage(err.message,true);}
  }
});
$("#upload-form").addEventListener("submit",async event=>{
  event.preventDefault();
  // DOM event.currentTarget becomes null after the first await in browsers.
  const form = event.currentTarget;
  const button=$("#upload-submit"), status=$("#upload-status");
  if(!API){status.textContent="The upload server is not connected.";return;}
  const file=$("#photo").files[0];
  if(!file || file.size>6*1024*1024){status.textContent="Choose an image smaller than 6 MB.";return;}
  button.disabled=true;status.textContent="Uploading securely…";
  try{
    const result=await request("/api/upload",{method:"POST",body:new FormData(form)});
    status.textContent=result.message+" Reference #"+result.id;
    form.reset();
  }catch(err){status.textContent=err.message;}
  finally{button.disabled=false;}
});
$("#search").addEventListener("input",()=>{if(["new","top","bottom","featured"].includes(state.page))loadEntries().catch(e=>alertMessage(e.message,true));});
// Translate old #section bookmarks once, then keep the public address bar
// pinned to the canonical homepage. Navigation thereafter is in-memory.
const initialPage=location.hash.slice(1);
if(location.pathname!=="/" || location.search || location.hash){
  history.replaceState(null,"","/");
}
window.addEventListener("hashchange",()=>{
  const oldPage=location.hash.slice(1);
  history.replaceState(null,"","/");
  if(PAGES.has(oldPage))go(oldPage);
});
$("#api-status").textContent=API?"Checking the submission server…":"Upload backend not yet configured.";
if(API)request("/api/health").then(()=>$("#api-status").textContent="Submission server is connected.").catch(()=>$("#api-status").textContent="Submission server currently unavailable.");
go(PAGES.has(initialPage)?initialPage:"home");
