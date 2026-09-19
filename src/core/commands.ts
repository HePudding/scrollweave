import { z } from "zod";
import {
  clone,
  compositionSchema,
  elementSchema,
  assetSchema,
  keyframeSchema,
  projectSchema,
  trackSchema,
  idSchema,
  seconds,
  properties,
  validateProject,
  uid,
  createElement,
  type Project,
  type Element,
  type Composition,
  type Asset,
} from "./model";
const comp = { compositionId: idSchema },
  target = { ...comp, elementId: idSchema };
function withoutDefaults<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  return z
    .object(
      Object.fromEntries(
        Object.entries(schema.shape).map(([key, value]) => [
          key,
          value instanceof z.ZodDefault ? value.removeDefault() : value,
        ]),
      ) as T,
    )
    .strict();
}
export const placement = z.enum(["place", "insert", "overwrite"]);
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("element.add"),
    ...comp,
    element: elementSchema,
    mode: placement.default("place"),
  }),
  z.object({
    type: z.literal("element.update"),
    ...target,
    patch: withoutDefaults(
      elementSchema.omit({ id: true, tracks: true }),
    ).partial(),
  }),
  z.object({ type: z.literal("element.delete"), ...target }),
  z.object({
    type: z.literal("element.trim"),
    ...target,
    start: seconds,
    end: seconds,
  }),
  z.object({
    type: z.literal("element.move"),
    ...target,
    delta: z.number().finite(),
    trackId: idSchema.optional(),
  }),
  z.object({
    type: z.literal("element.split"),
    ...target,
    at: seconds,
    newId: idSchema,
  }),
  z.object({
    type: z.literal("element.duplicate"),
    ...target,
    newId: idSchema,
  }),
  z.object({
    type: z.literal("element.reorder"),
    ...target,
    index: z.number().int().min(0),
  }),
  z.object({
    type: z.literal("element.group"),
    ...comp,
    elementIds: z.array(idSchema).min(1),
    groupId: idSchema,
  }),
  z.object({ type: z.literal("element.ungroup"), ...target }),
  z.object({
    type: z.literal("clip.insert"),
    ...comp,
    assetId: idSchema,
    trackId: idSchema,
    at: seconds,
    duration: seconds.positive().optional(),
    sourceIn: seconds.default(0),
    newId: idSchema.optional(),
    mode: placement.default("place"),
  }),
  z.object({
    type: z.literal("clips.move"),
    ...comp,
    elementIds: z.array(idSchema).min(1),
    delta: z.number().finite(),
    trackOffset: z.number().int().default(0),
  }),
  z.object({
    type: z.literal("clips.delete"),
    ...comp,
    elementIds: z.array(idSchema).min(1),
    ripple: z.boolean().default(false),
    linked: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("clips.paste"),
    ...comp,
    elements: z.array(elementSchema).min(1),
    at: seconds,
    trackId: idSchema,
  }),
  z.object({
    type: z.literal("clip.speed"),
    ...target,
    speed: z.number().min(0.05).max(16),
  }),
  z.object({ type: z.literal("track.add"), ...comp, track: trackSchema }),
  z.object({
    type: z.literal("track.update"),
    ...comp,
    trackId: idSchema,
    patch: withoutDefaults(trackSchema.omit({ id: true })).partial(),
  }),
  z.object({ type: z.literal("track.delete"), ...comp, trackId: idSchema }),
  z.object({
    type: z.literal("compound.create"),
    ...comp,
    elementIds: z.array(idSchema).min(1),
    newId: idSchema,
    name: z.string().max(200).default("复合片段"),
  }),
  z.object({ type: z.literal("compound.independent"), ...target }),
  z.object({
    type: z.literal("keyframe.set"),
    ...target,
    property: z.enum(properties),
    keyframe: keyframeSchema,
  }),
  z.object({
    type: z.literal("keyframe.delete"),
    ...target,
    property: z.enum(properties),
    keyframeId: idSchema,
  }),
  z.object({
    type: z.literal("composition.add"),
    composition: compositionSchema,
  }),
  z.object({
    type: z.literal("composition.update"),
    ...comp,
    patch: withoutDefaults(
      compositionSchema.omit({ id: true, elements: true }),
    ).partial(),
  }),
  z.object({ type: z.literal("composition.delete"), ...comp }),
  z.object({ type: z.literal("asset.add"), asset: assetSchema }),
  z.object({
    type: z.literal("project.update"),
    patch: projectSchema
      .pick({ name: true, canvas: true, scroll: true, sections: true })
      .partial(),
  }),
  z.object({ type: z.literal("project.replace"), project: projectSchema }),
  z.object({
    type: z.literal("project.import"),
    project: projectSchema,
    prefix: idSchema,
  }),
]);
export type Command = z.input<typeof commandSchema>;
const EPS = 1e-6;
function unlocked(c: Composition, e: Element) {
  if (e.locked || c.tracks.find((t) => t.id === e.trackId)?.locked)
    throw Error("片段或轨道已锁定");
}
function lane(c: Composition, id: string) {
  const t = c.tracks.find((t) => t.id === id);
  if (!t) throw Error("轨道不存在");
  if (t.locked) throw Error("目标轨道已锁定");
  return t;
}
function subtree(c: Composition, ids: string[]) {
  const set = new Set(ids);
  let size = 0;
  while (size !== set.size) {
    size = set.size;
    for (const e of c.elements)
      if (e.parentId && set.has(e.parentId)) set.add(e.id);
  }
  return set;
}
function remove(c: Composition, ids: string[]) {
  const set = subtree(c, ids);
  for (const e of c.elements.filter((e) => set.has(e.id))) unlocked(c, e);
  c.elements = c.elements.filter((e) => !set.has(e.id));
}
function copyTree(c: Composition, e: Element, id = uid("clip")) {
  const set = subtree(c, [e.id]),
    map = new Map([...set].map((x) => [x, x === e.id ? id : uid("clip")]));
  return c.elements
    .filter((x) => set.has(x.id))
    .map((x) => ({
      ...clone(x),
      id: map.get(x.id)!,
      parentId:
        x.parentId && map.has(x.parentId) ? map.get(x.parentId)! : x.parentId,
    }));
}
function split(c: Composition, e: Element, at: number, newId = uid("clip")) {
  unlocked(c, e);
  if (at <= e.start + EPS || at >= e.end - EPS)
    throw Error("播放头必须在片段内部");
  const copies = copyTree(c, e, newId),
    right = copies.find((x) => x.id === newId)!;
  right.start = at;
  right.sourceIn += (at - e.start) * e.speed;
  right.name = e.name + " · 后段";
  e.end = at;
  c.elements.push(...copies);
  return right;
}
function overlap(a: Element, b: Element) {
  return (
    a.id !== b.id &&
    a.parentId === b.parentId &&
    a.trackId === b.trackId &&
    a.start < b.end - EPS &&
    a.end > b.start + EPS
  );
}
function noCollision(c: Composition, e: Element) {
  if (c.elements.some((x) => overlap(e, x)))
    throw Error("目标轨道已有片段；选择空位、新轨道，或明确使用插入 / 覆盖");
}
function checkMedia(p: Project, e: Element) {
  if (e.type === "video") {
    const a = p.assets[e.assetId!];
    if (
      e.sourceIn < 0 ||
      (a?.duration !== undefined &&
        e.sourceIn + (e.end - e.start) * e.speed > a.duration + 0.04)
    )
      throw Error("裁剪范围超过视频真实时长");
  }
}
function insert(
  c: Composition,
  e: Element,
  mode: "place" | "insert" | "overwrite",
) {
  lane(c, e.trackId);
  if (e.start < 0) throw Error("片段不能移到 0 秒之前");
  if (mode === "place") noCollision(c, e);
  if (mode === "insert") {
    const duration = e.end - e.start;
    for (const other of [...c.elements].filter(
      (x) => x.parentId === e.parentId && x.trackId === e.trackId,
    )) {
      if (other.end <= e.start + EPS) continue;
      unlocked(c, other);
      const tail =
        other.start < e.start - EPS ? split(c, other, e.start) : other;
      tail.start += duration;
      tail.end += duration;
    }
  }
  if (mode === "overwrite")
    for (const other of [...c.elements].filter((x) => overlap(e, x))) {
      unlocked(c, other);
      if (other.start < e.start - EPS) {
        const tail = split(c, other, e.start);
        if (tail.end > e.end + EPS) {
          tail.sourceIn += (e.end - tail.start) * tail.speed;
          tail.start = e.end;
        } else remove(c, [tail.id]);
      } else if (other.end > e.end + EPS) {
        other.sourceIn += (e.end - other.start) * other.speed;
        other.start = e.end;
      } else remove(c, [other.id]);
    }
  c.elements.push(e);
}
function nodes(c: Composition, ids: string[]) {
  const list = [...new Set(ids)].map((id) => {
    const e = c.elements.find((x) => x.id === id);
    if (!e) throw Error("选中的片段不存在");
    unlocked(c, e);
    return e;
  });
  return list.filter(
    (e) => !list.some((x) => subtree(c, [x.id]).has(e.id) && x.id !== e.id),
  );
}
function compound(
  p: Project,
  c: Composition,
  ids: string[],
  newId: string,
  name: string,
) {
  if (p.compositions[newId]) throw Error("复合片段 ID 已存在");
  const selected = nodes(c, ids);
  if (selected.some((e) => e.parentId)) throw Error("请先选择时间线顶层片段");
  const start = Math.min(...selected.map((e) => e.start)),
    end = Math.max(...selected.map((e) => e.end)),
    set = subtree(
      c,
      selected.map((e) => e.id),
    );
  const indexes = selected.map((e) =>
      c.tracks.findIndex((t) => t.id === e.trackId),
    ),
    bottom = Math.min(...indexes),
    top = Math.max(...indexes);
  if (
    c.elements.some(
      (e) =>
        !set.has(e.id) &&
        !e.parentId &&
        e.start < end &&
        e.end > start &&
        c.tracks.findIndex((t) => t.id === e.trackId) >= bottom &&
        c.tracks.findIndex((t) => t.id === e.trackId) <= top,
    )
  )
    throw Error("所选轨道间还有交叠片段；请一起选中，避免改变叠放关系");
  const content = c.elements
    .filter((e) => set.has(e.id))
    .map((e) => ({
      ...clone(e),
      start: e.parentId ? e.start : e.start - start,
      end: e.parentId ? e.end : e.end - start,
    }));
  const used = new Set(content.map((e) => e.trackId));
  p.compositions[newId] = compositionSchema.parse({
    id: newId,
    name,
    width: c.width,
    height: c.height,
    background: "transparent",
    duration: end - start,
    tracks: c.tracks.filter((t) => used.has(t.id)),
    elements: content,
  });
  c.elements = c.elements.filter((e) => !set.has(e.id));
  const aid = uid("asset");
  p.assets[aid] = assetSchema.parse({
    id: aid,
    name,
    kind: "composition",
    mime: "application/x-scrollweave-composition",
    compositionId: newId,
    width: c.width,
    height: c.height,
    duration: end - start,
  });
  c.elements.push(
    createElement({
      id: uid("clip"),
      type: "composition",
      name,
      assetId: aid,
      compositionId: newId,
      trackId: c.tracks[bottom].id,
      start,
      end,
      width: c.width,
      height: c.height,
      fill: "transparent",
    }),
  );
}
export function applyCommands(project: Project, input: unknown[]): Project {
  let p = clone(project);
  for (const raw of input) {
    const a = commandSchema.parse(raw),
      c = "compositionId" in a ? p.compositions[a.compositionId] : undefined;
    if ("compositionId" in a && !c) throw Error("时间线不存在");
    const e =
      "elementId" in a
        ? c!.elements.find((e) => e.id === a.elementId)
        : undefined;
    if ("elementId" in a && !e) throw Error("片段不存在");
    if (e && a.type !== "element.update") unlocked(c!, e);
    switch (a.type) {
      case "element.add":
        checkMedia(p, a.element);
        insert(c!, a.element, a.mode);
        break;
      case "element.update": {
        if (Object.keys(a.patch).some((k) => k !== "locked")) unlocked(c!, e!);
        const was = { ...e! };
        Object.assign(e!, a.patch);
        lane(c!, e!.trackId);
        if (
          ["start", "end", "trackId", "parentId", "sourceIn", "speed"].some(
            (k) => k in a.patch,
          )
        ) {
          checkMedia(p, e!);
          if (
            was.start !== e!.start ||
            was.end !== e!.end ||
            was.trackId !== e!.trackId
          )
            noCollision(c!, e!);
        }
        break;
      }
      case "element.trim":
        e!.sourceIn += (a.start - e!.start) * e!.speed;
        e!.start = a.start;
        e!.end = a.end;
        checkMedia(p, e!);
        noCollision(c!, e!);
        break;
      case "element.move":
        e!.start += a.delta;
        e!.end += a.delta;
        if (a.trackId) e!.trackId = a.trackId;
        lane(c!, e!.trackId);
        noCollision(c!, e!);
        break;
      case "element.split":
        if (c!.elements.some((x) => x.id === a.newId))
          throw Error("片段 ID 已存在");
        split(c!, e!, a.at, a.newId);
        break;
      case "element.delete":
        remove(c!, [e!.id]);
        break;
      case "element.duplicate": {
        const t = {
          id: uid("track"),
          name: "副本轨道",
          locked: false,
          hidden: false,
        };
        c!.tracks.push(t);
        const copies = copyTree(c!, e!, a.newId);
        copies.find((x) => x.id === a.newId)!.trackId = t.id;
        c!.elements.push(...copies);
        break;
      }
      case "element.reorder": {
        const index = c!.elements.indexOf(e!);
        c!.elements.splice(index, 1);
        c!.elements.splice(a.index, 0, e!);
        break;
      }
      case "element.group":
        compound(p, c!, a.elementIds, a.groupId, "复合片段");
        break;
      case "element.ungroup":
        throw Error("旧版变换分组保留嵌套；请进入内容编辑，避免有损解组");
      case "clip.insert": {
        const asset = p.assets[a.assetId];
        if (!asset || asset.archived || asset.status !== "ready")
          throw Error("素材未就绪，请检查素材库");
        const duration =
          a.duration ??
          (asset.kind === "video"
            ? (asset.duration ?? 5) - a.sourceIn
            : asset.kind === "composition"
              ? p.compositions[asset.compositionId!].duration
              : 5);
        const scale = Math.min(
          asset.kind === "svg" ? 1 : Infinity,
          c!.width / (asset.width || c!.width),
          c!.height / (asset.height || c!.height),
        );
        const w = (asset.width || c!.width) * scale,
          h = (asset.height || c!.height) * scale;
        const clip = createElement({
          id: a.newId ?? uid("clip"),
          type: asset.kind,
          assetId: asset.id,
          compositionId: asset.compositionId,
          trackId: a.trackId,
          name: asset.name,
          start: a.at,
          end: a.at + duration,
          sourceIn: a.sourceIn,
          width: w,
          height: h,
          x: (c!.width - w) / 2,
          y: (c!.height - h) / 2,
          fill: "transparent",
        });
        checkMedia(p, clip);
        insert(c!, clip, a.mode);
        break;
      }
      case "clips.move": {
        const selected = nodes(c!, a.elementIds);
        for (const x of selected) {
          const dest =
            c!.tracks[
              c!.tracks.findIndex((t) => t.id === x.trackId) + a.trackOffset
            ];
          if (!dest) throw Error("移动超出轨道范围");
          lane(c!, dest.id);
          x.trackId = dest.id;
          x.start += a.delta;
          x.end += a.delta;
        }
        for (const x of selected) noCollision(c!, x);
        break;
      }
      case "clips.delete": {
        const selected = nodes(c!, a.elementIds),
          intervals = new Map<string, { start: number; end: number }[]>();
        if (a.ripple) {
          if (selected.some((e) => e.parentId))
            throw Error("分组内部请使用普通删除");
          for (const x of selected) {
            const key = a.linked ? "*" : x.trackId;
            intervals.set(key, [
              ...(intervals.get(key) ?? []),
              { start: x.start, end: x.end },
            ]);
          }
        }
        remove(
          c!,
          selected.map((x) => x.id),
        );
        for (const [track, ranges] of intervals) {
          const merged: { start: number; end: number }[] = [];
          for (const r of ranges.sort((a, b) => a.start - b.start)) {
            const last = merged.at(-1);
            if (last && r.start <= last.end)
              last.end = Math.max(last.end, r.end);
            else merged.push({ ...r });
          }
          for (const x of c!.elements.filter(
            (e) => !e.parentId && (track === "*" || e.trackId === track),
          )) {
            if (
              merged.some((r) => x.start < r.end - EPS && x.end > r.start + EPS)
            )
              throw Error("联动区间穿过其他片段，请先分割或一并选中");
            const delta = merged
              .filter((r) => r.end <= x.start + EPS)
              .reduce((n, r) => n + r.end - r.start, 0);
            if (delta) {
              unlocked(c!, x);
              x.start -= delta;
              x.end -= delta;
            }
          }
        }
        break;
      }
      case "clips.paste": {
        const roots = a.elements.filter(
          (e) => !a.elements.some((x) => x.id === e.parentId),
        );
        const first = Math.min(...roots.map((e) => e.start)),
          sourceTracks = [...new Set(a.elements.map((e) => e.trackId))],
          base = c!.tracks.findIndex((t) => t.id === a.trackId);
        lane(c!, a.trackId);
        const map = new Map(a.elements.map((e) => [e.id, uid("clip")]));
        while (c!.tracks.length < base + sourceTracks.length)
          c!.tracks.push({
            id: uid("track"),
            name: "粘贴轨道",
            hidden: false,
            locked: false,
          });
        for (const original of a.elements) {
          const x = clone(original);
          x.id = map.get(x.id)!;
          x.locked = false;
          if (x.parentId && map.has(x.parentId))
            x.parentId = map.get(x.parentId)!;
          else {
            x.parentId = null;
            x.start += a.at - first;
            x.end += a.at - first;
          }
          x.trackId =
            c!.tracks[base + sourceTracks.indexOf(original.trackId)].id;
          insert(c!, x, "place");
        }
        break;
      }
      case "clip.speed": {
        const length = (e!.end - e!.start) * e!.speed;
        e!.speed = a.speed;
        e!.end = e!.start + length / a.speed;
        noCollision(c!, e!);
        break;
      }
      case "track.add":
        if (c!.tracks.some((t) => t.id === a.track.id))
          throw Error("轨道 ID 重复");
        c!.tracks.push(a.track);
        break;
      case "track.update": {
        const t = c!.tracks.find((t) => t.id === a.trackId);
        if (!t) throw Error("轨道不存在");
        Object.assign(t, a.patch);
        break;
      }
      case "track.delete":
        if (c!.elements.some((e) => e.trackId === a.trackId))
          throw Error("请先清空轨道");
        c!.tracks = c!.tracks.filter((t) => t.id !== a.trackId);
        break;
      case "compound.create":
        compound(p, c!, a.elementIds, a.newId, a.name);
        break;
      case "compound.independent": {
        if (e!.type !== "composition") throw Error("请选择复合片段");
        const map = new Map<string, string>();
        function duplicate(id: string): string {
          if (map.has(id)) return map.get(id)!;
          const next = uid("comp");
          map.set(id, next);
          const copy = clone(p.compositions[id]);
          copy.id = next;
          copy.name += " · 独立副本";
          for (const x of copy.elements)
            if (x.compositionId) {
              x.compositionId = duplicate(x.compositionId);
              x.assetId = undefined;
            }
          p.compositions[next] = copy;
          return next;
        }
        e!.compositionId = duplicate(e!.compositionId!);
        const aid = uid("asset");
        p.assets[aid] = assetSchema.parse({
          id: aid,
          name: p.compositions[e!.compositionId!].name,
          kind: "composition",
          mime: "application/x-scrollweave-composition",
          compositionId: e!.compositionId,
          width: e!.width,
          height: e!.height,
          duration: p.compositions[e!.compositionId!].duration,
        });
        e!.assetId = aid;
        e!.name = p.assets[aid].name;
        break;
      }
      case "keyframe.set": {
        const keys = e!.tracks[a.property] ?? [];
        e!.tracks[a.property] = [
          ...keys.filter((k) => k.id !== a.keyframe.id),
          a.keyframe,
        ];
        break;
      }
      case "keyframe.delete":
        e!.tracks[a.property] = (e!.tracks[a.property] ?? []).filter(
          (k) => k.id !== a.keyframeId,
        );
        break;
      case "composition.add":
        if (p.compositions[a.composition.id]) throw Error("时间线 ID 已存在");
        p.compositions[a.composition.id] = a.composition;
        break;
      case "composition.update":
        Object.assign(c!, a.patch);
        break;
      case "composition.delete":
        delete p.compositions[a.compositionId];
        break;
      case "asset.add":
        if (p.assets[a.asset.id]) throw Error("素材 ID 已存在");
        p.assets[a.asset.id] = a.asset;
        break;
      case "project.update":
        Object.assign(p, a.patch);
        break;
      case "project.replace":
        p = a.project;
        break;
      case "project.import": {
        const incoming = validateProject(a.project),
          remap = (id: string) => a.prefix + "_" + id;
        const importedAssets = new Map<string, string>();
        for (const asset of Object.values(incoming.assets)) {
          const existing =
            asset.path &&
            Object.values(p.assets).find(
              (a) =>
                a.path === asset.path &&
                a.hash === asset.hash &&
                a.kind === asset.kind,
            );
          if (existing) {
            importedAssets.set(asset.id, existing.id);
            continue;
          }
          const id = remap(asset.id);
          importedAssets.set(asset.id, id);
          if (p.assets[id]) throw Error("导入前缀已占用");
          p.assets[id] = {
            ...asset,
            id,
            compositionId: asset.compositionId
              ? remap(asset.compositionId)
              : undefined,
          };
        }
        for (const source of Object.values(incoming.compositions)) {
          const id = remap(source.id);
          if (p.compositions[id]) throw Error("导入前缀已占用");
          p.compositions[id] = {
            ...source,
            id,
            elements: source.elements.map((e) => ({
              ...e,
              assetId: e.assetId ? importedAssets.get(e.assetId) : undefined,
              compositionId: e.compositionId
                ? remap(e.compositionId)
                : undefined,
            })),
          };
        }
        const first = incoming.sections[0].compositionId,
          sub = p.compositions[remap(first)],
          aid = uid("asset");
        p.assets[aid] = assetSchema.parse({
          id: aid,
          name: incoming.name,
          kind: "composition",
          mime: "application/x-scrollweave-composition",
          compositionId: sub.id,
          width: sub.width,
          height: sub.height,
          duration: sub.duration,
        });
        break;
      }
    }
  }
  return validateProject(p);
}
export type Selection = { compositionId: string; elementIds: string[] };
export type PreviewPosition = {
  compositionId: string;
  progress: number;
  sectionId?: string;
};
export type Snapshot = {
  project: Project;
  revision: number;
  selection: Selection;
  preview: PreviewPosition;
  canUndo: boolean;
  canRedo: boolean;
  lastAction: string;
  errors: string[];
};
export class ConflictError extends Error {
  constructor(public actualRevision: number) {
    super(
      "版本冲突：作品已更新到 r" + actualRevision + "，请读取最新状态后重试。",
    );
  }
}
export class ProjectStore {
  private past: { project: Project; label: string }[] = [];
  private future: { project: Project; label: string }[] = [];
  revision = 0;
  lastAction = "打开作品";
  errors: string[] = [];
  selection: Selection;
  preview: PreviewPosition;
  constructor(
    public project: Project,
    revision = 0,
  ) {
    this.project = validateProject(project);
    this.revision = revision;
    const id = this.project.sections[0].compositionId;
    this.selection = { compositionId: id, elementIds: [] };
    this.preview = {
      compositionId: id,
      progress: 0,
      sectionId: this.project.sections[0].id,
    };
  }
  snapshot(): Snapshot {
    return {
      project: this.project,
      revision: this.revision,
      selection: this.selection,
      preview: this.preview,
      canUndo: !!this.past.length,
      canRedo: !!this.future.length,
      lastAction: this.lastAction,
      errors: this.errors,
    };
  }
  check(expected: number) {
    if (expected !== this.revision) throw new ConflictError(this.revision);
  }
  withPersistence<T>(mutate: () => T, persist: () => void): T {
    const checkpoint = {
      project: this.project,
      revision: this.revision,
      lastAction: this.lastAction,
      past: [...this.past],
      future: [...this.future],
      selection: clone(this.selection),
      preview: clone(this.preview),
    };
    try {
      const result = mutate();
      persist();
      return result;
    } catch (error) {
      Object.assign(this, checkpoint);
      throw error;
    }
  }
  private normalizeSession() {
    if (!this.project.compositions[this.selection.compositionId])
      this.selection = {
        compositionId: this.project.sections[0].compositionId,
        elementIds: [],
      };
    this.selection = {
      ...this.selection,
      elementIds: this.selection.elementIds.filter((id) =>
        this.project.compositions[this.selection.compositionId].elements.some(
          (e) => e.id === id,
        ),
      ),
    };
    if (!this.project.compositions[this.preview.compositionId])
      this.preview = {
        compositionId: this.selection.compositionId,
        progress: 0,
      };
    this.preview.progress = Math.min(
      this.preview.progress,
      this.project.compositions[this.preview.compositionId].duration,
    );
    if (
      !this.project.sections.some(
        (s) =>
          s.id === this.preview.sectionId &&
          s.compositionId === this.preview.compositionId,
      )
    )
      this.preview.sectionId = this.project.sections.find(
        (s) => s.compositionId === this.preview.compositionId,
      )?.id;
  }
  commit(commands: unknown[], expected: number, label = "编辑作品") {
    this.check(expected);
    if (!commands.length || commands.length > 500)
      throw Error("每批命令需要 1–500 项");
    const result = applyCommands(this.project, commands);
    this.past.push({ project: this.project, label });
    if (this.past.length > 80) this.past.shift();
    this.project = result;
    this.future = [];
    this.revision++;
    this.lastAction = label;
    this.normalizeSession();
    return this.snapshot();
  }
  undo(expected: number) {
    this.check(expected);
    const entry = this.past.pop();
    if (entry) {
      this.future.push({ project: this.project, label: entry.label });
      this.project = entry.project;
      this.revision++;
      this.lastAction = "撤销：" + entry.label;
      this.normalizeSession();
    }
    return this.snapshot();
  }
  redo(expected: number) {
    this.check(expected);
    const entry = this.future.pop();
    if (entry) {
      this.past.push({ project: this.project, label: entry.label });
      this.project = entry.project;
      this.revision++;
      this.lastAction = "重做：" + entry.label;
      this.normalizeSession();
    }
    return this.snapshot();
  }
  /** External files form a separate history domain. No undo can write or resurrect old bytes. */
  syncAsset(asset: Asset) {
    const overlay = (p: Project) => ({
      ...p,
      assets: { ...p.assets, [asset.id]: clone(asset) },
    });
    this.project = validateProject(overlay(this.project));
    this.past = this.past.map((e) => ({ ...e, project: overlay(e.project) }));
    this.future = this.future.map((e) => ({
      ...e,
      project: overlay(e.project),
    }));
    this.revision++;
    this.lastAction = "素材更新：" + asset.name;
  }
  select(selection: Selection) {
    const c = this.project.compositions[selection.compositionId];
    if (
      !c ||
      selection.elementIds.some((id) => !c.elements.some((e) => e.id === id))
    )
      throw Error("选中对象不存在");
    this.selection = selection;
  }
  seek(position: PreviewPosition) {
    const c = this.project.compositions[position.compositionId];
    if (
      !c ||
      !Number.isFinite(position.progress) ||
      position.progress < 0 ||
      position.progress > c.duration
    )
      throw Error("无效预览秒数");
    if (
      position.sectionId &&
      !this.project.sections.some(
        (s) => s.id === position.sectionId && s.compositionId === c.id,
      )
    )
      throw Error("滚动区间不匹配");
    this.preview = {
      ...position,
      sectionId:
        position.sectionId ??
        this.project.sections.find((s) => s.compositionId === c.id)?.id,
    };
    if (this.selection.compositionId !== c.id)
      this.selection = { compositionId: c.id, elementIds: [] };
  }
}
