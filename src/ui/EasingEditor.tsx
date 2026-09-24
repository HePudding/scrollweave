import { useEffect, useRef, useState } from "react";
import {
  easingFunction,
  easingPoints,
  easingPresets,
  toBezier,
  type Easing,
  type Bezier,
} from "../core/easing";
import { expressionError } from "../core/expression";
const bound = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

export function EasingEditor({
  value,
  progress,
  revision,
  onCommit,
}: {
  value: Easing;
  progress: number;
  revision: number;
  onCommit: (value: Easing, revision: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [formula, setFormula] = useState(
    typeof value === "object" && !Array.isArray(value)
      ? value.formula
      : "t*t*(3-2*t)",
  );
  const [mode, setMode] = useState(
    typeof value === "object" && !Array.isArray(value) ? "expression" : "curve",
  );
  const [dragging, setDragging] = useState(false);
  const current = useRef(value),
    graph = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    index: number;
    revision: number;
    lo: number;
    hi: number;
    initial: Easing;
  } | null>(null);
  const formulaRevision = useRef(revision);
  const numberRevision = useRef(revision);
  useEffect(() => {
    current.current = value;
    setDraft(value);
    if (typeof value === "object" && !Array.isArray(value)) {
      setFormula(value.formula);
      setMode("expression");
    } else setMode("curve");
  }, [JSON.stringify(value)]);
  const error = expressionError(formula);
  const shown: Easing =
    mode === "expression" && !error ? { type: "expression", formula } : draft;
  const points = easingPoints(shown, 64),
    handles = toBezier(draft);
  const lo =
    drag.current?.lo ??
    Math.min(
      -0.15,
      ...points.map((p) => p[1]),
      mode === "curve" ? Math.min(handles[1], handles[3]) - 0.1 : 0,
    );
  const hi =
    drag.current?.hi ??
    Math.max(
      1.15,
      ...points.map((p) => p[1]),
      mode === "curve" ? Math.max(handles[1], handles[3]) + 0.1 : 1,
    );
  const px = (x: number) => 20 + x * 200,
    py = (y: number) => 142 - ((y - lo) / (hi - lo)) * 124;
  const path = points
    .map(([x, y], i) => `${i ? "L" : "M"}${px(x)},${py(y)}`)
    .join(" ");
  const t = bound(progress, 0, 1),
    y = easingFunction(shown)(t);
  const save = (next: Easing, rev = revision) => {
    current.current = next;
    setDraft(next);
    onCommit(next, rev);
  };
  return (
    <div className="easing-editor">
      <div className="easing-presets" role="group" aria-label="动画曲线预设">
        {easingPresets.map((preset) => {
          const active = JSON.stringify(value) === JSON.stringify(preset.value);
          return (
            <button
              key={preset.name}
              className={active ? "active" : ""}
              aria-pressed={active}
              title={preset.name}
              onClick={() => {
                setMode("curve");
                save(preset.value);
              }}
            >
              <svg viewBox="0 0 30 22" aria-hidden="true">
                <path
                  d={easingPoints(preset.value, 16)
                    .map(
                      ([x, y], i) =>
                        `${i ? "L" : "M"}${2 + x * 26},${19 - y * 14}`,
                    )
                    .join(" ")}
                />
              </svg>
              {preset.name}
            </button>
          );
        })}
      </div>
      <div className="curve-mode" role="group" aria-label="曲线编辑方式">
        <button
          className={mode === "curve" ? "active" : ""}
          aria-pressed={mode === "curve"}
          onClick={() => {
            setMode("curve");
            if (typeof draft === "object" && !Array.isArray(draft))
              save(toBezier(draft));
          }}
        >
          贝塞尔曲线
        </button>
        <button
          className={mode === "expression" ? "active" : ""}
          aria-pressed={mode === "expression"}
          onClick={() => {
            formulaRevision.current = revision;
            setMode("expression");
          }}
        >
          公式表达式
        </button>
      </div>
      <svg
        ref={graph}
        className="curve-graph"
        viewBox="0 0 240 165"
        aria-label="动画曲线指示器"
        onPointerMove={(event) => {
          const data = drag.current;
          if (!data || !graph.current) return;
          const rect = graph.current.getBoundingClientRect(),
            next = toBezier(current.current);
          next[data.index * 2] =
            Math.round(
              bound(
                (((event.clientX - rect.left) / rect.width) * 240 - 20) / 200,
                0,
                1,
              ) * 1000,
            ) / 1000;
          next[data.index * 2 + 1] =
            Math.round(
              bound(
                data.lo +
                  ((142 - ((event.clientY - rect.top) / rect.height) * 165) /
                    124) *
                    (data.hi - data.lo),
                -3,
                3,
              ) * 1000,
            ) / 1000;
          current.current = next;
          setDraft(next);
        }}
        onPointerUp={(event) => {
          const data = drag.current;
          if (!data) return;
          drag.current = null;
          setDragging(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
          onCommit(current.current, data.revision);
        }}
        onPointerCancel={() => {
          if (drag.current) {
            current.current = drag.current.initial;
            setDraft(drag.current.initial);
          }
          drag.current = null;
          setDragging(false);
        }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v} className="curve-grid">
            <line x1={px(v)} y1="18" x2={px(v)} y2="142" />
            <line x1="20" y1={py(v)} x2="220" y2={py(v)} />
          </g>
        ))}
        <line
          className="curve-diagonal"
          x1={px(0)}
          y1={py(0)}
          x2={px(1)}
          y2={py(1)}
        />
        <path className="curve-line" d={path} />
        <line
          className="curve-progress"
          x1={px(t)}
          x2={px(t)}
          y1="18"
          y2="142"
        />
        <circle className="curve-dot" cx={px(t)} cy={py(y)} r="4" />
        {mode === "curve" &&
          [0, 1].map((index) => (
            <g key={index}>
              <line
                className="curve-handle-line"
                x1={px(index)}
                y1={py(index)}
                x2={px(handles[index * 2])}
                y2={py(handles[index * 2 + 1])}
              />
              <circle
                className="curve-handle"
                role="slider"
                tabIndex={0}
                aria-label={`曲线控制点 ${index + 1}`}
                aria-valuetext={`X ${handles[index * 2]}，Y ${handles[index * 2 + 1]}`}
                cx={px(handles[index * 2])}
                cy={py(handles[index * 2 + 1])}
                r="6"
                onPointerDown={(event) => {
                  event.preventDefault();
                  drag.current = { index, revision, lo, hi, initial: draft };
                  setDragging(true);
                  graph.current!.setPointerCapture(event.pointerId);
                }}
                onKeyDown={(event) => {
                  if (
                    ![
                      "ArrowLeft",
                      "ArrowRight",
                      "ArrowUp",
                      "ArrowDown",
                    ].includes(event.key)
                  )
                    return;
                  event.preventDefault();
                  event.stopPropagation();
                  const next: Bezier = [...handles];
                  const axis =
                    event.key === "ArrowLeft" || event.key === "ArrowRight"
                      ? 0
                      : 1;
                  const delta =
                    event.key === "ArrowLeft" || event.key === "ArrowDown"
                      ? -0.02
                      : 0.02;
                  next[index * 2 + axis] =
                    Math.round(
                      bound(
                        next[index * 2 + axis] + delta,
                        axis ? -3 : 0,
                        axis ? 3 : 1,
                      ) * 1000,
                    ) / 1000;
                  save(next);
                }}
              />
            </g>
          ))}
        <text x="20" y="158">
          0
        </text>
        <text x="220" y="158" textAnchor="end">
          1 · 时间
        </text>
      </svg>
      <div className="curve-readout">
        时间 {Math.round(t * 100)}% <span>动画进度 {Math.round(y * 100)}%</span>
      </div>
      {mode === "curve" ? (
        <>
          <p className="hint">拖动两个控制点调整节奏；上下方向可产生回弹。</p>
          <div className="bezier-fields">
            {handles.map((n, index) => (
              <label key={index}>
                {["X₁", "Y₁", "X₂", "Y₂"][index]}
                <input
                  type="number"
                  step="0.01"
                  min={index % 2 ? -3 : 0}
                  max={index % 2 ? 3 : 1}
                  aria-label={
                    ["曲线 X1", "曲线 Y1", "曲线 X2", "曲线 Y2"][index]
                  }
                  key={`${JSON.stringify(draft)}-${dragging}`}
                  defaultValue={n}
                  onFocus={() => {
                    numberRevision.current = revision;
                  }}
                  onBlur={(event) => {
                    const n = Number(event.target.value);
                    if (!event.target.value || !Number.isFinite(n)) {
                      event.target.value = String(handles[index]);
                      return;
                    }
                    const next: Bezier = [...handles];
                    next[index] = bound(
                      n,
                      index % 2 ? -3 : 0,
                      index % 2 ? 3 : 1,
                    );
                    if (next[index] !== handles[index])
                      save(next, numberRevision.current);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </label>
            ))}
          </div>
        </>
      ) : (
        <div className="expression-editor">
          <label>
            f(t)
            <input
              aria-label="缓动公式"
              value={formula}
              maxLength={256}
              spellCheck={false}
              onFocus={() => {
                formulaRevision.current = revision;
              }}
              onChange={(event) => setFormula(event.target.value)}
            />
          </label>
          <p className="hint">
            t 为两帧间的时间进度（0–1）。f(0)=0，f(1)=1。支持 + − * /
            ^、sin、cos、pow、sqrt、min、max、clamp、pi。
          </p>
          {error && (
            <p className="formula-error" role="status">
              {error}
            </p>
          )}
          <button
            disabled={
              !!error ||
              (typeof value === "object" &&
                !Array.isArray(value) &&
                value.formula === formula)
            }
            onClick={() =>
              save({ type: "expression", formula }, formulaRevision.current)
            }
          >
            应用公式
          </button>
        </div>
      )}
    </div>
  );
}
