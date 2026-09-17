import { useEffect, useRef, useState } from "react";
import { Timeline as VisTimeline, type TimelineOptions } from "vis-timeline";
import { DataSet } from "vis-data";
import "vis-timeline/styles/vis-timeline-graph2d.css";
import {
  properties,
  type Project,
  type AnimProperty,
  type Element,
} from "../core/model";
import type { Command } from "../core/commands";
import { clamp, elementRange } from "../core/evaluate";
import { clipRange, parentRange } from "../core/timing";
import { keyId, moveKeys, type KeySelection } from "../core/keyframes";
export type { KeySelection } from "../core/keyframes";
export const propertyNames: Record<AnimProperty, string> = {
  x: "位置 X",
  y: "位置 Y",
  scaleX: "缩放 X",
  scaleY: "缩放 Y",
  rotation: "旋转",
  opacity: "透明度",
};
const extent = 100000;
type Props = {
  project: Project;
  compositionId: string;
  revision: number;
  progress: number;
  selected: string[];
  keys: KeySelection[];
  compact: boolean;
  snapping: boolean;
  view: { action: "fit" | "in" | "out"; serial: number };
  onSeek(p: number): void;
  onSelect(ids: string[]): void;
  onKey(keys: KeySelection[]): void;
  onError(message: string): void;
  onCommit(
    commands: Command[],
    label: string,
    revision?: number,
  ): Promise<void>;
};
const parseKey = (id: string): KeySelection => {
  const [, elementId, property, keyframeId] = id.split(":");
  return { elementId, property: property as AnimProperty, keyframeId };
};

