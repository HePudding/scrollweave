import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import express from "express";
import { unzipSync } from "fflate";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { blankProject, createElement, type Project } from "../src/core/model";
const origin = "http://127.0.0.1:4101";
const current = async (request: APIRequestContext) =>
  (await request.get("/api/state")).json();
async function call(
  request: APIRequestContext,
  name: string,
  args: Record<string, unknown> = {},
) {
  const r = await request.post("/api/action", { data: { name, args } });
  const value = await r.json();
  expect(r.ok(), JSON.stringify(value)).toBeTruthy();
  return value;
}
async function edit(request: APIRequestContext, commands: unknown[]) {
  return call(request, "edit_project", {
    expectedRevision: (await current(request)).revision,
    commands,
  });
}
async function seek(page: Page, time: number) {
  const input = page.getByLabel("播放头秒数");
  await input.fill(String(time));
  await input.press("Enter");
}
async function upload(request: APIRequestContext, file: string) {
  const r = await request.post("/api/import", {
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(path.basename(file)),
    },
    data: await fs.readFile(file),
  });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).asset;
}
const svg = (color = "#c4f36b") =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><path d="M30 75H104L76 47L88 35L136 83L88 131L76 119L104 91H30Z" fill="' +
  color +
  '"/></svg>';
test.beforeEach(async ({ request }) => {
  await edit(request, [{ type: "project.replace", project: blankProject() }]);
});

test("用户从空作品导入，源预览独立；拖入、重复、移动、裁边、分割和多选", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/editor");
  await page
    .getByTestId("media-import")
    .setInputFiles([
      "tests/fixtures/test-image.png",
      "tests/fixtures/test-motion.mp4",
    ]);
  await expect(page.locator(".asset-card")).toHaveCount(2);
  let s = await current(request);
  expect(s.project.compositions.main.elements).toHaveLength(0);
  const assets = Object.values(s.project.assets) as any[],
    video = assets.find((a) => a.kind === "video"),
    image = assets.find((a) => a.kind === "image");
  expect(video.duration).toBeCloseTo(8, 1);
  expect(video.width).toBe(640);
  expect(video.hasAudio).toBe(true);
  await seek(page, 2);
  await page.getByTestId("asset-" + video.id).click();
  await expect(page.getByRole("dialog", { name: "源素材预览" })).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".source-preview video")
        .evaluate((v: HTMLVideoElement) => v.readyState),
    )
    .toBeGreaterThanOrEqual(2);
  await page
    .locator(".source-preview video")
    .evaluate((v: HTMLVideoElement) => v.play());
  await expect
    .poll(() =>
      page
        .locator(".source-preview video")
        .evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeGreaterThan(0.15);
  s = await current(request);
  expect(s.project.compositions.main.elements).toHaveLength(0);
  expect(s.preview.progress).toBe(2);
  await page.getByLabel("关闭源素材").click();
  await seek(page, 0);
  await page
    .getByTestId("asset-" + video.id)
    .dragTo(page.getByTestId("track-track_main").locator(".track-content"), {
      targetPosition: { x: 1, y: 32 },
    });
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  s = await current(request);
  let clip = s.project.compositions.main.elements[0];
  expect(clip.start).toBe(0);
  expect(clip.end).toBeCloseTo(8, 1);
  await page.getByTitle("添加轨道", { exact: true }).click();
  await expect(page.locator(".track-row")).toHaveCount(2);
  s = await current(request);
  const upper = s.project.compositions.main.tracks[1].id;
  await page
    .getByTestId("asset-" + image.id)
    .dragTo(page.getByTestId("track-" + upper).locator(".track-content"), {
      targetPosition: { x: 144, y: 32 },
    });
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  s = await current(request);
  const still = s.project.compositions.main.elements.find(
    (e: any) => e.assetId === image.id,
  );
  expect(still.start).toBeCloseTo(2, 1);
  const body = page.getByTestId("clip-" + still.id),
    bounds = (await body.boundingBox())!;
  await page.mouse.move(bounds.x + 30, bounds.y + 25);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 102, bounds.y + 25, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await current(request)).project.compositions.main.elements.find(
          (e: any) => e.id === still.id,
        ).start,
    )
    .toBeCloseTo(3, 1);
  const right = page
      .getByTestId("clip-" + still.id)
      .locator(".clip-handle.right"),
    rb = (await right.boundingBox())!;
  await page.mouse.move(rb.x + 3, rb.y + 24);
  await page.mouse.down();
  await page.mouse.move(rb.x - 69, rb.y + 24, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await current(request)).project.compositions.main.elements.find(
          (e: any) => e.id === still.id,
        ).end,
    )
    .toBeCloseTo(7, 1);
  await page.getByTitle("添加轨道", { exact: true }).click();
  await expect(page.locator(".track-row")).toHaveCount(3);
  s = await current(request);
  const highest = s.project.compositions.main.tracks[2].id;
  const cross = (await page.getByTestId("clip-" + still.id).boundingBox())!;
  await page.mouse.move(cross.x + 30, cross.y + 25);
  await page.mouse.down();
  await page.mouse.move(cross.x + 30, cross.y - 39, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await current(request)).project.compositions.main.elements.find(
          (e: any) => e.id === still.id,
        ).trackId,
    )
    .toBe(highest);
  await page.getByTestId("clip-" + clip.id).click();
  await seek(page, 3);
  await page.getByTitle("分割 Ctrl+B").click();
  await expect(page.locator(".timeline-clip")).toHaveCount(3);
  s = await current(request);
  const second = s.project.compositions.main.elements.find(
    (e: any) => e.assetId === video.id && e.start > 0,
  );
  expect(second.sourceIn).toBeCloseTo(3, 3);
  await page.getByTestId("clip-" + still.id).click();
  await page.keyboard.press("Control+c");
  await seek(page, 0);
  await page.locator(".timeline-toolbar strong").click();
  await page.keyboard.press("Control+v");
  await expect(page.locator(".timeline-clip")).toHaveCount(4);
  s = await current(request);
  const copies = s.project.compositions.main.elements.filter(
    (e: any) => e.assetId === image.id,
  );
  expect(copies).toHaveLength(2);
  expect(copies[0].tracks).toEqual(copies[1].tracks);
  await page.getByTestId("clip-" + copies[0].id).click();
  await page
    .getByTestId("clip-" + copies[1].id)
    .click({ modifiers: ["Shift"] });
  await expect(
    page.getByText("2 个片段已选中", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator(".moveable-control-box")).toHaveCount(0);
  await page.keyboard.press("Delete");
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  expect((await current(request)).project.assets[image.id]).toBeTruthy();
  await page.keyboard.press("Control+z");
  await expect(page.locator(".timeline-clip")).toHaveCount(4);
  await page.keyboard.press("Control+Shift+z");
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: "docs/screenshots/editor-clips.png",
    fullPage: true,
  });
});

