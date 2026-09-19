import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import chokidar, { type FSWatcher } from "chokidar";
import DOMPurify from "dompurify";
import { JSDOM } from "jsdom";
import { assetSchema, references, uid, type Asset } from "../src/core/model";
import type { ProjectStore } from "../src/core/commands";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};
const digest = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
export function processFile(exe: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(
      exe,
      args,
      { windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) =>
        error
          ? reject(
              Error(
                exe +
                  " 无法读取素材：" +
                  stderr.slice(-600) +
                  " " +
                  error.message,
              ),
            )
          : resolve(stdout),
    ),
  );
}
export function sanitizeSVG(text: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw Error("SVG 不允许 DTD 或实体声明");
  const window = new JSDOM("").window;
  try {
    const parser = new window.DOMParser(),
      source = parser.parseFromString(text, "image/svg+xml");
    if (
      source.querySelector("parsererror") ||
      source.documentElement.localName !== "svg"
    )
      throw Error("SVG 尚未写完或格式无效");
    const purifier = DOMPurify(window as any);
    purifier.addHook("uponSanitizeAttribute", (_node, data) => {
      if (
        /^on/i.test(data.attrName) ||
        ["style", "src", "xml:base"].includes(data.attrName)
      )
        data.keepAttr = false;
      if (
        /href$/i.test(data.attrName) &&
        !/^#[a-zA-Z_][\w:.-]*$/.test(data.attrValue)
      )
        data.keepAttr = false;
      if (
        /url\s*\(/i.test(data.attrValue) &&
        !/^url\(\s*#[a-zA-Z_][\w:.-]*\s*\)$/.test(data.attrValue)
      )
        data.keepAttr = false;
    });
    const clean = purifier.sanitize(text, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: [
        "script",
        "foreignObject",
        "style",
        "animate",
        "animateMotion",
        "animateTransform",
        "set",
        "image",
        "a",
      ],
      FORBID_ATTR: ["style"],
      ALLOW_DATA_ATTR: false,
    });
    const svg = parser.parseFromString(clean, "image/svg+xml").documentElement;
    if (svg.localName !== "svg") throw Error("SVG 清理后没有根元素");
    const box = svg
      .getAttribute("viewBox")
      ?.trim()
      .split(/[\s,]+/)
      .map(Number);
    const dimension = (value: string | null, fallback: number) =>
      value && /^\d+(\.\d+)?(px)?$/.test(value) ? parseFloat(value) : fallback;
    const width = dimension(svg.getAttribute("width"), box?.[2] || 512),
      height = dimension(svg.getAttribute("height"), box?.[3] || 512);
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0 ||
      width > 40000 ||
      height > 40000
    )
      throw Error("SVG 尺寸无效");
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    return {
      bytes: Buffer.from(new window.XMLSerializer().serializeToString(svg)),
      width,
      height,
      warnings: purifier.removed.length
        ? [
            "已清理脚本、事件、外部资源或样式；使用 SVG 原生呈现属性可保留外观。",
          ]
        : [],
    };
  } finally {
    window.close();
  }
}
export class AssetManager {
  watcher?: FSWatcher;
  private queue = Promise.resolve();
  pending = 0;
  ready = false;
  constructor(
    public workspace: string,
    private store: () => ProjectStore,
    private changed: () => void,
  ) {}
  get directory() {
    return path.join(this.workspace, "assets");
  }
  get cache() {
    return path.join(this.workspace, ".scrollweave", "media");
  }
  async start() {
    await fs.mkdir(this.directory, { recursive: true });
    await fs.mkdir(this.cache, { recursive: true });
    this.watcher = chokidar.watch(this.directory, {
      ignoreInitial: false,
      followSymlinks: false,
      awaitWriteFinish: { stabilityThreshold: 900, pollInterval: 100 },
      atomic: 200,
      ignored: (file, stat) =>
        file !== this.directory &&
        (path.basename(file).startsWith(".") ||
          /\.(tmp|part|crdownload|swp|bak)$/i.test(file) ||
          (!!stat?.isFile() &&
            !/\.(png|jpe?g|webp|svg|mp4|webm|mov|avi|mkv)$/i.test(file))),
    });
    this.watcher
      .on("add", (file) => void this.enqueue(() => this.ingest(file)))
      .on("change", (file) => void this.enqueue(() => this.ingest(file)))
      .on(
        "unlink",
        (file) =>
          void this.enqueue(async () => {
            const relative = path
              .relative(this.workspace, file)
              .split(path.sep)
              .join("/");
            const a = Object.values(this.store().project.assets).find(
              (a) => a.path === relative,
            );
            if (a) {
              this.store().syncAsset({
                ...a,
                status: "missing",
                error: "源文件已删除或移动，请重新关联",
              });
              this.changed();
            }
          }),
      )
      .on("error", (error) => {
        this.store().errors.push("素材监听：" + String(error));
        this.changed();
      });
    await new Promise<void>((resolve) => this.watcher!.once("ready", resolve));
    await this.queue;
    this.ready = true;
    for (const a of Object.values(this.store().project.assets)) {
      if (a.path && !a.archived) {
        try {
          await fs.access(path.join(this.workspace, a.path));
        } catch {
          this.store().syncAsset({
            ...a,
            status: "missing",
            error: "找不到源文件，请重新关联",
          });
          this.changed();
        }
      }
    }
  }
  async close() {
    await this.watcher?.close();
    await this.queue;
  }
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    this.pending++;
    const result = this.queue.then(work);
    this.queue = result
      .then(
        () => {},
        (error) => {
          this.store().errors.push(String(error));
        },
      )
      .finally(() => {
        this.pending--;
      });
    return result;
  }
  private async safeFile(file: string) {
    const root = await fs.realpath(this.directory),
      resolved = await fs.realpath(file);
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw Error("只读取作品 assets 目录内的真实文件");
    if (!(await fs.lstat(file)).isFile()) throw Error("素材必须是普通文件");
    return resolved;
  }
  async inspect(file: string, id: string): Promise<Asset> {
    await this.safeFile(file);
    const stat = await fs.stat(file);
    if (stat.size > 512 * 1024 * 1024) throw Error("单份素材最多 512 MB");
    if (!stat.size) throw Error("文件为空或尚未写完");
    const ext = path.extname(file).toLowerCase(),
      mime = MIME[ext];
    if (!mime)
      throw Error(
        "不支持此格式；请使用 PNG、JPEG、WebP、SVG、H.264/AAC MP4 或 VP8/VP9 WebM",
      );
    const raw = await fs.readFile(file),
      hash = digest(raw),
      relative = path.relative(this.workspace, file).split(path.sep).join("/");
    const dest = path.join(this.cache, id);
    await fs.mkdir(dest, { recursive: true });
    let bytes = raw,
      width = 0,
      height = 0,
      duration: number | undefined,
      codec: string | undefined,
      audioCodec: string | undefined,
      hasAudio = false,
      warnings: string[] = [];
    if (ext === ".svg") {
      if (raw.length > 10 * 1024 * 1024) throw Error("SVG 最多 10 MB");
      const clean = sanitizeSVG(raw.toString("utf8"));
      ({ bytes, width, height, warnings } = clean);
    } else {
      const probe = JSON.parse(
        await processFile(process.env.SW_FFPROBE ?? "ffprobe", [
          "-v",
          "error",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          file,
        ]),
      );
      const stream = probe.streams?.find((s: any) => s.codec_type === "video");
      if (!stream) throw Error("没有可解码的画面");
      width = Number(stream.width);
      height = Number(stream.height);
      codec = stream.codec_name;
      if (mime.startsWith("video/")) {
        duration = Number(probe.format?.duration ?? stream.duration);
        if (!duration || duration > 86400)
          throw Error("视频缺少有效时长或超过 24 小时");
        const audio = probe.streams.find((s: any) => s.codec_type === "audio");
        hasAudio = !!audio;
        audioCodec = audio?.codec_name;
        if (
          ext === ".mp4" &&
          (codec !== "h264" || (audio && audioCodec !== "aac"))
        )
          throw Error("MP4 目前验证支持 H.264 视频 + AAC 音频；请转码后导入");
        if (
          ext === ".webm" &&
          (!["vp8", "vp9"].includes(codec!) ||
            (audio && !["opus", "vorbis"].includes(audioCodec!)))
        )
          throw Error("WebM 目前验证支持 VP8/VP9 + Opus/Vorbis");
      } else if (!["png", "mjpeg", "webp"].includes(codec!))
        throw Error("文件内容与图片格式不匹配");
    }
    const cachePath = id + "/" + hash + ext,
      thumbnail = id + "/" + hash + ".jpg";
    await fs.writeFile(path.join(this.cache, cachePath), bytes);
    if (ext !== ".svg")
      await processFile(process.env.SW_FFMPEG ?? "ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        path.join(this.cache, cachePath),
        "-frames:v",
        "1",
        "-vf",
        "scale=320:-2",
        "-q:v",
        "3",
        path.join(this.cache, thumbnail),
      ]);
    const a = assetSchema.parse({
      id,
      name: path.basename(file),
      kind:
        ext === ".svg" ? "svg" : mime.startsWith("video/") ? "video" : "image",
      mime,
      path: relative,
      cachePath,
      thumbnail: ext === ".svg" ? cachePath : thumbnail,
      width,
      height,
      duration,
      codec,
      audioCodec,
      hasAudio,
      warnings,
      hash,
      size: raw.length,
      status: "ready",
    });
    for (const ref of references(this.store().project, id)) {
      const e = this.store().project.compositions[
        ref.compositionId
      ].elements.find((e) => e.id === ref.clipId)!;
      if (
        duration &&
        e.sourceIn + (e.end - e.start) * e.speed > duration + 0.04
      )
        a.warnings.push(
          "新视频短于已有片段，超出部分保持末帧；请检查 " + e.name,
        );
    }
    return a;
  }
  private async ingest(file: string, forceId?: string) {
    const relative = path
      .relative(this.workspace, file)
      .split(path.sep)
      .join("/");
    const previous = forceId
      ? this.store().project.assets[forceId]
      : Object.values(this.store().project.assets).find(
          (a) => a.path === relative,
        );
    const id = previous?.id ?? uid("asset");
    try {
      const raw = await fs.readFile(await this.safeFile(file));
      if (
        previous?.hash === digest(raw) &&
        previous.status === "ready" &&
        previous.path === relative &&
        previous.cachePath &&
        (await fs.access(path.join(this.cache, previous.cachePath)).then(
          () => true,
          () => false,
        ))
      )
        return previous;
      const asset = await this.inspect(file, id);
      if (previous && previous.kind !== asset.kind)
        throw Error("重新关联必须保持素材类型一致");
      this.store().syncAsset(asset);
      this.changed();
      return asset;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return previous;
      const ext = path.extname(file).toLowerCase();
      const asset = assetSchema.parse({
        ...previous,
        id,
        name: previous?.name ?? path.basename(file),
        path: previous?.path ?? relative,
        kind:
          previous?.kind ??
          (ext === ".svg"
            ? "svg"
            : /\.(png|jpe?g|webp)$/i.test(ext)
              ? "image"
              : "video"),
        mime: previous?.mime ?? MIME[ext] ?? "application/octet-stream",
        status: "error",
        error: (error as Error).message,
      });
      this.store().syncAsset(asset);
      this.changed();
      return asset;
    }
  }
  async importBuffer(name: string, bytes: Buffer, replaceId?: string) {
    if (replaceId && !this.store().project.assets[replaceId])
      throw Error("重新关联的素材不存在");
    const base = path
      .basename(name)
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .slice(0, 180);
    if (!base || base.startsWith(".")) throw Error("文件名无效");
    return this.enqueue(async () => {
      const ext = path.extname(base),
        stem = path.basename(base, ext);
      let file = path.join(this.directory, base),
        count = 1;
      while (
        await fs.access(file).then(
          () => true,
          () => false,
        )
      )
        file = path.join(this.directory, stem + "-" + count++ + ext);
      const temporary = path.join(
        this.directory,
        ".upload-" + uid() + ext + ".tmp",
      );
      await fs.writeFile(temporary, bytes);
      await fs.rename(temporary, file);
      if (replaceId) {
        try {
          const candidate = await this.inspect(file, replaceId);
          if (candidate.kind !== this.store().project.assets[replaceId].kind)
            throw Error("重新关联必须保持素材类型一致");
          this.store().syncAsset(candidate);
          this.changed();
          return candidate;
        } catch (error) {
          await fs.unlink(file);
          throw error;
        }
      }
      return this.ingest(file);
    });
  }
  async waitFor(query: { path?: string; name?: string; timeoutMs: number }) {
    const end = Date.now() + query.timeoutMs;
    do {
      const a = Object.values(this.store().project.assets).find(
        (a) =>
          !a.archived &&
          (query.path ? a.path === query.path : a.name === query.name),
      );
      if (a && a.status === "ready") return a;
      if (a?.status === "error" && this.pending === 0) throw Error(a.error);
      await new Promise((r) => setTimeout(r, 100));
    } while (Date.now() < end);
    throw Error("等待素材超时，请检查路径与素材错误");
  }
}
