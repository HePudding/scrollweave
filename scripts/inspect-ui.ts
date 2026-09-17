import { chromium } from "@playwright/test";
import fs from "node:fs";
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
await page.goto("http://127.0.0.1:4100");
await page.waitForTimeout(1500);
await page.getByRole("slider", { name: "播放头进度" }).fill("0.16");
await page.getByText("主标题 · 淡入上移", { exact: true }).first().click();
await page.waitForTimeout(500);
fs.mkdirSync("docs/screenshots", { recursive: true });
await page.screenshot({ path: "docs/screenshots/editor.png", fullPage: true });
console.log(
  JSON.stringify(
    {
      errors,
      title: await page.title(),
      body: (await page.locator("body").innerText()).slice(0, 600),
    },
    null,
    2,
  ),
);
await browser.close();