test("真实 MCP 连接、自动发现 SVG、外部更新、错误恢复、缺失与重新关联", async ({
  page,
  request,
}) => {
  await page.goto("/editor");
  const client = new Client({ name: "scrollweave-acceptance", version: "2" });
  const json = (r: any) => {
    expect(r.isError, JSON.stringify(r.content)).not.toBe(true);
    return JSON.parse(r.content.find((c: any) => c.type === "text").text);
  };
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(origin + "/mcp")),
    );
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "workspace_info",
        "wait_for_asset",
        "insert_asset",
        "set_keyframe",
        "get_preview_screenshot",
      ]),
    );
    const info = json(
        await client.callTool({ name: "workspace_info", arguments: {} }),
      ),
      name = "arrow-" + Date.now() + ".svg",
      file = path.join(info.assetDirectory, name);
    await fs.writeFile(file + ".tmp", "<svg");
    await page.waitForTimeout(1100);
    expect(Object.keys((await current(request)).project.assets)).toHaveLength(
      0,
    );
    await fs.writeFile(file + ".tmp", svg());
    await fs.rename(file + ".tmp", file);
    const ready = json(
      await client.callTool({
        name: "wait_for_asset",
        arguments: { path: "assets/" + name, timeoutMs: 10000 },
      }),
    );
    expect(ready.asset.kind).toBe("svg");
    expect(ready.asset.width).toBe(160);
    expect(ready.asset.data).toBeUndefined();
    let s = await current(request);
    await call(request, "edit_project", {
      expectedRevision: s.revision,
      commands: [
        {
          type: "track.add",
          compositionId: "main",
          track: { id: "second", name: "第二轨" },
        },
      ],
    });
    s = await current(request);
    json(
      await client.callTool({
        name: "insert_asset",
        arguments: {
          expectedRevision: s.revision,
          compositionId: "main",
          assetId: ready.asset.id,
          trackId: "second",
          at: 3,
          duration: 2,
        },
      }),
    );
    s = await current(request);
    const clip = s.project.compositions.main.elements[0];
    json(
      await client.callTool({
        name: "set_keyframe",
        arguments: {
          expectedRevision: s.revision,
          compositionId: "main",
          elementId: clip.id,
          property: "opacity",
          at: 0,
          value: 0,
        },
      }),
    );
    s = await current(request);
    json(
      await client.callTool({
        name: "set_keyframe",
        arguments: {
          expectedRevision: s.revision,
          compositionId: "main",
          elementId: clip.id,
          property: "opacity",
          at: 1,
          value: 1,
        },
      }),
    );
    await expect(page.getByTestId("clip-" + clip.id)).toBeVisible();
    await page.getByTestId("clip-" + clip.id).click();
    await seek(page, 4);
    await page.getByLabel("位置 Y", { exact: true }).fill("240");
    await page.getByLabel("位置 Y", { exact: true }).press("Enter");
    await expect
      .poll(
        async () =>
          (await current(request)).project.compositions.main.elements[0].y,
      )
      .toBe(240);
    const before = (await current(request)).project.compositions.main
        .elements[0],
      hash = ready.asset.hash;
    await fs.writeFile(file, svg("#8ab6ff"));
    await expect
      .poll(
        async () =>
          (await current(request)).project.assets[ready.asset.id].hash,
        { timeout: 15000 },
      )
      .not.toBe(hash);
    expect(
      (await current(request)).project.compositions.main.elements[0],
    ).toEqual(before);
    s = await current(request);
    await call(request, "undo", { expectedRevision: s.revision });
    expect(
      (await current(request)).project.assets[ready.asset.id].hash,
    ).not.toBe(hash);
    expect(await fs.readFile(file, "utf8")).toContain("#8ab6ff");
    await fs.writeFile(file, "<svg><path");
    await expect
      .poll(
        async () =>
          (await current(request)).project.assets[ready.asset.id].status,
      )
      .toBe("error");
    expect(
      (await current(request)).project.compositions.main.elements,
    ).toHaveLength(1);
    await fs.writeFile(file, svg("#f4ad8b"));
    await expect
      .poll(
        async () =>
          (await current(request)).project.assets[ready.asset.id].status,
      )
      .toBe("ready");
    await fs.rename(file, file + ".bak");
    await expect
      .poll(
        async () =>
          (await current(request)).project.assets[ready.asset.id].status,
      )
      .toBe("missing");
    await page.getByTestId("asset-" + ready.asset.id).click();
    await expect(page.getByText("引用 · 1 个片段")).toBeVisible();
    await page.getByTestId("media-relink").setInputFiles({
      name: "relinked.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from(svg()),
    });
    await expect
      .poll(
        async () =>
          (await current(request)).project.assets[ready.asset.id].status,
      )
      .toBe("ready");
    await page.getByLabel("关闭源素材").click();
    const capture: any = await client.callTool({
      name: "get_preview_screenshot",
      arguments: { compositionId: "main", progress: 4 },
    });
    expect(capture.isError).not.toBe(true);
    expect(capture.content.some((c: any) => c.type === "image")).toBe(true);
    const report = json(
      await client.callTool({ name: "validate_project", arguments: {} }),
    );
    expect(report.valid).toBe(true);
    await fs.writeFile(
      "docs/mcp-verification.json",
      JSON.stringify(
        {
          tools: tools.tools.map((t) => t.name),
          workspace: info.directory,
          actions: [
            "wait_for_asset",
            "insert_asset",
            "set_keyframe",
            "get_preview_screenshot",
            "validate_project",
          ],
          screenshotErrors: JSON.parse(
            capture.content.find((c: any) => c.type === "text").text,
          ).errors,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close();
  }
});