export function Timeline(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const timeline = useRef<VisTimeline | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const items = useRef(new DataSet<any>());
  const groups = useRef(new DataSet<any>());
  const syncing = useRef(false);
  const ignoreClickUntil = useRef(0);
  const gesture = useRef<{
    revision: number;
    project: Project;
    selection: string[];
  } | null>(null);
  const pendingMoves = useRef(new Map<string, any>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [staticExpanded, setStaticExpanded] = useState(false);
  useEffect(() => {
    setExpanded({});
    setStaticExpanded(false);
    const options: TimelineOptions = {
      start: 0,
      end: extent,
      min: -1000,
      max: extent + 1000,
      zoomMin: 2000,
      zoomMax: extent + 2000,
      showCurrentTime: false,
      showMajorLabels: false,
      stack: false,
      groupOrder: "order",
      orientation: "top",
      height: "100%",
      verticalScroll: true,
      horizontalScroll: true,
      horizontalScrollKey: "shiftKey",
      horizontalScrollInvert: true,
      zoomKey: "ctrlKey",
      selectable: true,
      multiselect: true,
      editable: {
        updateTime: true,
        updateGroup: false,
        remove: false,
        add: false,
      },
      itemsAlwaysDraggable: { item: true, range: true },
      margin: { item: 6, axis: 8 },
      snap: null,
      format: {
        minorLabels: (date: any) => `${Math.round((+date / extent) * 100)}%`,
      },
      onMoving(item, callback) {
        ignoreClickUntil.current = performance.now() + 250;
        const p = latest.current;
        if (!gesture.current)
          gesture.current = {
            revision: p.revision,
            project: p.project,
            selection: (timeline.current?.getSelection() ?? []).map(String),
          };
        const original = items.current.get(item.id);
        if (!original) {
          callback(null);
          return;
        }
        if (p.snapping) {
          const window = timeline.current!.getWindow();
          const width =
            host.current?.querySelector(".vis-panel.vis-center")?.clientWidth ||
            800;
          const threshold = ((+window.end - +window.start) / width) * 7;
          const moving = new Set([
            ...gesture.current.selection,
            String(item.id),
          ]);
          const points = [
            0,
            extent,
            p.progress * extent,
            ...items.current
              .get()
              .filter((i) => !moving.has(String(i.id)))
              .flatMap((i) =>
                i.end !== undefined
                  ? [+new Date(i.start), +new Date(i.end)]
                  : [+new Date(i.start)],
              ),
          ];
          const snap = (value: number) => {
            const nearest = points.reduce(
              (best, n) =>
                Math.abs(n - value) < Math.abs(best - value) ? n : best,
              Infinity,
            );
            return Math.abs(nearest - value) < threshold ? nearest : value;
          };
          const oldStart = +new Date(original.start),
            oldEnd =
              original.end === undefined ? undefined : +new Date(original.end);
          let start = +new Date(item.start),
            end = item.end === undefined ? undefined : +new Date(item.end);
          if (end === undefined) start = snap(start);
          else if (Math.abs(end - start - (oldEnd! - oldStart)) < 0.5) {
            const shiftStart = snap(start) - start,
              shiftEnd = snap(end) - end;
            const shift =
              shiftStart !== 0 &&
              (shiftEnd === 0 || Math.abs(shiftStart) < Math.abs(shiftEnd))
                ? shiftStart
                : shiftEnd;
            start += shift;
            end += shift;
          } else if (Math.abs(start - oldStart) > 0.5) start = snap(start);
          else end = snap(end);
          item.start = new Date(start);
          if (end !== undefined) item.end = new Date(end);
        }
        callback(item);
      },
      onMove(item, callback) {
        ignoreClickUntil.current = performance.now() + 250;
        // vis calls this once per selected item. Collect a gesture into one transaction.
        callback(null);
        pendingMoves.current.set(String(item.id), item);
        if (flushTimer.current) return;
        flushTimer.current = setTimeout(() => {
          flushTimer.current = undefined;
          const p = latest.current,
            cid = p.compositionId;
          const captured = gesture.current ?? {
            revision: p.revision,
            project: p.project,
            selection: [],
          };
          const moves = [...pendingMoves.current.values()];
          pendingMoves.current.clear();
          gesture.current = null;
          const commands: Command[] = [];
          try {
            const keyMove = moves.find((i) => String(i.id).startsWith("key:"));
            if (keyMove) {
              const id = String(keyMove.id),
                ref = parseKey(id);
              const refs = [
                ...new Set([
                  ...captured.selection.filter((i) => i.startsWith("key:")),
                  id,
                ]),
              ].map(parseKey);
              const e = captured.project.compositions[cid].elements.find(
                (e) => e.id === ref.elementId,
              )!;
              const range = elementRange(captured.project, cid, e);
              const k = e.tracks[ref.property]!.find(
                (k) => k.id === ref.keyframeId,
              )!;
              commands.push(
                ...moveKeys(
                  captured.project,
                  cid,
                  refs,
                  +new Date(keyMove.start) / extent -
                    (range.start + k.at * (range.end - range.start)),
                ),
              );
            } else
              for (const item of moves) {
                const e = captured.project.compositions[cid].elements.find(
                  (e) => e.id === String(item.id).split(":")[1],
                );
                if (!e) continue;
                const parent = parentRange(captured.project, cid, e),
                  old = clipRange(captured.project, cid, e);
                const start = +new Date(item.start) / extent,
                  end = +new Date(item.end) / extent;
                const duration = parent.end - parent.start;
                if (Math.abs(end - start - (old.end - old.start)) < 0.00002)
                  commands.push({
                    type: "element.move",
                    compositionId: cid,
                    elementId: e.id,
                    delta: (start - old.start) / duration,
                  });
                else
                  commands.push({
                    type: "element.trim",
                    compositionId: cid,
                    elementId: e.id,
                    start: clamp((start - parent.start) / duration),
                    end: clamp((end - parent.start) / duration),
                  });
              }
            if (commands.length)
              void p.onCommit(
                commands,
                keyMove ? "移动关键帧" : "移动或裁剪素材",
                captured.revision,
              );
          } catch (e) {
            p.onError((e as Error).message);
          }
        }, 0);
      },
    };
    const view = new VisTimeline(
      host.current!,
      items.current,
      groups.current,
      options,
    );
    const resumeClicks = () => {
      ignoreClickUntil.current = 0;
    };
    const container = host.current!;
    container.addEventListener("pointerdown", resumeClicks, true);
    timeline.current = view;
    view.addCustomTime(props.progress * extent, "playhead");
    view.setCustomTimeTitle("拖动播放头 · 连续滚动进度", "playhead");
    view.on("timechange", (e) =>
      latest.current.onSeek(clamp(+e.time / extent)),
    );
    view.on("select", (e) => {
      if (syncing.current || performance.now() < ignoreClickUntil.current)
        return;
      const ids = (e.items as (string | number)[]).map(String);
      const keys = ids.filter((i) => i.startsWith("key:")).map(parseKey);
      if (ids.length)
        latest.current.onSelect([
          ...new Set(
            keys.length
              ? keys.map((k) => k.elementId)
              : ids.map((i) => i.split(":")[1]),
          ),
        ]);
      latest.current.onKey(keys);
    });
    view.on("click", (e) => {
      if (performance.now() < ignoreClickUntil.current) return;
      if (!e.item && e.time && e.what !== "group-label") {
        latest.current.onSeek(clamp(+e.time / extent));
        latest.current.onKey([]);
      }
    });
    const updateWindow = () => {
      const range = view.getWindow();
      if (host.current) {
        host.current.dataset.windowStart = String(+range.start);
        host.current.dataset.windowEnd = String(+range.end);
      }
    };
    view.on("rangechanged", updateWindow);
    updateWindow();
    return () => {
      container.removeEventListener("pointerdown", resumeClicks, true);
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = undefined;
      pendingMoves.current.clear();
      gesture.current = null;
      view.destroy();
      timeline.current = null;
    };
  }, [props.compositionId]);
  useEffect(() => {
    const comp = props.project.compositions[props.compositionId];
    const nextGroups: any[] = [],
      nextItems: any[] = [];
    const isAncestorOfSelection = (e: Element): boolean =>
      props.selected.some((id) => {
        let node = comp.elements.find((n) => n.id === id);
        while (node?.parentId) {
          if (node.parentId === e.id) return true;
          node = comp.elements.find((n) => n.id === node!.parentId);
        }
        return false;
      });
    const isOpen = (e: Element) =>
      !props.compact ||
      (expanded[e.id] ??
        (props.selected.includes(e.id) || isAncestorOfSelection(e)));
    const isStatic = (e: Element) =>
      !e.parentId &&
      !["group", "composition"].includes(e.type) &&
      !Object.values(e.tracks).some((keys) => keys?.length) &&
      clipRange(props.project, comp.id, e).start <= 0 &&
      clipRange(props.project, comp.id, e).end >= 1;
    const persistent = comp.elements.filter(isStatic);
    if (props.compact && persistent.length) {
      const label = document.createElement("button");
      label.className = "track-toggle";
      label.textContent = `${staticExpanded ? "▾" : "▸"} 全程静态图层 · ${persistent.length}`;
      label.title = "水印、背景等全程素材集中收起；点击展开";
      label.onclick = (event) => {
        event.stopPropagation();
        setStaticExpanded((v) => !v);
      };
      nextGroups.push({
        id: "static-header",
        content: label,
        order: -1,
        className: "static-track-header",
      });
    }
    let order = 0;
    const append = (e: Element, depth = 0) => {
      if (
        props.compact &&
        isStatic(e) &&
        !staticExpanded &&
        !props.selected.includes(e.id)
      )
        return;
      const range = clipRange(props.project, comp.id, e),
        animation = elementRange(props.project, comp.id, e);
      const groupId = `range:${e.id}`;
      const hasDetails =
        Object.values(e.tracks).some((k) => k?.length) ||
        comp.elements.some((n) => n.parentId === e.id);
      const open = isOpen(e);
      const label = document.createElement("button");
      label.className = "track-toggle";
      label.style.paddingLeft = `${depth * 12}px`;
      label.textContent = `${hasDetails ? (open ? "▾" : "▸") : "·"} ${e.name}`;
      label.title = hasDetails ? "点击展开 / 收起关键帧和子图层" : e.name;
      label.onclick = (event) => {
        event.stopPropagation();
        latest.current.onSelect([e.id]);
        latest.current.onKey([]);
        if (hasDetails) setExpanded((v) => ({ ...v, [e.id]: !open }));
      };
      nextGroups.push({ id: groupId, content: label, order: order++ });
      if (range.end > range.start)
        nextItems.push({
          id: groupId,
          group: groupId,
          content: e.type === "composition" ? "◇ 子合成" : e.name,
          start: range.start * extent,
          end: range.end * extent,
          type: "range",
          title: `${e.name} · ${(range.start * 100).toFixed(1)}–${(range.end * 100).toFixed(1)}%\n拖动移动素材；边缘裁剪，不改变动画速度`,
          editable: {
            updateTime: !e.locked,
            updateGroup: false,
            remove: false,
          },
          className: `${e.type === "composition" ? "composition-clip" : "element-clip"} ${props.selected.includes(e.id) ? "selected-clip" : ""} ${e.hidden ? "muted-clip" : ""}`,
        });
      if (open)
        properties.forEach((property) => {
          const keys = e.tracks[property];
          if (!keys?.length) return;
          const row = `${e.id}:${property}`;
          nextGroups.push({
            id: row,
            content: `↳ ${propertyNames[property]}`,
            order: order++,
            className: "property-row",
          });
          keys.forEach((key) => {
            const at =
              animation.start + key.at * (animation.end - animation.start);
            nextItems.push({
              id: keyId({ elementId: e.id, property, keyframeId: key.id }),
              group: row,
              content: "◆",
              start: at * extent,
              type: "point",
              editable: {
                updateTime: !e.locked,
                updateGroup: false,
                remove: false,
              },
              title: `${propertyNames[property]}: ${key.value} · 合成 ${(at * 100).toFixed(1)}%\nShift / Ctrl 多选 · Delete 删除关键帧`,
              className: `keyframe-point ${at < range.start || at > range.end ? "trimmed-key" : ""}`,
            });
          });
        });
      if (open)
        comp.elements
          .filter((child) => child.parentId === e.id)
          .forEach((child) => append(child, depth + 1));
    };
    comp.elements.filter((e) => !e.parentId).forEach((e) => append(e));
    syncing.current = true;
    items.current.clear();
    groups.current.clear();
    groups.current.add(nextGroups);
    items.current.add(nextItems);
    const ids = props.keys.length
      ? props.keys.map(keyId)
      : props.selected.map((id) => `range:${id}`);
    timeline.current?.setSelection(
      ids.filter((id) => nextItems.some((i) => i.id === id)),
    );
    syncing.current = false;
  }, [
    props.project,
    props.compositionId,
    props.selected.join("|"),
    props.keys.map(keyId).join("|"),
    props.compact,
    expanded,
    staticExpanded,
  ]);
  useEffect(() => {
    timeline.current?.setCustomTime(props.progress * extent, "playhead");
  }, [props.progress]);
  useEffect(() => {
    const view = timeline.current;
    if (!view) return;
    if (props.view.action === "fit")
      view.setWindow(0, extent, { animation: false });
    else {
      const range = view.getWindow(),
        factor = props.view.action === "in" ? 0.7 : 1 / 0.7;
      const center = props.progress * extent;
      view.setWindow(
        center + (+range.start - center) * factor,
        center + (+range.end - center) * factor,
        { animation: false },
      );
    }
  }, [props.view]);
  return <div className="timeline-view" ref={host} data-testid="timeline" />;
}
