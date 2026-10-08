import { test, expect } from "@playwright/test";

const devices = [
  {name:"small Android",width:320,height:700},
  {name:"iPhone SE",width:375,height:812},
  {name:"modern iPhone",width:390,height:844},
  {name:"large phone",width:430,height:932},
  {name:"phone landscape",width:667,height:375},
  {name:"large phone landscape",width:844,height:390}
];

async function noHorizontalOverflow(page,label){
  const x=await page.evaluate(()=>({
    scrollWidth:document.documentElement.scrollWidth,
    viewportWidth:document.documentElement.clientWidth
  }));
  expect(x.scrollWidth, `Horizontal overflow on ${label}: ${JSON.stringify(x)}`).toBeLessThanOrEqual(x.viewportWidth+1);
}

for(const device of devices){
  test(`layout fits ${device.name} at ${device.width}x${device.height}`,async({page})=>{
    await page.setViewportSize({width:device.width,height:device.height});
    await page.goto("/");
    await expect(page.locator("#viewer .vote-buttons button")).toHaveCount(10);
    await noHorizontalOverflow(page,"home");
    if(device.width<=760){
      const toggle=page.getByRole("button",{name:"Open navigation"});
      await expect(toggle).toBeVisible();
      await expect(page.locator(".mobile-quick-nav")).toBeVisible();
      const sizes=await page.locator("#viewer .vote-buttons button").evaluateAll(buttons=>buttons.map(b=>{
        const rect=b.getBoundingClientRect();return {width:rect.width,height:rect.height};
      }));
      for(const size of sizes){expect(size.width).toBeGreaterThanOrEqual(44);expect(size.height).toBeGreaterThanOrEqual(44);}
      await page.locator(".mobile-quick-nav [data-page='upload']").click();
    }else{
      await expect(page.locator(".mobile-quick-nav")).toBeHidden();
      await page.locator("#nav [data-page='upload']").click();
    }
    await expect(page.locator("#upload-page")).toBeVisible();
    await noHorizontalOverflow(page,"upload");
    await expect(page.locator("#upload-submit")).toBeVisible();
    const sizes=await page.locator(".text-field").evaluateAll(inputs=>inputs.map(el=>{
      const box=el.getBoundingClientRect();return {left:box.left,right:box.right,width:box.width};
    }));
    for(const rect of sizes){expect(rect.left).toBeGreaterThanOrEqual(-1);expect(rect.right).toBeLessThanOrEqual(device.width+1);}
    if(device.width<=760){
      await page.locator(".mobile-quick-nav [data-page='top']").click();
    }else{
      await page.locator("#nav [data-page='top']").click();
    }
    await expect(page.locator("#list-page")).toBeVisible();
    await expect(page.locator(".tile img[loading='lazy'][decoding='async']")).toHaveCount(1);
    await noHorizontalOverflow(page,"gallery");
  });
}

test("mobile menu opens, follows the selected page and supports Escape",async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/");
  const toggle=page.locator("#mobile-menu-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded","false");
  await expect(page.locator(".nav")).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded","true");
  await expect(page.locator(".nav")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded","false");
  await expect(toggle).toBeFocused();
  await toggle.click();
  await page.locator("#nav [data-page='featured']").click();
  await expect(page.locator(".nav")).toBeHidden();
  await expect(page.locator("#list-title")).toHaveText("STAFF FAVOURITES");
  await expect(page.locator("#nav [data-page='featured']")).toHaveAttribute("aria-current","page");
});

test("mobile photo submission is touch-friendly and confirms the result",async({page})=>{
  await page.setViewportSize({width:375,height:812});
  await page.goto("/");
  await page.locator(".mobile-quick-nav [data-page='upload']").click();
  await page.locator("#title").fill("A proper test photo");
  await page.locator("#nickname").fill("Test");
  await page.locator("#photo").setInputFiles({
    name:"test.png",mimeType:"image/png",
    buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jgX0AAAAASUVORK5CYII=","base64")
  });
  await page.locator("#agree").check();
  await page.locator("#upload-submit").click();
  await expect(page.locator("#upload-status")).toContainText("Photo received");
  await noHorizontalOverflow(page,"submitted");
});

test("navigation is visible on desktop, without a sticky phone bar",async({page})=>{
  await page.setViewportSize({width:1280,height:800});
  await page.goto("/");
  await expect(page.locator("#mobile-menu-toggle")).toBeHidden();
  await expect(page.locator(".nav")).toBeVisible();
  await expect(page.locator(".mobile-quick-nav")).toBeHidden();
  await expect(page.locator("#viewer img[fetchpriority='high']")).toHaveCount(1);
  await noHorizontalOverflow(page,"desktop");
});

test("all information sections are readable inside the homepage on a narrow screen",async({page})=>{
  await page.setViewportSize({width:320,height:700});
  await page.goto("/");
  for(const section of ["how","guidelines"]){
    await page.locator("#mobile-menu-toggle").click();
    await page.locator('#nav [data-page="'+section+'"]').click();
    await expect(page.locator("#"+section+"-page h1")).toBeVisible();
    await noHorizontalOverflow(page,section);
    expect(new URL(page.url()).pathname).toBe("/");
    expect(new URL(page.url()).hash).toBe("");
  }
});
