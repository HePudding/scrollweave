import { z } from "zod";
import { customElements } from "../extensions/registry";

import { properties } from "./constants";
export { properties } from "./constants";
export type AnimProperty = (typeof properties)[number];
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
    at: z.number().min(0).max(1),
    value: finite,
    easing: easingSchema.default("easeInOut"),
  })
  .strict();
export type Keyframe = z.infer<typeof keyframeSchema>;
const tracksSchema = z
  .object({
    x: z.array(keyframeSchema).optional(),
    y: z.array(keyframeSchema).optional(),
    scaleX: z.array(keyframeSchema).optional(),
    scaleY: z.array(keyframeSchema).optional(),
    rotation: z.array(keyframeSchema).optional(),
    opacity: z.array(keyframeSchema).optional(),
  })
  .strict();
const color = z.string().regex(/^#[0-9a-fA-F]{3,8}$|^transparent$/);
export const elementSchema = z
  .object({
    id: idSchema,
    name: z.string().max(200),
    type: z.enum(["text", "image", "shape", "group", "composition", "custom"]),
    parentId: idSchema.nullable().default(null),
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
    start: z.number().min(0).max(1).default(0),
    end: z.number().min(0).max(1).default(1),
    // Display cuts are independent of animation timing. Missing fields keep v1 projects intact.
    timeOffset: finite.default(0),
    trim: z
      .object({
        start: z.number().min(0).max(1),
        end: z.number().min(0).max(1),
      })
      .strict()
      .nullable()
      .default(null),
    outside: z.enum(["hold", "hide"]).default("hold"),
    tracks: tracksSchema.default({}),
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
export const compositionSchema = z
  .object({
    id: idSchema,
    name: z.string().max(200),
    width: z.number().min(1).max(20000).default(1920),
    height: z.number().min(1).max(20000).default(1080),
    background: color.default("#101312"),
    elements: z.array(elementSchema).max(500),
  })
  .strict();
export type Composition = z.infer<typeof compositionSchema>;
export const assetSchema = z
  .object({
    id: idSchema,
    name: z.string().max(300),
    mime: z.enum(["image/png", "image/jpeg", "image/webp"]),
    data: z.string().max(16_000_000),
  })
  .strict();
export const projectSchema = z
  .object({
    format: z.literal("scrollweave"),
    version: z.literal(1),
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
    sections: z
      .array(
        z
          .object({
            id: idSchema,
            compositionId: idSchema,
            kind: z.enum(["pin", "flow"]),
            scrollDistance: z.number().min(100).max(100000),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();
export type Project = z.infer<typeof projectSchema>;
export type Section = Project["sections"][number];
export const uid = (prefix = "id") =>
  `${prefix}_${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
export const createElement = (
  input: Partial<Element> & Pick<Element, "type">,
): Element => elementSchema.parse({ id: uid("el"), name: "新图层", ...input });
export const clone = <T>(value: T): T => structuredClone(value);

export function validateProject(input: unknown): Project {
  const p = projectSchema.parse(input);
  if (Object.keys(p.compositions).length > 100)
    throw new Error("最多 100 个合成");
  const checkMapId = (map: Record<string, { id: string }>) => {
    for (const [key, value] of Object.entries(map))
      if (key !== value.id || !idSchema.safeParse(key).success)
        throw new Error(`无效映射 ID: ${key}`);
  };
  checkMapId(p.compositions);
  checkMapId(p.assets);
  for (const a of Object.values(p.assets)) {
    if (
      !a.data.startsWith(`data:${a.mime};base64,`) ||
      !/^[A-Za-z0-9+/]+=*$/.test(a.data.split(",")[1] || "")
    )
      throw new Error(`素材 ${a.name} 必须是内嵌的栅格图片`);
    let bytes: string;
    try {
      bytes = atob(a.data.split(",")[1]);
    } catch {
      throw new Error(`素材 ${a.name} 的 base64 无效`);
    }
    const be32 = (i: number) =>
      bytes.charCodeAt(i) * 0x1000000 +
      (bytes.charCodeAt(i + 1) << 16) +
      (bytes.charCodeAt(i + 2) << 8) +
      bytes.charCodeAt(i + 3);
    const le32 = (i: number) =>
      bytes.charCodeAt(i) +
      (bytes.charCodeAt(i + 1) << 8) +
      (bytes.charCodeAt(i + 2) << 16) +
      bytes.charCodeAt(i + 3) * 0x1000000;
    if (a.mime === "image/png") {
      if (!bytes.startsWith("\x89PNG\r\n\x1a\n"))
        throw new Error(`素材 ${a.name} 不是 PNG`);
      for (let i = 8; i + 8 < bytes.length;) {
        const type = bytes.slice(i + 4, i + 8);
        if (type === "acTL")
          throw new Error("首版仅支持静态图片，请将 APNG 转为静态 PNG");
        const size = be32(i);
        if (size > bytes.length - i - 12) throw new Error("PNG 数据不完整");
        i += 12 + size;
      }
    }
    if (a.mime === "image/jpeg" && !bytes.startsWith("\xff\xd8\xff"))
      throw new Error(`素材 ${a.name} 不是 JPEG`);
    if (a.mime === "image/webp") {
      if (!bytes.startsWith("RIFF") || bytes.slice(8, 12) !== "WEBP")
        throw new Error(`素材 ${a.name} 不是 WebP`);
      for (let i = 12; i + 8 <= bytes.length;) {
        const type = bytes.slice(i, i + 4);
        if (type === "ANIM" || type === "ANMF")
          throw new Error("首版仅支持静态 WebP");
        const size = le32(i + 4);
        if (size > bytes.length - i - 8) throw new Error("WebP 数据不完整");
        i += 8 + size + (size % 2);
      }
    }
  }
  const sectionIds = new Set<string>();
  for (const s of p.sections) {
    if (!p.compositions[s.compositionId])
      throw new Error("页面引用了不存在的合成");
    if (sectionIds.has(s.id)) throw new Error("页面区间 ID 重复");
    sectionIds.add(s.id);
  }
  for (const c of Object.values(p.compositions)) {
    const ids = new Set(c.elements.map((e) => e.id));
    if (ids.size !== c.elements.length)
      throw new Error(`${c.name} 的图层 ID 重复`);
    for (const e of c.elements) {
      if (e.start >= e.end)
        throw new Error(`${e.name}: 结束进度必须大于开始进度`);
      if (e.trim && e.trim.start >= e.trim.end)
        throw new Error(`${e.name}: 素材出点必须大于入点`);
      if (e.type === "image" && (!e.assetId || !p.assets[e.assetId]))
        throw new Error(`${e.name}: 图片素材不存在`);
      if (
        e.type === "composition" &&
        (!e.compositionId || !p.compositions[e.compositionId])
      )
        throw new Error(`${e.name}: 子合成不存在`);
      if (
        e.type === "custom" &&
        (!e.customType || !customElements.has(e.customType))
      )
        throw new Error(`${e.name}: 自定义元素未注册，请安装对应源码扩展`);
      const seen = new Set([e.id]);
      let parent = e.parentId;
      while (parent) {
        if (seen.has(parent)) throw new Error("禁止循环分组");
        seen.add(parent);
        const node = c.elements.find((n) => n.id === parent);
        if (!node || node.type !== "group")
          throw new Error("父图层必须是同一合成中的分组");
        parent = node.parentId;
      }
      for (const [prop, keys] of Object.entries(e.tracks)) {
        const keyIds = new Set<string>();
        const times = new Set<number>();
        for (const k of keys) {
          if (keyIds.has(k.id) || times.has(k.at))
            throw new Error(`${e.name}: 关键帧 ID 或位置重复`);
          if (prop === "opacity" && (k.value < 0 || k.value > 1))
            throw new Error("透明度关键帧必须在 0 到 1 之间");
          keyIds.add(k.id);
          times.add(k.at);
        }
        keys.sort((a, b) => a.at - b.at);
      }
    }
  }
  const counts = new Map<string, number>();
  const visit = (id: string, stack: string[]): number => {
    if (stack.includes(id)) throw new Error("禁止循环嵌套合成");
    if (stack.length > 16) throw new Error("嵌套深度最多 16 层");
    if (counts.has(id)) return counts.get(id)!;
    let count = p.compositions[id].elements.length;
    for (const e of p.compositions[id].elements)
      if (e.type === "composition")
        count += visit(e.compositionId!, [...stack, id]);
    if (count > 5000) throw new Error("单个合成展开后最多 5000 个图层");
    counts.set(id, count);
    return count;
  };
  for (const id of Object.keys(p.compositions)) visit(id, []);
  return p;
}

export function blankProject(): Project {
  return validateProject({
    format: "scrollweave",
    version: 1,
    id: uid("project"),
    name: "未命名滚动项目",
    canvas: { width: 1920, height: 1080, fit: "contain" },
    scroll: { mode: "exact", smoothing: 180 },
    compositions: { main: { id: "main", name: "主舞台", elements: [] } },
    assets: {},
    sections: [
      { id: "stage", compositionId: "main", kind: "pin", scrollDistance: 4800 },
    ],
  });
}
