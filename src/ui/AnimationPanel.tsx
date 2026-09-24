import { useEffect, useRef, useState } from "react";
import { Diamond, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import {
  properties,
  type AnimProperty,
  type Element,
  type Project,
  type Keyframe,
} from "../core/model";
import { globalTime, parentTime, sourceTime } from "../core/evaluate";
import { pairedKeys } from "../core/animation-edit";
import type { Command } from "../core/commands";
import { EasingEditor } from "./EasingEditor";
export const propertyNames: Record<AnimProperty, string> = {
  x: "位置 X",
  y: "位置 Y",
  scaleX: "水平缩放",
  scaleY: "垂直缩放",
  rotation: "旋转",
  opacity: "透明度",
};
export type KeyEdit = {
  elementId: string;
  property: AnimProperty;
  keyId: string;
};
function KeyNumber({
  label,
  value,
  revision,
  onCommit,
}: {
  label: string;
  value: number;
  revision: number;
  onCommit: (v: number, r: number) => void;
}) {
  const captured = useRef(revision);
  const initial = useRef("");
  return (
    <input
      type="number"
      step="0.01"
      aria-label={label}
      defaultValue={Math.round(value * 10000) / 10000}
      key={value}
      onFocus={(event) => {
        captured.current = revision;
        initial.current = event.currentTarget.value;
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      onBlur={(event) => {
        const n = Number(event.target.value);
        if (
          event.target.value !== initial.current &&
          event.target.value &&
          Number.isFinite(n) &&
          n !== value
        )
          onCommit(n, captured.current);
        else event.target.value = String(value);
      }}
    />
  );
}
export function AnimationPanel(p: {
  project: Project;
  cid: string;
  element: Element;
  time: number;
  revision: number;
  autoKey: boolean;
  onAutoKey: () => void;
  activeProperty: AnimProperty;
  onProperty: (v: AnimProperty) => void;
  keyEdit: KeyEdit | null;
  onKey: (v: KeyEdit | null) => void;
  onAddPosition: () => void;
  onNavigate: (direction: -1 | 1) => void;
  onSeek: (time: number, final?: boolean) => void;
  onCommit: (
    commands: Command[],
    label: string,
    revision?: number,
  ) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (p.keyEdit?.elementId === p.element.id) setExpanded(true);
  }, [p.keyEdit]);
  useEffect(() => {
    if (expanded && p.keyEdit?.elementId === p.element.id)
      details.current?.scrollIntoView({ block: "nearest" });
  }, [expanded, p.keyEdit]);
  const e = p.element,
    at = sourceTime(e, parentTime(p.project, p.cid, e, p.time));
  const keys = e.tracks[p.activeProperty] ?? [];
  const explicit =
    p.keyEdit?.elementId === e.id && p.keyEdit.property === p.activeProperty
      ? keys.find((k) => k.id === p.keyEdit!.keyId)
      : undefined;
  const key =
    explicit ?? keys.filter((k) => k.at <= at + 1e-5).at(-1) ?? keys[0];
  const index = key ? keys.indexOf(key) : -1;
  const start = keys[index === keys.length - 1 ? index - 1 : index],
    end = keys[index === keys.length - 1 ? index : index + 1];
  const startTime = start ? globalTime(p.project, p.cid, e, start.at) : 0,
    endTime = end ? globalTime(p.project, p.cid, e, end.at) : 0;
  const inRange =
    at >= e.sourceIn - 1e-5 &&
    at <= e.sourceIn + (e.end - e.start) * e.speed + 1e-5;
  const locked =
    e.locked ||
    p.project.compositions[p.cid].tracks.find((t) => t.id === e.trackId)
      ?.locked;
  const update = (patch: Partial<Keyframe>, rev: number) => {
    if (!key) return;
    const targets =
      patch.at !== undefined
        ? pairedKeys(e, p.activeProperty, key)
        : [{ property: p.activeProperty, key }];
    void p.onCommit(
      targets.map(({ property, key: k }) => ({
        type: "keyframe.set",
        compositionId: p.cid,
        elementId: e.id,
        property,
        keyframe: { ...k, ...patch },
      })),
      "编辑关键帧",
      rev,
    );
  };
  return (
    <section
      className="property-section animation-panel"
      aria-label="关键帧与动画曲线"
    >
      <h4>
        关键帧{" "}
        <button
          className={p.autoKey ? "active" : ""}
          aria-pressed={p.autoKey}
          title="自动关键帧 Shift+K"
          onClick={p.onAutoKey}
        >
          自动记录 {p.autoKey ? "开" : "关"}
        </button>
      </h4>
      <div className="animation-actions">
        <button
          title="上一个关键帧 ["
          aria-label="上一个关键帧"
          onClick={() => p.onNavigate(-1)}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          className="add-position-key"
          disabled={!inRange || locked}
          onClick={p.onAddPosition}
          title="添加位置关键帧 K"
        >
          <Diamond size={13} /> 添加位置关键帧 <kbd>K</kbd>
        </button>
        <button
          title="下一个关键帧 ]"
          aria-label="下一个关键帧"
          onClick={() => p.onNavigate(1)}
        >
          <ChevronRight size={14} />
        </button>
      </div>
      <p className="hint">先添加一帧，移动播放头，再拖动画面记录下一帧。</p>
      <label className="animation-channel">
        显示属性
        <select
          aria-label="关键帧显示属性"
          value={p.activeProperty}
          onChange={(event) => {
            p.onProperty(event.target.value as AnimProperty);
            p.onKey(null);
          }}
        >
          {properties.map((prop) => (
            <option key={prop} value={prop}>
              {propertyNames[prop]}
              {e.tracks[prop]?.length ? ` · ${e.tracks[prop]!.length} 帧` : ""}
            </option>
          ))}
        </select>
      </label>
      {key && (
        <details
          ref={details}
          className="key-details"
          open={expanded}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
        >
          <summary>
            动画曲线与关键帧 <span>{keys.length} 帧</span>
          </summary>
          <h4>
            ◆ 第 {index + 1} 帧 <span>{keys.length} 帧</span>
            <button
              title="删除此关键帧"
              aria-label="删除此关键帧"
              disabled={locked}
              onClick={() => {
                void p.onCommit(
                  pairedKeys(e, p.activeProperty, key).map(
                    ({ property, key: k }) => ({
                      type: "keyframe.delete",
                      compositionId: p.cid,
                      elementId: e.id,
                      property,
                      keyframeId: k.id,
                    }),
                  ),
                  "删除关键帧",
                );
                p.onKey(null);
              }}
            >
              <Trash2 size={12} />
            </button>
          </h4>
          <div className="field-grid">
            <label>
              时间 / 秒
              <KeyNumber
                label="关键帧时间"
                value={globalTime(p.project, p.cid, e, key.at)}
                revision={p.revision}
                onCommit={(time, rev) =>
                  update(
                    {
                      at: sourceTime(e, parentTime(p.project, p.cid, e, time)),
                    },
                    rev,
                  )
                }
              />
            </label>
            <label>
              {propertyNames[p.activeProperty]}
              <KeyNumber
                label="关键帧值"
                value={key.value}
                revision={p.revision}
                onCommit={(value, rev) => update({ value }, rev)}
              />
            </label>
          </div>
          {start && end ? (
            <>
              <h4 className="curve-heading">
                动画曲线{" "}
                <span>
                  {startTime.toFixed(2)} → {endTime.toFixed(2)} s
                </span>
              </h4>
              <EasingEditor
                key={`${e.id}-${p.activeProperty}-${start.id}-${end.id}`}
                value={start.easing}
                revision={p.revision}
                progress={(p.time - startTime) / (endTime - startTime)}
                onCommit={(easing, rev) => {
                  // Position has a shared clock: synchronize easing only for matching XY intervals.
                  const targets = pairedKeys(e, p.activeProperty, start).filter(
                    ({ property }) =>
                      property === p.activeProperty ||
                      e.tracks[property]?.some(
                        (k) => Math.abs(k.at - end.at) < 1e-5,
                      ),
                  );
                  void p.onCommit(
                    targets.map(({ property, key: k }) => ({
                      type: "keyframe.set",
                      compositionId: p.cid,
                      elementId: e.id,
                      property,
                      keyframe: { ...k, easing },
                    })),
                    "调整动画曲线",
                    rev,
                  );
                }}
              />
            </>
          ) : (
            <p className="hint">添加第二帧后，即可调整两帧间的动画曲线。</p>
          )}
        </details>
      )}
    </section>
  );
}
