import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { chromium, type Browser } from "playwright";
import { ProjectStore, commandSchema } from "../src/core/commands";
import { idSchema, validateProject } from "../src/core/model";
import { presets } from "../src/extensions/registry";
import "../src/extensions/builtins";
import { exportHTML } from "./export";
const expected = { expectedRevision: z.number().int().min(0) };
const filename = z
  .string()
  .regex(/^[a-zA-Z0-9_\-\u4e00-\u9fff]{1,100}$/)
  .default("scrollweave-project");
export const schemas = {
  read_project: z.object({}),
  edit_project: z.object({
    ...expected,
    label: z.string().max(200).default("Agent 批量修改"),
    commands: z.array(commandSchema).min(1).max(500),
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
    progress: z.number().min(0).max(1),
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
    progress: z.number().min(0).max(1).optional(),
  }),
};
export type ToolName = keyof typeof schemas;
export const descriptions: Record<ToolName, string> = {
  read_project:
    "读取完整可编辑项目、素材、轨道、关键帧、当前选中对象、预览进度和 revision。",
  edit_project:
    "原子应用一批编辑命令，整批一次撤销。expectedRevision 必须来自最新 read_project；冲突不会覆盖更新。支持元素、分组、关键帧、合成、素材、页面区间、导入项目。",
  undo: "撤销最近一次人或 Agent 的项目事务。",
  redo: "重做最近一次撤销。",
  set_selection: "设置编辑器当前选中的合成和图层。",
  set_preview: "定位编辑器画布和页面预览的连续进度 0–1。",
  list_presets: "查询预制动画、说明和可用配置。",
  apply_preset: "插入或应用内置/社区预制，和界面使用相同命令，整体可撤销。",
  validate_project: "校验项目结构、素材、关键帧和嵌套引用，返回错误。",
  save_project:
    "将带素材的完整项目保存到本地 workspace exports 目录，返回路径和下载地址。",
  export_html: "导出无编辑器依赖、素材内嵌的单文件 HTML，返回路径和下载地址。",
  get_preview_screenshot:
    "在真实 Chromium 中渲染当前项目指定合成与进度，返回 PNG 截图、项目 revision、位置以及运行时错误。",
};
export class EditorService {
  listeners = new Set<(type: string, data: unknown) => void>();
  browser?: Browser;
  private captureQueue = Promise.resolve();
  constructor(
    public store: ProjectStore,
    public workspace: string,
  ) {
    fs.mkdirSync(path.join(workspace, "exports"), { recursive: true });
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
    const file = path.join(this.workspace, "workspace.json");
    const tmp = `${file}.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify({
        project: this.store.project,
        revision: this.store.revision,
        selection: this.store.selection,
        preview: this.store.preview,
      }),
    );
    fs.renameSync(tmp, file);
  }
  async run(name: ToolName, input: unknown): Promise<any> {
    if (!Object.hasOwn(schemas, name)) throw new Error("未知操作");
    const a: any = schemas[name].parse(input);
    switch (name) {
      case "read_project":
        return this.store.snapshot();
      case "edit_project": {
        const result = this.store.withPersistence(
          () => this.store.commit(a.commands, a.expectedRevision, a.label),
          () => this.persist(),
        );
        this.emit();
        return result;
      }
      case "undo":
      case "redo": {
        const result = this.store.withPersistence(
          () => this.store[name](a.expectedRevision),
          () => this.persist(),
        );
        this.emit();
        return result;
      }
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
        return [...presets.values()].map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          options:
            p.id === "title-rise"
              ? { text: "标题", distance: 100 }
              : p.id === "product-zoom"
                ? { from: 0.72 }
                : { name: "横向卡片", start: 0, end: 1 },
        }));
      case "apply_preset": {
        this.store.check(a.expectedRevision);
        const preset = presets.get(a.presetId);
        if (!preset) throw new Error("预制不存在");
        const commands = preset.build({ project: this.store.project, ...a });
        return this.run("edit_project", {
          commands,
          expectedRevision: a.expectedRevision,
          label: `应用预制：${preset.name}`,
        });
      }
      case "validate_project":
        validateProject(this.store.project);
        return {
          valid: true,
          revision: this.store.revision,
          errors: this.store.errors,
        };
      case "save_project": {
        this.store.check(a.expectedRevision);
        this.persist();
        const file = `${a.filename}.scrollweave.json`;
        fs.writeFileSync(
          path.join(this.workspace, "exports", file),
          JSON.stringify(this.store.project, null, 2),
        );
        return {
          path: path.join(this.workspace, "exports", file),
          download: `/exports/${encodeURIComponent(file)}`,
          revision: this.store.revision,
        };
      }
      case "export_html": {
        this.store.check(a.expectedRevision);
        const project = this.store.project;
        const revision = this.store.revision;
        const html = await exportHTML(project);
        const file = `${a.filename}.html`;
        fs.writeFileSync(path.join(this.workspace, "exports", file), html);
        return {
          path: path.join(this.workspace, "exports", file),
          download: `/exports/${encodeURIComponent(file)}`,
          revision,
        };
      }
      case "get_preview_screenshot": {
        const project = this.store.project;
        const revision = this.store.revision;
        const compositionId =
          a.compositionId ?? this.store.preview.compositionId;
        const progress = a.progress ?? this.store.preview.progress;
        if (!project.compositions[compositionId]) throw new Error("合成不存在");
        let release!: () => void;
        const previous = this.captureQueue;
        this.captureQueue = new Promise((resolve) => {
          release = resolve;
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
            deviceScaleFactor: 1,
          });
          const errors: string[] = [];
          page.on("pageerror", (error) => errors.push(error.message));
          try {
            const capture = {
              ...project,
              scroll: { ...project.scroll, mode: "exact" as const },
              sections: [
                {
                  id: "capture",
                  compositionId,
                  kind: "pin" as const,
                  scrollDistance: 5000,
                },
              ],
            };
            await page.setContent(await exportHTML(capture), {
              waitUntil: "load",
            });
            await page.evaluate(
              (p) => window.ScrollWeave.seek(p, "capture", true),
              progress,
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
        } catch (error) {
          throw new Error(
            `截图失败。请运行 npx playwright install chromium 或设置 SW_BROWSER_PATH。${(error as Error).message}`,
          );
        } finally {
          release();
        }
      }
    }
  }
}
