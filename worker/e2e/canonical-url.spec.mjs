import { test,expect } from "@playwright/test";

const canonical= new URL("http://127.0.0.1:4173/");
function expectRoot(url) {
  const value=new URL(url);
  expect(value.origin).toBe(canonical.origin);
  expect(value.pathname).toBe("/");
  expect(value.search).toBe("");
  expect(value.hash).toBe("");
}

test("main navigation never modifies the browser URL or adds fragments",async({page})=>{
  await page.setViewportSize({width:1280,height:800});
  await page.goto("/");
  for(const section of ["top","bottom","featured","new","upload","how","guidelines","about","home"]){
    await page.locator('#nav button[data-page="'+section+'"]').click();
    await expect(page.locator("#"+(["top","bottom","featured","new"].includes(section)?"list":section)+"-page")).toBeVisible();
    expectRoot(page.url());
  }
  await page.locator('.foot [data-page="admin"]').click();
  await expect(page.locator("#admin-page")).toBeVisible();
  expectRoot(page.url());
  await page.locator(".logo").click();
  await expect(page.locator("#home-page")).toBeVisible();
  expectRoot(page.url());
});
test("mobile navigation and information links stay at the root URL",async({page})=>{
  await page.setViewportSize({width:375,height:812});
  await page.goto("/");
  for(const section of ["top","upload","home"]){
    await page.locator('.mobile-quick-nav [data-page="'+section+'"]').click();
    expectRoot(page.url());
  }
  for(const section of ["how","guidelines","about"]){
    await page.locator("#mobile-menu-toggle").click();
    await page.locator('#nav [data-page="'+section+'"]').click();
    await expect(page.locator("#"+section+"-page")).toBeVisible();
    expectRoot(page.url());
  }
});
test("legacy fragment links still open the requested section but remove URL fragment",async({page})=>{
  for(const section of ["admin","top","upload","how","guidelines"]){
    await page.goto("/#"+section);
    await expect(page.locator("#"+(["top","bottom","featured","new"].includes(section)?"list":section)+"-page")).toBeVisible();
    expectRoot(page.url());
  }
});
test("retired information pages redirect to the homepage URL",async({page})=>{
  for(const path of ["/how-it-works/","/community-guidelines/","/how-it-works","/community-guidelines"]){
    await page.goto(path);
    await expect(page.locator("#home-page")).toBeVisible();
    expectRoot(page.url());
  }
});
test("query strings are cleared on initial load without breaking galleries",async({page})=>{
  await page.goto("/?utm_source=old-newsletter#top");
  await expect(page.locator("#list-page")).toBeVisible();
  expectRoot(page.url());
});
