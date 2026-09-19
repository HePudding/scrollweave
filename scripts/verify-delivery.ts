import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import express from "express";
import { unzipSync } from "fflate";
import { chromium } from "playwright";
import { EditorService } from "../server/service";
import assert from "node:assert/strict";
const directory = await fs.mkdtemp(
  path.join(os.tmpdir(), "scrollweave-final-"),
);
async function extract(bytes: Uint8Array, dest: string) {
  const files = unzipSync(bytes);
  for (const [name, data] of Object.entries(files)) {
    const target = path.resolve(dest, name);
    if (!target.startsWith(path.resolve(dest) + path.sep))
      throw Error("不安全的包路径");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }
}
const projectDir = path.join(directory, "editable");
await extract(
  await fs.readFile(
    "examples/signal-and-motion/signal-and-motion.scrollweave.zip",
  ),
  projectDir,
);
let service = await EditorService.open(projectDir, 4108);
try {
  assert.equal(service.store.project.compositions.main.duration, 18);
  assert.equal(
    Object.values(service.store.project.assets).filter(
      (a) => a.status !== "ready",
    ).length,
    0,
  );
  await service.run("set_preview", {
    compositionId: "main",
    progress: 2,
    sectionId: "intro",
  });
  await service.run("set_selection", {
    compositionId: "main",
    elementIds: ["hero_title"],
  });
  await service.run("save_project", {
    expectedRevision: service.store.revision,
    filename: "reopened",
  });
  const before = JSON.stringify(service.store.project);
  await service.close();
  service = await EditorService.open(projectDir, 4108);
  assert.equal(JSON.stringify(service.store.project), before);
  assert.equal(service.store.preview.progress, 2);
  const output = await service.run("export_html", {
    expectedRevision: service.store.revision,
    filename: "reopened",
  });
  const website = path.join(directory, "website");
  await extract(await fs.readFile(output.path), website);
  const app = express();
  app.use(express.static(website));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as any).port;
  const browser = await chromium.launch({
      headless: true,
      executablePath:
        process.env.SW_BROWSER_PATH ??
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
    }),
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } }),
    errors: string[] = [],
    requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (r) => requests.push(r.url()));
  try {
    await page.goto("http://127.0.0.1:" + port + "/index.html");
    for (const time of [6, 11, 7.5]) {
      await page.evaluate(
        (t) => window.ScrollWeave.seek(t, "gallery", true),
        time,
      );
      await page.waitForFunction(
        (t) =>
          [
            ...document.querySelectorAll<HTMLVideoElement>(
              '[data-section-id="gallery"] video',
            ),
          ].every(
            (v) =>
              v.readyState >= 2 &&
              !v.seeking &&
              Math.abs(v.currentTime - (t - 5)) < 0.08,
          ),
        time,
      );
    }
    await page.screenshot({ path: "docs/screenshots/example-independent.png" });
    const runtimeErrors = await page.evaluate(() => window.__SW_ERRORS__);
    assert.deepEqual(errors, []);
    assert.deepEqual(runtimeErrors, []);
    assert.ok(
      requests.every((url) => url.startsWith("http://127.0.0.1:" + port)),
    );
    const report = {
      editableDirectory: projectDir,
      standaloneWebsite: website,
      mainDuration: 18,
      coldMediaCacheRebuilt: true,
      closeAndReopenPreserved: true,
      videoSeeks: [6, 11, 7.5],
      runtimeErrors,
      editorRequests: [],
      requestCount: requests.length,
    };
    await fs.writeFile(
      "docs/delivery-verification.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
} finally {
  await service.close();
}
