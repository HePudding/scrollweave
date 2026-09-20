import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
const origin = process.env.SCROLLWEAVE_URL ?? "http://127.0.0.1:4100";
const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.SW_BROWSER_PATH ??
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
  }),
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
await fs.mkdir("docs/screenshots", { recursive: true });
const state = async () => fetch(origin + "/api/state").then((r) => r.json());
const action = async (name: string, args: unknown = {}) => {
  const r = await fetch(origin + "/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, args }),
  });
  const result: any = await r.json();
  if (!r.ok) throw Error(JSON.stringify(result));
  return result;
};
try {
  await page.goto(origin + "/editor");
  await page.waitForSelector(".canvas-host .sw-design");
  await page.getByLabel("播放头秒数").fill("2");
  await page.getByLabel("播放头秒数").press("Enter");
  const s: any = await state();
  if (
    !s.project.compositions.main.elements.some(
      (e: any) => e.id === "hero_title",
    )
  )
    throw Error("请先在空作品运行 npm run example");
  await action("set_selection", {
    compositionId: "main",
    elementIds: ["hero_title"],
  });
  await page.getByLabel("文字内容").fill("FROM ASSETS.\nTO STORIES.");
  await page.getByLabel("文字内容").press("Tab");
  await page.waitForFunction(async () => {
    const s = await (await fetch("/api/state")).json();
    return (
      s.project.compositions.main.elements.find(
        (e: any) => e.id === "hero_title",
      )?.text === "FROM ASSETS.\nTO STORIES."
    );
  });
  await page.getByTestId("clip-hero_title").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "docs/screenshots/editor-v2.png",
    fullPage: true,
  });
  await page.getByLabel("播放头秒数").fill("7");
  await page.getByLabel("播放头秒数").press("Enter");
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForFunction(
    () =>
      Number(
        (
          document.querySelector(
            '[aria-label="播放头秒数"]',
          ) as HTMLInputElement
        ).value,
      ) > 7.3,
  );
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.getByRole("button", { name: "滚动预览", exact: true }).click();
  const frame = await (await page
    .locator("iframe")
    .elementHandle())!.contentFrame();
  await frame!.waitForFunction(() => window.__SW_READY__);
  for (const t of [6, 11, 7.5]) {
    await frame!.evaluate(
      (t) => window.ScrollWeave.seek(t, "gallery", true),
      t,
    );
    await page.waitForTimeout(120);
  }
  await page.screenshot({
    path: "docs/screenshots/example-gallery.png",
    fullPage: true,
  });
  const before: any = await state();
  await action("save_project", {
    expectedRevision: before.revision,
    filename: "signal-and-motion",
  });
  const output = await action("export_html", {
    expectedRevision: before.revision,
    filename: "signal-and-motion",
  });
  const info = await action("workspace_info");
  await fs.copyFile(
    info.directory + "/exports/signal-and-motion.scrollweave.zip",
    "examples/signal-and-motion/signal-and-motion.scrollweave.zip",
  );
  await fs.copyFile(
    output.path,
    "examples/signal-and-motion/signal-and-motion.html.zip",
  );
  await page.getByRole("button", { name: "剪辑预览", exact: true }).click();
  await page.getByLabel("播放头秒数").fill("2");
  await page.getByLabel("播放头秒数").press("Enter");
  await action("set_preview", {
    compositionId: "main",
    progress: 2,
    sectionId: "intro",
  });
  await action("save_project", {
    expectedRevision: ((await state()) as any).revision,
    filename: "signal-and-motion",
  });
  const client = new Client({
    name: "scrollweave-visual-verification",
    version: "2",
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(origin + "/mcp")),
  );
  const screenshot: any = await client.callTool({
    name: "get_preview_screenshot",
    arguments: { compositionId: "main", progress: 2 },
  });
  if (screenshot.isError) throw Error(JSON.stringify(screenshot));
  await fs.writeFile(
    "docs/screenshots/example-hero.png",
    Buffer.from(
      screenshot.content.find((c: any) => c.type === "image").data,
      "base64",
    ),
  );
  await client.close();
  const result = {
    errors,
    manualAfterMCP:
      "通过真实浏览器修改标题文字，保存、播放、滚动正向/反向定位并导出",
    workspace: info.directory,
    revision: ((await state()) as any).revision,
  };
  await fs.writeFile(
    "docs/example-browser-verification.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) throw Error(errors.join("\n"));
} finally {
  await browser.close();
}
