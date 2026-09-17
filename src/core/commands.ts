import { z } from "zod";
import {
  clone,
  compositionSchema,
  elementSchema,
  assetSchema,
  keyframeSchema,
  projectSchema,
  idSchema,
  properties,
  validateProject,
  uid,
  type Project,
  type Element,
} from "./model";
import { clipWindow } from "./timing";

const comp = { compositionId: idSchema };
const target = { ...comp, elementId: idSchema };
// Zod 4 applies inner defaults even through optional(). Updates must contain
// only fields explicitly supplied by the caller, unlike object creation.
function withoutDefaults<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
  type Shape = {
    [K in keyof T]: T[K] extends z.ZodDefault<infer U> ? U : T[K];
  };
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, value]) => [
      key,
      value instanceof z.ZodDefault ? value.removeDefault() : value,
    ]),
  ) as Shape;
  return z.object(shape).strict();
}
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("element.add"), ...comp, element: elementSchema }),
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
    start: z.number().min(0).max(1),
    end: z.number().min(0).max(1),
  }),
  z.object({
    type: z.literal("element.move"),
    ...target,
    delta: z.number().finite().min(-1).max(1),
  }),
  z.object({
    type: z.literal("element.split"),
    ...target,
    at: z.number().min(0).max(1),
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
export type Command = z.infer<typeof commandSchema>;

/** Commands are applied to an isolated draft. Validation and commit happen once per batch. */
export function applyCommands(project: Project, input: unknown[]): Project {
  let p = clone(project);
  for (const raw of input) {
    const c = commandSchema.parse(raw);
    const composition =
      "compositionId" in c ? p.compositions[c.compositionId] : undefined;
    if ("compositionId" in c && !composition)
      throw new Error(`合成不存在: ${c.compositionId}`);
    const element =
      "elementId" in c
        ? composition!.elements.find((e) => e.id === c.elementId)
        : undefined;
    if ("elementId" in c && !element)
      throw new Error(`图层不存在: ${c.elementId}`);
    switch (c.type) {
      case "element.add":
        composition!.elements.push(c.element);
        break;
      case "element.update":
        Object.assign(element!, c.patch);
        break;
      case "element.trim":
        if (element!.locked) throw new Error("请先解锁图层");
        element!.trim = { start: c.start, end: c.end };
        break;
      case "element.move": {
        if (element!.locked) throw new Error("请先解锁图层");
        const range = clipWindow(element!);
        const start = range.start + c.delta,
          end = range.end + c.delta;
        if (start < -1e-8 || end > 1 + 1e-8)
          throw new Error("移动后的素材超出父级区间");
        element!.trim = { start: Math.max(0, start), end: Math.min(1, end) };
        element!.timeOffset += c.delta;
        break;
      }
      case "element.split": {
        if (element!.locked) throw new Error("请先解锁图层");
        const range = clipWindow(element!);
        if (c.at <= range.start + 1e-7 || c.at >= range.end - 1e-7)
          throw new Error("播放头需要位于素材内部才能分割");
        if (composition!.elements.some((e) => e.id === c.newId))
          throw new Error("图层 ID 已存在");
        const ids = new Map([[element!.id, c.newId]]);
        for (let i = 0; i < composition!.elements.length; i++)
          for (const e of composition!.elements)
            if (e.parentId && ids.has(e.parentId) && !ids.has(e.id))
              ids.set(e.id, uid("el"));
        const copies = composition!.elements
          .filter((e) => ids.has(e.id))
          .map((e) => ({
            ...clone(e),
            id: ids.get(e.id)!,
            name: e.id === element!.id ? `${e.name} · 后段` : e.name,
            parentId:
              e.parentId && ids.has(e.parentId)
                ? ids.get(e.parentId)!
                : e.parentId,
            trim:
              e.id === element!.id ? { start: c.at, end: range.end } : e.trim,
          }));
        element!.trim = { start: range.start, end: c.at };
        // Keep the duplicated subtree next to its source to preserve stacking relative to other layers.
        const index = Math.max(
          ...composition!.elements.map((e, i) => (ids.has(e.id) ? i : -1)),
        );
        composition!.elements.splice(index + 1, 0, ...copies);
        break;
      }
      case "element.delete": {
        const removed = new Set([c.elementId]);
        for (let i = 0; i < composition!.elements.length; i++)
          for (const e of composition!.elements)
            if (e.parentId && removed.has(e.parentId)) removed.add(e.id);
        composition!.elements = composition!.elements.filter(
          (e) => !removed.has(e.id),
        );
        break;
      }
      case "element.duplicate": {
        const ids = new Map([[element!.id, c.newId]]);
        for (let i = 0; i < composition!.elements.length; i++)
          for (const e of composition!.elements)
            if (e.parentId && ids.has(e.parentId) && !ids.has(e.id))
              ids.set(e.id, uid("el"));
        const copies = composition!.elements
          .filter((e) => ids.has(e.id))
          .map((e) => {
            const copy = {
              ...clone(e),
              id: ids.get(e.id)!,
              name: `${e.name} 副本`,
              parentId:
                e.parentId && ids.has(e.parentId)
                  ? ids.get(e.parentId)!
                  : e.parentId,
              x: e.id === element!.id ? e.x + 32 : e.x,
            };
            if (e.id === element!.id)
              copy.tracks.x?.forEach((k) => {
                k.value += 32;
              });
            return copy;
          });
        composition!.elements.push(...copies);
        break;
      }
      case "element.reorder": {
        const index = composition!.elements.indexOf(element!);
        composition!.elements.splice(index, 1);
        composition!.elements.splice(c.index, 0, element!);
        break;
      }
      case "element.group": {
        const nodes = c.elementIds.map((id) => {
          const e = composition!.elements.find((n) => n.id === id);
          if (!e) throw new Error("分组图层不存在");
          return e;
        });
        if (nodes.some((e) => e.parentId !== nodes[0].parentId))
          throw new Error("只能对同级图层分组");
        const group = elementSchema.parse({
          id: c.groupId,
          name: "新分组",
          type: "group",
          parentId: nodes[0].parentId,
          width: composition!.width,
          height: composition!.height,
          fill: "transparent",
        });
        composition!.elements.splice(
          composition!.elements.indexOf(nodes[0]),
          0,
          group,
        );
        nodes.forEach((e) => {
          e.parentId = c.groupId;
        });
        break;
      }
      case "element.ungroup": {
        if (element!.type !== "group") throw new Error("请选择分组");
        if (
          Object.keys(element!.tracks).length ||
          element!.rotation ||
          element!.scaleX !== 1 ||
          element!.scaleY !== 1 ||
          element!.opacity !== 1 ||
          element!.start !== 0 ||
          element!.end !== 1 ||
          element!.trim !== null ||
          element!.timeOffset !== 0
        )
          throw new Error("有变换或动画的分组请先保留分组；无法无损解组");
        composition!.elements
          .filter((e) => e.parentId === element!.id)
          .forEach((e) => {
            e.parentId = element!.parentId;
            e.x += element!.x;
            e.y += element!.y;
            for (const prop of ["x", "y"] as const)
              e.tracks[prop]?.forEach((k) => {
                k.value += element![prop];
              });
          });
        composition!.elements = composition!.elements.filter(
          (e) => e.id !== element!.id,
        );
        break;
      }
      case "keyframe.set": {
        const keys = element!.tracks[c.property] ?? [];
        element!.tracks[c.property] = [
          ...keys.filter((k) => k.id !== c.keyframe.id),
          c.keyframe,
        ];
        break;
      }
      case "keyframe.delete":
        element!.tracks[c.property] = (
          element!.tracks[c.property] ?? []
        ).filter((k) => k.id !== c.keyframeId);
        break;
      case "composition.add":
        if (p.compositions[c.composition.id]) throw new Error("合成 ID 已存在");
        p.compositions[c.composition.id] = c.composition;
        break;
      case "composition.update":
        Object.assign(composition!, c.patch);
        break;
      case "composition.delete":
        delete p.compositions[c.compositionId];
        break;
      case "asset.add":
        if (p.assets[c.asset.id]) throw new Error("素材 ID 已存在");
        p.assets[c.asset.id] = c.asset;
        break;
      case "project.update":
        Object.assign(p, c.patch);
        break;
      case "project.replace":
        p = c.project;
        break;
      case "project.import": {
        const incoming = validateProject(c.project);
        const remap = (id: string) => `${c.prefix}_${id}`;
        for (const a of Object.values(incoming.assets)) {
          const id = remap(a.id);
          if (p.assets[id]) throw new Error("导入前缀已被占用");
          p.assets[id] = { ...a, id };
        }
        for (const source of Object.values(incoming.compositions)) {
          const id = remap(source.id);
          if (p.compositions[id]) throw new Error("导入前缀已被占用");
          p.compositions[id] = {
            ...source,
            id,
            elements: source.elements.map((e) => ({
              ...e,
              assetId: e.assetId ? remap(e.assetId) : undefined,
              compositionId: e.compositionId
                ? remap(e.compositionId)
                : undefined,
            })),
          };
        }
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
    super(`版本冲突：项目已更新到 r${actualRevision}。请读取最新状态后重试。`);
  }
}
export class ProjectStore {
  private past: { project: Project; label: string }[] = [];
  private future: { project: Project; label: string }[] = [];
  revision = 0;
  lastAction = "打开项目";
  errors: string[] = [];
  selection: Selection;
  preview: PreviewPosition;
  constructor(
    public project: Project,
    revision = 0,
  ) {
    this.project = validateProject(project);
    this.revision = revision;
    const id = project.sections[0].compositionId;
    this.selection = { compositionId: id, elementIds: [] };
    this.preview = {
      compositionId: id,
      progress: 0,
      sectionId: project.sections[0].id,
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
    this.selection.elementIds = this.selection.elementIds.filter((id) =>
      this.project.compositions[this.selection.compositionId].elements.some(
        (e) => e.id === id,
      ),
    );
    if (!this.project.compositions[this.preview.compositionId])
      this.preview = {
        compositionId: this.project.sections[0].compositionId,
        progress: 0,
        sectionId: this.project.sections[0].id,
      };
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
  commit(commands: unknown[], expectedRevision: number, label = "编辑项目") {
    this.check(expectedRevision);
    if (!commands.length || commands.length > 500)
      throw new Error("每批命令需要 1–500 项");
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
    if (!entry) return this.snapshot();
    this.future.push({ project: this.project, label: entry.label });
    this.project = entry.project;
    this.revision++;
    this.lastAction = `撤销：${entry.label}`;
    this.normalizeSession();
    return this.snapshot();
  }
  redo(expected: number) {
    this.check(expected);
    const entry = this.future.pop();
    if (!entry) return this.snapshot();
    this.past.push({ project: this.project, label: entry.label });
    this.project = entry.project;
    this.revision++;
    this.lastAction = `重做：${entry.label}`;
    this.normalizeSession();
    return this.snapshot();
  }
  select(selection: Selection) {
    const c = this.project.compositions[selection.compositionId];
    if (
      !c ||
      selection.elementIds.some((id) => !c.elements.some((e) => e.id === id))
    )
      throw new Error("选中对象不存在");
    this.selection = selection;
  }
  seek(position: PreviewPosition) {
    if (
      !this.project.compositions[position.compositionId] ||
      !Number.isFinite(position.progress) ||
      position.progress < 0 ||
      position.progress > 1
    )
      throw new Error("无效预览位置");
    if (
      position.sectionId &&
      !this.project.sections.some(
        (s) =>
          s.id === position.sectionId &&
          s.compositionId === position.compositionId,
      )
    )
      throw new Error("预览页面区间与合成不匹配");
    this.preview = {
      ...position,
      sectionId:
        position.sectionId ??
        this.project.sections.find(
          (s) => s.compositionId === position.compositionId,
        )?.id,
    };
    if (this.selection.compositionId !== position.compositionId)
      this.selection = {
        compositionId: position.compositionId,
        elementIds: [],
      };
  }
}
