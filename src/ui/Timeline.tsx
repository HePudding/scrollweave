import { useEffect, useRef, useState } from "react";
import {
  LockKeyhole,
  Eye,
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
      title={property + " · " + at.toFixed(2) + "s"}
      className="key-diamond"
      style={{ left: (at + delta) * scale, touchAction: "none" }}
      onPointerDown={(event) => {
        event.stopPropagation();
        drag.current = { x: event.clientX, delta: 0, revision: p.revision };
        moved.current = false;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current) {
          const value = Math.max(
            -at,
            Math.round(((event.clientX - drag.current.x) / scale) * 30) / 30,
          );
          drag.current.delta = value;
          setDelta(value);
        }
      }}
      onPointerUp={(event) => {
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
            [
              {
                type: "keyframe.set",
                compositionId: p.cid,
                elementId: e.id,
                property,
                keyframe: { ...k, at: source },
              },
            ],
            "移动关键帧",
            data.revision,
          );
        }
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDelta(0);
      }}
      onClick={() => {
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
export function Timeline(p: Props) {
  const c = p.project.compositions[p.cid],
    tracks = [...c.tracks].reverse(),
    [scale, setScale] = useState(72),
    [gesture, setGesture] = useState<Gesture | null>(null),
    scroll = useRef<HTMLDivElement>(null),
    gestureRef = useRef<Gesture | null>(null);
  const [viewport, setViewport] = useState({ left: 0, width: 1400 });
  useEffect(() => {
    const node = scroll.current!;
    const update = () =>
      setViewport({ left: node.scrollLeft, width: node.clientWidth });
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
    const node = scroll.current;
    if (!node || gestureRef.current) return;
    const pixel = p.time * scale;
    if (
      pixel < node.scrollLeft ||
      pixel > node.scrollLeft + node.clientWidth - 160
    )
      node.scrollLeft = Math.max(0, pixel - node.clientWidth / 2);
  }, [p.time, scale]);
  const roots = c.elements.filter((e) => !e.parentId),
    width = Math.max(800, (c.duration + 3) * scale),
    selectedElement =
      p.selected.length === 1
        ? c.elements.find((e) => e.id === p.selected[0])
        : undefined;
  const step = scale >= 90 ? 0.5 : scale >= 45 ? 1 : scale >= 20 ? 2 : 5;
  const firstTick = Math.max(0, Math.floor(viewport.left / scale / step) - 1),
    lastTick = Math.min(
      Math.ceil((c.duration + 3) / step),
      Math.ceil((viewport.left + viewport.width) / scale / step) + 1,
    );
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
    if (event.clientX < bounds.left + 150) scroll.current!.scrollLeft -= 10;
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
  const channels = selectedElement
    ? Object.entries(selectedElement.tracks).filter(([, keys]) => keys.length)
    : [];
  return (
    <section className="timeline-panel" aria-label="多轨时间线">
      <div className="timeline-toolbar">
        <strong>时间线</strong>
        <button title="添加轨道" onClick={p.onAddTrack}>
          <Plus size={15} />
          轨道
        </button>
        <span className="divider" />
        <button
          title="分割 Ctrl+B"
          disabled={!p.selected.length}
          onClick={p.onSplit}
        >
          <Scissors size={16} />
        </button>
        <button
          title="复制 Ctrl+C"
          disabled={!p.selected.length}
          onClick={p.onCopy}
        >
          <Copy size={16} />
        </button>
        <button
          title="普通删除 · 保留空隙 Delete"
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
          disabled={!p.selected.length}
          onClick={p.onCompound}
        >
          <Layers size={16} />
        </button>
        <span className="spacer" />
        <button
          className={p.snap ? "active" : ""}
          onClick={p.onSnap}
          title="吸附只对齐边界，不移动其他片段"
        >
          <Magnet size={15} />
          吸附
        </button>
        <button
          className={p.linked ? "active" : ""}
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
          onClick={() => setScale((s) => Math.min(240, s * 1.3))}
        >
          <Plus size={14} />
        </button>
      </div>
      <div
        className="timeline-scroll"
        ref={scroll}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            setScale((s) =>
              Math.max(12, Math.min(240, s * (e.deltaY > 0 ? 0.9 : 1.1))),
            );
          }
        }}
      >
        <div className="timeline-grid" style={{ width: width + 128 }}>
          <div className="time-ruler">
            <div className="track-label">
              <span>秒 · 30 fps</span>
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
            </div>
          </div>
          {tracks.map((track) => (
            <div
              key={track.id}
              className={"track-row " + (track.locked ? "locked" : "")}
              data-testid={"track-" + track.id}
            >
              <div className="track-label">
                <span title={track.name}>{track.name}</span>
                <div>
                  <button
                    title={track.locked ? "解锁轨道" : "锁定轨道"}
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
                        onDoubleClick={() => {
                          if (e.type === "composition")
                            p.onEnter(e.compositionId!);
                          else p.onSeek(e.start, true);
                        }}
                      >
                        {asset &&
                          asset.kind !== "composition" &&
                          thumbnailURL(asset) && (
                            <img src={thumbnailURL(asset)} draggable={false} />
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
                        <div
                          className="clip-handle left"
                          aria-label="裁剪左边界"
                          onPointerDown={(event) => start(event, e, "left")}
                        />
                        <div
                          className="clip-handle right"
                          aria-label="裁剪右边界"
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
          {channels.map(([property, keys]) => (
            <div className="key-row" key={property}>
              <div className="track-label">{property}</div>
              <div className="key-content" style={{ width }}>
                {keys.map((k) => {
                  return (
                    <KeyDiamond
                      key={k.id}
                      p={p}
                      e={selectedElement!}
                      property={property as AnimProperty}
                      k={k}
                      scale={scale}
                    />
                  );
                })}
              </div>
            </div>
          ))}
          <div className="playhead" style={{ left: 128 + p.time * scale }}>
            <i />
            <span />
          </div>
        </div>
      </div>
      <div className="timeline-status">
        <span>
          {gesture
            ? (gesture.kind === "move" ? "移动" : "裁边") +
              " " +
              gesture.delta.toFixed(2) +
              "s"
            : "拖动移动 · 拖边裁剪 · Shift 多选 · Ctrl+B 分割 · Delete 留空 · Shift+Delete 波纹"}
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
