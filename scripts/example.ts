import fs from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createElement, type Project } from "../src/core/model";
import { processFile } from "../server/assets";
const origin = process.env.SCROLLWEAVE_URL ?? "http://127.0.0.1:4100",
  client = new Client({
    name: "scrollweave-example-builder",
    version: "2.0.0",
  });
const decode = (r: any) => {
  if (r.isError) throw Error(JSON.stringify(r.content));
  return JSON.parse(r.content.find((c: any) => c.type === "text").text);
};
async function call(name: string, args: Record<string, unknown> = {}) {
  return decode(await client.callTool({ name, arguments: args }));
}
const read = () => call("read_project");
async function edit(commands: unknown[], label: string) {
  return call("edit_project", {
    commands,
    label,
    expectedRevision: (await read()).revision,
  });
}
const keys = (start: number, end: number, from: number, to: number) => [
  { id: "from", at: start, value: from, easing: "easeInOut" },
  { id: "to", at: end, value: to, easing: "easeInOut" },
];
const log: string[] = [];
await client.connect(
  new StreamableHTTPClientTransport(new URL(origin + "/mcp")),
);
try {
  const listed = await client.listTools(),
    initial = await read();
  if (
    Object.values(initial.project.compositions as Project["compositions"]).some(
      (c) => c.elements.length,
    )
  )
    throw Error(
      "示例生成需要一个空作品。请先在界面创建新作品；不会覆盖现有内容。",
    );
  const info = await call("workspace_info");
  log.push("真实 MCP 连接：" + listed.tools.length + " 个工具；从空作品开始。");
  const inputs = path.resolve(".scrollweave/example-inputs");
  await fs.mkdir(inputs, { recursive: true });
  const videoPath = path.join(inputs, "tidal-light.mp4"),
    imagePath = path.join(inputs, "still-light.png");
  await processFile("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "nullsrc=s=960x540:r=30:d=8,geq=r='30+24*sin(X/90+T*1.2)+20*cos(Y/80)':g='92+44*sin(X/180+Y/120-T)':b='66+48*cos(X/140-T*0.8)',format=yuv420p",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=220:sample_rate=48000:duration=8",
    "-af",
    "volume=0.05",
    "-c:v",
    "libx264",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    "-shortest",
    videoPath,
  ]);
  await processFile("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-ss",
    "2",
    "-i",
    videoPath,
    "-frames:v",
    "1",
    imagePath,
  ]);
  async function upload(file: string) {
    const response = await fetch(origin + "/api/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(path.basename(file)),
      },
      body: await fs.readFile(file),
    });
    const result: any = await response.json();
    if (!response.ok || result.asset.status !== "ready")
      throw Error(JSON.stringify(result));
    return result.asset;
  }
  const image = await upload(imagePath),
    video = await upload(videoPath);
  if ((await read()).project.compositions.main.elements.length)
    throw Error("导入不应自动创建片段");
  log.push("PNG 与真实 H.264/AAC MP4 通过导入接口进入素材库，时间线仍为空。");
  const arrowPath = path.join(info.assetDirectory, "direction.svg");
  const arrow = (color: string) =>
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180"><circle cx="90" cy="90" r="87" fill="none" stroke="' +
    color +
    '" stroke-width="2"/><path d="M50 90H127M94 55L129 90L94 125" fill="none" stroke="' +
    color +
    '" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  await fs.writeFile(arrowPath + ".tmp", arrow("#c4f36b"));
  await fs.rename(arrowPath + ".tmp", arrowPath);
  const arrowAsset = (
    await call("wait_for_asset", { path: "assets/direction.svg" })
  ).asset;
  log.push("SVG 写入 assets 并被目录监听自动发现，无重启、无再次导入。");
  const trackIds = [
    "hero_art",
    "motion_media",
    "motion_side",
    "motion_labels",
    "motion_labels2",
    "headlines",
    "details",
    "icons",
    "brand",
  ];
  await edit(
    [
      {
        type: "project.update",
        patch: { name: "SIGNAL & MOTION · 素材到故事" },
      },
      {
        type: "composition.update",
        compositionId: "main",
        patch: { duration: 18, background: "#10231c" },
      },
      ...trackIds.map((id, i) => ({
        type: "track.add",
        compositionId: "main",
        track: {
          id,
          name: [
            "开场画面",
            "动态画面",
            "并列画面",
            "卡片文字",
            "并列说明",
            "章节标题",
            "说明与标记",
            "SVG 图标",
            "品牌标记",
          ][i],
        },
      })),
    ],
    "创建作品轨道",
  );
  await edit(
    [
      {
        type: "clip.insert",
        compositionId: "main",
        assetId: image.id,
        trackId: "hero_art",
        at: 0,
        duration: 5,
        newId: "hero_photo",
      },
      {
        type: "clip.insert",
        compositionId: "main",
        assetId: image.id,
        trackId: "motion_side",
        at: 5,
        duration: 8,
        newId: "side_photo",
      },
      {
        type: "clip.insert",
        compositionId: "main",
        assetId: video.id,
        trackId: "motion_media",
        at: 5,
        newId: "motion_video",
      },
      {
        type: "clip.insert",
        compositionId: "main",
        assetId: arrowAsset.id,
        trackId: "icons",
        at: 0,
        duration: 5,
        newId: "hero_arrow",
      },
      {
        type: "clip.insert",
        compositionId: "main",
        assetId: arrowAsset.id,
        trackId: "icons",
        at: 13,
        duration: 5,
        newId: "outro_arrow",
      },
      {
        type: "element.update",
        compositionId: "main",
        elementId: "hero_photo",
        patch: {
          x: 1210,
          y: 240,
          width: 570,
          height: 580,
          crop: { top: 0, right: 18, bottom: 0, left: 18 },
          radius: 24,
          clip: true,
        },
      },
      {
        type: "element.update",
        compositionId: "main",
        elementId: "side_photo",
        patch: {
          x: 1460,
          y: 250,
          width: 940,
          height: 540,
          radius: 22,
          clip: true,
        },
      },
      {
        type: "element.update",
        compositionId: "main",
        elementId: "motion_video",
        patch: {
          x: 120,
          y: 250,
          width: 1200,
          height: 675,
          radius: 22,
          clip: true,
          volume: 0.25,
        },
      },
      {
        type: "element.update",
        compositionId: "main",
        elementId: "hero_arrow",
        patch: { x: 1580, y: 790, width: 160, height: 160 },
      },
      {
        type: "element.update",
        compositionId: "main",
        elementId: "outro_arrow",
        patch: { x: 1570, y: 765, width: 170, height: 170 },
      },
      {
        type: "keyframe.set",
        compositionId: "main",
        elementId: "hero_photo",
        property: "scaleX",
        keyframe: { id: "sx1", at: 0, value: 0.93, easing: "easeOut" },
      },
      {
        type: "keyframe.set",
        compositionId: "main",
        elementId: "hero_photo",
        property: "scaleX",
        keyframe: { id: "sx2", at: 2, value: 1, easing: "easeOut" },
      },
    ],
    "重复使用素材，各实例独立设置画面",
  );
  const beforeDelete = (await read()).project.compositions.main.elements.find(
    (e: any) => e.id === "side_photo",
  );
  await call("delete_clips", {
    expectedRevision: (await read()).revision,
    compositionId: "main",
    elementIds: ["hero_photo"],
  });
  if (
    JSON.stringify(
      (await read()).project.compositions.main.elements.find(
        (e: any) => e.id === "side_photo",
      ),
    ) !== JSON.stringify(beforeDelete)
  )
    throw Error("删除影响其他实例");
  await fs.access(path.join(info.directory, image.path));
  await call("undo", { expectedRevision: (await read()).revision });
  log.push(
    "同一 PNG 创建两个独立实例；删除开场实例后另一实例与源文件保持，撤销恢复。",
  );
  await call("trim_clip", {
    expectedRevision: (await read()).revision,
    compositionId: "main",
    elementId: "hero_photo",
    start: 0.3,
    end: 5,
  });
  await call("split_clip", {
    expectedRevision: (await read()).revision,
    compositionId: "main",
    elementId: "motion_video",
    at: 9,
  });
  let current = await read(),
    tail = current.project.compositions.main.elements.find(
      (e: any) => e.assetId === video.id && e.start === 9,
    );
  if (tail.sourceIn !== 4) throw Error("视频分割源进度错误");
  log.push("静态实例独立左裁边；视频 9 秒处分割，后段源时间从 4 秒继续。");
  const text = (
    id: string,
    trackId: string,
    start: number,
    end: number,
    content: string,
    x: number,
    y: number,
    fontSize: number,
    width = 1500,
    color = "#edf2d5",
  ) => ({
    type: "element.add",
    compositionId: "main",
    element: createElement({
      id,
      type: "text",
      trackId,
      start,
      end,
      text: content,
      name: content.replaceAll("\n", " ").slice(0, 40),
      x,
      y,
      width,
      height: fontSize * 2.6,
      fontSize,
      fontWeight: 600,
      color,
    }),
  });
  await edit(
    [
      text(
        "brand",
        "brand",
        0,
        18,
        "S / SCROLLWEAVE     —     FIELD NOTES 001",
        120,
        80,
        23,
      ),
      text(
        "hero_title",
        "headlines",
        0,
        5,
        "FROM ASSETS\nTO STORIES.",
        120,
        245,
        145,
        1160,
      ),
      text(
        "hero_copy",
        "details",
        0,
        5,
        "让素材进入创作，让时间成为叙事。\n一份图片，一段视频，一个由 Agent 生成的 SVG。",
        128,
        805,
        29,
        1100,
        "#a4b7a3",
      ),
      text(
        "hero_kicker",
        "motion_labels",
        0,
        5,
        "01     /     COLLECT & COMPOSE",
        128,
        175,
        22,
        1100,
        "#c4f36b",
      ),
      text(
        "motion_heading",
        "headlines",
        5,
        13,
        "A LITTLE MOTION. A DIFFERENT FEEL.",
        120,
        150,
        55,
      ),
      text(
        "video_label",
        "motion_labels",
        5,
        13,
        "02 / TIDAL LIGHT     —     8 SEC · H.264 + AAC",
        120,
        965,
        22,
        1250,
        "#b1c2ae",
      ),
      text(
        "image_label",
        "motion_labels2",
        5,
        13,
        "03 / THE SAME SOURCE. A NEW MOMENT.",
        1460,
        850,
        27,
        960,
        "#c4f36b",
      ),
      text(
        "outro_title",
        "headlines",
        13,
        18,
        "ONE TIMELINE.\nMANY WAYS TO FEEL.",
        120,
        280,
        105,
        1680,
      ),
      text(
        "outro_copy",
        "details",
        13,
        18,
        "用播放检查节奏，用滚动探索画面。\n把素材与结构留在本地，把作品带到任何地方。",
        128,
        790,
        30,
        1390,
        "#a4b7a3",
      ),
      text(
        "outro_kicker",
        "motion_labels",
        13,
        18,
        "04     /     MADE TO BE SHARED",
        128,
        190,
        22,
        1200,
        "#c4f36b",
      ),
      ...keys(0, 1.4, 0.3, 1).map((keyframe) => ({
        type: "keyframe.set",
        compositionId: "main",
        elementId: "hero_title",
        property: "opacity",
        keyframe,
      })),
      ...keys(0, 1.4, 290, 245).map((keyframe) => ({
        type: "keyframe.set",
        compositionId: "main",
        elementId: "hero_title",
        property: "y",
        keyframe,
      })),
      ...keys(0, 2.5, 0, 1).map((keyframe) => ({
        type: "keyframe.set",
        compositionId: "main",
        elementId: "outro_title",
        property: "opacity",
        keyframe,
      })),
    ],
    "加入章节文字与独立关键帧",
  );
  await call("create_compound", {
    expectedRevision: (await read()).revision,
    compositionId: "main",
    elementIds: [
      "motion_video",
      tail.id,
      "side_photo",
      "video_label",
      "image_label",
    ],
    name: "横向素材画廊",
  });
  current = await read();
  const gallery = current.project.compositions.main.elements.find(
    (e: any) => e.type === "composition",
  );
  await edit(
    keys(0, 8, 0, -1160).map((keyframe) => ({
      type: "keyframe.set",
      compositionId: "main",
      elementId: gallery.id,
      property: "x",
      keyframe,
    })),
    "复合片段整体横向移动",
  );
  await call("set_preview", {
    compositionId: gallery.compositionId,
    progress: 4,
  });
  await call("set_preview", { compositionId: "main", progress: 7 });
  log.push(
    "图片、视频两段与卡片文字创建共享复合片段，进入内部再返回，外层 X 关键帧横向展示。",
  );
  const clipBefore = (await read()).project.compositions.main.elements.find(
    (e: any) => e.id === "hero_arrow",
  );
  await fs.writeFile(arrowPath, arrow("#edf2d5"));
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const updated = await call("inspect_asset", { assetId: arrowAsset.id });
    if (updated.hash !== arrowAsset.hash && updated.status === "ready") break;
    await new Promise((r) => setTimeout(r, 150));
  }
  if (
    JSON.stringify(
      (await read()).project.compositions.main.elements.find(
        (e: any) => e.id === "hero_arrow",
      ),
    ) !== JSON.stringify(clipBefore)
  )
    throw Error("SVG 更新丢失剪辑");
  log.push("SVG 源文件改色，缩略图与引用更新，剪辑与变换未变。");
  await edit(
    [
      {
        type: "project.update",
        patch: {
          sections: [
            {
              id: "intro",
              compositionId: "main",
              kind: "flow",
              start: 0,
              end: 4,
              scrollDistance: 550,
              name: "纵向进入",
            },
            {
              id: "gallery",
              compositionId: "main",
              kind: "pin",
              start: 4,
              end: 13,
              scrollDistance: 4200,
              name: "固定舞台 · 横向素材",
            },
            {
              id: "outro",
              compositionId: "main",
              kind: "flow",
              start: 13,
              end: 18,
              scrollDistance: 650,
              name: "继续纵向",
            },
          ],
        },
      },
    ],
    "秒数映射到页面滚动",
  );
  await call("set_selection", {
    compositionId: "main",
    elementIds: ["hero_title"],
  });
  await call("set_preview", {
    compositionId: "main",
    progress: 2,
    sectionId: "intro",
  });
  const output = path.resolve("examples/signal-and-motion");
  await fs.mkdir(output, { recursive: true });
  const saved = await call("save_project", {
      expectedRevision: (await read()).revision,
      filename: "signal-and-motion",
    }),
    exported = await call("export_html", {
      expectedRevision: (await read()).revision,
      filename: "signal-and-motion",
    });
  await fs.copyFile(
    saved.package,
    path.join(output, "signal-and-motion.scrollweave.zip"),
  );
  await fs.copyFile(
    exported.path,
    path.join(output, "signal-and-motion.html.zip"),
  );
  current = await read();
  await fs.writeFile(
    path.join(output, "acceptance.json"),
    JSON.stringify(
      {
        workspace: info.directory,
        mcp: info.mcpUrl,
        tools: listed.tools.map((t) => t.name),
        revision: current.revision,
        checks: log,
        delivery: exported.format,
        mainDuration: current.project.compositions.main.duration,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        workspace: info.directory,
        projectPackage: saved.package,
        webPackage: exported.path,
        revision: current.revision,
        checks: log,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
