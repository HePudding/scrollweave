import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { uid } from "../src/core/model";
import { migrateProject } from "../src/core/migrate";
import type { ProjectEntry } from "../src/core/library";

const recordSchema = z.object({
  id: z.string().regex(/^project_[a-zA-Z0-9_]+$/),
  directory: z.string().min(1),
  name: z.string(),
  createdAt: z.string(),
  lastOpenedAt: z.string(),
  favorite: z.boolean().default(false),
  hidden: z.boolean().default(false),
});
const registrySchema = z.object({
  version: z.literal(1),
  projects: z.array(recordSchema),
});
type RecordEntry = z.infer<typeof recordSchema>;
export const projectFile = (directory: string) => {
  const current = path.join(directory, "project.scrollweave.json");
  return fs.existsSync(current)
    ? current
    : path.join(directory, "workspace.json");
};
export function canonicalDirectory(directory: string) {
  const absolute = path.resolve(directory);
  return fs.existsSync(absolute) ? fs.realpathSync.native(absolute) : absolute;
}
const pathKey = (directory: string) => {
  const canonical = canonicalDirectory(directory);
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
};

/** An explicit directory registry. It never discovers projects by crawling disk. */
export class ProjectLibrary {
  constructor(
    public file: string,
    public defaultDirectory: string,
  ) {
    this.file = path.resolve(file);
    this.defaultDirectory = path.resolve(defaultDirectory);
  }
  private read() {
    if (!fs.existsSync(this.file))
      return { version: 1 as const, projects: [] as RecordEntry[] };
    try {
      return registrySchema.parse(
        JSON.parse(fs.readFileSync(this.file, "utf8")),
      );
    } catch {
      throw Error("项目列表文件无法读取，原文件已保留：" + this.file);
    }
  }
  private update<T>(fn: (records: RecordEntry[]) => T): T {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const lock = this.file + ".lock";
    if (fs.existsSync(lock)) {
      const pid = Number(fs.readFileSync(lock, "utf8"));
      let alive = false;
      try {
        if (pid > 0) {
          process.kill(pid, 0);
          alive = true;
        }
      } catch {}
      if (alive) throw Error("项目列表正在由另一个操作更新，请稍后重试");
      fs.unlinkSync(lock);
    }
    fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
    try {
      const registry = this.read();
      const result = fn(registry.projects);
      const tmp = this.file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(registry, null, 2));
      fs.renameSync(tmp, this.file);
      return result;
    } finally {
      fs.unlinkSync(lock);
    }
  }
  remember(directory: string, name: string, restore = true) {
    const resolved = canonicalDirectory(directory);
    return this.update((records) => {
      let record = records.find(
        (entry) => pathKey(entry.directory) === pathKey(resolved),
      );
      const now = new Date().toISOString();
      if (!record) {
        record = {
          id: uid("project"),
          directory: resolved,
          name,
          createdAt: now,
          lastOpenedAt: now,
          favorite: false,
          hidden: false,
        };
        records.push(record);
      } else {
        record.name = name;
        record.directory = resolved;
        if (restore) {
          record.hidden = false;
          record.lastOpenedAt = now;
        }
      }
      return record.id;
    });
  }
  get(id: string) {
    const record = this.read().projects.find((p) => p.id === id && !p.hidden);
    if (!record) throw Error("项目不在列表中，请重新打开项目文件夹");
    return record;
  }
  patch(
    id: string,
    patch: { favorite?: boolean; hidden?: boolean; name?: string },
  ) {
    this.update((records) => {
      const record = records.find((entry) => entry.id === id && !entry.hidden);
      if (!record) throw Error("项目不在列表中");
      Object.assign(record, patch);
    });
  }
  startupDirectory() {
    return this.read()
      .projects.filter((p) => !p.hidden)
      .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
      .find((p) => this.inspect(p, this.defaultDirectory).status === "ready")
      ?.directory;
  }
  private inspect(record: RecordEntry, activeDirectory: string): ProjectEntry {
    const { hidden: _hidden, ...entry } = record;
    const base: ProjectEntry = {
      ...entry,
      modifiedAt: entry.lastOpenedAt,
      active: pathKey(entry.directory) === pathKey(activeDirectory),
      status: "ready",
    };
    const file = projectFile(entry.directory);
    if (!fs.existsSync(file))
      return {
        ...base,
        status: "missing",
        error: "找不到项目文件，目录可能已移动或磁盘未连接。",
      };
    try {
      const stat = fs.statSync(file);
      if (stat.size > 60 * 1024 * 1024) throw Error("项目文件超过 60 MB");
      const saved = JSON.parse(fs.readFileSync(file, "utf8"));
      const project = migrateProject(saved.project ?? saved);
      const composition =
        project.compositions[project.sections[0].compositionId];
      const assets = Object.values(project.assets).filter((a) => !a.archived);
      // Use only generated/sanitized cache thumbnails, never arbitrary source paths.
      const cover = assets.find(
        (a) => a.thumbnail && this.cacheFile(entry.directory, a.thumbnail),
      );
      return {
        ...base,
        name: project.name,
        revision: saved.revision ?? 0,
        modifiedAt: stat.mtime.toISOString(),
        duration: composition.duration,
        width: project.canvas.width,
        height: project.canvas.height,
        assetCount: assets.length,
        clipCount: Object.values(project.compositions).reduce(
          (n, c) => n + c.elements.length,
          0,
        ),
        thumbnail: cover
          ? `/api/projects/${entry.id}/thumbnail?v=${encodeURIComponent(cover.hash)}`
          : undefined,
        coverText: composition.elements
          .filter((e) => e.type === "text" && e.text.trim())
          .sort((a, b) => b.fontSize - a.fontSize)[0]
          ?.text.slice(0, 100),
        background: composition.background,
      };
    } catch (error) {
      return {
        ...base,
        status: "invalid",
        error: "项目文件无法读取：" + (error as Error).message,
      };
    }
  }
  list(activeDirectory: string) {
    return this.read()
      .projects.filter((p) => !p.hidden)
      .map((p) => this.inspect(p, activeDirectory))
      .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
  }
  private cacheFile(directory: string, relative: string) {
    const root = path.resolve(directory, ".scrollweave", "media");
    const candidate = path.resolve(root, relative);
    if (
      !/\.(png|jpe?g|webp|svg)$/i.test(candidate) ||
      !fs.existsSync(candidate)
    )
      return null;
    const within = (base: string, target: string) => {
      const rel = path.relative(base, target);
      return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
    };
    if (
      !within(root, candidate) ||
      !within(fs.realpathSync(root), fs.realpathSync(candidate))
    )
      return null;
    return fs.statSync(candidate).isFile() ? candidate : null;
  }
  thumbnail(id: string) {
    const entry = this.get(id);
    const saved = JSON.parse(
      fs.readFileSync(projectFile(entry.directory), "utf8"),
    );
    const project = migrateProject(saved.project ?? saved);
    for (const asset of Object.values(project.assets)) {
      if (asset.archived || !asset.thumbnail) continue;
      const file = this.cacheFile(entry.directory, asset.thumbnail);
      if (file) return file;
    }
    return null;
  }
  newDirectory(name: string, parent = this.defaultDirectory) {
    if (!path.isAbsolute(parent) || !fs.statSync(parent).isDirectory())
      throw Error("请选择有效的保存文件夹。");
    const segment = name
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
      .replace(/[. ]+$/g, "")
      .slice(0, 80);
    if (
      !segment ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
    )
      throw Error("请换一个有效的项目名称");
    const directory = path.join(canonicalDirectory(parent), segment);
    if (fs.existsSync(directory))
      throw Error("该文件夹已存在，请换个名称或打开已有项目");
    return directory;
  }
}
