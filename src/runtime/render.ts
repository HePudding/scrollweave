import type { Element, Project } from "../core/model";
import { assetURL } from "../core/media-url";
import { sampleElement, clamp, chase } from "../core/evaluate";
import { customElements } from "../extensions/registry";
import "../extensions/builtin-elements";
export const runtimeCSS = `*{box-sizing:border-box}html,body{margin:0;width:100%;min-height:100%;background:#101312}body{font-family:Inter,"Segoe UI","Microsoft YaHei",sans-serif}.sw-section{position:relative;isolation:isolate}.sw-viewport{width:100%;height:100vh;position:relative;overflow:hidden}.sw-section[data-kind=pin]>.sw-viewport{position:sticky;top:0}.sw-fit{position:absolute;left:50%;top:50%;transform-origin:center center}.sw-design{position:relative;overflow:hidden;isolation:isolate}.sw-element{position:absolute;left:0;top:0;transform-origin:0 0;box-sizing:border-box;white-space:pre-wrap;line-height:1.15;overflow-wrap:break-word}.sw-element img,.sw-element video{display:block;width:100%;height:100%;object-fit:contain;pointer-events:none}.sw-element a{color:inherit;text-decoration:none;display:flex;align-items:center;justify-content:center;width:100%;height:100%}.sw-text{white-space:pre-wrap}.sw-media-error{position:absolute;inset:0;display:grid;place-content:center;background:#471d29cc;color:#fff;font-size:24px;padding:24px}.sw-element[data-type=group],.sw-element[data-type=composition]{pointer-events:none}.sw-element[data-type=group]>.sw-element,.sw-element[data-type=composition] .sw-element{pointer-events:auto}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}`;
type RenderNode = {
  element: Element;
  dom: HTMLElement;
  trackHidden: boolean;
  nested?: RenderNode[];
  custom?: HTMLElement;
  media?: ReturnType<typeof videoController>;
};
function videoController(
  video: HTMLVideoElement,
  report: (text: string) => void,
) {
  let target = 0,
    playing = false,
    rate = 1,
    disposed = false,
    requested = false,
    blocked = false;
  const seek = () => {
    if (disposed || !video.readyState || video.seeking) return;
    const at = clamp(target, 0, Math.max(0, video.duration - 0.002));
    if (Math.abs(video.currentTime - at) > (playing ? 0.22 : 0.012))
      try {
        video.currentTime = at;
      } catch {}
  };
  const ready = () => {
    seek();
    if (playing) play();
  };
  const play = () => {
    if (disposed || requested || blocked || !video.paused) return;
    requested = true;
    void video
      .play()
      .catch((error) => {
        if (error.name !== "AbortError") {
          blocked = true;
          report("视频播放失败：" + error.message);
        }
      })
      .finally(() => {
        requested = false;
      });
  };
  video.addEventListener("loadedmetadata", ready);
  video.addEventListener("seeked", seek);
  video.addEventListener("error", () =>
    report("视频解码失败；请使用 H.264/AAC MP4 或 VP8/VP9 WebM"),
  );
  return {
    update(
      time: number,
      run: boolean,
      speed: number,
      muted: boolean,
      volume: number,
    ) {
      target = time;
      rate = clamp(speed, 0.0625, 16);
      video.playbackRate = rate;
      video.muted = muted;
      video.volume = clamp(volume);
      const changed = playing !== run;
      playing = run;
      if (changed && run) blocked = false;
      if (!playing) {
        if (!video.paused) video.pause();
        seek();
      } else {
        seek();
        play();
      }
      video.dataset.targetTime = String(target);
      video.dataset.playing = String(playing);
    },
    destroy() {
      disposed = true;
      video.pause();
      video.removeAttribute("src");
      video.load();
    },
  };
}
export function mountStage(
  host: HTMLElement,
  project: Project,
  compositionId: string,
  options: { fit?: boolean; onError?: (message: string) => void } = {},
) {
  const doc = host.ownerDocument,
    composition = project.compositions[compositionId];
  if (!composition) throw Error("时间线不存在");
  const fit = doc.createElement("div");
  fit.className = options.fit === false ? "" : "sw-fit";
  const design = doc.createElement("div");
  design.className = "sw-design";
  design.dataset.compositionId = compositionId;
  Object.assign(design.style, {
    width: composition.width + "px",
    height: composition.height + "px",
    background: composition.background,
  });
  fit.append(design);
  host.replaceChildren(fit);
  const media: ReturnType<typeof videoController>[] = [];
  function build(cid: string, parent: HTMLElement, path: string): RenderNode[] {
    const c = project.compositions[cid],
      rank = new Map(c.tracks.map((t, i) => [t.id, i]));
    function children(
      parentId: string | null,
      container: HTMLElement,
      prefix: string,
    ): RenderNode[] {
      return c.elements
        .filter((e) => e.parentId === parentId)
        .sort((a, b) => (rank.get(a.trackId) ?? 0) - (rank.get(b.trackId) ?? 0))
        .map((element) => {
          const dom = doc.createElement("div");
          dom.className = "sw-element";
          dom.dataset.elementId = element.id;
          dom.dataset.type = element.type;
          dom.dataset.path = prefix + "/" + element.id;
          Object.assign(dom.style, {
            width: element.width + "px",
            height: element.height + "px",
            color: element.color,
            borderRadius: element.radius + "px",
            fontSize: element.fontSize + "px",
            fontWeight: String(element.fontWeight),
            overflow: element.clip ? "hidden" : "visible",
            clipPath: Object.values(element.crop).some(Boolean)
              ? `inset(${element.crop.top}% ${element.crop.right}% ${element.crop.bottom}% ${element.crop.left}%)`
              : "",
            background: element.type === "shape" ? element.fill : "transparent",
          });
          const node: RenderNode = {
            element,
            dom,
            trackHidden: !!c.tracks.find((t) => t.id === element.trackId)
              ?.hidden,
          };
          const report = (message: string) => {
            if (!dom.querySelector(".sw-media-error")) {
              const badge = doc.createElement("div");
              badge.className = "sw-media-error";
              badge.textContent = message;
              dom.append(badge);
            }
            options.onError?.(message);
            doc.defaultView?.dispatchEvent(
              new CustomEvent("sw-media-error", { detail: message }),
            );
          };
          if (element.type === "text") {
            dom.classList.add("sw-text");
            if (element.href) {
              const link = doc.createElement("a");
              link.href = element.href;
              link.rel = "noopener noreferrer";
              link.textContent = element.text;
              dom.append(link);
            } else dom.textContent = element.text;
          }
          if (["image", "svg", "video"].includes(element.type)) {
            const asset = project.assets[element.assetId!];
            if (asset.status === "missing") report("素材缺失：" + asset.name);
            else if (!assetURL(asset)) report(asset.error ?? "素材尚未就绪");
            else if (element.type === "video") {
              const video = doc.createElement("video");
              video.src = assetURL(asset);
              video.preload = "auto";
              video.playsInline = true;
              video.muted = true;
              dom.append(video);
              node.media = videoController(video, report);
              media.push(node.media);
            } else {
              const img = doc.createElement("img");
              img.src = assetURL(asset);
              img.alt = element.name;
              img.draggable = false;
              img.onerror = () => report("图片加载失败：" + asset.name);
              dom.append(img);
            }
          }
          if (element.type === "group")
            node.nested = children(element.id, dom, dom.dataset.path!);
          if (element.type === "composition") {
            const sub = project.compositions[element.compositionId!],
              inner = doc.createElement("div");
            Object.assign(inner.style, {
              position: "absolute",
              width: sub.width + "px",
              height: sub.height + "px",
              transformOrigin: "0 0",
              transform: `scale(${element.width / sub.width},${element.height / sub.height})`,
              background: sub.background,
            });
            dom.append(inner);
            node.nested = build(sub.id, inner, dom.dataset.path!);
          }
          if (element.type === "custom") {
            const ext = customElements.get(element.customType!);
            if (!ext) throw Error("未知自定义元素");
            node.custom = ext.create(element, doc);
            dom.append(node.custom);
          }
          container.append(dom);
          return node;
        });
    }
    return children(null, parent, path);
  }
  const nodes = build(compositionId, design, compositionId);
  function draw(
    time: number,
    playback: { playing?: boolean; muted?: boolean } = {},
  ) {
    const visit = (
      list: RenderNode[],
      at: number,
      visible: boolean,
      opacity: number,
      rate: number,
      muted: boolean,
      volume: number,
    ) => {
      for (const node of list) {
        const e = node.element,
          v = sampleElement(e, at),
          shown = visible && v.visible && !node.trackHidden;
        node.dom.style.transform = `translate(${v.x}px,${v.y}px) rotate(${v.rotation}deg) scale(${v.scaleX},${v.scaleY})`;
        node.dom.style.opacity = String(v.opacity);
        node.dom.style.visibility =
          shown && opacity * v.opacity > 1e-6 ? "visible" : "hidden";
        node.media?.update(
          Math.max(0, v.sourceTime),
          !!playback.playing && shown,
          rate * e.speed,
          muted || e.muted || !playback.playing,
          volume * e.volume,
        );
        if (node.nested) {
          let child = v.progress;
          if (e.sourceDuration !== undefined && child === e.sourceDuration)
            child -= 1e-8;
          visit(
            node.nested,
            child,
            shown,
            opacity * v.opacity,
            rate * e.speed,
            muted || e.muted,
            volume * e.volume,
          );
        }
        if (node.custom)
          customElements
            .get(e.customType!)
            ?.update?.(
              node.custom,
              e,
              e.sourceDuration ? v.progress / e.sourceDuration : v.progress,
            );
      }
    };
    visit(
      nodes,
      Math.min(time, composition.duration - 1e-8),
      true,
      1,
      1,
      !!playback.muted,
      1,
    );
  }
  const resize = () => {
    if (options.fit === false) return;
    const scale = (project.canvas.fit === "cover" ? Math.max : Math.min)(
      host.clientWidth / composition.width,
      host.clientHeight / composition.height,
    );
    fit.style.width = composition.width + "px";
    fit.style.height = composition.height + "px";
    fit.style.transform = `translate(-50%,-50%) scale(${scale})`;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  draw(0);
  return {
    design,
    draw,
    resize,
    destroy() {
      observer.disconnect();
      media.forEach((m) => m.destroy());
      host.replaceChildren();
    },
  };
}
export type PagePosition = {
  compositionId: string;
  sectionId: string;
  progress: number;
  targetProgress: number;
  fraction: number;
  globalProgress: number;
  scrollY: number;
  mode: "exact" | "smooth";
};
export function mountPage(
  root: HTMLElement,
  project: Project,
  onProgress?: (p: PagePosition) => void,
) {
  const doc = root.ownerDocument,
    win = doc.defaultView!;
  const sections = project.sections.map((section) => {
    const block = doc.createElement("section");
    block.className = "sw-section";
    block.dataset.sectionId = section.id;
    block.dataset.kind = section.kind;
    const viewport = doc.createElement("div");
    viewport.className = "sw-viewport";
    viewport.style.background =
      project.compositions[section.compositionId].background;
    block.append(viewport);
    root.append(block);
    return {
      section,
      block,
      viewport,
      stage: mountStage(viewport, project, section.compositionId),
      actual: 0,
      target: 0,
    };
  });
  const seconds = (s: (typeof sections)[number], fraction: number) =>
    s.section.start +
    fraction *
      ((s.section.end ??
        project.compositions[s.section.compositionId].duration) -
        s.section.start);
  const range = (s: (typeof sections)[number]) =>
    s.section.kind === "pin"
      ? s.section.scrollDistance
      : Math.max(1, s.section.scrollDistance);
  const updateTargets = () => {
    for (const s of sections)
      s.target = clamp((win.scrollY - s.block.offsetTop) / range(s));
  };
  const resize = () => {
    for (const s of sections) {
      s.block.style.height = s.section.scrollDistance + win.innerHeight + "px";
      s.viewport.style.height = "100vh";
    }
    updateTargets();
  };
  let mode = project.scroll.mode,
    frame = 0,
    last = 0,
    destroyed = false,
    position: PagePosition;
  const reduced = win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const tick = (now: number) => {
    if (destroyed) return;
    const delta = last ? Math.min(64, now - last) : 16;
    last = now;
    updateTargets();
    for (const s of sections) {
      s.actual =
        mode === "exact" || reduced
          ? s.target
          : chase(s.actual, s.target, delta, project.scroll.smoothing);
      if (Math.abs(s.actual - s.target) < 1e-6) s.actual = s.target;
      s.stage.draw(seconds(s, s.actual), { muted: true });
    }
    const active =
      [...sections]
        .reverse()
        .find((s) => win.scrollY >= s.block.offsetTop - 1) ?? sections[0];
    position = {
      compositionId: active.section.compositionId,
      sectionId: active.section.id,
      progress: seconds(active, active.actual),
      targetProgress: seconds(active, active.target),
      fraction: active.actual,
      globalProgress:
        win.scrollY /
        Math.max(1, doc.documentElement.scrollHeight - win.innerHeight),
      scrollY: win.scrollY,
      mode,
    };
    onProgress?.(position);
    frame = win.requestAnimationFrame(tick);
  };
  resize();
  win.addEventListener("resize", resize);
  frame = win.requestAnimationFrame(tick);
  return {
    get position() {
      return position;
    },
    seek(time: number, sectionId = sections[0].section.id, immediate = false) {
      const s = sections.find((s) => s.section.id === sectionId);
      if (!s) throw Error("滚动区间不存在");
      const fraction = clamp(
        (time - s.section.start) /
          ((s.section.end ??
            project.compositions[s.section.compositionId].duration) -
            s.section.start),
      );
      win.scrollTo(0, s.block.offsetTop + fraction * range(s));
      updateTargets();
      if (immediate)
        for (const entry of sections) {
          entry.actual = entry.target;
          entry.stage.draw(seconds(entry, entry.actual), { muted: true });
        }
    },
    setMode(value: "exact" | "smooth") {
      mode = value;
    },
    destroy() {
      destroyed = true;
      win.cancelAnimationFrame(frame);
      win.removeEventListener("resize", resize);
      sections.forEach((s) => s.stage.destroy());
      root.replaceChildren();
    },
  };
}
