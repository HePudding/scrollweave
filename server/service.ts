import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { chromium, type Browser } from "playwright";
import { zipSync, unzipSync, strToU8 } from "fflate";
import { ProjectStore, commandSchema } from "../src/core/commands";
import {
  idSchema,
  seconds,
  validateProject,
  blankProject,
  references,
  clone,
  uid,
  type Project,
} from "../src/core/model";
import { migrateProject } from "../src/core/migrate";
import { presets } from "../src/extensions/registry";
import "../src/extensions/builtins";
import { exportHTML } from "./export";
import { AssetManager, sanitizeSVG } from "./assets";
const expected = { expectedRevision: z.number().int().min(0) },
  target = { compositionId: idSchema, elementId: idSchema };
const filename = z
  .string()
  .regex(/^[a-zA-Z0-9_\-\u4e00-\u9fff]{1,100}$/)
  .default("scrollweave-project");
export const schemas = {
  read_project: z.object({ includeMedia: z.boolean().default(false) }),
  workspace_info: z.object({}),
  new_project: z.object({
    directory: z.string().min(1),
    name: z.string().min(1).max(200).default("未命名作品"),
  }),
  open_project: z.object({ directory: z.string().min(1) }),
  list_assets: z.object({
    query: z.string().optional(),
    kind: z.enum(["image", "svg", "video", "composition"]).optional(),
  }),
  inspect_asset: z.object({ assetId: idSchema }),
  wait_for_asset: z
    .object({
      path: z.string().optional(),
      name: z.string().optional(),
      timeoutMs: z.number().min(100).max(30000).default(10000),
    })
    .refine((a) => a.path || a.name),
  archive_asset: z.object({ ...expected, assetId: idSchema }),
  edit_project: z.object({
    ...expected,
    label: z.string().max(200).default("Agent 批量修改"),
    commands: z.array(commandSchema).min(1).max(500),
  }),
  insert_asset: z.object({
    ...expected,
    compositionId: idSchema,
    assetId: idSchema,
    trackId: idSchema,
    at: seconds,
    duration: seconds.positive().optional(),
    sourceIn: seconds.default(0),
    mode: z.enum(["place", "insert", "overwrite"]).default("place"),
  }),
  move_clips: z.object({
    ...expected,
    compositionId: idSchema,
    elementIds: z.array(idSchema).min(1),
    delta: z.number().finite(),
    trackOffset: z.number().int().default(0),
  }),
  trim_clip: z.object({ ...expected, ...target, start: seconds, end: seconds }),
  split_clip: z.object({ ...expected, ...target, at: seconds }),
  delete_clips: z.object({
    ...expected,
    compositionId: idSchema,
    elementIds: z.array(idSchema).min(1),
    ripple: z.boolean().default(false),
    linked: z.boolean().default(false),
  }),
  set_keyframe: z.object({
    ...expected,
    ...target,
    property: z.enum(["x", "y", "scaleX", "scaleY", "rotation", "opacity"]),
    at: z.number().finite(),
    value: z.number().finite(),
    easing: z
      .enum(["linear", "easeIn", "easeOut", "easeInOut"])
      .default("easeInOut"),
  }),
  create_compound: z.object({
    ...expected,
    compositionId: idSchema,
    elementIds: z.array(idSchema).min(1),
    name: z.string().max(200).default("复合片段"),
  }),
  undo: z.object(expected),
  redo: z.object(expected),
  set_selection: z.object({
    compositionId: idSchema,
    elementIds: z.array(idSchema),
    source: z.string().max(100).optional(),
  }),
  set_preview: z.object({
    compositionId: idSchema,
    progress: seconds,
    sectionId: idSchema.optional(),
    source: z.string().max(100).optional(),
  }),
  list_presets: z.object({}),
  apply_preset: z.object({
    ...expected,
    presetId: z.string(),
    compositionId: idSchema,
    elementId: idSchema.optional(),
    options: z
      .record(z.string(), z.union([z.string(), z.number()]))
      .default({}),
  }),
  validate_project: z.object({}),
  save_project: z.object({ ...expected, filename }),
  export_html: z.object({ ...expected, filename }),
  get_preview_screenshot: z.object({
    compositionId: idSchema.optional(),
    progress: seconds.optional(),
  }),
};
export type ToolName = keyof typeof schemas;
export const descriptions: Record<ToolName, string> = {
  read_project:
    "读取完整可编辑结构、秒制片段、源时钟关键帧、选中与 revision。默认省略媒体字节。",
  workspace_info: "查询当前作品目录、assets 约定、Agent 说明和真实 MCP 地址。",
  new_project: "在指定空作品目录创建空时间线，切换人和 Agent 共用的编辑会话。",
  open_project: "打开已有作品目录并切换共用会话。旧版文件先备份再迁移。",
  list_assets: "搜索素材元信息，不返回媒体数据。",
  inspect_asset: "查询素材详情、错误及所有片段引用，替换前检查影响。",
  wait_for_asset: "等待 assets 相对路径或文件名完成自动导入；最多 30 秒。",
  archive_asset:
    "从素材库隐藏未被引用的素材；保留源文件和历史，已引用素材明确拒绝。",
  edit_project:
    "原子命令批次，一次撤销；expectedRevision 冲突拒绝覆盖。时间、sourceIn 与关键帧 at 均为秒。",
  insert_asset:
    "把素材实例放到指定轨道和秒数。place 拒绝碰撞；insert 分割并后移；overwrite 明确覆盖。",
  move_clips:
    "整体移动全部所选片段与相对轨道，不改变源取用或关键帧。碰撞拒绝。",
  trim_clip: "修改左右边界，保留播放速度、源进度与关键帧节奏。",
  split_clip: "在秒制播放头分割片段，后段继续原源时钟。",
  delete_clips:
    "删除全部所选实例；默认留空，显式 ripple 可收拢，可显式跨轨 linked。",
  set_keyframe:
    "设置源时钟秒数 at 的关键帧。当前位置源秒 = sourceIn + (播放头秒-start)*speed。",
  create_compound:
    "将所选顶层片段封装为共享复合素材。内部秒数、剪辑与变换保持。",
  undo: "撤销人或 Agent 的时间线事务，外部文件修改不回滚。",
  redo: "重做最近一次撤销。",
  set_selection: "同步画布、时间线、属性面板选中。",
  set_preview: "定位共同播放头，progress 字段表示秒，不是 0–1。",
  list_presets: "列出可用动画预制。",
  apply_preset: "对选中片段或空轨道应用动画预制。",
  validate_project: "检查引用、结构、曲线、嵌套及缺失素材。",
  save_project:
    "保存完整项目，并打包可迁移的 project + assets + Agent 说明 ZIP。",
  export_html:
    "图片/SVG 导出单 HTML；有视频导出 HTML + assets ZIP，均不依赖编辑器。",
  get_preview_screenshot:
    "在真实 Chromium 中定位秒数，等待视频 seek，返回截图与运行错误。",
};
function atomic(file: string, data: string | Uint8Array) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
function acquire(workspace: string) {
  fs.mkdirSync(path.join(workspace, ".scrollweave"), { recursive: true });
  const file = path.join(workspace, ".scrollweave", "server.lock");
  if (fs.existsSync(file)) {
    const pid = Number(fs.readFileSync(file, "utf8"));
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {}
    if (alive) throw Error("作品已由进程 " + pid + " 打开");
    fs.unlinkSync(file);
  }
  fs.writeFileSync(file, String(process.pid), { flag: "wx" });
  return () => {
    try {
      if (fs.readFileSync(file, "utf8") === String(process.pid))
        fs.unlinkSync(file);
    } catch {}
  };
}
function readWorkspace(workspace: string) {
  const file = fs.existsSync(path.join(workspace, "project.scrollweave.json"))
    ? path.join(workspace, "project.scrollweave.json")
    : path.join(workspace, "workspace.json");
  if (!fs.existsSync(file))
    return { store: new ProjectStore(blankProject()), migrated: false };
  const saved = JSON.parse(fs.readFileSync(file, "utf8")),
    raw = saved.project ?? saved;
  if (raw.version === 1) {
    const backup = file + ".v1-" + Date.now() + ".bak";
    fs.copyFileSync(file, backup);
  }
  const project = migrateProject(raw);
  sanitizeEmbedded(project);
  const store = new ProjectStore(project, saved.revision ?? 0);
  if (saved.selection)
    try {
      store.select(saved.selection);
    } catch {}
  if (saved.preview)
    try {
      store.seek({
        ...saved.preview,
        progress: saved.preview.progress * (raw.version === 1 ? 12 : 1),
      });
    } catch {}
  return { store, migrated: raw.version === 1 };
}
export function sanitizeEmbedded(p: Project) {
  for (const a of Object.values(p.assets))
    if (a.data && a.mime === "image/svg+xml") {
      const clean = sanitizeSVG(
        Buffer.from(a.data.split(",")[1], "base64").toString(),
      );
      a.data = "data:image/svg+xml;base64," + clean.bytes.toString("base64");
      a.warnings.push(...clean.warnings);
      a.width = clean.width;
      a.height = clean.height;
    }
}
export class EditorService {
  listeners = new Set<(type: string, data: unknown) => void>();
  browser?: Browser;
  private captureQueue = Promise.resolve();
  private release: () => void = () => {};
  assets: AssetManager;
  switching = false;
  constructor(
    public store: ProjectStore,
    public workspace: string,
    public port = 4100,
  ) {
    this.assets = new AssetManager(
      workspace,
      () => this.store,
      () => {
        this.persist();
        this.emit();
      },
    );
  }
  static async open(workspace: string, port: number) {
    workspace = path.resolve(workspace);
    const release = acquire(workspace);
    try {
      const { store } = readWorkspace(workspace),
        service = new EditorService(store, workspace, port);
      service.release = release;
      service.setup();
      await service.startAssets();
      service.persist();
      return service;
    } catch (error) {
      release();
      throw error;
    }
  }
  static renameClosedProject(
    directory: string,
    name: string,
    expectedRevision: number,
  ) {
    const workspace = fs.realpathSync.native(path.resolve(directory));
    const release = acquire(workspace);
    try {
      const { store } = readWorkspace(workspace);
      store.commit(
        [{ type: "project.update", patch: { name } }],
        expectedRevision,
        "重命名作品",
      );
      atomic(
        path.join(workspace, "project.scrollweave.json"),
        JSON.stringify(
          {
            project: store.project,
            revision: store.revision,
            selection: store.selection,
            preview: store.preview,
          },
          null,
          2,
        ),
      );
    } finally {
      release();
    }
  }
  info() {
    return {
      directory: this.workspace,
      assetDirectory: path.join(this.workspace, "assets"),
      projectFile: path.join(this.workspace, "project.scrollweave.json"),
      agentInstructions: path.join(this.workspace, "AGENTS.md"),
      mcpUrl: "http://127.0.0.1:" + this.port + "/mcp",
      watcherReady: this.assets.ready,
      pendingImports: this.assets.pending,
      revision: this.store.revision,
    };
  }
  private async startAssets() {
    await this.assets.start();
    for (const a of Object.values(this.store.project.assets)) {
      if (!a.data || a.kind === "composition" || a.status !== "ready") continue;
      const ext =
        a.mime === "image/svg+xml"
          ? ".svg"
          : a.mime === "image/jpeg"
            ? ".jpg"
            : "." + a.mime.split("/")[1];
      const name = /\.(png|jpe?g|webp|svg|mp4|webm)$/i.test(a.name)
        ? a.name
        : a.name + ext;
      await this.assets.importBuffer(
        name,
        Buffer.from(a.data.split(",")[1], "base64"),
        a.id,
      );
    }
  }
  private setup() {
    fs.mkdirSync(path.join(this.workspace, "exports"), { recursive: true });
    fs.mkdirSync(path.join(this.workspace, "assets"), { recursive: true });
    fs.writeFileSync(
      path.join(this.workspace, "SCROLLWEAVE.md"),
      "# 当前 ScrollWeave 连接\n\n此文件由运行中的编辑器更新。作品：" +
        this.workspace +
        "\n\n素材目录：" +
        path.join(this.workspace, "assets") +
        "\n\nMCP（Streamable HTTP）：http://127.0.0.1:" +
        this.port +
        "/mcp\n\nCodex：codex mcp add scrollweave --url http://127.0.0.1:" +
        this.port +
        "/mcp\n\n编辑器源码：" +
        process.cwd() +
        "。请在作品目录生成素材。服务运行时连接才有效；项目包中的旧地址以本文件为准。\n",
    );
    const instructions =
      "# ScrollWeave 作品目录\n\n连接地址以本目录 SCROLLWEAVE.md 为准，它在服务启动时更新。\n\n这里是作品，不是编辑器源码。只把 PNG、JPEG、WebP、SVG、H.264/AAC MP4 或 VP8/VP9 WebM 素材写入 assets/。先写 .tmp，再重命名完成。编辑器自动监听；不需要改 JSON 或粘贴 base64。SVG 使用呈现属性，脚本、事件、外部引用、CSS 与内置动画会被清理。\n\nMCP: http://127.0.0.1:" +
      this.port +
      "/mcp （本机 Streamable HTTP；服务运行时有效）\nCodex: codex mcp add scrollweave --url http://127.0.0.1:" +
      this.port +
      '/mcp\n\n先调用 workspace_info、read_project、list_assets；写文件后 wait_for_asset({path:"assets/name.svg"})；通过 insert_asset / edit_project 修改时间线。所有时间是秒；关键帧使用源时钟 sourceIn+(播放头-start)*speed。带最新 expectedRevision，冲突先重新读取，不盲目重试。多条命令一次事务、一次撤销。\n\n默认导入仅入库。删除片段不删源文件。外部素材更新不进入时间线撤销；不要覆盖 project.scrollweave.json、缓存或 exports。替换素材先 inspect_asset 查看引用。复合素材共享内容，compound.independent 创建独立副本。保存 save_project，交付 export_html。图片/SVG 单 HTML；视频 HTML + assets ZIP。源代码目录：' +
      process.cwd() +
      "。\n";
    if (!fs.existsSync(path.join(this.workspace, "AGENTS.md")))
      fs.writeFileSync(path.join(this.workspace, "AGENTS.md"), instructions);
    if (!fs.existsSync(path.join(this.workspace, ".mcp.json")))
      fs.writeFileSync(
        path.join(this.workspace, ".mcp.json"),
        JSON.stringify(
          {
            mcpServers: {
              scrollweave: {
                type: "http",
                url: "http://127.0.0.1:" + this.port + "/mcp",
              },
            },
          },
          null,
          2,
        ),
      );
  }
  emit(type = "state", source?: string) {
    const data =
      type === "state"
        ? this.store.snapshot()
        : {
            selection: this.store.selection,
            preview: this.store.preview,
            source,
          };
    this.listeners.forEach((fn) => fn(type, data));
  }
  persist() {
    atomic(
      path.join(this.workspace, "project.scrollweave.json"),
      JSON.stringify(
        {
          project: this.store.project,
          revision: this.store.revision,
          selection: this.store.selection,
          preview: this.store.preview,
        },
        null,
        2,
      ),
    );
  }
  async close() {
    await this.assets.close();
    await this.browser?.close();
    this.release();
  }
  async switchWorkspace(directory: string, name?: string) {
    if (this.switching) throw Error("正在切换作品目录，请稍候");
    const absolute = path.resolve(directory);
    const next = fs.existsSync(absolute)
      ? fs.realpathSync.native(absolute)
      : absolute;
    if (next === this.workspace) {
      if (name) throw Error("该目录已有作品，请使用打开");
      return this.info();
    }
    if (
      next === process.cwd() ||
      (path.relative(process.cwd(), next).split(path.sep)[0] !== ".." &&
        !path.isAbsolute(path.relative(process.cwd(), next)))
    )
      throw Error("作品目录应位于编辑器源码目录之外");
    const exists =
      fs.existsSync(path.join(next, "project.scrollweave.json")) ||
      fs.existsSync(path.join(next, "workspace.json"));
    if (name && exists) throw Error("该目录已有作品，请使用打开");
    if (!name && !exists) throw Error("目录内没有可打开的作品文件");
    const release = acquire(next);
    let newStore: ProjectStore;
    try {
      newStore = readWorkspace(next).store;
      if (name) newStore.project.name = name;
    } catch (error) {
      release();
      throw error;
    }
    this.switching = true;
    try {
      this.persist();
      await this.assets.close();
      this.release();
      this.release = release;
      this.workspace = next;
      this.store = newStore;
      this.assets = new AssetManager(
        next,
        () => this.store,
        () => {
          this.persist();
          this.emit();
        },
      );
      this.setup();
      await this.startAssets();
      this.persist();
      this.listeners.forEach((fn) => fn("workspace", this.info()));
      this.emit();
      return this.info();
    } finally {
      this.switching = false;
    }
  }
  async portableProject(
    p = this.store.project,
    rootIds = p.sections.map((s) => s.compositionId),
  ) {
    const result = clone(p);
    const reachable = new Set<string>();
    const visit = (id: string) => {
      if (reachable.has(id)) return;
      reachable.add(id);
      for (const e of result.compositions[id].elements)
        if (e.compositionId) visit(e.compositionId);
    };
    rootIds.forEach(visit);
    for (const id of Object.keys(result.compositions))
      if (!reachable.has(id)) delete result.compositions[id];
    result.sections = result.sections.filter((s) =>
      reachable.has(s.compositionId),
    );
    const used = new Set(
      Object.values(result.compositions).flatMap((c) =>
        c.elements.flatMap((e) => (e.assetId ? [e.assetId] : [])),
      ),
    );
    for (const a of Object.values(result.assets)) {
      if (!used.has(a.id)) {
        delete result.assets[a.id];
        continue;
      }
      if (a.kind === "composition") continue;
      if (a.status !== "ready") throw Error("素材未就绪，无法交付：" + a.name);
      if (!a.data) {
        if (!a.cachePath) throw Error("素材没有缓存：" + a.name);
        a.data =
          "data:" +
          a.mime +
          ";base64," +
          fs
            .readFileSync(path.join(this.assets.cache, a.cachePath))
            .toString("base64");
      }
      a.deliveryPath = undefined;
    }
    return result;
  }
  async importProject(bytes: Buffer, asCompound = false) {
    const documentBefore = JSON.stringify({
      ...this.store.project,
      assets: undefined,
    });
    const backup = path.join(this.workspace, ".scrollweave", "backups");
    fs.mkdirSync(backup, { recursive: true });
    fs.writeFileSync(
      path.join(
        backup,
        "import-" +
          Date.now() +
          (bytes[0] === 80 && bytes[1] === 75 ? ".zip" : ".json"),
      ),
      bytes,
    );
    fs.copyFileSync(
      path.join(this.workspace, "project.scrollweave.json"),
      path.join(backup, "before-import-" + Date.now() + ".json"),
    );
    let raw: unknown;
    if (bytes[0] === 80 && bytes[1] === 75) {
      if (bytes.length > 512 * 1024 * 1024) throw Error("项目包过大");
      let total = 0;
      const files = unzipSync(bytes, {
        filter: (file) => {
          total += file.originalSize;
          if (total > 768 * 1024 * 1024) throw Error("解压内容超过 768 MB");
          return true;
        },
      });
      if (!files["project.scrollweave.json"])
        throw Error("不是 ScrollWeave 项目包");
      raw = JSON.parse(
        Buffer.from(files["project.scrollweave.json"]).toString("utf8"),
      );
      const p = migrateProject((raw as any).project ?? raw);
      for (const a of Object.values(p.assets))
        if (a.path && !a.data && a.kind !== "composition") {
          const content = files[a.path];
          if (!content) throw Error("项目包缺少 " + a.path);
          a.data =
            "data:" +
            a.mime +
            ";base64," +
            Buffer.from(content).toString("base64");
        }
      raw = p;
    } else raw = JSON.parse(bytes.toString("utf8"));
    const p = migrateProject((raw as any).project ?? raw);
    sanitizeEmbedded(p);
    // Use the same importer, making every incoming asset independent of the source machine.
    for (const a of Object.values(p.assets))
      if (a.kind !== "composition") {
        if (!a.data)
          throw Error(
            "单独的 JSON 缺少媒体字节；请使用项目 ZIP 或打开作品目录",
          );
        const imported = await this.assets.importBuffer(
          a.name,
          Buffer.from(a.data.split(",")[1], "base64"),
        );
        if (!imported || imported.status !== "ready")
          throw Error(imported?.error ?? "素材导入失败");
        p.assets[a.id] = { ...imported, id: a.id };
      }
    if (
      JSON.stringify({ ...this.store.project, assets: undefined }) !==
      documentBefore
    )
      throw Error(
        "导入期间作品已被编辑。素材已保留在库中，请重新打开项目包；没有覆盖新编辑。",
      );
    this.store.withPersistence(
      () =>
        this.store.commit(
          asCompound
            ? [{ type: "project.import", project: p, prefix: uid("import") }]
            : [{ type: "project.replace", project: p }],
          this.store.revision,
          asCompound ? "导入子项目" : "打开项目包",
        ),
      () => this.persist(),
    );
    this.emit();
    return this.summary();
  }
  summary() {
    return {
      revision: this.store.revision,
      lastAction: this.store.lastAction,
      selection: this.store.selection,
      preview: this.store.preview,
    };
  }
  async run(name: ToolName, input: unknown): Promise<any> {
    if (this.switching) throw Error("正在切换作品目录，请稍候");
    if (!Object.hasOwn(schemas, name)) throw Error("未知操作");
    const a: any = schemas[name].parse(input);
    const aliases: Partial<Record<ToolName, string>> = {
      insert_asset: "clip.insert",
      move_clips: "clips.move",
      trim_clip: "element.trim",
      split_clip: "element.split",
      delete_clips: "clips.delete",
      create_compound: "compound.create",
    };
    if (aliases[name]) {
      const { expectedRevision, ...args } = a;
      return this.run("edit_project", {
        expectedRevision,
        label: descriptions[name].split("。")[0],
        commands: [
          {
            type: aliases[name],
            ...args,
            ...(["split_clip", "create_compound"].includes(name)
              ? { newId: uid(name === "split_clip" ? "clip" : "comp") }
              : {}),
          },
        ],
      });
    }
    switch (name) {
      case "workspace_info":
        return this.info();
      case "new_project":
        return this.switchWorkspace(a.directory, a.name);
      case "open_project":
        return this.switchWorkspace(a.directory);
      case "read_project": {
        const snapshot = this.store.snapshot();
        if (a.includeMedia) return snapshot;
        const p = clone(snapshot.project);
        for (const asset of Object.values(p.assets)) {
          delete asset.data;
          delete asset.deliveryPath;
        }
        return { ...snapshot, project: p };
      }
      case "list_assets":
        return {
          revision: this.store.revision,
          assets: Object.values(this.store.project.assets)
            .filter(
              (x) =>
                !x.archived &&
                (!a.kind || x.kind === a.kind) &&
                (!a.query ||
                  x.name.toLowerCase().includes(a.query.toLowerCase())),
            )
            .map(({ data, ...x }) => ({
              ...x,
              references: references(this.store.project, x.id),
            })),
        };
      case "inspect_asset": {
        const asset = this.store.project.assets[a.assetId];
        if (!asset) throw Error("素材不存在");
        const { data, ...metadata } = asset;
        return {
          ...metadata,
          references: references(this.store.project, a.assetId),
          revision: this.store.revision,
        };
      }
      case "wait_for_asset": {
        const { data, ...asset } = await this.assets.waitFor(a);
        return { asset, revision: this.store.revision };
      }
      case "archive_asset": {
        this.store.check(a.expectedRevision);
        const asset = this.store.project.assets[a.assetId];
        if (!asset) throw Error("素材不存在");
        const refs = references(this.store.project, asset.id);
        if (refs.length)
          throw Error(
            "素材被 " +
              refs.map((r) => r.compositionName + "/" + r.name).join("、") +
              " 使用，请先删除引用",
          );
        this.store.syncAsset({ ...asset, archived: true });
        this.persist();
        this.emit();
        return this.summary();
      }
      case "edit_project": {
        // Raw command clients share the same SVG trust boundary.
        for (const cmd of a.commands) {
          if (
            cmd.type === "asset.add" &&
            cmd.asset.data &&
            cmd.asset.mime === "image/svg+xml"
          ) {
            const clean = sanitizeSVG(
              Buffer.from(cmd.asset.data.split(",")[1], "base64").toString(),
            );
            cmd.asset.data =
              "data:image/svg+xml;base64," + clean.bytes.toString("base64");
          }
          if (cmd.project) sanitizeEmbedded(cmd.project);
        }
        this.store.withPersistence(
          () => this.store.commit(a.commands, a.expectedRevision, a.label),
          () => this.persist(),
        );
        this.emit();
        return this.summary();
      }
      case "set_keyframe": {
        const e = this.store.project.compositions[
            a.compositionId
          ]?.elements.find((e) => e.id === a.elementId),
          old = e?.tracks[a.property as "x"]?.find(
            (k) => Math.abs(k.at - a.at) < 1e-6,
          );
        return this.run("edit_project", {
          expectedRevision: a.expectedRevision,
          label: "设置关键帧",
          commands: [
            {
              type: "keyframe.set",
              compositionId: a.compositionId,
              elementId: a.elementId,
              property: a.property,
              keyframe: {
                id: old?.id ?? uid("key"),
                at: a.at,
                value: a.value,
                easing: a.easing,
              },
            },
          ],
        });
      }
      case "undo":
      case "redo":
        this.store.withPersistence(
          () => this.store[name](a.expectedRevision),
          () => this.persist(),
        );
        this.emit();
        return this.summary();
      case "set_selection":
        this.store.select({
          compositionId: a.compositionId,
          elementIds: a.elementIds,
        });
        this.emit("session", a.source);
        return this.store.selection;
      case "set_preview":
        this.store.seek({
          compositionId: a.compositionId,
          progress: a.progress,
          sectionId: a.sectionId,
        });
        this.emit("session", a.source);
        return this.store.preview;
      case "list_presets":
        return [...presets.values()].map(({ id, name, description }) => ({
          id,
          name,
          description,
        }));
      case "apply_preset": {
        this.store.check(a.expectedRevision);
        const preset = presets.get(a.presetId);
        if (!preset) throw Error("预制不存在");
        return this.run("edit_project", {
          commands: preset.build({ project: this.store.project, ...a }),
          expectedRevision: a.expectedRevision,
          label: "应用预制：" + preset.name,
        });
      }
      case "validate_project":
        validateProject(this.store.project);
        return {
          valid: true,
          revision: this.store.revision,
          issues: Object.values(this.store.project.assets)
            .filter((a) => !a.archived && a.status !== "ready")
            .map((a) => ({ assetId: a.id, status: a.status, error: a.error })),
        };
      case "save_project": {
        this.store.check(a.expectedRevision);
        this.persist();
        const p = clone(this.store.project),
          files: Record<string, Uint8Array> = {};
        const omitted: string[] = [];
        for (const asset of Object.values(p.assets)) {
          if (asset.kind === "composition") continue;
          if (
            (asset.archived || asset.status !== "ready") &&
            !references(p, asset.id).length
          ) {
            if (asset.status !== "ready") omitted.push(asset.name);
            delete p.assets[asset.id];
            continue;
          }
          if (asset.status !== "ready")
            throw Error(
              "项目已保存，但打包失败：" + asset.name + " " + asset.status,
            );
          const ext =
            asset.mime === "image/svg+xml"
              ? ".svg"
              : asset.mime === "image/jpeg"
                ? ".jpg"
                : "." + asset.mime.split("/")[1];
          const relative = "assets/" + asset.id + ext;
          files[relative] = asset.data
            ? Buffer.from(asset.data.split(",")[1], "base64")
            : fs.readFileSync(path.join(this.assets.cache, asset.cachePath!));
          asset.path = relative;
          delete asset.data;
          delete asset.cachePath;
          delete asset.thumbnail;
          delete asset.deliveryPath;
        }
        files["project.scrollweave.json"] = strToU8(JSON.stringify(p, null, 2));
        files["AGENTS.md"] = fs.readFileSync(
          path.join(this.workspace, "AGENTS.md"),
        );
        files[".mcp.json"] = fs.readFileSync(
          path.join(this.workspace, ".mcp.json"),
        );
        files["SCROLLWEAVE.md"] = fs.readFileSync(
          path.join(this.workspace, "SCROLLWEAVE.md"),
        );
        const file = a.filename + ".scrollweave.zip";
        atomic(
          path.join(this.workspace, "exports", file),
          zipSync(files, { level: 1 }),
        );
        return {
          ...this.summary(),
          path: path.join(this.workspace, "project.scrollweave.json"),
          package: path.join(this.workspace, "exports", file),
          download: "/exports/" + encodeURIComponent(file),
          format: "可编辑作品 + assets ZIP",
          warnings: omitted.length
            ? ["未打包未使用且未就绪的素材：" + omitted.join("、")]
            : [],
        };
      }
      case "export_html": {
        this.store.check(a.expectedRevision);
        const revision = this.store.revision,
          p = await this.portableProject(),
          videos = Object.values(p.assets).some(
            (a) => a.kind === "video" && !a.archived,
          ),
          files: Record<string, Uint8Array> = {};
        if (videos)
          for (const asset of Object.values(p.assets)) {
            if (asset.kind === "composition") continue;
            const ext =
              asset.mime === "image/svg+xml"
                ? ".svg"
                : asset.mime === "image/jpeg"
                  ? ".jpg"
                  : "." + asset.mime.split("/")[1];
            asset.deliveryPath = "assets/" + asset.id + ext;
            files[asset.deliveryPath] = Buffer.from(
              asset.data!.split(",")[1],
              "base64",
            );
            delete asset.data;
          }
        const html = await exportHTML(p),
          file = a.filename + (videos ? ".html.zip" : ".html");
        if (videos) {
          files["index.html"] = strToU8(html);
          files["README.txt"] = strToU8(
            "将整个目录一起交付。打开 index.html，或用任意静态 HTTP 服务访问。assets 不可删除。不依赖 ScrollWeave 服务。",
          );
          atomic(
            path.join(this.workspace, "exports", file),
            zipSync(files, { level: 1 }),
          );
        } else atomic(path.join(this.workspace, "exports", file), html);
        return {
          revision,
          path: path.join(this.workspace, "exports", file),
          download: "/exports/" + encodeURIComponent(file),
          format: videos ? "HTML + assets ZIP" : "独立单文件 HTML",
        };
      }
      case "get_preview_screenshot":
        return this.screenshot(a);
    }
  }
  private async screenshot(a: any) {
    const revision = this.store.revision,
      compositionId = a.compositionId ?? this.store.preview.compositionId,
      progress = a.progress ?? this.store.preview.progress;
    const project = await this.portableProject(this.store.project, [
      compositionId,
    ]);
    if (!project.compositions[compositionId]) throw Error("时间线不存在");
    let release!: () => void;
    const previous = this.captureQueue;
    this.captureQueue = new Promise((r) => {
      release = r;
    });
    await previous;
    try {
      if (!this.browser) {
        const executablePath =
          process.env.SW_BROWSER_PATH ||
          [
            "C:/Program Files/Google/Chrome/Application/chrome.exe",
            "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
          ].find((p) => fs.existsSync(p));
        this.browser = await chromium.launch({
          headless: true,
          ...(executablePath ? { executablePath } : {}),
        });
      }
      const page = await this.browser.newPage({
          viewport: { width: 1280, height: 720 },
        }),
        errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      try {
        await page.setContent(
          await exportHTML({
            ...project,
            scroll: { ...project.scroll, mode: "exact" },
            sections: [
              {
                id: "capture",
                compositionId,
                kind: "pin",
                scrollDistance: 5000,
                start: 0,
                end: null,
                name: "截图",
              },
            ],
          }),
          { waitUntil: "load" },
        );
        await page.evaluate(
          (p) => window.ScrollWeave.seek(p, "capture", true),
          progress,
        );
        await page.waitForFunction(
          () =>
            [...document.querySelectorAll("video")].every(
              (v) =>
                v.readyState >= 2 &&
                !v.seeking &&
                Math.abs(
                  v.currentTime -
                    Math.min(Number(v.dataset.targetTime), v.duration - 0.002),
                ) < 0.08,
            ),
          { timeout: 10000 },
        );
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(
            [...document.images].map((i) => i.decode().catch(() => {})),
          );
          await new Promise(requestAnimationFrame);
        });
        const data = (await page.screenshot({ type: "png" })).toString(
          "base64",
        );
        errors.push(...(await page.evaluate(() => window.__SW_ERRORS__)));
        return {
          data,
          mimeType: "image/png",
          revision,
          compositionId,
          progress,
          errors,
        };
      } finally {
        await page.close();
      }
    } finally {
      release();
    }
  }
}
