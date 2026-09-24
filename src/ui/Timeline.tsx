import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  LockKeyhole,
  Eye,
  EyeOff,
  Plus,
  Magnet,
  Scissors,
  Trash2,
  Layers,
  Copy,
  Minus,
} from "lucide-react";
import { globalTime, parentTime, sourceTime } from "../core/evaluate";
import {
  thumbnailURL,
  type Project,
  type Element,
  type AnimProperty,
  type Keyframe,
} from "../core/model";
import type { Command } from "../core/commands";
import { easingPoints } from "../core/easing";
import { pairedKeys } from "../core/animation-edit";
import { properties } from "../core/model";
const TRACK_GUTTER = 48;
const channelLabels: Record<AnimProperty, string> = {
  x: "X",
  y: "Y",
  scaleX: "缩放X",
  scaleY: "缩放Y",
  rotation: "旋转",
  opacity: "透明度",
};
type Props = {
  project: Project;
  cid: string;
  time: number;
  selected: string[];
  revision: number;
  snap: boolean;
  mode: "place" | "insert" | "overwrite";
  linked: boolean;
  onSnap: () => void;
  onMode: (mode: "place" | "insert" | "overwrite") => void;
  onLinked: () => void;
  onSelect: (ids: string[]) => void;
  onSeek: (time: number, final?: boolean) => void;
  onCommit: (
    commands: Command[],
    label: string,
    revision?: number,
  ) => Promise<void>;
  onInsert: (assetId: string, trackId: string, at: number) => void;
  onFiles: (files: File[], trackId: string, at: number) => void;
  onSplit: () => void;
  onDelete: (ripple: boolean) => void;
  onCopy: () => void;
  onCompound: () => void;
  onEnter: (id: string) => void;
  onAddTrack: () => void;
  activeProperty: AnimProperty;
  selectedKeyId?: string;
  onKey: (e: Element, property: AnimProperty, key: Keyframe) => void;
  onError: (message: string) => void;
};
type Gesture = {
  kind: "move" | "left" | "right";
  id: string;
  ids: string[];
  x: number;
  y: number;
  scroll: number;
  revision: number;
  delta: number;
  offset: number;
};
function KeyDiamond({
  p,
  e,
  property,
  k,
  scale,
}: {
  p: Props;
  e: Element;
  property: AnimProperty;
  k: Keyframe;
  scale: number;
}) {
  const at = globalTime(p.project, p.cid, e, k.at),
    [delta, setDelta] = useState(0),
    drag = useRef<{ x: number; delta: number; revision: number } | null>(null),
    moved = useRef(false);
  return (
    <button
      title={
        channelLabels[property] +
        " 关键帧 · " +
        at.toFixed(2) +
        "s · 拖动调整时间"
      }
      aria-label={channelLabels[property] + " 关键帧 " + at.toFixed(2) + "秒"}
      className={
        "key-diamond" +
        (p.selectedKeyId === k.id && p.activeProperty === property
          ? " active"
          : "")
      }
      style={{ left: (at + delta - e.start) * scale, touchAction: "none" }}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (
          event.button !== 0 ||
          e.locked ||
          p.project.compositions[p.cid].tracks.find((t) => t.id === e.trackId)
            ?.locked
        )
          return;
        drag.current = { x: event.clientX, delta: 0, revision: p.revision };
        moved.current = false;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current) {
          const value = Math.max(
            e.start - at,
            Math.min(
              e.end - at,
              Math.round(((event.clientX - drag.current.x) / scale) * 30) / 30,
            ),
          );
          drag.current.delta = value;
          setDelta(value);
        }
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        const data = drag.current;
        drag.current = null;
        setDelta(0);
        event.currentTarget.releasePointerCapture(event.pointerId);
        if (data && Math.abs(data.delta) > 0.001) {
          moved.current = true;
          const source = sourceTime(
            e,
            parentTime(p.project, p.cid, e, at + data.delta),
          );
          void p.onCommit(
            pairedKeys(e, property, k).map(({ property: channel, key }) => ({
              type: "keyframe.set",
              compositionId: p.cid,
              elementId: e.id,
              property: channel,
              keyframe: { ...key, at: source },
            })),
            "移动关键帧",
            data.revision,
          );
        }
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDelta(0);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (moved.current) return;
        p.onSeek(
          Math.max(0, Math.min(p.project.compositions[p.cid].duration, at)),
          true,
        );
        p.onKey(e, property, k);
      }}
    >
      ◆
    </button>
  );
}
function ClipKeys({ p, e, scale }: { p: Props; e: Element; scale: number }) {
  const selected = p.selected.includes(e.id),
    keys = e.tracks[p.activeProperty] ?? [];
  const clock = (k: Keyframe) =>
    (globalTime(p.project, p.cid, e, k.at) - e.start) * scale;
  const width = (e.end - e.start) * scale;
  const markers = new Map<number, { property: AnimProperty; key: Keyframe }>();
  for (const property of [
    ...properties.filter((prop) => prop !== p.activeProperty),
    p.activeProperty,
  ])
    for (const key of e.tracks[property] ?? []) {
      const x = clock(key);
      if (x >= -0.01 && x <= width + 0.01)
        markers.set(Math.round(key.at * 100000), { property, key });
    }
  if (!markers.size) return null;
  return (
    <div
      className="clip-key-overlay"
      role={selected ? "group" : undefined}
      aria-label={selected ? "素材条关键帧" : undefined}
    >
      {selected &&
        keys.slice(0, -1).map((key, i) => {
          const left = clock(key),
            right = clock(keys[i + 1]);
          if (right < 0 || left > width || right - left < 5) return null;
          const points = easingPoints(key.easing, 24),
            low = Math.min(0, ...points.map((p) => p[1])),
            high = Math.max(1, ...points.map((p) => p[1]));
          const path = points
            .map(
              ([x, y], i) =>
                `${i ? "L" : "M"}${x * 100},${19 - ((y - low) / (high - low)) * 16}`,
            )
            .join(" ");
          return (
            <button
              key={key.id}
              className="clip-curve"
              style={{ left, width: right - left }}
              aria-label={`编辑 ${channelLabels[p.activeProperty]} 曲线 ${(left / scale + e.start).toFixed(2)} 至 ${(right / scale + e.start).toFixed(2)} 秒`}
              onPointerDown={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                p.onKey(e, p.activeProperty, key);
              }}
            >
              <svg
                viewBox="0 0 100 22"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path d={path} />
              </svg>
            </button>
          );
        })}
      {selected ? (
        [...markers.values()].map(({ property, key }) => (
          <KeyDiamond
            key={`${property}-${key.id}`}
            p={p}
            e={e}
            property={property}
            k={key}
            scale={scale}
          />
        ))
      ) : (
        <svg
          className="clip-key-summary"
          width={width}
          height="14"
          aria-hidden="true"
        >
          <path
            d={[...markers.values()]
              .map(({ key }) => {
                const x = clock(key);
                return `M${x},2 l4,4 -4,4 -4,-4 Z`;
              })
              .join(" ")}
          />
        </svg>
      )}
    </div>
  );
}
export function Timeline(p: Props) {
  const c = p.project.compositions[p.cid],
    tracks = [...c.tracks].reverse(),
    [height, setHeight] = useState(360),
    [scale, setScale] = useState(72),
    [gesture, setGesture] = useState<Gesture | null>(null),
    scroll = useRef<HTMLDivElement>(null),
    gestureRef = useRef<Gesture | null>(null);
  const resize = useRef<{ y: number; height: number } | null>(null);
  const [viewport, setViewport] = useState({ left: 0, width: 1400 });
  useEffect(() => {
    const node = scroll.current!;
    const update = () => {
      const left = node.scrollLeft,
        width = node.clientWidth;
      setViewport((previous) =>
        previous.left === left && previous.width === width
          ? previous
          : { left, width },
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    node.addEventListener("scroll", update);
    update();
    return () => {
      observer.disconnect();
      node.removeEventListener("scroll", update);
    };
  }, []);
  useEffect(() => {
    // React wheel listeners are passive, so Ctrl+wheel could not cancel page zoom.
    const node = scroll.current!;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setScale((s) =>
        Math.max(12, Math.min(240, s * (e.deltaY > 0 ? 0.9 : 1.1))),
      );
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    const node = scroll.current;
    if (!node || gestureRef.current) return;
    const pixel = p.time * scale;
    if (
      pixel < node.scrollLeft ||
      pixel > node.scrollLeft + node.clientWidth - TRACK_GUTTER - 32
    )
      node.scrollLeft = Math.max(0, pixel - node.clientWidth / 2);
  }, [p.time, scale]);
  useEffect(() => {
    const node = scroll.current;
    if (!node || gestureRef.current || p.selected.length !== 1) return;
    const clip = node.querySelector<HTMLElement>(
      `[data-testid="clip-${p.selected[0]}"]`,
    );
    const row = clip?.closest<HTMLElement>(".track-row");
    if (!row) return;
    if (row.offsetTop < node.scrollTop + 31)
      node.scrollTop = row.offsetTop - 31;
    else if (
      row.offsetTop + row.offsetHeight >
      node.scrollTop + node.clientHeight
    )
      node.scrollTop = row.offsetTop + row.offsetHeight - node.clientHeight;
  }, [p.selected.join("|"), p.cid, height]);
  const roots = c.elements.filter((e) => !e.parentId),
    width = Math.max(800, (c.duration + 3) * scale);
  const step = scale >= 90 ? 0.5 : scale >= 45 ? 1 : scale >= 20 ? 2 : 5;
  const firstTick = Math.max(0, Math.floor(viewport.left / scale / step) - 1),
    lastTick = Math.min(
      Math.ceil((c.duration + 3) / step),
      Math.ceil((viewport.left + viewport.width) / scale / step) + 1,
    );
  const playheadPixel = p.time * scale;
  const visibleLeft = viewport.left;
  const visibleRight = Math.max(
    visibleLeft,
    viewport.left + viewport.width - TRACK_GUTTER - 1,
  );
  const headOutside =
    playheadPixel < visibleLeft
      ? "left"
      : playheadPixel > visibleRight
        ? "right"
        : null;
  const headPixel = headOutside
    ? Math.max(visibleLeft + 7, Math.min(visibleRight - 7, playheadPixel))
    : playheadPixel;
  const revealPlayhead = () => {
    const node = scroll.current;
    if (node)
      node.scrollLeft = Math.max(
        0,
        playheadPixel - (node.clientWidth - TRACK_GUTTER) / 2,
      );
  };
  const snap = (value: number, exclude: string[] = []) => {
    const rounded = Math.round(value * 30) / 30;
    if (!p.snap) return rounded;
    const positions = [
      0,
      p.time,
      ...roots
        .filter((e) => !exclude.includes(e.id))
        .flatMap((e) => [e.start, e.end]),
    ];
    const nearest = positions.sort(
      (a, b) => Math.abs(a - value) - Math.abs(b - value),
    )[0];
    return Math.abs(nearest - value) * scale < 9 ? nearest : rounded;
  };
  const timeAt = (event: { clientX: number }, rect: DOMRect) =>
    Math.max(0, (event.clientX - rect.left) / scale);
  const start = (
    event: React.PointerEvent,
    e: Element,
    kind: Gesture["kind"],
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    if (e.locked || c.tracks.find((t) => t.id === e.trackId)?.locked) return;
    const ids = event.shiftKey
      ? p.selected.includes(e.id)
        ? p.selected.filter((id) => id !== e.id)
        : [...p.selected, e.id]
      : p.selected.includes(e.id)
        ? p.selected
        : [e.id];
    p.onSelect(ids);
    if (!ids.includes(e.id) || event.shiftKey) return;
    if (kind !== "move" && ids.length !== 1) {
      p.onError("裁边需要只选中一个片段；多选可整体移动、删除和创建复合片段");
      return;
    }
    const g: Gesture = {
      kind,
      id: e.id,
      ids,
      x: event.clientX,
      y: event.clientY,
      scroll: scroll.current!.scrollLeft,
      revision: p.revision,
      delta: 0,
      offset: 0,
    };
    gestureRef.current = g;
    setGesture(g);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: React.PointerEvent) => {
    const g = gestureRef.current;
    if (!g) return;
    const e = roots.find((e) => e.id === g.id)!;
    const bounds = scroll.current!.getBoundingClientRect();
    if (event.clientX > bounds.right - 35) scroll.current!.scrollLeft += 10;
    if (event.clientX < bounds.left + TRACK_GUTTER + 22)
      scroll.current!.scrollLeft -= 10;
    const raw =
      (event.clientX - g.x + scroll.current!.scrollLeft - g.scroll) / scale;
    const edge = g.kind === "right" ? e.end : e.start;
    let delta = snap(edge + raw, g.ids) - edge;
    if (g.kind === "move") {
      const endDelta = snap(e.end + raw, g.ids) - e.end;
      if (Math.abs(endDelta - raw) < Math.abs(delta - raw)) delta = endDelta;
      delta = Math.max(
        -Math.min(
          ...roots.filter((e) => g.ids.includes(e.id)).map((e) => e.start),
        ),
        delta,
      );
    } else if (g.kind === "left")
      delta = Math.min(e.end - e.start - 0.04, Math.max(-e.start, delta));
    else delta = Math.max(e.start - e.end + 0.04, delta);
    const offset =
      g.kind === "move" ? -Math.round((event.clientY - g.y) / 64) : 0;
    const next = { ...g, delta, offset };
    gestureRef.current = next;
    setGesture(next);
  };
  const finish = async (event: React.PointerEvent) => {
    const g = gestureRef.current;
    gestureRef.current = null;
    setGesture(null);
    if (!g) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (Math.abs(g.delta) < 0.0001 && !g.offset) return;
    const e = roots.find((e) => e.id === g.id)!;
    await p.onCommit(
      g.kind === "move"
        ? [
            {
              type: "clips.move",
              compositionId: p.cid,
              elementIds: g.ids,
              delta: g.delta,
              trackOffset: g.offset,
            },
          ]
        : [
            {
              type: "element.trim",
              compositionId: p.cid,
              elementId: e.id,
              start: e.start + (g.kind === "left" ? g.delta : 0),
              end: e.end + (g.kind === "right" ? g.delta : 0),
            },
          ],
      g.kind === "move" ? "移动片段" : "裁剪片段",
      g.revision,
    );
  };
  return (
    <section
      className="timeline-panel"
      aria-label="多轨时间线"
      style={{ "--track-gutter": `${TRACK_GUTTER}px`, height } as CSSProperties}
    >
      <div
        className="timeline-resize"
        role="separator"
        aria-label="调整时间线高度"
        aria-orientation="horizontal"
        aria-valuenow={height}
        aria-valuemin={230}
        aria-valuemax={Math.round(window.innerHeight * 0.7)}
        aria-valuetext={`${height} 像素`}
        tabIndex={0}
        title="上下拖动调整时间线高度"
        onPointerDown={(event) => {
          resize.current = { y: event.clientY, height };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (resize.current)
            setHeight(
              Math.max(
                230,
                Math.min(
                  window.innerHeight * 0.7,
                  resize.current.height + resize.current.y - event.clientY,
                ),
              ),
            );
        }}
        onPointerUp={(event) => {
          resize.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          resize.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            setHeight((value) =>
              Math.max(
                230,
                Math.min(
                  window.innerHeight * 0.7,
                  value + (event.key === "ArrowUp" ? 40 : -40),
                ),
              ),
            );
          }
        }}
      >
        <span />
      </div>
      <div className="timeline-toolbar">
        <strong>时间线</strong>
        <button title="添加轨道" onClick={p.onAddTrack}>
          <Plus size={15} />
          轨道
        </button>
        <span className="divider" />
        <button
          title="分割 Ctrl+B"
          aria-label="分割"
          disabled={!p.selected.length}
          onClick={p.onSplit}
        >
          <Scissors size={16} />
        </button>
        <button
          title="复制 Ctrl+C"
          aria-label="复制"
          disabled={!p.selected.length}
          onClick={p.onCopy}
        >
          <Copy size={16} />
        </button>
        <button
          title="普通删除 · 保留空隙 Delete"
          aria-label="删除 · 保留空隙"
          disabled={!p.selected.length}
          onClick={() => p.onDelete(false)}
        >
          <Trash2 size={16} />
        </button>
        <button disabled={!p.selected.length} onClick={() => p.onDelete(true)}>
          波纹删除
        </button>
        <button
          title="创建复合片段 Alt+G"
          aria-label="创建复合片段"
          disabled={!p.selected.length}
          onClick={p.onCompound}
        >
          <Layers size={16} />
        </button>
        <span className="spacer" />
        <button
          className={p.snap ? "active" : ""}
          aria-pressed={p.snap}
          onClick={p.onSnap}
          title="吸附只对齐边界，不移动其他片段"
        >
          <Magnet size={15} />
          吸附
        </button>
        <button
          className={p.linked ? "active" : ""}
          aria-pressed={p.linked}
          onClick={p.onLinked}
          title="仅波纹删除时联动其他轨道"
        >
          跨轨联动
        </button>
        <select
          aria-label="放入方式"
          value={p.mode}
          onChange={(e) => p.onMode(e.target.value as Props["mode"])}
        >
          <option value="place">放入空位</option>
          <option value="insert">插入并后移</option>
          <option value="overwrite">覆盖片段</option>
        </select>
        <button
          title="缩小时间线"
          aria-label="缩小时间线"
          onClick={() => setScale((s) => Math.max(12, s / 1.3))}
        >
          <Minus size={14} />
        </button>
        <input
          aria-label="时间线缩放"
          className="timeline-zoom"
          type="range"
          min="12"
          max="240"
          value={scale}
          onChange={(e) => setScale(Number(e.target.value))}
        />
        <button
          title="放大时间线"
          aria-label="放大时间线"
          onClick={() => setScale((s) => Math.min(240, s * 1.3))}
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="timeline-scroll" ref={scroll}>
        <div className="timeline-grid" style={{ width: width + TRACK_GUTTER }}>
          <div className="time-ruler">
            <div className="track-label" title="时间刻度：秒 · 30 fps">
              <span>秒</span>
            </div>
            <div
              className="ruler-scale"
              style={{ width }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                p.onSeek(
                  Math.min(
                    c.duration,
                    timeAt(e, e.currentTarget.getBoundingClientRect()),
                  ),
                );
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  p.onSeek(
                    Math.min(
                      c.duration,
                      timeAt(e, e.currentTarget.getBoundingClientRect()),
                    ),
                  );
              }}
              onPointerUp={(e) => {
                if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                e.currentTarget.releasePointerCapture(e.pointerId);
                p.onSeek(
                  Math.min(
                    c.duration,
                    timeAt(e, e.currentTarget.getBoundingClientRect()),
                  ),
                  true,
                );
              }}
            >
              {Array.from(
                { length: Math.max(0, lastTick - firstTick + 1) },
                (_, i) => (
                  <span
                    key={i + firstTick}
                    className="tick"
                    style={{ left: (i + firstTick) * step * scale }}
                  >
                    {((i + firstTick) * step).toFixed(step < 1 ? 1 : 0)}s
                  </span>
                ),
              )}
              <button
                className={
                  "ruler-playhead" +
                  (headOutside ? ` outside-${headOutside}` : "")
                }
                aria-label={
                  headOutside
                    ? `回到播放头 ${p.time.toFixed(2)} 秒`
                    : `播放头 ${p.time.toFixed(2)} 秒`
                }
                title={
                  headOutside ? "播放头在可见范围外，点击定位" : "拖动播放头"
                }
                style={{ left: headPixel }}
                onPointerDown={(event) => {
                  if (headOutside) event.stopPropagation();
                }}
                onPointerUp={(event) => {
                  if (headOutside) event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  if (headOutside) revealPlayhead();
                }}
              >
                <i />
                {headOutside && (
                  <span>
                    {headOutside === "left" ? "‹ " : ""}
                    {p.time.toFixed(2)}s{headOutside === "right" ? " ›" : ""}
                  </span>
                )}
              </button>
            </div>
          </div>
          {tracks.map((track, index) => (
            <div
              key={track.id}
              className={
                "track-row " +
                (track.locked ? "locked " : "") +
                (track.hidden ? "hidden-track" : "")
              }
              data-testid={"track-" + track.id}
            >
              <div
                className="track-label track-controls"
                role="group"
                aria-label={`轨道 ${tracks.length - index}`}
              >
                <span
                  className="track-index"
                  title={`轨道 ${tracks.length - index} · 可连续放入多个素材`}
                >
                  {track.locked ? (
                    <LockKeyhole size={13} />
                  ) : track.hidden ? (
                    <EyeOff size={13} />
                  ) : (
                    tracks.length - index
                  )}
                </span>
                <div className="track-actions">
                  <button
                    title={track.locked ? "解锁轨道" : "锁定轨道"}
                    aria-label="锁定轨道"
                    aria-pressed={track.locked}
                    className={track.locked ? "active" : ""}
                    onClick={() =>
                      void p.onCommit(
                        [
                          {
                            type: "track.update",
                            compositionId: p.cid,
                            trackId: track.id,
                            patch: { locked: !track.locked },
                          },
                        ],
                        "轨道锁定",
                      )
                    }
                  >
                    <LockKeyhole size={12} />
                  </button>
                  <button
                    title={track.hidden ? "显示轨道" : "隐藏轨道"}
                    aria-label="隐藏轨道"
                    aria-pressed={track.hidden}
                    className={track.hidden ? "active" : ""}
                    onClick={() =>
                      void p.onCommit(
                        [
                          {
                            type: "track.update",
                            compositionId: p.cid,
                            trackId: track.id,
                            patch: { hidden: !track.hidden },
                          },
                        ],
                        "轨道显示",
                      )
                    }
                  >
                    <Eye size={12} />
                  </button>
                  <button
                    title="删除空轨道"
                    aria-label="删除空轨道"
                    disabled={
                      c.tracks.length === 1 ||
                      c.elements.some((e) => e.trackId === track.id)
                    }
                    onClick={() =>
                      void p.onCommit(
                        [
                          {
                            type: "track.delete",
                            compositionId: p.cid,
                            trackId: track.id,
                          },
                        ],
                        "删除轨道",
                      )
                    }
                  >
                    <Minus size={12} />
                  </button>
                </div>
              </div>
              <div
                className="track-content"
                style={{ width, backgroundSize: step * scale + "px 100%" }}
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) {
                    p.onSelect([]);
                    p.onSeek(
                      Math.min(
                        c.duration,
                        timeAt(e, e.currentTarget.getBoundingClientRect()),
                      ),
                      true,
                    );
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const at = snap(
                    timeAt(e, e.currentTarget.getBoundingClientRect()),
                  );
                  const id = e.dataTransfer.getData(
                    "application/x-scrollweave-asset",
                  );
                  if (id) p.onInsert(id, track.id, at);
                  else if (e.dataTransfer.files.length)
                    p.onFiles(Array.from(e.dataTransfer.files), track.id, at);
                }}
              >
                {roots
                  .filter((e) => e.trackId === track.id)
                  .map((e) => {
                    const asset = e.assetId
                        ? p.project.assets[e.assetId]
                        : undefined,
                      active = gesture?.ids.includes(e.id),
                      delta = active ? gesture!.delta : 0,
                      left =
                        e.start +
                        (active && gesture!.kind !== "right" ? delta : 0),
                      end =
                        e.end +
                        (active && gesture!.kind !== "left" ? delta : 0);
                    return (
                      <div
                        key={e.id}
                        tabIndex={0}
                        role="button"
                        aria-label={"片段 " + e.name}
                        data-testid={"clip-" + e.id}
                        className={
                          "timeline-clip " +
                          e.type +
                          (p.selected.includes(e.id) ? " selected" : "") +
                          (Object.values(e.tracks).some((keys) => keys.length)
                            ? " animated"
                            : "") +
                          (active ? " dragging" : "")
                        }
                        style={{
                          left: left * scale,
                          width: Math.max(3, (end - left) * scale),
                          transform:
                            active && gesture!.kind === "move"
                              ? "translateY(" + -gesture!.offset * 64 + "px)"
                              : undefined,
                        }}
                        onPointerDown={(event) => start(event, e, "move")}
                        onPointerMove={move}
                        onPointerUp={finish}
                        onPointerCancel={() => {
                          gestureRef.current = null;
                          setGesture(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ")
                            return;
                          // Keep Space away from the global play shortcut.
                          event.preventDefault();
                          event.stopPropagation();
                          if (
                            event.key === "Enter" &&
                            p.selected.includes(e.id)
                          ) {
                            if (e.type === "composition")
                              p.onEnter(e.compositionId!);
                            else p.onSeek(e.start, true);
                            return;
                          }
                          p.onSelect(
                            event.shiftKey
                              ? p.selected.includes(e.id)
                                ? p.selected.filter((id) => id !== e.id)
                                : [...p.selected, e.id]
                              : [e.id],
                          );
                        }}
                        onDoubleClick={() => {
                          if (e.type === "composition")
                            p.onEnter(e.compositionId!);
                          else p.onSeek(e.start, true);
                        }}
                      >
                        {asset &&
                          asset.kind !== "composition" &&
                          thumbnailURL(asset) && (
                            <img
                              src={thumbnailURL(asset)}
                              alt=""
                              width={asset.width || undefined}
                              height={asset.height || undefined}
                              draggable={false}
                            />
                          )}
                        <span className="clip-title">
                          {e.type === "composition" ? "◈ " : ""}
                          {e.name}
                        </span>
                        <small>
                          {(end - left).toFixed(2)}s
                          {asset?.status !== "ready" && asset
                            ? " · " + asset.status
                            : ""}
                        </small>
                        {!active && <ClipKeys p={p} e={e} scale={scale} />}
                        {/* Pointer-only trim; the inspector start/end fields are the keyboard path. */}
                        <div
                          className="clip-handle left"
                          aria-hidden="true"
                          onPointerDown={(event) => start(event, e, "left")}
                        />
                        <div
                          className="clip-handle right"
                          aria-hidden="true"
                          onPointerDown={(event) => start(event, e, "right")}
                        />
                      </div>
                    );
                  })}
                {!roots.length && track.id === c.tracks[0].id && (
                  <span className="drop-hint">
                    将素材拖到这里 · 文件可直接拖入并创建片段
                  </span>
                )}
              </div>
            </div>
          ))}
          <div
            className="playhead"
            style={{ left: TRACK_GUTTER + p.time * scale }}
          />
        </div>
      </div>
      <div className="timeline-status">
        <span>
          {gesture
            ? (gesture.kind === "move" ? "移动" : "裁边") +
              " " +
              gesture.delta.toFixed(2) +
              "s"
            : "K 添加位置关键帧 · [ / ] 前后帧 · 拖动菱形调整时间 · Ctrl+B 分割"}
        </span>
        <span>
          {p.selected.length
            ? p.selected.length + " 个片段已选中"
            : "未选择片段"}{" "}
          · {c.duration.toFixed(2)}s
        </span>
      </div>
    </section>
  );
}
