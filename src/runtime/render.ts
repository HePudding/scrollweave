import type { Element, Project } from "../core/model";
import { sampleElement, clamp, chase } from "../core/evaluate";
import { customElements } from "../extensions/registry";
import "../extensions/builtin-elements";

export const runtimeCSS = `*{box-sizing:border-box}html,body{margin:0;width:100%;min-height:100%;background:#101312}body{font-family:Inter,"Segoe UI","Microsoft YaHei",sans-serif}.sw-section{position:relative;isolation:isolate}.sw-viewport{width:100%;height:100vh;position:relative;overflow:hidden}.sw-section[data-kind=pin]>.sw-viewport{position:sticky;top:0}.sw-fit{position:absolute;left:50%;top:50%;transform-origin:center center}.sw-design{position:relative;overflow:hidden;isolation:isolate}.sw-element{position:absolute;left:0;top:0;transform-origin:0 0;box-sizing:border-box;white-space:pre-wrap;line-height:1.15;overflow-wrap:break-word}.sw-element img{display:block;width:100%;height:100%;object-fit:cover;pointer-events:none}.sw-element a{color:inherit;text-decoration:none;display:flex;align-items:center;justify-content:center;width:100%;height:100%}.sw-text{white-space:pre-wrap}.sw-element[data-type=group],.sw-element[data-type=composition]{pointer-events:none}.sw-element[data-type=group]>.sw-element,.sw-element[data-type=composition] .sw-element{pointer-events:auto}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}`;
type RenderNode = {
  element: Element;
  dom: HTMLElement;
  nested?: RenderNode[];
  custom?: HTMLElement;
};
export function mountStage(
  host: HTMLElement,
  project: Project,
  compositionId: string,
  options: { fit?: boolean } = {},
) {
  const doc = host.ownerDocument;
  const composition = project.compositions[compositionId];
  if (!composition) throw new Error(`合成不存在: ${compositionId}`);
  const fit = doc.createElement("div");
  fit.className = options.fit === false ? "" : "sw-fit";
  const design = doc.createElement("div");
  design.className = "sw-design";
  design.dataset.compositionId = compositionId;
  Object.assign(design.style, {
    width: `${composition.width}px`,
    height: `${composition.height}px`,
    background: composition.background,
  });
  fit.append(design);
  host.replaceChildren(fit);
  const build = (
    cid: string,
    parent: HTMLElement,
    path: string,
  ): RenderNode[] => {
    const c = project.compositions[cid];
    const children = (
      parentId: string | null,
      container: HTMLElement,
      prefix: string,
    ): RenderNode[] =>
      c.elements
        .filter((e) => e.parentId === parentId)
        .map((element) => {
          const dom = doc.createElement("div");
          dom.className = "sw-element";
          dom.dataset.elementId = element.id;
          dom.dataset.type = element.type;
          dom.dataset.path = `${prefix}/${element.id}`;
          Object.assign(dom.style, {
            width: `${element.width}px`,
            height: `${element.height}px`,
            color: element.color,
            borderRadius: `${element.radius}px`,
            fontSize: `${element.fontSize}px`,
            fontWeight: String(element.fontWeight),
            overflow: element.clip ? "hidden" : "visible",
            clipPath: Object.values(element.crop).some(Boolean)
              ? `inset(${element.crop.top}% ${element.crop.right}% ${element.crop.bottom}% ${element.crop.left}%)`
              : "",
            background: ["shape", "image"].includes(element.type)
              ? element.fill
              : "transparent",
          });
          const node: RenderNode = { element, dom };
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
          if (element.type === "image") {
            const img = doc.createElement("img");
            img.src = project.assets[element.assetId!].data;
            img.alt = element.name;
            img.draggable = false;
            dom.append(img);
          }
          if (element.type === "group")
            node.nested = children(element.id, dom, dom.dataset.path!);
          if (element.type === "composition") {
            const sub = project.compositions[element.compositionId!];
            const inner = doc.createElement("div");
            Object.assign(inner.style, {
              position: "absolute",
              width: `${sub.width}px`,
              height: `${sub.height}px`,
              transformOrigin: "0 0",
              transform: `scale(${element.width / sub.width},${element.height / sub.height})`,
              background: sub.background,
            });
            dom.append(inner);
            node.nested = build(sub.id, inner, dom.dataset.path!);
          }
          if (element.type === "custom") {
            const extension = customElements.get(element.customType!);
            if (!extension)
              throw new Error(`未知自定义元素: ${element.customType}`);
            node.custom = extension.create(element, doc);
            dom.append(node.custom);
          }
          container.append(dom);
          return node;
        });
    return children(null, parent, path);
  };
  const nodes = build(compositionId, design, compositionId);
  const draw = (
    progress: number,
    list = nodes,
    parentVisible = true,
    parentOpacity = 1,
  ) => {
    for (const node of list) {
      const v = sampleElement(node.element, progress);
      const visible = parentVisible && v.visible;
      const opacity = parentOpacity * v.opacity;
      node.dom.style.transform = `translate(${v.x}px, ${v.y}px) rotate(${v.rotation}deg) scale(${v.scaleX}, ${v.scaleY})`;
      node.dom.style.opacity = String(v.opacity);
      // Descendants must not override a hidden group, and zero-opacity objects
      // must not intercept canvas selection or exported page links.
      node.dom.style.visibility =
        visible && opacity > 0.000001 ? "visible" : "hidden";
      if (node.nested) draw(v.progress, node.nested, visible, opacity);
      if (node.custom)
        customElements
          .get(node.element.customType!)
          ?.update?.(node.custom, node.element, v.progress);
    }
  };
  const resize = () => {
    if (options.fit === false) return;
    const scale = (project.canvas.fit === "cover" ? Math.max : Math.min)(
      host.clientWidth / composition.width,
      host.clientHeight / composition.height,
    );
    fit.style.width = `${composition.width}px`;
    fit.style.height = `${composition.height}px`;
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
      host.replaceChildren();
    },
  };
}