test("真实视频普通播放含音频，分割后续播；滚动正向、反向、快速定位和独立视频包", async ({
  page,
  request,
  browser,
}) => {
  const video = await upload(request, "tests/fixtures/test-motion.mp4");
  await edit(request, [
    {
      type: "clip.insert",
      compositionId: "main",
      assetId: video.id,
      trackId: "track_main",
      at: 0,
      newId: "video",
    },
    {
      type: "element.split",
      compositionId: "main",
      elementId: "video",
      at: 3,
      newId: "tail",
    },
  ]);
  await page.goto("/editor");
  await seek(page, 4);
  const media = page.locator('.canvas-host [data-element-id="tail"] video');
  await expect
    .poll(() => media.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeCloseTo(4, 1);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect
    .poll(() => media.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(false);
  await expect
    .poll(() => media.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(4.3);
  expect(
    await media.evaluate((v: HTMLVideoElement) => ({
      muted: v.muted,
      volume: v.volume,
      decoded: (v as any).webkitDecodedFrameCount,
    })),
  ).toMatchObject({ muted: false, volume: 1 });
  await expect
    .poll(() =>
      media.evaluate(
        (v: HTMLVideoElement) => v.getVideoPlaybackQuality().totalVideoFrames,
      ),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      media.evaluate(
        (v: HTMLVideoElement) => (v as any).webkitAudioDecodedByteCount,
      ),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await expect
    .poll(() => media.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(true);
  await page.getByTestId("clip-tail").click();
  await page.getByLabel("静音", { exact: true }).click();
  await expect(page.getByLabel("静音", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "播放", exact: true }).click();
  expect(await media.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await page.getByRole("button", { name: "滚动预览", exact: true }).click();
  const frame = page.frameLocator('iframe[title="滚动网页预览"]');
  const frameHandle = await page.locator("iframe").elementHandle(),
    content = await frameHandle!.contentFrame();
  expect(content).toBeTruthy();
  // The parent restores its playhead after iframe load; seek only after that handshake.
  await content!.waitForFunction(() => window.__SW_READY__);
  for (const t of [1, 6.5, 3.2, 7.5, 0.4, 5.8]) {
    await content!.evaluate(
      (t) => window.ScrollWeave.seek(t, "stage", true),
      t,
    );
    const id = t < 3 ? "video" : "tail";
    await expect
      .poll(() =>
        frame
          .locator('[data-element-id="' + id + '"] video')
          .evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeCloseTo(t, 1);
    expect(
      await frame
        .locator('[data-element-id="' + id + '"] video')
        .evaluate((v: HTMLVideoElement) => v.muted),
    ).toBe(true);
  }
  let s = await current(request);
  const output = await call(request, "export_html", {
    expectedRevision: s.revision,
    filename: "video-export",
  });
  expect(output.format).toBe("HTML + assets ZIP");
  const archive = unzipSync(
      new Uint8Array(await (await request.get(output.download)).body()),
    ),
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "sw-export-"));
  for (const [name, bytes] of Object.entries(archive)) {
    const dest = path.join(directory, name);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, bytes);
  }
  const app = express();
  app.use(express.static(directory));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const port = (server.address() as any).port,
    exported = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    }),
    requests: string[] = [];
  exported.on("request", (r) => requests.push(r.url()));
  try {
    await exported.goto("http://127.0.0.1:" + port + "/index.html");
    await exported.evaluate(() => window.ScrollWeave.seek(6, "stage", true));
    await expect
      .poll(() =>
        exported
          .locator('[data-element-id="tail"] video')
          .evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeCloseTo(6, 1);
    expect(requests.filter((url) => url.startsWith(origin))).toEqual([]);
    await exported.screenshot({ path: "docs/screenshots/export-video.png" });
  } finally {
    await exported.close();
    server.close();
  }
  const webm = await upload(request, "tests/fixtures/test-motion.webm");
  expect(webm.status).toBe("ready");
  expect(webm.codec).toBe("vp9");
  expect(webm.audioCodec).toBe("opus");
  await edit(request, [
    {
      type: "track.add",
      compositionId: "main",
      track: { id: "webm", name: "WebM" },
    },
    {
      type: "clip.insert",
      compositionId: "main",
      assetId: webm.id,
      trackId: "webm",
      at: 0,
      newId: "webm",
    },
  ]);
  await page.getByRole("button", { name: "剪辑预览", exact: true }).click();
  await seek(page, 1);
  const webmPlayer = page.locator(
    '.canvas-host [data-element-id="webm"] video',
  );
  await expect
    .poll(() => webmPlayer.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeCloseTo(1, 1);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await expect
    .poll(() => webmPlayer.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(1.2);
  await expect
    .poll(() =>
      webmPlayer.evaluate(
        (v: HTMLVideoElement) => v.getVideoPlaybackQuality().totalVideoFrames,
      ),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const unsupported = await upload(
    request,
    "tests/fixtures/unsupported-codec.mp4",
  );
  expect(unsupported.status).toBe("error");
  expect(unsupported.error).toContain("H.264");
});

test("复合片段内部编辑与返回，关键帧画布联动；图片 SVG 单文件与可移植项目", async ({
  page,
  request,
  browser,
}) => {
  const image = await upload(request, "tests/fixtures/test-image.png");
  await edit(request, [
    {
      type: "clip.insert",
      compositionId: "main",
      assetId: image.id,
      trackId: "track_main",
      at: 0,
      newId: "image",
    },
    {
      type: "track.add",
      compositionId: "main",
      track: { id: "text", name: "文字" },
    },
    {
      type: "element.add",
      compositionId: "main",
      element: createElement({
        id: "text",
        type: "text",
        trackId: "text",
        text: "FROM ASSETS TO STORIES",
        start: 0,
        end: 5,
        x: 100,
        y: 100,
        width: 1500,
        height: 200,
      }),
    },
  ]);
  await page.goto("/editor");
  await page.getByTestId("clip-text").click();
  await seek(page, 0);
  await page.getByTitle("添加关键帧 位置 X").click();
  await expect
    .poll(
      async () =>
        (await current(request)).project.compositions.main.elements.find(
          (element: any) => element.id === "text",
        )?.tracks.x?.length ?? 0,
    )
    .toBe(1);
  await seek(page, 2);
  await page.getByLabel("位置 X", { exact: true }).fill("400");
  await page.getByLabel("位置 X", { exact: true }).press("Enter");
  await expect
    .poll(
      async () =>
        (await current(request)).project.compositions.main.elements.find(
          (e: any) => e.id === "text",
        )?.tracks.x?.length ?? 0,
    )
    .toBe(2);
  await seek(page, 1);
  await expect
    .poll(() =>
      page
        .locator('.canvas-host [data-element-id="text"]')
        .evaluate((el) => el.style.transform),
    )
    .toContain("250px");
  // Keyframe editing is inline; selecting multiple clips leaves that inspector.
  await page.getByTestId("clip-image").click({ modifiers: ["Shift"] });
  await page.getByTitle("创建复合片段 Alt+G").click();
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  let s = await current(request),
    wrapper = s.project.compositions.main.elements[0];
  await page.getByTestId("clip-" + wrapper.id).dblclick();
  await expect(page.locator(".timeline-clip")).toHaveCount(2);
  await expect(page.getByText("共享内容 · 修改会影响所有引用")).toBeVisible();
  await page.getByTitle("返回外层时间线").click();
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  const beforeSource = await current(request);
  await page.getByTestId("asset-" + wrapper.assetId).click();
  await page.getByRole("button", { name: "播放复合素材", exact: true }).click();
  await expect
    .poll(() => page.getByLabel("复合素材预览秒数").inputValue())
    .not.toBe("0");
  await page.getByRole("button", { name: "暂停复合素材", exact: true }).click();
  expect((await current(request)).preview).toEqual(beforeSource.preview);
  await page.getByLabel("关闭源素材").click();
  s = await current(request);
  const saved = await call(request, "save_project", {
      expectedRevision: s.revision,
      filename: "portable",
    }),
    html = await call(request, "export_html", {
      expectedRevision: s.revision,
      filename: "standalone",
    });
  expect(html.format).toBe("独立单文件 HTML");
  const htmlBody = await (await request.get(html.download)).text();
  expect(htmlBody).toContain("data:image/png;base64,");
  const exported = await browser.newPage();
  try {
    await exported.setContent(htmlBody);
    await exported.evaluate(() => window.ScrollWeave.seek(1, "stage", true));
    await expect(exported.locator("img")).toHaveCount(1);
    expect(
      await exported
        .locator("img")
        .evaluate((i: HTMLImageElement) => i.naturalWidth),
    ).toBe(640);
  } finally {
    await exported.close();
  }
  const files = unzipSync(
    new Uint8Array(await (await request.get(saved.download)).body()),
  );
  expect(files["project.scrollweave.json"]).toBeTruthy();
  expect(Object.keys(files).some((n) => n.startsWith("assets/"))).toBe(true);
  const restored = await request.post("/api/import-project", {
    headers: { "Content-Type": "application/octet-stream" },
    data: Buffer.from(await (await request.get(saved.download)).body()),
  });
  expect(restored.ok(), await restored.text()).toBe(true);
  s = await current(request);
  expect(s.project.compositions.main.elements).toHaveLength(1);
  expect(Object.keys(s.project.compositions)).toHaveLength(2);
  for (const a of Object.values(s.project.assets) as any[])
    if (a.kind !== "composition") {
      expect(a.path).toMatch(/^assets\//);
      expect(a.cachePath).toBeTruthy();
    }
  await page.reload();
  await expect(page.locator(".timeline-clip")).toHaveCount(1);
  await page.screenshot({
    path: "docs/screenshots/editor-compound.png",
    fullPage: true,
  });
});

test("嵌套视频与横向动画共用秒制求值，滚动区间距离与平滑跟随不改编排", async ({
  page,
  request,
}) => {
  const video = await upload(request, "tests/fixtures/test-motion.mp4");
  await edit(request, [
    {
      type: "clip.insert",
      compositionId: "main",
      assetId: video.id,
      trackId: "track_main",
      at: 2,
      newId: "v",
    },
    {
      type: "element.trim",
      compositionId: "main",
      elementId: "v",
      start: 3,
      end: 8,
    },
    {
      type: "compound.create",
      compositionId: "main",
      elementIds: ["v"],
      newId: "nested",
      name: "嵌套视频",
    },
  ]);
  let s = await current(request),
    wrapper = s.project.compositions.main.elements[0];
  await edit(request, [
    {
      type: "keyframe.set",
      compositionId: "main",
      elementId: wrapper.id,
      property: "x",
      keyframe: { id: "left", at: 0, value: 0, easing: "linear" },
    },
    {
      type: "keyframe.set",
      compositionId: "main",
      elementId: wrapper.id,
      property: "x",
      keyframe: { id: "right", at: 5, value: -500, easing: "linear" },
    },
    {
      type: "project.update",
      patch: {
        sections: [
          {
            id: "intro",
            compositionId: "main",
            kind: "flow",
            start: 0,
            end: 3,
            scrollDistance: 600,
            name: "纵向进入",
          },
          {
            id: "focus",
            compositionId: "main",
            kind: "pin",
            start: 3,
            end: 8,
            scrollDistance: 2500,
            name: "固定横向",
          },
          {
            id: "outro",
            compositionId: "main",
            kind: "flow",
            start: 8,
            end: 10,
            scrollDistance: 600,
            name: "继续纵向",
          },
        ],
      },
    },
  ]);
  await page.goto("/editor");
  await seek(page, 5);
  const clip = page.locator(
      '.canvas-host [data-element-id="' + wrapper.id + '"]',
    ),
    videoNode = page.locator(".canvas-host video");
  await expect
    .poll(() => videoNode.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeCloseTo(3, 1);
  expect(await clip.evaluate((e) => e.style.transform)).toContain("-200px");
  await page.getByRole("button", { name: "滚动预览", exact: true }).click();
  const handle = await page.locator("iframe").elementHandle(),
    frame = await handle!.contentFrame();
  await frame!.waitForFunction(() => window.__SW_READY__);
  await frame!.evaluate(() => window.ScrollWeave.seek(5, "focus", true));
  const scrollVideo = frame!.locator('[data-section-id="focus"] video');
  await expect
    .poll(() => scrollVideo.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeCloseTo(3, 1);
  expect(
    await frame!
      .locator(
        '[data-section-id="focus"] [data-element-id="' + wrapper.id + '"]',
      )
      .evaluate((e) => e.style.transform),
  ).toContain("-200px");
  const original = (await current(request)).project.compositions;
  s = await current(request);
  await edit(request, [
    {
      type: "project.update",
      patch: {
        sections: s.project.sections.map((section: any) =>
          section.id === "focus"
            ? { ...section, scrollDistance: 5000 }
            : section,
        ),
      },
    },
  ]);
  expect((await current(request)).project.compositions).toEqual(original);
  await frame!.waitForFunction(
    () =>
      window.__SW_READY__ &&
      window.__SW_PROJECT__.sections.find((s) => s.id === "focus")
        ?.scrollDistance === 5000,
  );
  await frame!.evaluate(() => {
    window.ScrollWeave.seek(3, "focus", true);
    window.ScrollWeave.setMode("smooth");
    window.ScrollWeave.seek(7, "focus");
  });
  await expect
    .poll(() =>
      frame!.evaluate(() => window.ScrollWeave.position.targetProgress),
    )
    .toBeCloseTo(7, 1);
  await expect
    .poll(() => frame!.evaluate(() => window.ScrollWeave.position.progress))
    .toBeCloseTo(7, 1);
  await expect
    .poll(() => scrollVideo.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeCloseTo(5, 1);
  const follow = await current(request);
  expect(follow.preview.compositionId).toBe("main");
  await expect
    .poll(async () => (await current(request)).preview.progress)
    .toBeCloseTo(7, 1);
  await page.screenshot({
    path: "docs/screenshots/editor-scroll.png",
    fullPage: true,
  });
});

test("键盘可用：源预览 Esc 关闭并还原焦点，片段 Enter 选中，Space 激活按钮不触发播放，Ctrl+滚轮只缩放时间线", async ({
  page,
  request,
}) => {
  const asset = await upload(request, "tests/fixtures/test-image.png");
  await page.goto("/editor");
  const preview = page.getByRole("button", {
    name: "预览素材 " + asset.name,
    exact: true,
  });
  await preview.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "源素材预览" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(preview).toBeFocused();

  // The server keeps the previous test's playhead; insertion happens at the playhead.
  await seek(page, 0);
  await page
    .getByRole("button", { name: "添加 " + asset.name + " 到时间线" })
    .click();
  const clip = page.locator(".timeline-clip");
  // Insertion selects the new clip after its commit; deselect only once that has happened.
  await expect(clip).toHaveClass(/selected/);
  const row = page.locator(".track-content", { has: clip });
  const [rowBox, clipBox] = [await row.boundingBox(), await clip.boundingBox()];
  await row.click({
    position: { x: clipBox!.x + clipBox!.width - rowBox!.x + 60, y: 20 },
  });
  await expect(clip).not.toHaveClass(/selected/);
  await clip.focus();
  await page.keyboard.press("Enter");
  await expect(clip).toHaveClass(/selected/);

  const snap = page.getByRole("button", { name: "吸附" });
  await expect(snap).toHaveAttribute("aria-pressed", "true");
  await snap.focus();
  await page.keyboard.press("Space");
  await expect(snap).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("button", { name: "播放", exact: true }),
  ).toBeVisible();

  const zoom = page.getByLabel("时间线缩放");
  const before = Number(await zoom.inputValue());
  await page.evaluate(() => {
    window.addEventListener(
      "wheel",
      (e) => ((window as any).wheelPrevented = e.defaultPrevented),
      { passive: true },
    );
  });
  await page.locator(".timeline-scroll").hover();
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect
    .poll(async () => Number(await zoom.inputValue()))
    .toBeGreaterThan(before);
  expect(await page.evaluate(() => (window as any).wheelPrevented)).toBe(true);
});

test("刚打开编辑器就选中片段，晚到的同版本状态快照不会冲掉选中", async ({
  page,
  request,
}) => {
  await edit(request, [
    {
      type: "element.add",
      compositionId: "main",
      element: createElement({
        id: "text",
        type: "text",
        trackId: "track_main",
        text: "LATE SNAPSHOT",
        start: 0,
        end: 3,
      }),
    },
  ]);
  // Hold /api/state so the SSE snapshot renders first and these land after the click.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  let fetched = 0,
    delivered = 0;
  await page.route("**/api/state", async (route) => {
    const response = await route.fetch();
    fetched++;
    await held;
    await route.fulfill({ response });
    delivered++;
  });
  await page.goto("/editor");
  const clip = page.getByTestId("clip-text");
  await clip.click();
  await expect(clip).toHaveClass(/selected/);
  await expect.poll(() => fetched).toBeGreaterThan(0);
  release();
  await expect.poll(() => delivered).toBe(fetched);
  await page.waitForTimeout(500);
  await expect(clip).toHaveClass(/selected/);
  await expect(page.getByTitle("添加关键帧 位置 X")).toBeVisible();
});
