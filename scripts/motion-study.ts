import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  assetSchema,
  createElement,
  validateProject,
  type Composition,
  type Element,
  type Keyframe,
  type Project,
} from "../src/core/model";
import { sampleComposition } from "../src/core/evaluate";

// Rebuild the currently open example through its revision-checked editing API.
// A portable backup is saved before replacing its timeline.
const client = new Client({ name: "motion-study-builder", version: "1.0.0" });
const origin = process.env.SCROLLWEAVE_URL ?? "http://127.0.0.1:4100";
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw Error(JSON.stringify(result.content));
  if (!Array.isArray(result.content)) throw Error("Missing tool content");
  const item = result.content.find((item) => item.type === "text");
  if (!item || typeof item.text !== "string") throw Error("Missing tool result");
  return JSON.parse(item.text);
}
const ink = "#111b18",
  cream = "#f0f1e4",
  lime = "#d4f798",
  lilac = "#b6a5ed";
const coral = "#f09d80";
const glide: Keyframe["easing"] = [0.22, 1, 0.36, 1];
const soft: Keyframe["easing"] = [0.45, 0, 0.55, 1];
function keys(
  points: [number, number][],
  easing: Keyframe["easing"] = soft,
): Keyframe[] {
  return points.map(([at, value], i) => ({ id: `k${i}`, at, value, easing }));
}
function reveal(at = 0.8) {
  return keys(
    [
      [0, 0],
      [at, 0],
      [at + 0.85, 1],
    ],
    glide,
  );
}
const svg = (width: number, height: number, content: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;

function scene(id: string, name: string, duration: number, index: number) {
  const c: Composition = {
    id,
    name,
    duration,
    width: 1920,
    height: 1080,
    background: ink,
    tracks: [],
    elements: [],
  };
  function add(input: Partial<Element> & Pick<Element, "type">) {
    const n = c.elements.length,
      tid = `lane_${n + 1}`;
    c.tracks.push({
      id: tid,
      name: `轨道 ${n + 1}`,
      hidden: false,
      locked: false,
    });
    const element = createElement({
      id: `${id}_${n}`,
      trackId: tid,
      end: duration,
      width: 1920,
      height: 1080,
      fill: "transparent",
      color: cream,
      ...input,
    });
    c.elements.push(element);
    return element;
  }
  function text(
    name: string,
    x: number,
    y: number,
    size: number,
    content: string,
    extra: Partial<Element> = {},
  ) {
    return add({
      type: "text",
      name,
      x,
      y,
      width: 1650,
      height: size * 1.2,
      fontSize: size,
      fontWeight: 500,
      text: content,
      ...extra,
    });
  }
  function shape(
    name: string,
    x: number,
    y: number,
    width: number,
    height: number,
    fill: string,
    extra: Partial<Element> = {},
  ) {
    return add({ type: "shape", name, x, y, width, height, fill, ...extra });
  }
  function image(
    name: string,
    assetId: string,
    x: number,
    y: number,
    width: number,
    height: number,
    extra: Partial<Element> = {},
  ) {
    return add({ type: "svg", name, assetId, x, y, width, height, ...extra });
  }
  function header() {
    shape("页眉标记", 104, 65, 12, 12, lime, { radius: 6 });
    text("标识", 134, 60, 23, "SIGNAL / MOTION", {
      fontWeight: 650,
      width: 550,
    });
    text("期号", 1530, 62, 18, "STUDIES IN MOVEMENT", {
      color: "#91a297",
      width: 300,
    });
    shape("页脚基线", 104, 971, 1712, 1, "#435249");
    shape("全片进度", 104, 971, 1712, 2, lime, {
      tracks: {
        scaleX: keys(
          [
            [0, [0, 7, 15, 23][index] / 30],
            [duration, [7, 15, 23, 30][index] / 30],
          ],
          "linear",
        ),
      },
    });
    text("章节号", 104, 995, 18, `0${index + 1} / 04`, {
      color: lime,
      width: 200,
    });
    text(
      "章节说明",
      320,
      995,
      18,
      [
        "FORM FINDS ITS FLOW",
        "A RHYTHM OF ITS OWN",
        "EVERY FRAME CONNECTED",
        "MADE TO MOVE YOU",
      ][index],
      { color: "#91a297", width: 1000 },
    );
    text("时长标记", 1660, 995, 18, "00:30 / 2026", {
      width: 200,
      color: "#91a297",
    });
  }
  function transitions(inColor?: string, outColor?: string) {
    if (inColor)
      shape("接续擦入", 0, 0, 1920, 1080, inColor, {
        start: 0,
        end: 0.7,
        tracks: {
          x: keys(
            [
              [0, 0],
              [0.65, 1920],
            ],
            "easeOut",
          ),
        },
      });
    if (outColor)
      shape("连续擦出", -1920, 0, 1920, 1080, outColor, {
        start: duration - 0.65,
        end: duration,
        tracks: {
          x: keys(
            [
              [0, -1920],
              [0.65, 0],
            ],
            "easeIn",
          ),
        },
      });
  }
  return { c, add, text, shape, image, header, transitions };
}

await client.connect(
  new StreamableHTTPClientTransport(new URL(origin + "/mcp")),
);
try {
  const info = await call("workspace_info");
  const initial = await call("read_project");
  await call("list_assets");
  assert.equal(
    path.resolve(info.directory),
    path.resolve("E:/ScrollWeaveProjects/Signal-and-Motion-v2"),
    "Unexpected active workspace",
  );
  const backup = await call("save_project", {
    filename: `before-motion-study-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    expectedRevision: initial.revision,
  });
  console.log("Original project backed up:", backup.package);
  const art: Record<string, string> = {};
  const gridLines =
    Array.from({ length: 25 }, (_, i) => `<path d="M${i * 80} 0V1080"/>`).join(
      "",
    ) +
    Array.from({ length: 15 }, (_, i) => `<path d="M0 ${i * 80}H1920"/>`).join(
      "",
    );
  art["study-grid.svg"] = svg(
    1920,
    1080,
    `<g fill="none" stroke="#52695b" stroke-opacity="0.16" stroke-width="1">${gridLines}</g>`,
  );
  const mesh =
    Array.from({ length: 23 }, (_, i) => {
      const angle = (i * Math.PI) / 22;
      return `<ellipse cx="360" cy="360" rx="${Math.max(2, Math.abs(Math.cos(angle)) * 300)}" ry="300"/>`;
    }).join("") +
    Array.from({ length: 17 }, (_, i) => {
      const y = -280 + i * 35;
      return `<ellipse cx="360" cy="${360 + y}" rx="${Math.sqrt(90000 - y * y)}" ry="${22 + 45 * (1 - Math.abs(y) / 300)}"/>`;
    }).join("");
  art["study-orbit.svg"] = svg(
    720,
    720,
    `<defs><linearGradient id="wire" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${lime}"/><stop offset=".5" stop-color="#8ba682"/><stop offset="1" stop-color="#344c3f"/></linearGradient></defs><g fill="none" stroke="url(#wire)" stroke-width="1.3" transform="rotate(-25 360 360)">${mesh}</g><circle cx="360" cy="360" r="324" fill="none" stroke="#71866f" stroke-dasharray="2 16"/>`,
  );
  art["study-sphere.svg"] = svg(
    420,
    420,
    `<defs><radialGradient id="sphere" cx="30%" cy="25%" r="78%"><stop stop-color="#f5ffd5"/><stop offset=".35" stop-color="${lime}"/><stop offset=".74" stop-color="#60845a"/><stop offset="1" stop-color="#1e382a"/></radialGradient></defs><circle cx="210" cy="210" r="200" fill="url(#sphere)"/><ellipse cx="180" cy="88" rx="70" ry="15" fill="#f9ffe8" opacity=".27"/>`,
  );
  const ribbons = Array.from({ length: 34 }, (_, i) => {
    const v = i * 15;
    return `<path d="M${70 + v} 570C${-130 + v} 370 ${680 - v} 90 ${580 - v} 30"/>`;
  }).join("");
  art["study-ribbon.svg"] = svg(
    680,
    620,
    `<g fill="none" stroke="${lilac}" stroke-width="3" stroke-opacity=".78">${ribbons}</g>`,
  );
  art["study-spark.svg"] = svg(
    240,
    240,
    `<g fill="none" stroke="${lime}" stroke-width="14" stroke-linecap="round">${Array.from({ length: 12 }, (_, i) => `<path d="M120 17V seventy" transform="rotate(${i * 30} 120 120)"/>`.replace("seventy", "70")).join("")}</g>`,
  );
  const assets: Record<string, string> = {};
  for (const [filename, data] of Object.entries(art)) {
    const destination = path.join(info.assetDirectory, filename);
    await fs.writeFile(destination + ".tmp", data);
    await fs.rename(destination + ".tmp", destination);
    const result = await call("wait_for_asset", { path: "assets/" + filename });
    assets[filename] = result.asset.id;
  }
  const current = await call("read_project");
  const project: Project = structuredClone(current.project);
  const originalVideo = Object.values(project.assets).find(
    (a) => a.kind === "video" && a.status === "ready" && (a.duration ?? 0) >= 8,
  );
  const originalImage = Object.values(project.assets).find(
    (a) => a.kind === "image" && a.status === "ready",
  );
  assert.ok(
    originalVideo && originalImage,
    "Example needs its original video and still image",
  );
  const grid = assets["study-grid.svg"],
    orbit = assets["study-orbit.svg"],
    sphere = assets["study-sphere.svg"],
    ribbon = assets["study-ribbon.svg"],
    spark = assets["study-spark.svg"];
  const a = scene("study_form", "01 · 形体入场", 7, 0);
  a.image("空间网格", grid, 0, 0, 1920, 1080, { opacity: 0.32 });
  a.text("序言", 108, 206, 23, "LESS NOISE. MORE FEELING.", {
    color: lime,
    tracks: {
      opacity: reveal(0.2),
      y: keys(
        [
          [0, 230],
          [0.2, 230],
          [1.2, 206],
        ],
        glide,
      ),
    },
  });
  a.text("标题上行", 96, 318, 164, "IN", {
    fontWeight: 750,
    width: 820,
    height: 205,
    tracks: {
      opacity: reveal(0.15),
      y: keys(
        [
          [0, 398],
          [0.15, 398],
          [1.45, 318],
        ],
        glide,
      ),
    },
  });
  a.text("标题下行", 96, 492, 164, "MOTION.", {
    fontWeight: 750,
    width: 920,
    height: 205,
    tracks: {
      opacity: reveal(0.38),
      y: keys(
        [
          [0, 582],
          [0.38, 582],
          [1.7, 492],
        ],
        glide,
      ),
    },
  });
  a.text("中文副题", 108, 766, 30, "让形状流动，让时间有节奏。", {
    color: "#a6b5a8",
    tracks: {
      opacity: reveal(1.1),
      y: keys(
        [
          [0, 799],
          [1.1, 799],
          [2.2, 766],
        ],
        glide,
      ),
    },
  });
  a.shape("副题划线", 108, 853, 318, 3, lime, {
    tracks: {
      scaleX: keys(
        [
          [0, 0],
          [1.2, 0],
          [2.8, 1],
        ],
        glide,
      ),
    },
  });
  // Rotate around the visual centre by animating a group and offsetting its child.
  const globe = a.add({
    type: "group",
    name: "旋转线框球",
    x: 1385,
    y: 538,
    width: 1,
    height: 1,
    tracks: {
      opacity: reveal(0.15),
      rotation: keys(
        [
          [0, -22],
          [7, 38],
        ],
        "linear",
      ),
      scaleX: keys(
        [
          [0, 0.68],
          [2.6, 1],
          [7, 1.04],
        ],
        glide,
      ),
      scaleY: keys(
        [
          [0, 0.68],
          [2.6, 1],
          [7, 1.04],
        ],
        glide,
      ),
    },
  });
  a.image("球体网格", orbit, -382, -382, 764, 764, { parentId: globe.id });
  a.image("浮动光球", sphere, 1478, 607, 220, 220, {
    tracks: {
      y: keys(
        [
          [0, 650],
          [2, 607],
          [4.2, 570],
          [6.7, 607],
        ],
        soft,
      ),
      x: keys(
        [
          [0, 1570],
          [2.1, 1478],
          [5, 1510],
          [7, 1478],
        ],
        glide,
      ),
      opacity: reveal(0.65),
    },
  });
  a.shape("轨道上的光点", 1318, 214, 17, 17, lime, {
    radius: 9,
    tracks: {
      x: keys(
        Array.from(
          { length: 29 },
          (_, i) =>
            [i / 4, 1385 + 330 * Math.cos((i / 28) * Math.PI * 1.4 - 1.8)] as [
              number,
              number,
            ],
        ),
        "linear",
      ),
      y: keys(
        Array.from(
          { length: 29 },
          (_, i) =>
            [i / 4, 538 + 330 * Math.sin((i / 28) * Math.PI * 1.4 - 1.8)] as [
              number,
              number,
            ],
        ),
        "linear",
      ),
    },
  });
  a.text("右侧注记", 1190, 888, 19, "001 / FORM IN ORBIT", {
    color: "#91a297",
    width: 540,
    tracks: { opacity: reveal(1.4) },
  });
  a.header();
  a.transitions(undefined, lime);

  const b = scene("study_rhythm", "02 · 素材的节奏", 8, 1);
  b.text("段落标题", 104, 167, 92, "A rhythm of its own.", {
    fontWeight: 650,
    tracks: {
      opacity: reveal(0.5),
      y: keys(
        [
          [0, 213],
          [0.5, 213],
          [1.55, 167],
        ],
        glide,
      ),
    },
  });
  b.text("段落副题", 108, 286, 26, "同一段素材，不同的时刻。", {
    color: "#a6b5a8",
    tracks: { opacity: reveal(0.8) },
  });
  const cards = [
    {
      x: 104,
      y: 432,
      w: 518,
      h: 338,
      color: lime,
      label: "01 / CAPTURE",
      sub: "静帧 · 保留一瞬",
      type: "image" as const,
      assetId: originalImage.id,
    },
    {
      x: 662,
      y: 380,
      w: 594,
      h: 438,
      color: lilac,
      label: "02 / REFRAME",
      sub: "动态 · 让画面呼吸",
      type: "video" as const,
      assetId: originalVideo.id,
    },
    {
      x: 1296,
      y: 432,
      w: 518,
      h: 338,
      color: coral,
      label: "03 / CONNECT",
      sub: "向量 · 接上新的节奏",
      type: "svg" as const,
      assetId: ribbon,
    },
  ];
  cards.forEach((card, i) => {
    const at = 0.65 + i * 0.16;
    const group = b.add({
      type: "group",
      name: card.label,
      x: card.x,
      y: card.y,
      width: card.w,
      height: 530,
      tracks: {
        y: keys(
          [
            [0, card.y + 150],
            [at, card.y + 150],
            [at + 1.25, card.y],
            [5, card.y - 18],
            [7.4, card.y],
          ],
          glide,
        ),
        opacity: reveal(at),
        rotation: keys(
          [
            [0, (i - 1) * 7],
            [at, (i - 1) * 7],
            [at + 1.5, 0],
          ],
          glide,
        ),
      },
    });
    b.shape("卡片底", 0, 0, card.w, card.h, i === 2 ? "#242137" : "#294033", {
      parentId: group.id,
      radius: 18,
    });
    b.add({
      type: card.type,
      name: card.sub,
      assetId: card.assetId,
      parentId: group.id,
      x: i === 2 ? 48 : 12,
      y: i === 2 ? 0 : 12,
      width: i === 2 ? 424 : card.w - 24,
      height: card.h - 24,
      start: 0,
      end: 8,
      radius: 12,
      clip: true,
      muted: true,
      tracks: {
        scaleX: keys(
          [
            [0, 1.035],
            [8, 1],
          ],
          soft,
        ),
        scaleY: keys(
          [
            [0, 1.035],
            [8, 1],
          ],
          soft,
        ),
      },
    });
    b.shape("卡片色条", 0, card.h + 24, 31, 3, card.color, {
      parentId: group.id,
    });
    b.text("卡片标签", 47, card.h + 16, 21, card.label, {
      parentId: group.id,
      color: card.color,
      width: 440,
    });
    b.text("卡片说明", 0, card.h + 54, 23, card.sub, {
      parentId: group.id,
      color: "#a6b5a8",
      width: 520,
    });
  });
  b.header();
  b.transitions(lime, cream);

  const d = scene("study_flow", "03 · 波形与连接", 8, 2);
  d.image("空间网格", grid, 0, 0, 1920, 1080, { opacity: 0.25 });
  d.text("节拍标题", 104, 170, 112, "EVERY FRAME", {
    fontWeight: 750,
    tracks: {
      opacity: reveal(0.45),
      x: keys(
        [
          [0, 30],
          [0.45, 30],
          [1.8, 104],
        ],
        glide,
      ),
    },
  });
  d.text("节拍标题下行", 104, 293, 112, "CONNECTED.", {
    fontWeight: 750,
    color: lilac,
    tracks: {
      opacity: reveal(0.65),
      x: keys(
        [
          [0, 30],
          [0.65, 30],
          [2, 104],
        ],
        glide,
      ),
    },
  });
  d.text("节拍副题", 1245, 267, 28, "快与慢之间，\n留一点呼吸。", {
    width: 480,
    height: 100,
    color: "#a6b5a8",
    tracks: { opacity: reveal(1) },
  });
  // Independent phased envelopes provide actual editable animation channels.
  for (let i = 0; i < 32; i++) {
    const points: [number, number][] = [
      [0, 0.025],
      [0.6 + i * 0.018, 0.025],
    ];
    for (let frame = 0; frame <= 12; frame++) {
      const t = 1.6 + frame * 0.43;
      const amp =
        0.12 +
        0.74 * Math.pow((Math.sin(i * 0.32 - frame * 0.68) + 1) / 2, 1.4);
      points.push([t, amp]);
    }
    const barHeight = 360;
    d.shape(
      `节奏柱 ${i + 1}`,
      108 + i * 53,
      850,
      34,
      barHeight,
      i < 11 ? lime : i < 22 ? lilac : coral,
      {
        radius: 17,
        tracks: {
          scaleY: keys(points, soft),
          y: keys(
            points.map(([t, v]) => [t, 850 - barHeight * v]),
            soft,
          ),
        },
      },
    );
  }
  d.shape("波形基线", 104, 867, 1712, 1, "#526958");
  d.text("节奏注记", 108, 900, 19, "STAGGER / OVERLAP / EASE / REPEAT", {
    color: "#91a297",
    tracks: { opacity: reveal(1.3) },
  });
  d.header();
  d.transitions(cream, lilac);

  const e = scene("study_resolve", "04 · 收束与留白", 7, 3);
  e.text("结束前言", 104, 182, 22, "COMPLEX MOTION. SIMPLE TIMELINE.", {
    color: lime,
    tracks: { opacity: reveal(0.55) },
  });
  e.text("片尾上行", 104, 310, 146, "MADE TO", {
    fontWeight: 750,
    width: 1240,
    height: 185,
    tracks: {
      opacity: reveal(0.65),
      y: keys(
        [
          [0, 390],
          [0.65, 390],
          [2, 310],
        ],
        glide,
      ),
    },
  });
  e.text("片尾下行", 104, 472, 146, "MOVE YOU.", {
    fontWeight: 750,
    color: lime,
    width: 1300,
    height: 185,
    tracks: {
      opacity: reveal(0.82),
      y: keys(
        [
          [0, 552],
          [0.82, 552],
          [2.2, 472],
        ],
        glide,
      ),
    },
  });
  e.text("片尾中文", 110, 724, 30, "四段场景，一条时间线。", {
    color: "#a6b5a8",
    tracks: { opacity: reveal(1.35) },
  });
  e.shape("片尾短线", 110, 808, 425, 3, lime, {
    tracks: {
      scaleX: keys(
        [
          [0, 0],
          [1.5, 0],
          [3, 1],
        ],
        glide,
      ),
    },
  });
  const mark = e.add({
    type: "group",
    name: "慢慢停下的星芒",
    x: 1510,
    y: 520,
    width: 1,
    height: 1,
    tracks: {
      rotation: keys(
        [
          [0, -135],
          [3.8, 0],
          [7, 18],
        ],
        glide,
      ),
      scaleX: keys(
        [
          [0, 0.35],
          [0.6, 0.35],
          [2.5, 1],
          [7, 1.06],
        ],
        glide,
      ),
      scaleY: keys(
        [
          [0, 0.35],
          [0.6, 0.35],
          [2.5, 1],
          [7, 1.06],
        ],
        glide,
      ),
      opacity: reveal(0.65),
    },
  });
  e.image("星芒", spark, -192, -192, 384, 384, { parentId: mark.id });
  e.image("漂浮光球", sphere, 1605, 726, 105, 105, {
    tracks: {
      y: keys(
        [
          [0, 816],
          [1, 816],
          [3, 726],
          [7, 702],
        ],
        glide,
      ),
      opacity: reveal(1),
    },
  });
  e.text("片尾签名", 1300, 875, 18, "SIGNAL / MOTION — STUDY 002", {
    width: 600,
    color: "#91a297",
    tracks: { opacity: reveal(1.8) },
  });
  e.header();
  e.transitions(lilac);

  const scenes = [a.c, b.c, d.c, e.c];
  // Keep source assets, remove only old compound definitions from the new edit.
  project.assets = Object.fromEntries(
    Object.entries(project.assets).filter(
      ([, asset]) => asset.kind !== "composition",
    ),
  );
  project.compositions = {};
  const main: Composition = {
    id: "main",
    name: "主时间线",
    width: 1920,
    height: 1080,
    background: ink,
    duration: 30,
    tracks: [
      { id: "track_main", name: "轨道 1", hidden: false, locked: false },
    ],
    elements: [],
  };
  let at = 0;
  for (const c of scenes) {
    project.compositions[c.id] = c;
    const asset = assetSchema.parse({
      id: `asset_${c.id}`,
      name: c.name,
      kind: "composition",
      mime: "application/x-scrollweave-composition",
      compositionId: c.id,
      width: 1920,
      height: 1080,
      duration: c.duration,
    });
    project.assets[asset.id] = asset;
    main.elements.push(
      createElement({
        id: `clip_${c.id}`,
        type: "composition",
        name: c.name,
        trackId: "track_main",
        assetId: asset.id,
        compositionId: c.id,
        width: 1920,
        height: 1080,
        start: at,
        end: at + c.duration,
        sourceDuration: c.duration,
      }),
    );
    at += c.duration;
  }
  project.compositions.main = main;
  project.name = "SIGNAL / MOTION · 流动研究";
  project.scroll = { mode: "smooth", smoothing: 150 };
  project.sections = [
    {
      id: "stage",
      compositionId: "main",
      kind: "pin",
      scrollDistance: 9600,
      start: 0,
      end: 30,
      name: "流动研究 · 四幕",
    },
  ];
  const validated = validateProject(project);
  assert.equal(main.tracks.length, 1);
  assert.equal(main.elements.length, 4);
  const samples = [
    0, 0.5, 3, 6.999, 7, 7.001, 11, 14.999, 15, 15.001, 19, 22.999, 23, 23.001,
    27, 29.999,
  ];
  for (const time of samples) {
    const values = Object.values(sampleComposition(validated, "main", time));
    assert.ok(values.some((v) => v.visible));
    assert.ok(
      values.every((v) =>
        [v.x, v.y, v.rotation, v.scaleX, v.scaleY, v.opacity].every(
          Number.isFinite,
        ),
      ),
    );
  }
  // No source timeline edit may be silently overwritten while art is being imported.
  const latest = await call("read_project");
  assert.deepEqual(
    latest.project.compositions,
    initial.project.compositions,
    "Timeline changed while preparing the study; inspect before replacing",
  );
  await call("edit_project", {
    expectedRevision: latest.revision,
    label: "流动研究 · 单轨四幕与连续转场",
    commands: [{ type: "project.replace", project: validated }],
  });
  await call("set_selection", { compositionId: "main", elementIds: [] });
  await call("set_preview", { compositionId: "main", progress: 2.8 });
  const verification = await call("validate_project");
  const saved = await call("save_project", {
    filename: "signal-motion-study",
    expectedRevision: (await call("read_project")).revision,
  });
  const report = {
    backup: backup.package,
    package: saved.package,
    duration: 30,
    mainTracks: 1,
    mainClips: 4,
    layers: scenes.reduce((n, c) => n + c.elements.length, 0),
    keyframes: scenes.reduce(
      (n, c) =>
        n +
        c.elements.reduce(
          (m, element) =>
            m +
            Object.values(element.tracks).reduce(
              (sum, channel) => sum + channel.length,
              0,
            ),
          0,
        ),
      0,
    ),
    samples,
    verification,
  };
  await fs.mkdir("test-results/motion-study", { recursive: true });
  await fs.writeFile(
    "test-results/motion-study/build.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close();
}