export type PagePosition = {
  compositionId: string;
  sectionId: string;
  progress: number;
  targetProgress: number;
  globalProgress: number;
  scrollY: number;
  mode: "exact" | "smooth";
};
export function mountPage(
  root: HTMLElement,
  project: Project,
  onProgress?: (p: PagePosition) => void,
) {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  const sections = project.sections.map((section) => {
    const block = doc.createElement("section");
    block.className = "sw-section";
    block.dataset.sectionId = section.id;
    block.dataset.kind = section.kind;
    const viewport = doc.createElement("div");
    viewport.className = "sw-viewport";
    viewport.style.background =
      project.compositions[section.compositionId].background;
    if (section.kind === "flow")
      viewport.style.height = `${section.scrollDistance}px`;
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
  let mode = project.scroll.mode;
  let frame = 0;
  let last = 0;
  let destroyed = false;
  let position: PagePosition;
  const reduced = win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const resize = () => {
    for (const s of sections) {
      s.block.style.height = `${s.section.kind === "pin" ? s.section.scrollDistance + win.innerHeight : s.section.scrollDistance}px`;
    }
    updateTargets();
  };
  const scrollRange = (s: (typeof sections)[number]) =>
    s.section.kind === "pin"
      ? s.section.scrollDistance
      : Math.max(1, s.section.scrollDistance - win.innerHeight);
  const updateTargets = () => {
    for (const s of sections)
      s.target = clamp((win.scrollY - s.block.offsetTop) / scrollRange(s));
  };
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
      if (Math.abs(s.actual - s.target) < 0.000001) s.actual = s.target;
      s.stage.draw(s.actual);
    }
    const active =
      [...sections]
        .reverse()
        .find((s) => win.scrollY >= s.block.offsetTop - 1) ?? sections[0];
    position = {
      compositionId: active.section.compositionId,
      sectionId: active.section.id,
      progress: active.actual,
      targetProgress: active.target,
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
    seek(
      progress: number,
      sectionId = sections[0].section.id,
      immediate = false,
    ) {
      const s = sections.find((s) => s.section.id === sectionId);
      if (!s) throw new Error("页面区间不存在");
      const p = clamp(progress);
      win.scrollTo(0, s.block.offsetTop + p * scrollRange(s));
      updateTargets();
      if (immediate) {
        for (const entry of sections) {
          entry.actual = entry.target;
          entry.stage.draw(entry.actual);
        }
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
