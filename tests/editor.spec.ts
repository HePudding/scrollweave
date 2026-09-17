import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Snapshot, Command } from "../src/core/commands";
import type { Project } from "../src/core/model";
import { blankProject, createElement } from "../src/core/model";
const base = "http://127.0.0.1:4101";
const example: Project = JSON.parse(
  fs.readFileSync("examples/form.scrollweave.json", "utf8"),
);
const get = async (request: APIRequestContext): Promise<Snapshot> =>
  (await request.get("/api/state")).json();
const act = async (
  request: APIRequestContext,
  name: string,
  args: unknown = {},
) => {
  const response = await request.post("/api/action", { data: { name, args } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
};
const edit = async (request: APIRequestContext, commands: Command[]) =>
  act(request, "edit_project", {
    commands,
    expectedRevision: (await get(request)).revision,
    label: "浏览器验收",
  });
async function connect() {
  const client = new Client({
    name: "scrollweave-acceptance-agent",
    version: "1.0",
  });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`)),
  );
  return client;
}
const textResult = (result: any) =>
  JSON.parse(result.content.find((c: any) => c.type === "text").text);
async function interactionProject(request: APIRequestContext) {
  const p = blankProject();
  p.compositions.main.elements = [
    createElement({
      id: "clip",
      name: "交互验收素材",
      type: "shape",
      x: 100,
      y: 300,
      start: 0.1,
      end: 0.9,
      outside: "hide",
      tracks: {
        x: [
          { id: "a", at: 0.125, value: 100, easing: "linear" },
          { id: "b", at: 0.375, value: 500, easing: "linear" },
          { id: "c", at: 0.875, value: 900, easing: "linear" },
        ],
      },
    }),
  ];
  await edit(request, [{ type: "project.replace", project: p }]);
  await act(request, "set_selection", {
    compositionId: "main",
    elementIds: ["clip"],
  });
  await act(request, "set_preview", { compositionId: "main", progress: 0.5 });
  return p;
}
async function seek(
  page: Page,
  progress: number,
  sectionId = "story",
  immediate = true,
) {
  await page.evaluate(
    ({ progress, sectionId, immediate }) =>
      window.ScrollWeave.seek(progress, sectionId, immediate),
    { progress, sectionId, immediate },
  );
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
async function styles(page: Page) {
  return page.locator("#sw-root .sw-element").evaluateAll((nodes) =>
    nodes.map((node) => ({
      path: (node as HTMLElement).dataset.path,
      transform: (node as HTMLElement).style.transform,
      opacity: (node as HTMLElement).style.opacity,
      visibility: (node as HTMLElement).style.visibility,
      clip: (node as HTMLElement).style.clipPath,
    })),
  );
}

test.beforeEach(async ({ request }) => {
  const state = await get(request);
  await act(request, "edit_project", {
    expectedRevision: state.revision,
    label: "重置验收示例",
    commands: [{ type: "project.replace", project: example }],
  });
  await act(request, "set_selection", {
    compositionId: "main",
    elementIds: [],
  });
  await act(request, "set_preview", {
    compositionId: "main",
    progress: 0.16,
    sectionId: "story",
  });
});

test("完整验收：人工关键帧 → 真实 MCP 批量修改 → 撤销 → 保存重开 → 独立 HTML", async ({
  page,
  request,
  browser,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto("/");
  await page.getByText("主标题 · 淡入上移", { exact: true }).first().click();
  const y = page.getByRole("spinbutton", { name: "位置 Y", exact: true });
  await y.fill("420");
  await y.press("Enter");
  await expect
    .poll(async () =>
      (await get(request)).project.compositions.main.elements
        .find((e) => e.id === "title")!
        .tracks.y!.some(
          (k) => Math.abs(k.at - 0.16) < 0.001 && k.value === 420,
        ),
    )
    .toBeTruthy();
  const manual = await get(request);
  const client = await connect();
  try {
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("get_preview_screenshot");
    const read = textResult(
      await client.callTool({ name: "read_project", arguments: {} }),
    );
    expect(read.revision).toBe(manual.revision);
    expect(read.selection.elementIds).toContain("title");
    const changed = await client.callTool({
      name: "edit_project",
      arguments: {
        expectedRevision: read.revision,
        label: "Agent 验收批次",
        commands: [
          {
            type: "element.update",
            compositionId: "main",
            elementId: "title",
            patch: { text: "同一项目，协同创作。" },
          },
          {
            type: "element.update",
            compositionId: "main",
            elementId: "brand",
            patch: { x: 170 },
          },
        ],
      },
    });
    expect(changed.isError).toBeFalsy();
    await expect(
      page.locator(".canvas-host [data-element-id=title]"),
    ).toHaveText("同一项目，协同创作。");
    await page
      .getByRole("button", { name: "撤销 Ctrl+Z", exact: true })
      .click();
    await expect
      .poll(async () => (await get(request)).project)
      .toEqual(manual.project);
    const stale = await client.callTool({
      name: "edit_project",
      arguments: {
        expectedRevision: read.revision,
        commands: [{ type: "project.update", patch: { name: "不应覆盖" } }],
      },
    });
    expect(stale.isError).toBe(true);
    expect(textResult(stale).code).toBe("REVISION_CONFLICT");
    const downloadEvent = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "保存项目 Ctrl+S", exact: true })
      .click();
    const saved = await downloadEvent;
    const savedPath = testInfo.outputPath("saved.scrollweave.json");
    await saved.saveAs(savedPath);
    expect(JSON.parse(fs.readFileSync(savedPath, "utf8"))).toEqual(
      manual.project,
    );
    await page.getByRole("button", { name: "新建项目", exact: true }).click();
    await expect(page.getByText("从上方添加第一个图层")).toBeVisible();
    await page.locator("input[type=file]").first().setInputFiles(savedPath);
    await expect(
      page.locator(".canvas-host [data-element-id=title]"),
    ).toHaveText("让灵感\n顺势而动。");
    expect((await get(request)).project).toEqual(manual.project);
    const exportEvent = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "导出独立 HTML", exact: true })
      .click();
    const exported = await exportEvent;
    const htmlPath = testInfo.outputPath("independent.html");
    await exported.saveAs(htmlPath);
    const filePage = await browser.newPage({
      viewport: { width: 1280, height: 720 },
    });
    const external: string[] = [];
    filePage.on("request", (r) => {
      if (/^https?:/.test(r.url())) external.push(r.url());
    });
    await filePage.goto(pathToFileURL(htmlPath).href);
    await seek(filePage, 0.16);
    await expect(filePage.locator("[data-element-id=title]")).toHaveCSS(
      "opacity",
      "1",
    );
    await seek(filePage, 0.7);
    await expect(filePage.locator("[data-element-id=cardsInstance]")).toHaveCSS(
      "opacity",
      "1",
    );
    expect(external).toEqual([]);
    expect(await filePage.evaluate(() => window.__SW_ERRORS__)).toEqual([]);
    await filePage.close();
    const image: any = await client.callTool({
      name: "get_preview_screenshot",
      arguments: { compositionId: "main", progress: 0.7 },
    });
    expect(image.isError).toBeFalsy();
    const png: any = image.content.find((c: any) => c.type === "image");
    expect(png.data.length).toBeGreaterThan(15000);
    fs.writeFileSync(
      testInfo.outputPath("mcp-screenshot.png"),
      Buffer.from(png.data, "base64"),
    );
    expect(textResult(image).errors).toEqual([]);
    expect(pageErrors).toEqual([]);
  } finally {
    await client.close();
  }
});

test("精确模式：正反滚动、快速跳转、嵌套边界，预览与离线导出逐像素一致", async ({
  browser,
  request,
}, testInfo) => {
  const result = await act(request, "export_html", {
    expectedRevision: (await get(request)).revision,
    filename: "parity",
  });
  const live = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  const offline = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  await live.goto(`${base}/api/preview`);
  await offline.goto(pathToFileURL(result.path).href);
  try {
    const baseline = new Map<number, unknown>();
    for (const progress of [
      0, 0.12, 0.43, 0.68, 0.96, 1, 0.68, 0.43, 0.12, 0, 1, 0.12,
    ]) {
      await seek(live, progress);
      await seek(offline, progress);
      const preview = await styles(live);
      expect(await styles(offline)).toEqual(preview);
      if (baseline.has(progress))
        expect(preview).toEqual(baseline.get(progress));
      else baseline.set(progress, preview);
      expect((await live.screenshot()).equals(await offline.screenshot())).toBe(
        true,
      );
    }
    await seek(live, 0.68);
    await live.screenshot({ path: testInfo.outputPath("horizontal.png") });
    const pinned = live.locator("[data-section-id=story]>.sw-viewport");
    expect((await pinned.boundingBox())!.y).toBe(0);
    await live.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    await live.waitForTimeout(80);
    expect((await pinned.boundingBox())!.y).toBeLessThan(0);
    await expect(live.locator("[data-element-id=cta]")).toBeInViewport();
    const lastScroll = await live.evaluate(() => window.scrollY);
    await live.keyboard.press("PageUp");
    await expect
      .poll(() => live.evaluate(() => window.scrollY))
      .toBeLessThan(lastScroll);
    expect(await live.evaluate(() => window.__SW_ERRORS__)).toEqual([]);
  } finally {
    await live.close();
    await offline.close();
  }
});

test("平滑追随从当前显示状态追赶，反向与突变后收敛", async ({
  browser,
  request,
}) => {
  await edit(request, [
    {
      type: "project.update",
      patch: { scroll: { mode: "smooth", smoothing: 160 } },
    },
  ]);
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    reducedMotion: "no-preference",
  });
  await page.goto(`${base}/api/preview`);
  try {
    await seek(page, 0, "story", true);
    await page.evaluate(() => window.scrollTo(0, 5200));
    await page.waitForTimeout(70);
    const a = await page.evaluate(() => window.ScrollWeave.position);
    expect(a.progress).toBeGreaterThan(0.01);
    expect(a.progress).toBeLessThan(0.8);
    expect(a.targetProgress).toBe(1);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(35);
    const b = await page.evaluate(() => window.ScrollWeave.position);
    expect(b.progress).toBeGreaterThan(0);
    expect(b.progress).toBeLessThan(a.progress);
    expect(b.targetProgress).toBe(0);
    await expect
      .poll(() => page.evaluate(() => window.ScrollWeave.position.progress), {
        timeout: 5000,
      })
      .toBeLessThan(0.001);
    await page.evaluate(() => window.scrollTo(0, 3900));
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            Math.abs(window.ScrollWeave.position.progress - 0.75),
          ),
        { timeout: 5000 },
      )
      .toBeLessThan(0.001);
  } finally {
    await page.close();
  }
});

test("嵌套多实例、循环拒绝和子项目重新导入在真实 DOM 中有效", async ({
  browser,
  request,
}) => {
  await edit(request, [
    {
      type: "element.duplicate",
      compositionId: "main",
      elementId: "cardsInstance",
      newId: "second",
    },
    {
      type: "element.update",
      compositionId: "main",
      elementId: "second",
      patch: { start: 0, end: 0.3 },
    },
  ]);
  const page = await browser.newPage();
  await page.goto(`${base}/api/preview`);
  await seek(page, 0.55);
  const first = await page
    .locator('[data-path="main/cardsInstance/strip"]')
    .getAttribute("style");
  const second = await page
    .locator('[data-path="main/second/strip"]')
    .getAttribute("style");
  expect(first).not.toEqual(second);
  await seek(page, 1);
  await seek(page, 0.55);
  expect(
    await page
      .locator('[data-path="main/cardsInstance/strip"]')
      .getAttribute("style"),
  ).toBe(first);
  const state = await get(request);
  const response = await request.post("/api/action", {
    data: {
      name: "edit_project",
      args: {
        expectedRevision: state.revision,
        commands: [
          {
            type: "element.update",
            compositionId: "main",
            elementId: "second",
            patch: { compositionId: "main" },
          },
        ],
      },
    },
  });
  expect(response.status()).toBe(400);
  expect((await get(request)).revision).toBe(state.revision);
  await edit(request, [
    { type: "project.import", project: example, prefix: "imported" },
  ]);
  expect(
    (await get(request)).project.compositions.imported_main.elements.find(
      (e) => e.id === "cardsInstance",
    )?.compositionId,
  ).toBe("imported_cards");
  await page.close();
});

test("画布拖动、缩放、旋转和关键帧时间线编辑均提交真实项目命令", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByText("品牌标识", { exact: true }).first().click();
  const target = page.locator(".canvas-host [data-element-id=brand]");
  const before = (await get(request)).project.compositions.main.elements.find(
    (e) => e.id === "brand",
  )!;
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 90, box.y + 45, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await get(request)).project.compositions.main.elements.find(
          (e) => e.id === "brand",
        )!.x,
    )
    .not.toBe(before.x);
  const resize = page.locator('.moveable-control[data-direction="se"]');
  await expect(resize).toBeVisible();
  const resizeBox = (await resize.boundingBox())!;
  await page.mouse.move(resizeBox.x + 4, resizeBox.y + 4);
  await page.mouse.down();
  await page.mouse.move(resizeBox.x + 35, resizeBox.y + 25, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await get(request)).project.compositions.main.elements.find(
          (e) => e.id === "brand",
        )!.width,
    )
    .not.toBe(before.width);
  const rotation = page.locator(".moveable-rotation-control");
  const rb = (await rotation.boundingBox())!;
  await page.mouse.move(rb.x + 4, rb.y + 4);
  await page.mouse.down();
  await page.mouse.move(rb.x + 40, rb.y + 40, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await get(request)).project.compositions.main.elements.find(
          (e) => e.id === "brand",
        )!.rotation,
    )
    .not.toBe(0);
  await page.getByText("主标题 · 淡入上移", { exact: true }).first().click();
  await page
    .getByRole("button", { name: "为位置 Y添加关键帧", exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: "关键帧位置", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("spinbutton", { name: "关键帧位置", exact: true })
    .fill("22");
  await page
    .getByRole("spinbutton", { name: "关键帧位置", exact: true })
    .press("Enter");
  await expect
    .poll(async () =>
      (await get(request)).project.compositions.main.elements
        .find((e) => e.id === "title")!
        .tracks.y!.some((k) => k.at === 0.22),
    )
    .toBeTruthy();
  await page
    .getByRole("combobox", { name: "缓动预设", exact: true })
    .selectOption("easeOut");
  await expect
    .poll(
      async () =>
        (await get(request)).project.compositions.main.elements
          .find((e) => e.id === "title")!
          .tracks.y!.find((k) => k.at === 0.22)?.easing,
    )
    .toBe("easeOut");
  await page
    .getByRole("spinbutton", { name: "曲线控制点 1", exact: true })
    .fill("0.25");
  await page.getByRole("button", { name: "应用曲线", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await get(request)).project.compositions.main.elements
          .find((e) => e.id === "title")!
          .tracks.y!.find((k) => k.at === 0.22)?.easing,
    )
    .toEqual([0.25, 0, 0.58, 1]);
});

test("图片素材内嵌、裁切保存、独立导出保留图像", async ({
  page,
  request,
  browser,
}, testInfo) => {
  await page.goto("/");
  const png = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#c4f36b";
      ctx.fillRect(0, 0, 1, 1);
      return c.toDataURL("image/png").split(",")[1];
    }),
    "base64",
  );
  await page.locator("input[type=file]").nth(1).setInputFiles({
    name: "test-pixel.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect
    .poll(async () => Object.keys((await get(request)).project.assets).length)
    .toBe(1);
  const state = await get(request);
  const image = state.project.compositions.main.elements.find(
    (e) => e.type === "image",
  )!;
  await edit(request, [
    {
      type: "element.update",
      compositionId: "main",
      elementId: image.id,
      patch: {
        width: 400,
        height: 300,
        crop: { top: 10, left: 10, right: 0, bottom: 0 },
      },
    },
  ]);
  const saved = await act(request, "save_project", {
    expectedRevision: (await get(request)).revision,
    filename: "image-project",
  });
  const recovered = JSON.parse(fs.readFileSync(saved.path, "utf8"));
  expect(
    recovered.assets[image.assetId!].data.startsWith("data:image/png;base64,"),
  ).toBe(true);
  const exported = await act(request, "export_html", {
    expectedRevision: (await get(request)).revision,
    filename: "image-export",
  });
  const offline = await browser.newPage();
  await offline.goto(pathToFileURL(exported.path).href);
  const img = offline.locator(`[data-element-id="${image.id}"] img`);
  expect(
    await img.evaluate(
      (n: HTMLImageElement) => n.complete && n.naturalWidth === 1,
    ),
  ).toBeTruthy();
  await expect(img.locator("..")).toHaveCSS(
    "clip-path",
    "inset(10% 0% 0% 10%)",
  );
  await offline.close();
});

test("stdio MCP 桥接连接同一服务；错误输入返回真实错误", async ({
  request,
}) => {
  const client = new Client({ name: "stdio-acceptance", version: "1.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "server/stdio.ts"],
    cwd: process.cwd(),
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (v): v is [string, string] => typeof v[1] === "string",
        ),
      ),
      SCROLLWEAVE_URL: base,
    },
  });
  try {
    await client.connect(transport);
    const state = textResult(
      await client.callTool({ name: "read_project", arguments: {} }),
    );
    expect(state.revision).toBe((await get(request)).revision);
    const presets = textResult(
      await client.callTool({ name: "list_presets", arguments: {} }),
    );
    expect(presets).toHaveLength(3);
    const invalid = await client.callTool({
      name: "set_preview",
      arguments: { compositionId: "missing", progress: 0.2 },
    });
    expect(invalid.isError).toBe(true);
  } finally {
    await client.close();
  }
});

test("原生预览滚动同步播放头；Agent 定位同步已打开的预览", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "打开原生滚动预览", exact: true })
    .click();
  const frame = page.frameLocator('iframe[title="滚动页面预览"]');
  await expect(frame.locator("#sw-root")).toBeVisible();
  const native = page.frames().find((f) => f !== page.mainFrame())!;
  await native.evaluate(() => window.scrollTo(0, 2600));
  await expect
    .poll(async () => (await get(request)).preview.progress)
    .toBeCloseTo(0.5, 2);
  const client = await connect();
  try {
    await client.callTool({
      name: "set_preview",
      arguments: { compositionId: "main", progress: 0.8, sectionId: "story" },
    });
    await expect.poll(() => native.evaluate(() => window.scrollY)).toBe(4160);
  } finally {
    await client.close();
  }
});

test("vis-timeline 真实关键帧拖动和区间边缘调整", async ({ page, request }) => {
  const p = blankProject();
  p.compositions.main.elements = [
    createElement({
      id: "box",
      name: "拖动验收图层",
      type: "shape",
      start: 0.2,
      end: 0.8,
      outside: "hide",
      tracks: {
        x: [
          { id: "a", at: 0.2, value: 20, easing: "linear" },
          { id: "b", at: 0.8, value: 200, easing: "linear" },
        ],
      },
    }),
  ];
  await edit(request, [{ type: "project.replace", project: p }]);
  await page.goto("/");
  await page.getByText("拖动验收图层", { exact: true }).first().click();
  const key = page.locator(".vis-item.vis-point").first();
  await expect(key).toBeVisible();
  const box = (await key.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 75, box.y + box.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await get(request)).project.compositions.main.elements[0].tracks.x![0]
          .at,
    )
    .toBeGreaterThan(0.2);
  const clip = page.locator(".vis-item.vis-range");
  await clip.click();
  const edge = clip.locator(".vis-drag-right");
  await expect(edge).toBeVisible();
  const eb = (await edge.boundingBox())!;
  await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
  await page.mouse.down();
  await page.mouse.move(eb.x + eb.width / 2 - 65, eb.y + eb.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await get(request)).project.compositions.main.elements[0].trim?.end ??
        1,
    )
    .toBeLessThan(0.8);
});

test("交互：普通滚轮纵向、Ctrl 缩放、Shift 横移和快捷键适应全段", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "展开全部轨道", exact: true }).click();
  const timeline = page.getByTestId("timeline");
  const left = timeline.locator(".vis-panel.vis-left");
  const window = async () =>
    timeline.evaluate((el) => [
      Number(el.dataset.windowStart),
      Number(el.dataset.windowEnd),
    ]);
  const before = await window();
  await timeline
    .locator(".vis-panel.vis-center")
    .hover({ position: { x: 750, y: 80 } });
  await page.mouse.wheel(0, 260);
  await expect
    .poll(() => left.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  expect(await window()).toEqual(before);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -220);
  await page.keyboard.up("Control");
  await expect
    .poll(async () => {
      const [s, e] = await window();
      return e - s;
    })
    .toBeLessThan(before[1] - before[0] - 1000);
  const zoomed = await window();
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, 120);
  await page.keyboard.up("Shift");
  await expect.poll(async () => (await window())[0]).not.toBe(zoomed[0]);
  await page.keyboard.press("Shift+Z");
  await expect.poll(window).toEqual([0, 100000]);
});

test("交互：精简轨道、标题自动显示有效长度，新增文字不会铺满全段", async ({
  page,
  request,
}, info) => {
  await page.goto("/");
  const timeline = page.getByTestId("timeline");
  await expect(
    timeline.getByRole("button", { name: /全程静态图层/ }),
  ).toBeVisible();
  await expect(timeline.locator(".property-row")).toHaveCount(0);
  await expect(
    timeline.locator(".vis-range").filter({ hasText: "品牌标识" }),
  ).toHaveCount(0);
  const clip = timeline
    .locator(".vis-range")
    .filter({ hasText: "主标题 · 淡入上移" });
  const width = (await clip.boundingBox())!.width;
  const total = (await timeline.locator(".vis-panel.vis-center").boundingBox())!
    .width;
  expect(width / total).toBeCloseTo(0.46, 1);
  await page.screenshot({ path: info.outputPath("compact-timeline.png") });
  await page.getByRole("button", { name: "添加文字", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await get(request)).project.compositions.main.elements.at(-1)!.name,
    )
    .toBe("新文字");
  const element = (await get(request)).project.compositions.main.elements.at(
    -1,
  )!;
  expect(element.start).toBe(0.16);
  expect(element.end).toBeCloseTo(0.36);
  expect(element.outside).toBe("hide");
  await act(request, "set_preview", { compositionId: "main", progress: 0.6 });
  await expect(
    page.locator(`.canvas-host [data-element-id="${element.id}"]`),
  ).toHaveCSS("visibility", "hidden");
});

test("交互：Q/W 裁边、Ctrl+B 分割保持动画，快捷键撤销且输入框不触发", async ({
  page,
  request,
}) => {
  const original = await interactionProject(request);
  await page.goto("/");
  await expect(page.getByRole("spinbutton", { name: "素材入点" })).toHaveValue(
    "10",
  );
  await page.keyboard.press("q");
  await expect
    .poll(
      async () =>
        (await get(request)).project.compositions.main.elements[0].trim?.start,
    )
    .toBe(0.5);
  expect(
    (await get(request)).project.compositions.main.elements[0].tracks,
  ).toEqual(original.compositions.main.elements[0].tracks);
  await page.keyboard.press("Control+z");
  await expect
    .poll(
      async () =>
        (await get(request)).project.compositions.main.elements[0].trim,
    )
    .toBeNull();
  await page
    .getByRole("button", { name: "裁掉播放头右侧 (W)", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await get(request)).project.compositions.main.elements[0].trim?.end,
    )
    .toBe(0.5);
  await page.keyboard.press("Control+z");
  await expect
    .poll(
      async () =>
        (await get(request)).project.compositions.main.elements[0].trim,
    )
    .toBeNull();
  await page.keyboard.press("Control+b");
  await expect
    .poll(
      async () =>
        (await get(request)).project.compositions.main.elements.length,
    )
    .toBe(2);
  const split = (await get(request)).project.compositions.main.elements;
  expect(split[0].trim).toEqual({ start: 0.1, end: 0.5 });
  expect(split[1].trim).toEqual({ start: 0.5, end: 0.9 });
  await act(request, "set_preview", { compositionId: "main", progress: 0.5 });
  await expect(page.locator('.canvas-host [data-element-id="clip"]')).toHaveCSS(
    "visibility",
    "hidden",
  );
  await expect(
    page.locator(`.canvas-host [data-element-id="${split[1].id}"]`),
  ).toHaveCSS("visibility", "visible");
  const name = page.getByRole("textbox", { name: "图层名称", exact: true });
  const revision = (await get(request)).revision;
  await name.focus();
  await name.press("q");
  await name.press("w");
  expect((await get(request)).revision).toBe(revision);
  await name.press("Escape");
});

test("交互：关键帧多选拖动、复制到播放头、上下帧跳转，Delete 不删图层", async ({
  page,
  request,
}) => {
  await interactionProject(request);
  await page.goto("/");
  const keys = page.locator(".vis-item.vis-point");
  await expect(keys).toHaveCount(3);
  await keys.nth(0).click();
  await keys.nth(1).click({ modifiers: ["Control"] });
  await expect(page.locator(".inspector-heading")).toContainText("已选 2");
  const before = await get(request);
  const box = (await keys.nth(0).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(async () => (await get(request)).revision)
    .toBe(before.revision + 1);
  const moved = (await get(request)).project.compositions.main.elements[0]
    .tracks.x!;
  expect(moved[0].at).toBeGreaterThan(0.125);
  expect(moved[1].at - moved[0].at).toBeCloseTo(0.25, 6);
  await expect(page.locator(".inspector-heading")).toContainText("已选 2");
  await page.keyboard.press("Control+z");
  await expect
    .poll(
      async () =>
        (await get(request)).project.compositions.main.elements[0].tracks.x![0]
          .at,
    )
    .toBe(0.125);
  await expect(page.locator(".inspector-heading")).toContainText("已选 2");
  await page.keyboard.press("Control+c");
  await expect(page.locator(".toast")).toContainText("已复制 2");
  await act(request, "set_preview", { compositionId: "main", progress: 0.5 });
  await page.keyboard.press("Control+v");
  await expect
    .poll(
      async () =>
        (await get(request)).project.compositions.main.elements[0].tracks.x!
          .length,
    )
    .toBe(5);
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(
      async () =>
        (await get(request)).project.compositions.main.elements[0].tracks.x![2]
          .at,
    )
    .toBeCloseTo(0.50125, 5);
  await page.keyboard.press("Delete");
  await expect
    .poll(
      async () =>
        (await get(request)).project.compositions.main.elements[0].tracks.x!
          .length,
    )
    .toBe(3);
  expect((await get(request)).project.compositions.main.elements).toHaveLength(
    1,
  );
  await page.keyboard.press("Alt+ArrowLeft");
  await expect
    .poll(async () => (await get(request)).preview.progress)
    .toBeCloseTo(0.4, 5);
  await page.keyboard.press("Alt+ArrowRight");
  await expect
    .poll(async () => (await get(request)).preview.progress)
    .toBeCloseTo(0.8, 5);
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { name: "暂停 (Space)", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await get(request)).preview.progress)
    .toBeGreaterThan(0.8);
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("button", { name: "播放预览 (Space)", exact: true }),
  ).toBeVisible();
});

test("交互：MCP 分割嵌套合成保存重开，切点前后离线导出与原画面一致", async ({
  page,
  request,
  browser,
}) => {
  const original = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  const offline = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  const client = await connect();
  try {
    await original.goto(`${base}/api/preview`);
    await page.goto("/");
    const revision = (await get(request)).revision;
    const result = await client.callTool({
      name: "edit_project",
      arguments: {
        expectedRevision: revision,
        label: "Agent 分割嵌套组件",
        commands: [
          {
            type: "element.split",
            compositionId: "main",
            elementId: "product",
            at: 0.3,
            newId: "productTail",
          },
          {
            type: "element.split",
            compositionId: "main",
            elementId: "cardsInstance",
            at: 0.68,
            newId: "cardsTail",
          },
        ],
      },
    });
    expect(result.isError).toBeFalsy();
    await expect(
      page.getByText("横向卡片 · 子合成 · 后段", { exact: true }).first(),
    ).toBeVisible();
    const split = await get(request);
    const saved = await act(request, "save_project", {
      expectedRevision: split.revision,
      filename: "split-roundtrip",
    });
    const restored = JSON.parse(fs.readFileSync(saved.path, "utf8"));
    await edit(request, [{ type: "project.replace", project: blankProject() }]);
    await edit(request, [{ type: "project.replace", project: restored }]);
    const html = await act(request, "export_html", {
      expectedRevision: (await get(request)).revision,
      filename: "split-offline",
    });
    await offline.goto(pathToFileURL(html.path).href);
    for (const progress of [
      0.2999, 0.3, 0.3001, 0.6799, 0.68, 0.6801, 0.95, 0.3, 0.1,
    ]) {
      await seek(original, progress);
      await seek(offline, progress);
      expect(
        (await original.screenshot()).equals(await offline.screenshot()),
      ).toBe(true);
    }
    expect(await offline.evaluate(() => window.__SW_ERRORS__)).toEqual([]);
  } finally {
    await original.close();
    await offline.close();
    await client.close();
  }
});

test("未提交文字遇到 Agent 并发修改会提示冲突；隐藏组不泄漏子元素", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByText("主标题 · 淡入上移", { exact: true }).first().click();
  const field = page.getByRole("textbox", { name: "文字内容", exact: true });
  await field.fill("尚未提交的人类修改");
  await edit(request, [
    {
      type: "element.update",
      compositionId: "main",
      elementId: "title",
      patch: { text: "Agent 最新内容" },
    },
  ]);
  await expect(page.locator(".canvas-host [data-element-id=title]")).toHaveText(
    "Agent 最新内容",
  );
  await field.blur();
  await expect(page.getByRole("alert")).toContainText("版本冲突");
  expect(
    (await get(request)).project.compositions.main.elements.find(
      (e) => e.id === "title",
    )!.text,
  ).toBe("Agent 最新内容");
  await edit(request, [
    {
      type: "element.update",
      compositionId: "main",
      elementId: "product",
      patch: { hidden: true },
    },
  ]);
  await expect(page.locator(".canvas-host [data-element-id=case]")).toHaveCSS(
    "visibility",
    "hidden",
  );
});
