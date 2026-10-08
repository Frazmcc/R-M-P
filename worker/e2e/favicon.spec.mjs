import { test, expect } from "@playwright/test";

test("homepage uses the branded vector favicon with a PNG fallback",async({page})=>{
  await page.goto("/");
  const icons=page.locator('head link[rel="icon"]');
  await expect(icons).toHaveCount(2);
  await expect(page.locator('head link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute("href","/favicon.svg?v=1");
  await expect(page.locator('head link[rel="icon"][type="image/png"]')).toHaveAttribute("href","/favicon-32.png?v=1");
  for(const [path,contentType] of [
    ["/favicon.svg?v=1","image/svg+xml"],
    ["/favicon-32.png?v=1","image/png"]
  ]){
    const response=await page.request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain(contentType);
    expect((await response.body()).length).toBeGreaterThan(500);
  }
  const image=await page.evaluate(async()=>{
    const img=new Image();
    img.src="/favicon-32.png?v=1";
    await img.decode();
    return {width:img.naturalWidth,height:img.naturalHeight};
  });
  expect(image).toEqual({width:32,height:32});
  expect(new URL(page.url()).pathname).toBe("/");
});
