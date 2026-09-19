import { z } from "zod";
import { customElements } from "../extensions/registry";
import { properties } from "./constants";
export { properties } from "./constants";
export type AnimProperty = (typeof properties)[number];
export const MAX_TIME = 86400;
export const idSchema = z
  .string()
  .regex(/^[a-zA-Z0-9_-]{1,100}$/)
  .refine(
    (id) =>
      ![
        "__proto__",
        "prototype",
        "constructor",
        "toString",
        "valueOf",
        "hasOwnProperty",
      ].includes(id),
    "保留的 ID",
  );
const finite = z.number().finite().min(-100000).max(100000);
export const seconds = z.number().finite().min(0).max(MAX_TIME);
const color = z.string().regex(/^#[0-9a-fA-F]{3,8}$|^transparent$/);
export const easingSchema = z.union([
  z.enum(["linear", "easeIn", "easeOut", "easeInOut"]),
  z.tuple([
    z.number().min(0).max(1),
    z.number().min(-3).max(3),
    z.number().min(0).max(1),
    z.number().min(-3).max(3),
  ]),
]);
export const keyframeSchema = z
  .object({
    id: idSchema,
    at: finite,
    value: finite,
    easing: easingSchema.default("easeInOut"),
  })
  .strict();
export type Keyframe = z.infer<typeof keyframeSchema>;
const channels = z
  .object(
    Object.fromEntries(
      properties.map((p) => [p, z.array(keyframeSchema).max(2000).optional()]),
    ) as Record<AnimProperty, z.ZodOptional<z.ZodArray<typeof keyframeSchema>>>,
  )
  .strict();
export const elementSchema = z
  .object({
    id: idSchema,
    name: z.string().max(200),
    type: z.enum([
      "text",
      "image",
      "svg",
      "video",
      "shape",
      "group",
      "composition",
      "custom",
    ]),
    parentId: idSchema.nullable().default(null),
    trackId: idSchema.default("track_main"),
    start: seconds.default(0),
    end: seconds.default(5),
    // Source-clock seconds. Cuts change sourceIn; moves never change it or keys.
    sourceIn: finite.default(0),
    speed: z.number().min(0.001).max(1000).default(1),
    sourceDuration: seconds.optional(),
    x: finite.default(0),
    y: finite.default(0),
    width: z.number().min(1).max(20000).default(400),
    height: z.number().min(1).max(20000).default(200),
    scaleX: finite.default(1),
    scaleY: finite.default(1),
    rotation: finite.default(0),
    opacity: z.number().min(0).max(1).default(1),
    fill: color.default("#c4f36b"),
    color: color.default("#f8fafc"),
    text: z.string().max(20000).default(""),
    fontSize: z.number().min(1).max(1000).default(64),
    fontWeight: z.number().min(100).max(900).default(500),
    radius: z.number().min(0).max(20000).default(0),
    clip: z.boolean().default(false),
    hidden: z.boolean().default(false),
    locked: z.boolean().default(false),
    crop: z
      .object({
        top: z.number().min(0).max(49),
        right: z.number().min(0).max(49),
        bottom: z.number().min(0).max(49),
        left: z.number().min(0).max(49),
      })
      .default({ top: 0, right: 0, bottom: 0, left: 0 }),
    assetId: idSchema.optional(),
    compositionId: idSchema.optional(),
    customType: idSchema.optional(),
    customData: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .default({}),
    tracks: channels.default({}),
    volume: z.number().min(0).max(1).default(1),
    muted: z.boolean().default(false),
    layout: z
      .object({
        anchor: z.enum(["top-left", "center"]).default("top-left"),
        responsive: z.enum(["scale", "crop"]).default("scale"),
      })
      .default({ anchor: "top-left", responsive: "scale" }),
    href: z
      .string()
      .max(2000)
      .refine(
        (s) => !s || /^(https?:\/\/|mailto:|#)/i.test(s),
        "链接必须是 http(s)、mailto 或页面锚点",
      )
      .default(""),
  })
  .strict();
export type Element = z.infer<typeof elementSchema>;
export type Clip = Element;
export const trackSchema = z
  .object({
    id: idSchema,
    name: z.string().max(100),
    locked: z.boolean().default(false),
    hidden: z.boolean().default(false),
  })
  .strict();
export type Track = z.infer<typeof trackSchema>;
export const compositionSchema = z
  .object({
    id: idSchema,
    name: z.string().max(200),
    width: z.number().min(1).max(20000).default(1920),
    height: z.number().min(1).max(20000).default(1080),
    background: color.default("#101312"),
    duration: seconds.min(0.01).default(10),
    tracks: z
      .array(trackSchema)
      .min(1)
      .max(100)
      .default([
        { id: "track_main", name: "主轨道", locked: false, hidden: false },
      ]),
    elements: z.array(elementSchema).max(1000),
  })
  .strict();
export type Composition = z.infer<typeof compositionSchema>;
const relative = z
  .string()
  .max(600)
  .refine(
    (p) =>
      !p.includes("\\") &&
      !p.startsWith("/") &&
      !p.includes(":") &&
      !p.split("/").some((s) => !s || s === ".." || s === "."),
    "必须是安全的相对路径",
  );
export const assetSchema = z
  .object({
    id: idSchema,
    name: z.string().max(300),
    kind: z.enum(["image", "svg", "video", "composition"]),
    mime: z.string().max(100),
    path: relative
      .refine((p) => p.startsWith("assets/"), "素材必须位于 assets 目录")
      .optional(),
    cachePath: relative.optional(),
    deliveryPath: relative.optional(),
    thumbnail: relative.optional(),
    data: z.string().max(750_000_000).optional(),
    width: z.number().min(0).max(40000).default(0),
    height: z.number().min(0).max(40000).default(0),
    duration: seconds.optional(),
    hash: z.string().max(128).default(""),
    size: z.number().nonnegative().default(0),
    status: z.enum(["ready", "missing", "error"]).default("ready"),
    error: z.string().max(2000).optional(),
    codec: z.string().max(100).optional(),
    audioCodec: z.string().max(100).optional(),
    hasAudio: z.boolean().default(false),
    compositionId: idSchema.optional(),
    archived: z.boolean().default(false),
    warnings: z.array(z.string()).default([]),
  })
  .strict();
export type Asset = z.infer<typeof assetSchema>;
export const sectionSchema = z
  .object({
    id: idSchema,
    compositionId: idSchema,
    kind: z.enum(["pin", "flow"]),
    scrollDistance: z.number().min(100).max(100000),
    start: seconds.default(0),
    end: seconds.nullable().default(null),
    name: z.string().max(100).default("滚动区间"),
  })
  .strict();
export const projectSchema = z
  .object({
    format: z.literal("scrollweave"),
    version: z.literal(2),
    id: idSchema,
    name: z.string().min(1).max(200),
    canvas: z
      .object({
        width: z.literal(1920),
        height: z.literal(1080),
        fit: z.enum(["contain", "cover"]),
      })
      .strict(),
    scroll: z
      .object({
        mode: z.enum(["exact", "smooth"]),
        smoothing: z.number().min(30).max(3000),
      })
      .strict(),
    compositions: z.record(z.string(), compositionSchema),
    assets: z.record(z.string(), assetSchema),
    sections: z.array(sectionSchema).min(1).max(30),
    migration: z
      .object({
        fromVersion: z.literal(1),
        secondsPerComposition: z.number(),
        note: z.string(),
      })
      .optional(),
  })
  .strict();
export type Project = z.infer<typeof projectSchema>;
export type Section = Project["sections"][number];
export const uid = (prefix = "id") =>
  `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
export const clone = <T>(value: T): T => structuredClone(value);
export const createElement = (
  input: Partial<Element> & Pick<Element, "type">,
): Element =>
  elementSchema.parse({ id: uid("clip"), name: "新片段", ...input });
export { assetURL, thumbnailURL } from "./media-url";
export const references = (p: Project, assetId: string) =>
  Object.values(p.compositions).flatMap((c) =>
    c.elements
      .filter((e) => e.assetId === assetId)
      .map((e) => ({
        compositionId: c.id,
        compositionName: c.name,
        clipId: e.id,
        name: e.name,
      })),
  );
export function validateProject(input: unknown): Project {
  const p = projectSchema.parse(input);
  if (
    Object.keys(p.compositions).length > 100 ||
    Object.keys(p.assets).length > 2000
  )
    throw Error("作品超过合成或素材数量限制");
  for (const map of [p.compositions, p.assets])
    for (const [id, v] of Object.entries(map))
      if (id !== v.id || !idSchema.safeParse(id).success)
        throw Error("无效映射 ID");
  for (const a of Object.values(p.assets)) {
    if (a.kind === "composition") {
      if (!a.compositionId || !p.compositions[a.compositionId])
        throw Error("复合素材引用不存在");
      continue;
    }
    if (
      a.data &&
      (!a.data.startsWith(`data:${a.mime};base64,`) ||
        !/^[A-Za-z0-9+/]+=*$/.test(a.data.split(",")[1] ?? ""))
    )
      throw Error("素材必须是内嵌数据或作品目录相对引用");
    if (!a.path && !a.data) throw Error(`素材 ${a.name} 缺少来源`);
    if (
      a.status === "ready" &&
      ![
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/svg+xml",
        "video/mp4",
        "video/webm",
      ].includes(a.mime)
    )
      throw Error("不支持的素材类型");
  }
  const sections = new Set<string>();
  for (const s of p.sections) {
    if (!p.compositions[s.compositionId] || sections.has(s.id))
      throw Error("页面区间引用或 ID 无效");
    sections.add(s.id);
    if (s.end !== null && s.end <= s.start)
      throw Error("滚动区间终点必须晚于起点");
  }
  for (const c of Object.values(p.compositions)) {
    const ids = new Set(c.elements.map((e) => e.id)),
      lanes = new Set(c.tracks.map((t) => t.id));
    if (ids.size !== c.elements.length || lanes.size !== c.tracks.length)
      throw Error("片段或轨道 ID 重复");
    for (const e of c.elements) {
      if (e.end <= e.start) throw Error(`${e.name}: 结束时间必须大于开始时间`);
      if (!lanes.has(e.trackId)) throw Error(`${e.name}: 轨道不存在`);
      if (
        ["image", "svg", "video"].includes(e.type) &&
        (!e.assetId || !p.assets[e.assetId])
      )
        throw Error(`${e.name}: 素材不存在`);
      if (e.type === "video" && e.assetId) {
        const a = p.assets[e.assetId];
        if (a.kind !== "video" || e.sourceIn < 0)
          throw Error("无效视频源取用范围");
      }
      if (
        e.type === "composition" &&
        (!e.compositionId || !p.compositions[e.compositionId])
      )
        throw Error("子合成不存在");
      if (
        e.type === "custom" &&
        (!e.customType || !customElements.has(e.customType))
      )
        throw Error("自定义元素未注册");
      const seen = new Set([e.id]);
      let parent = e.parentId;
      while (parent) {
        if (seen.has(parent)) throw Error("禁止循环分组");
        seen.add(parent);
        const node = c.elements.find((n) => n.id === parent);
        if (!node || node.type !== "group")
          throw Error("父对象必须是同一合成的分组");
        parent = node.parentId;
      }
      for (const [prop, keys] of Object.entries(e.tracks)) {
        const ki = new Set<string>(),
          kt = new Set<number>();
        for (const k of keys) {
          if (ki.has(k.id) || kt.has(k.at)) throw Error("关键帧 ID 或位置重复");
          if (prop === "opacity" && (k.value < 0 || k.value > 1))
            throw Error("透明度必须在 0 到 1 之间");
          ki.add(k.id);
          kt.add(k.at);
        }
        keys.sort((a, b) => a.at - b.at);
      }
    }
    c.duration = Math.max(
      c.duration,
      ...c.elements.filter((e) => !e.parentId).map((e) => e.end),
    );
  }
  for (const s of p.sections) {
    const duration = p.compositions[s.compositionId].duration;
    if (s.start >= duration || (s.end !== null && s.end > duration + 1e-6))
      throw Error("滚动映射必须位于时间线时长内");
  }
  for (const a of Object.values(p.assets))
    if (a.kind === "composition") {
      const c = p.compositions[a.compositionId!];
      a.width = c.width;
      a.height = c.height;
      a.duration = c.duration;
    }
  const visit = (id: string, stack: string[]): number => {
    if (stack.includes(id)) throw Error("禁止循环嵌套合成");
    if (stack.length > 16) throw Error("嵌套最多 16 层");
    let count = p.compositions[id].elements.length;
    for (const e of p.compositions[id].elements)
      if (e.type === "composition")
        count += visit(e.compositionId!, [...stack, id]);
    if (count > 5000) throw Error("展开后最多 5000 个片段");
    return count;
  };
  for (const id of Object.keys(p.compositions)) visit(id, []);
  return p;
}
export function blankProject(): Project {
  return validateProject({
    format: "scrollweave",
    version: 2,
    id: uid("project"),
    name: "未命名作品",
    canvas: { width: 1920, height: 1080, fit: "contain" },
    scroll: { mode: "exact", smoothing: 180 },
    compositions: {
      main: { id: "main", name: "主时间线", duration: 10, elements: [] },
    },
    assets: {},
    sections: [
      { id: "stage", compositionId: "main", kind: "pin", scrollDistance: 4800 },
    ],
  });
}
