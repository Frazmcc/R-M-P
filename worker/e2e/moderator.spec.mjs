import { test,expect } from "@playwright/test";

test("remembered moderator stays signed in after reload without storing the key",async({page,context})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto("/#admin");
  await expect(page.locator("#admin-login")).toBeVisible();
  await expect(page.locator("#admin-logged-in")).toBeHidden();
  await expect(page.locator("#remember-browser")).toBeChecked();
  await page.locator("#admin-token").fill("test-e2e-moderator-key");
  await page.locator("#load-pending").click();
  await expect(page.locator("#admin-logged-in")).toBeVisible();
  await expect(page.locator("#admin-token")).toHaveValue("");
  const storage=await page.evaluate(()=>({
    local:{...localStorage},session:{...sessionStorage},cookie:document.cookie
  }));
  expect(JSON.stringify(storage)).not.toContain("test-e2e-moderator-key");
  expect(storage.cookie).not.toContain("rmp_browser_test_session");
  const cookie=(await context.cookies()).find(c=>c.name==="rmp_browser_test_session");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.expires).toBeGreaterThan(Date.now()/1000);
  await page.reload();
  await expect(page.locator("#admin-logged-in")).toBeVisible();
  await expect(page.locator("#admin-login")).toBeHidden();
  await page.locator("#admin-signout").click();
  await expect(page.locator("#admin-login")).toBeVisible();
  await page.reload();
  await expect(page.locator("#admin-logged-in")).toBeHidden();
  expect((await context.cookies()).some(c=>c.name==="rmp_browser_test_session")).toBe(false);
});

test("wrong moderator key cannot create a session",async({page})=>{
  await page.goto("/#admin");
  await expect(page.locator("#admin-login")).toBeVisible();
  await page.locator("#admin-token").fill("invalid");
  await page.locator("#load-pending").click();
  await expect(page.locator("#message")).toContainText("Moderator credentials incorrect");
  await expect(page.locator("#admin-logged-in")).toBeHidden();
});

test("without remember checkbox the moderator cookie is session-only",async({page,context})=>{
  await page.goto("/#admin");
  await expect(page.locator("#admin-login")).toBeVisible();
  await page.locator("#remember-browser").uncheck();
  await page.locator("#admin-token").fill("test-e2e-moderator-key");
  await page.locator("#load-pending").click();
  await expect(page.locator("#admin-logged-in")).toBeVisible();
  const cookie=(await context.cookies()).find(c=>c.name==="rmp_browser_test_session");
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.expires).toBe(-1);
});
