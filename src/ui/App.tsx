import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Box,
  Braces,
  Check,
  ChevronRight,
  Circle,
  Copy,
  Diamond,
  Download,
  Eye,
  EyeOff,
  FilePlus2,
  FolderOpen,
  Group,
  ImagePlus,
  Layers,
  Lock,
  MousePointer2,
  Package,
  Play,
  Pause,
  Scissors,
  ChevronsLeft,
  ChevronsRight,
  SkipBack,
  SkipForward,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Magnet,
  Plus,
  Redo2,
  Save,
  Settings2,
  Square,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Upload,
  X,
} from "lucide-react";
import { BezierCurveEditor, type ValueType } from "react-bezier-curve-editor";
import "react-bezier-curve-editor/index.css";
import type { Command, Snapshot } from "../core/commands";
import {
  blankProject,
  createElement,
  properties,
  uid,
  validateProject,
  type Element,
  type Project,
  type AnimProperty,
  type Keyframe,
} from "../core/model";
import { clamp, sampleElement, elementRange } from "../core/evaluate";
import { clipWindow, insertionTiming } from "../core/timing";
import {
  readKeys,
  moveKeys,
  pasteKeys,
  type CopiedKey,
} from "../core/keyframes";
import { Canvas, propertyCommands, parentProgress } from "./Canvas";
import { Timeline, propertyNames, type KeySelection } from "./Timeline";
import { action, download, downloadJSON } from "./api";
import { TextField } from "./TextField";
import { presets } from "../extensions/registry";
import "../extensions/builtins";

function Button({
  children,
  title,
  onClick,
  disabled,
  className = "",
}: {
  children: ReactNode;
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className}
      aria-label={title}
      title={title}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function NumberField({
  label,
  value,
  onCommit,
  step = 1,
  suffix = "",
  revision,
}: {
  label: string;
  value: number;
  onCommit(v: number, revision: number): void;
  step?: number;
  suffix?: string;
  revision: number;
}) {
  const [draft, setDraft] = useState(String(Math.round(value * 1000) / 1000));
  const focused = useRef(false);
  const captured = useRef(revision);
  useEffect(() => {
    if (!focused.current) setDraft(String(Math.round(value * 1000) / 1000));
  }, [value]);
  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        aria-label={label}
        type="number"
        value={draft}
        step={step}
        onFocus={() => {
          focused.current = true;
          captured.current = revision;
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          focused.current = false;
          const n = Number(draft);
          if (draft && Number.isFinite(n) && Math.abs(n - value) > 0.00001)
            onCommit(n, captured.current);
          else setDraft(String(Math.round(value * 1000) / 1000));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      <small>{suffix}</small>
    </label>
  );
}
const easeValues: Record<string, ValueType> = {
  linear: [0, 0, 1, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
};
function CurvePanel({
  value,
  revision,
  onApply,
}: {
  value: Keyframe["easing"];
  revision: number;
  onApply(v: Keyframe["easing"], revision: number): void;
}) {
  const [curve, setCurve] = useState<ValueType>(
    Array.isArray(value) ? value : easeValues[value],
  );
  const [changed, setChanged] = useState(false);
  const captured = useRef(revision);
  useEffect(() => {
    setCurve(Array.isArray(value) ? value : easeValues[value]);
    setChanged(false);
    captured.current = revision;
  }, [JSON.stringify(value)]);
  return (
    <>
      <select
        aria-label="缓动预设"
        value={Array.isArray(value) ? "custom" : value}
        onChange={(e) => {
          if (e.target.value !== "custom")
            onApply(e.target.value as Keyframe["easing"], revision);
        }}
      >
        <option value="linear">线性</option>
        <option value="easeIn">缓入</option>
        <option value="easeOut">缓出</option>
        <option value="easeInOut">缓入缓出</option>
        <option value="custom">自定义贝塞尔</option>
      </select>
      <div className="curve">
        <BezierCurveEditor
          size={174}
          outerAreaSize={14}
          value={curve}
          onChange={(v) => {
            if (!changed) captured.current = revision;
            setCurve(v);
            setChanged(true);
          }}
          innerAreaColor="#212622"
          outerAreaColor="#1a1e1b"
          rowColor="#30372f"
          curveLineColor="#c4f36b"
          handleLineColor="#7f8d78"
          startHandleColor="#c4f36b"
          endHandleColor="#a9b8ff"
          enablePreview={false}
        />
      </div>
      <div className="curve-values">
        {curve.map((v, i) => (
          <input
            key={i}
            aria-label={`曲线控制点 ${i + 1}`}
            type="number"
            step="0.05"
            value={Number(v.toFixed(3))}
            onChange={(e) => {
              if (!changed) captured.current = revision;
              const next: ValueType = [...curve];
              next[i] = Number(e.target.value);
              setCurve(next);
              setChanged(true);
            }}
          />
        ))}
      </div>
      <Button
        className="wide"
        disabled={!changed}
        onClick={() => onApply(curve, captured.current)}
      >
        应用曲线
      </Button>
    </>
  );
}
export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const state = useRef<Snapshot | null>(null);
  const clientId = useRef(uid("ui"));
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoKey, setAutoKey] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [keySelection, setActiveKeySelection] = useState<KeySelection | null>(
    null,
  );
  const [selectedKeys, setSelectedKeys] = useState<KeySelection[]>([]);
  const keyClipboard = useRef<CopiedKey[]>([]);
  const [hasKeyClipboard, setHasKeyClipboard] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [compactTracks, setCompactTracks] = useState(true);
  const [snapping, setSnapping] = useState(true);
  const [timelineView, setTimelineView] = useState({
    action: "fit" as "fit" | "in" | "out",
    serial: 0,
  });
  const changeTimelineView = (action: "fit" | "in" | "out") =>
    setTimelineView((v) => ({ action, serial: v.serial + 1 }));
  const setKeySelections = (keys: KeySelection[]) => {
    setSelectedKeys(keys);
    setActiveKeySelection(keys[0] ?? null);
  };
  const setKeySelection = (key: KeySelection | null) =>
    setKeySelections(key ? [key] : []);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [leftTab, setLeftTab] = useState<"layers" | "components">("layers");
  const [previewHTML, setPreviewHTML] = useState("");
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const [timelineUnit, setTimelineUnit] = useState<"percent" | "px">("percent");
  const projectInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const importMode = useRef<"replace" | "component">("replace");
  const seekTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const update = (next: Snapshot) => {
    if (!state.current || next.revision >= state.current.revision) {
      state.current = next;
      setSnapshot(next);
    }
  };
  // Project responses may arrive after a local seek/selection. Session events have
  // their own channel; never let an older mutation response move the playhead back.
  const updateProject = (next: Snapshot) => {
    const old = state.current;
    if (!old) {
      update(next);
      return;
    }
    const comp = next.project.compositions[old.selection.compositionId];
    const selection = comp
      ? {
          ...old.selection,
          elementIds: old.selection.elementIds.filter((id) =>
            comp.elements.some((e) => e.id === id),
          ),
        }
      : next.selection;
    const preview = next.project.compositions[old.preview.compositionId]
      ? {
          ...old.preview,
          sectionId: next.project.sections.some(
            (s) =>
              s.id === old.preview.sectionId &&
              s.compositionId === old.preview.compositionId,
          )
            ? old.preview.sectionId
            : next.project.sections.find(
                (s) => s.compositionId === old.preview.compositionId,
              )?.id,
        }
      : next.preview;
    update({ ...next, selection, preview });
  };
  const toast = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(""), 4000);
  };
  useEffect(() => {
    if (!snapshot) return;
    const cid = snapshot.selection.compositionId;
    const valid = selectedKeys.filter(
      (k) =>
        snapshot.selection.elementIds.includes(k.elementId) &&
        snapshot.project.compositions[cid]?.elements.some(
          (e) =>
            e.id === k.elementId &&
            e.tracks[k.property]?.some((key) => key.id === k.keyframeId),
        ),
    );
    if (valid.length !== selectedKeys.length) setKeySelections(valid);
  }, [
    snapshot?.project,
    snapshot?.selection.compositionId,
    snapshot?.selection.elementIds.join("|"),
  ]);
  const guard = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    const events = new EventSource("/api/events");
    events.addEventListener("state", (event) => {
      updateProject(JSON.parse(event.data));
      setConnected(true);
    });
    events.addEventListener("session", (event) => {
      const data = JSON.parse(event.data);
      const old = state.current;
      if (!old || data.source === clientId.current) return;
      const changed =
        Math.abs(old.preview.progress - data.preview.progress) > 0.0002 ||
        old.preview.compositionId !== data.preview.compositionId;
      update({ ...old, ...data });
      if (changed)
        previewFrame.current?.contentWindow?.postMessage(
          { type: "scrollweave:seek", ...data.preview },
          "*",
        );
    });
    events.onerror = () => setConnected(false);
    return () => {
      events.close();
      if (seekTimer.current) clearTimeout(seekTimer.current);
    };
  }, []);
  useEffect(() => {
    if (!previewOpen) return;
    const controller = new AbortController();
    fetch("/api/preview", { signal: controller.signal })
      .then((r) => r.text())
      .then(setPreviewHTML)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [previewOpen, snapshot?.revision]);
  const commit = async (
    commands: Command[],
    label = "编辑项目",
    revision?: number,
  ) => {
    if (!state.current) return;
    setBusy(true);
    try {
      const next = await action<Snapshot>("edit_project", {
        commands,
        label,
        expectedRevision: revision ?? state.current.revision,
      });
      updateProject(next);
    } catch (e) {
      setError((e as Error).message);
      const response = await fetch("/api/state");
      updateProject(await response.json());
    } finally {
      setBusy(false);
    }
  };
  const select = (
    ids: string[],
    compositionId = state.current!.selection.compositionId,
  ) => {
    const s = state.current!;
    if (compositionId !== s.selection.compositionId) {
      setPlaying(false);
      setKeySelection(null);
    }
    const selection = { compositionId, elementIds: ids };
    update({ ...s, selection });
    void guard(() =>
      action("set_selection", { ...selection, source: clientId.current }),
    );
  };
  const seek = (
    progress: number,
    compositionId = state.current!.selection.compositionId,
    fromPage = false,
    sectionId?: string,
  ) => {
    const s = state.current!;
    const preview = {
      compositionId,
      progress,
      sectionId:
        sectionId ??
        s.project.sections.find(
          (section) => section.compositionId === compositionId,
        )?.id,
    };
    update({ ...s, preview });
    if (!fromPage)
      previewFrame.current?.contentWindow?.postMessage(
        { type: "scrollweave:seek", ...preview },
        "*",
      );
    if (!seekTimer.current)
      seekTimer.current = setTimeout(() => {
        seekTimer.current = undefined;
        const latest = state.current!.preview;
        void guard(() =>
          action("set_preview", { ...latest, source: clientId.current }),
        );
      }, 80);
  };
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        event.source !== previewFrame.current?.contentWindow ||
        event.data?.type !== "scrollweave:progress" ||
        !state.current
      )
        return;
      const p = event.data.position;
      if (!state.current.project.compositions[p.compositionId]) return;
      if (state.current.selection.compositionId !== p.compositionId)
        select([], p.compositionId);
      seek(p.progress, p.compositionId, true, p.sectionId);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  const undo = (redo = false) =>
    void guard(async () =>
      updateProject(
        await action<Snapshot>(redo ? "redo" : "undo", {
          expectedRevision: state.current!.revision,
        }),
      ),
    );
  const deleteSelection = () => {
    const s = state.current!;
    if (selectedKeys.length) {
      const keys = readKeys(s.project, s.selection.compositionId, selectedKeys);
      if (!keys.length) {
        setKeySelection(null);
        return;
      }
      if (
        keys.some(
          (k) =>
            s.project.compositions[s.selection.compositionId].elements.find(
              (e) => e.id === k.elementId,
            )?.locked,
        )
      ) {
        setError("请先解锁图层");
        return;
      }
      void commit(
        keys.map((k) => ({
          type: "keyframe.delete",
          compositionId: s.selection.compositionId,
          elementId: k.elementId,
          property: k.property,
          keyframeId: k.keyframe.id,
        })),
        "删除关键帧",
      );
      setKeySelection(null);
      return;
    }
    const c = s.project.compositions[s.selection.compositionId];
    const ids = s.selection.elementIds.filter(
      (id) =>
        !c.elements.some(
          (e) =>
            e.id === id &&
            e.parentId &&
            s.selection.elementIds.includes(e.parentId),
        ),
    );
    if (ids.length)
      void commit(
        ids.map((elementId) => ({
          type: "element.delete",
          compositionId: c.id,
          elementId,
        })),
        "删除图层",
      );
  };
  const duplicate = () => {
    const s = state.current!;
    void commit(
      s.selection.elementIds.map((elementId) => ({
        type: "element.duplicate",
        compositionId: s.selection.compositionId,
        elementId,
        newId: uid("el"),
      })),
      "复制图层",
    );
  };
  const cutClip = (side: "left" | "right" | "split") => {
    const s = state.current!;
    const cid = s.selection.compositionId;
    const elements = s.project.compositions[cid].elements;
    const commands: Command[] = [];
    for (const element of elements.filter(
      (e) =>
        s.selection.elementIds.includes(e.id) &&
        !s.selection.elementIds.some((id) => {
          let parent = e.parentId;
          while (parent) {
            if (parent === id) return true;
            parent = elements.find((n) => n.id === parent)?.parentId ?? null;
          }
          return false;
        }),
    )) {
      const at = parentProgress(s.project, cid, element, s.preview.progress);
      const range = clipWindow(element);
      if (at <= range.start + 1e-7 || at >= range.end - 1e-7) continue;
      commands.push(
        side === "split"
          ? {
              type: "element.split",
              compositionId: cid,
              elementId: element.id,
              at,
              newId: uid("el"),
            }
          : {
              type: "element.trim",
              compositionId: cid,
              elementId: element.id,
              start: side === "left" ? at : range.start,
              end: side === "right" ? at : range.end,
            },
      );
    }
    if (!commands.length) {
      toast("先选中素材，并把播放头移到素材内部");
      return;
    }
    setPlaying(false);
    setKeySelection(null);
    void commit(
      commands,
      side === "split"
        ? "在播放头处分割"
        : side === "left"
          ? "裁掉播放头左侧"
          : "裁掉播放头右侧",
    );
  };
  const copyKeys = () => {
    const s = state.current!;
    keyClipboard.current = readKeys(
      s.project,
      s.selection.compositionId,
      selectedKeys,
    );
    setHasKeyClipboard(!!keyClipboard.current.length);
    if (keyClipboard.current.length)
      toast(
        `已复制 ${keyClipboard.current.length} 个关键帧，移动播放头后按 Ctrl+V 粘贴`,
      );
  };
  const pasteAtPlayhead = () => {
    const s = state.current!;
    try {
      const commands = pasteKeys(
        s.project,
        s.selection.compositionId,
        keyClipboard.current,
        s.preview.progress,
        s.selection.elementIds,
      );
      if (commands.length) {
        void commit(commands, "粘贴关键帧");
        setKeySelections(
          commands.flatMap((c) =>
            c.type === "keyframe.set"
              ? [
                  {
                    elementId: c.elementId,
                    property: c.property,
                    keyframeId: c.keyframe.id,
                  },
                ]
              : [],
          ),
        );
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const step = (delta: number) => {
    const s = state.current!;
    setPlaying(false);
    if (selectedKeys.length) {
      try {
        const commands = moveKeys(
          s.project,
          s.selection.compositionId,
          selectedKeys,
          delta,
        );
        if (commands.length) void commit(commands, "微调关键帧位置");
      } catch (e) {
        setError((e as Error).message);
      }
    } else seek(clamp(s.preview.progress + delta));
  };
  const jumpKey = (direction: -1 | 1) => {
    const s = state.current!;
    const cid = s.selection.compositionId;
    const candidates = s.project.compositions[cid].elements
      .filter(
        (e) =>
          !s.selection.elementIds.length ||
          s.selection.elementIds.includes(e.id),
      )
      .flatMap((e) =>
        properties.flatMap((property) =>
          (e.tracks[property] ?? []).map((k) => {
            const range = elementRange(s.project, cid, e);
            return {
              at: range.start + k.at * (range.end - range.start),
              ref: { elementId: e.id, property, keyframeId: k.id },
            };
          }),
        ),
      )
      .filter(
        (k) =>
          k.at >= 0 &&
          k.at <= 1 &&
          direction * (k.at - s.preview.progress) > 0.000001,
      )
      .sort((a, b) => direction * (a.at - b.at));
    if (candidates[0]) {
      setPlaying(false);
      seek(candidates[0].at);
    }
  };
  useEffect(() => {
    if (!playing) return;
    let frame: number,
      previous = performance.now();
    const tick = (now: number) => {
      const s = state.current;
      if (!s) return;
      const next = Math.min(
        1,
        s.preview.progress + Math.min(100, now - previous) / 12000,
      );
      previous = now;
      seek(next);
      if (next >= 1) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (
        !state.current ||
        (event.target as HTMLElement).closest(
          "input,textarea,select,[contenteditable]",
        )
      )
        return;
      if (event.key === "Escape") {
        setPreviewOpen(false);
        setHelpOpen(false);
        setPlaying(false);
        setKeySelection(null);
        return;
      }
      if (previewOpen || helpOpen) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") {
        event.preventDefault();
        undo(event.shiftKey);
      } else if (mod && key === "s") {
        event.preventDefault();
        void save();
      } else if (mod && key === "d") {
        event.preventDefault();
        if (selectedKeys.length) {
          const s = state.current;
          try {
            const copied = readKeys(
              s.project,
              s.selection.compositionId,
              selectedKeys,
            );
            const commands = pasteKeys(
              s.project,
              s.selection.compositionId,
              copied,
              Math.min(...copied.map((k) => k.position)) + 0.01,
              s.selection.elementIds,
            );
            if (commands.length) void commit(commands, "复制关键帧到后方 1%");
          } catch (e) {
            setError((e as Error).message);
          }
        } else duplicate();
      } else if (mod && key === "b") {
        event.preventDefault();
        if (!event.repeat) cutClip("split");
      } else if (mod && key === "c" && selectedKeys.length) {
        event.preventDefault();
        copyKeys();
      } else if (mod && key === "v" && keyClipboard.current.length) {
        event.preventDefault();
        if (!event.repeat) pasteAtPlayhead();
      } else if (!mod && (key === "q" || key === "w")) {
        event.preventDefault();
        if (!event.repeat) cutClip(key === "q" ? "left" : "right");
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        if (event.altKey) jumpKey(direction);
        else step(direction * (event.shiftKey ? 0.01 : 0.001));
      } else if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat) {
          if (state.current.preview.progress >= 1) seek(0);
          setPlaying((v) => !v);
        }
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        setPlaying(false);
        seek(event.key === "Home" ? 0 : 1);
      } else if (!mod && ["+", "=", "-"].includes(key)) {
        event.preventDefault();
        changeTimelineView(key === "-" ? "out" : "in");
      } else if (!mod && event.shiftKey && key === "z") {
        event.preventDefault();
        changeTimelineView("fit");
      } else if (!mod && key === "n") {
        event.preventDefault();
        setSnapping((v) => !v);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelection();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });
  const save = async () =>
    guard(async () => {
      const result = await action("save_project", {
        expectedRevision: state.current!.revision,
        filename: "scrollweave-project",
      });
      download(result.download);
      toast("项目与全部素材已打包保存");
    });
  const exportProject = () =>
    void guard(async () => {
      setBusy(true);
      try {
        const result = await action("export_html", {
          expectedRevision: state.current!.revision,
          filename: "scrollweave-page",
        });
        download(result.download);
        toast("已导出独立 HTML，可直接双击打开");
      } finally {
        setBusy(false);
      }
    });
  const openComposition = (id: string) => {
    setKeySelection(null);
    select([], id);
    seek(0, id);
  };
  const add = async (type: Element["type"], extra: Partial<Element> = {}) => {
    const s = state.current!;
    const element = createElement({
      type,
      name: {
        text: "新文字",
        shape: "新形状",
        image: "图片",
        group: "分组",
        composition: "子合成",
        custom: "自定义元素",
      }[type],
      x: 600,
      y: 380,
      text: type === "text" ? "写下你的想法" : "",
      width: type === "text" ? 800 : 400,
      height: type === "text" ? 140 : 300,
      ...insertionTiming(s.preview.progress),
      ...extra,
    });
    await commit(
      [
        {
          type: "element.add",
          compositionId: s.selection.compositionId,
          element,
        },
      ],
      "添加图层",
    );
    if (
      state.current?.project.compositions[
        s.selection.compositionId
      ].elements.some((e) => e.id === element.id)
    )
      select([element.id]);
  };
  const importProject = (file: File) =>
    void guard(async () => {
      const incoming = validateProject(JSON.parse(await file.text()));
      const s = state.current!;
      if (importMode.current === "replace") {
        await commit(
          [{ type: "project.replace", project: incoming }],
          "打开项目",
        );
        openComposition(incoming.sections[0].compositionId);
      } else {
        const prefix = uid("import");
        const compositionId = `${prefix}_${incoming.sections[0].compositionId}`;
        const element = createElement({
          type: "composition",
          name: incoming.name,
          compositionId,
          width: 1920,
          height: 1080,
          fill: "transparent",
          ...insertionTiming(s.preview.progress),
        });
        await commit(
          [
            { type: "project.import", project: incoming, prefix },
            {
              type: "element.add",
              compositionId: s.selection.compositionId,
              element,
            },
          ],
          "导入子项目",
        );
      }
    });
  const importImage = (file: File) =>
    void guard(async () => {
      if (
        file.size > 10_000_000 ||
        !["image/png", "image/jpeg", "image/webp"].includes(file.type)
      )
        throw new Error("请选择 10MB 以内的静态 PNG、JPEG 或 WebP 图片");
      const bitmap = await createImageBitmap(file);
      const width = Math.min(800, bitmap.width);
      const height = (width * bitmap.height) / bitmap.width;
      bitmap.close();
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const asset = {
        id: uid("asset"),
        name: file.name,
        mime: file.type as "image/png",
        data,
      };
      const element = createElement({
        type: "image",
        assetId: asset.id,
        name: file.name,
        x: 500,
        y: 250,
        width,
        height,
        ...insertionTiming(state.current!.preview.progress),
      });
      await commit(
        [
          { type: "asset.add", asset },
          {
            type: "element.add",
            compositionId: state.current!.selection.compositionId,
            element,
          },
        ],
        "导入图片",
      );
      select([element.id]);
    });
  if (!snapshot)
    return (
      <div className="loading">
        <div className="brand-mark">S</div>
        <h2>正在连接滚动工作台</h2>
        <p>本地服务 · http://127.0.0.1:4100</p>
        {!connected && <p>若一直停在这里，请运行 npm run dev。</p>}
      </div>
    );
  const { project, revision, selection } = snapshot;
  const cid = selection.compositionId;
  const composition = project.compositions[cid];
  const selected = composition.elements.find(
    (e) => e.id === selection.elementIds[0],
  );
  const progress =
    snapshot.preview.compositionId === cid ? snapshot.preview.progress : 0;
  const values = selected
    ? sampleElement(selected, parentProgress(project, cid, selected, progress))
    : undefined;
  const activeKeyElement = keySelection
    ? composition.elements.find((e) => e.id === keySelection.elementId)
    : undefined;
  const activeKey = keySelection
    ? activeKeyElement?.tracks[keySelection.property]?.find(
        (k) => k.id === keySelection.keyframeId,
      )
    : undefined;
  const patch = (values: Partial<Element>, captured = revision) =>
    selected &&
    void commit(
      propertyCommands(project, cid, selected, progress, values, autoKey),
      "修改属性",
      captured,
    );
  const keyPatch = (value: Partial<Keyframe>, captured = revision) => {
    if (!activeKey || !keySelection) return;
    const keys =
      value.easing !== undefined
        ? readKeys(project, cid, selectedKeys)
        : [{ ...keySelection, keyframe: activeKey }];
    void commit(
      keys.map((k) => ({
        type: "keyframe.set",
        compositionId: cid,
        elementId: k.elementId,
        property: k.property,
        keyframe: { ...k.keyframe, ...value },
      })),
      "修改关键帧",
      captured,
    );
  };
  const addKey = (prop: AnimProperty) => {
    if (!selected || !values) return;
    const commands = propertyCommands(
      project,
      cid,
      selected,
      progress,
      { [prop]: values[prop] },
      true,
    );
    void commit(commands, "添加关键帧");
    const command = commands[0];
    if (command.type === "keyframe.set")
      setKeySelection({
        elementId: selected.id,
        property: prop,
        keyframeId: command.keyframe.id,
      });
  };
  const section = project.sections.find((s) => s.compositionId === cid);
  const exportComponent = () => {
    const compositions: Project["compositions"] = {};
    const assets: Project["assets"] = {};
    const visit = (id: string) => {
      if (compositions[id]) return;
      const c = project.compositions[id];
      compositions[id] = c;
      for (const e of c.elements) {
        if (e.assetId) assets[e.assetId] = project.assets[e.assetId];
        if (e.compositionId) visit(e.compositionId);
      }
    };
    visit(cid);
    downloadJSON(
      {
        ...project,
        name: composition.name,
        compositions,
        assets,
        sections: [
          {
            id: "component",
            compositionId: cid,
            kind: "pin",
            scrollDistance: 4000,
          },
        ],
      },
      `${cid}.scrollweave.json`,
    );
    toast("子合成及依赖已打包");
  };
  const layerTree = (parentId: string | null, depth = 0): ReactNode =>
    [...composition.elements]
      .reverse()
      .filter((e) => e.parentId === parentId)
      .map((e) => (
        <div key={e.id}>
          <div
            className={`layer ${selection.elementIds.includes(e.id) ? "active" : ""}`}
            style={{ paddingLeft: 13 + depth * 15 }}
            onClick={(event) => {
              select(
                event.shiftKey
                  ? selection.elementIds.includes(e.id)
                    ? selection.elementIds.filter((id) => id !== e.id)
                    : [...selection.elementIds, e.id]
                  : [e.id],
              );
              setKeySelection(null);
            }}
            onDoubleClick={() =>
              e.type === "composition" && openComposition(e.compositionId!)
            }
            role="button"
            tabIndex={0}
            onKeyDown={(event) => event.key === "Enter" && select([e.id])}
          >
            {e.type === "text" ? (
              <Type size={13} />
            ) : e.type === "composition" ? (
              <Box size={13} />
            ) : e.type === "group" ? (
              <Group size={13} />
            ) : e.type === "image" ? (
              <ImagePlus size={13} />
            ) : (
              <Square size={13} />
            )}
            <span title={e.name}>{e.name}</span>
            <button
              aria-label={`${e.hidden ? "显示" : "隐藏"} ${e.name}`}
              onClick={(event) => {
                event.stopPropagation();
                void commit(
                  [
                    {
                      type: "element.update",
                      compositionId: cid,
                      elementId: e.id,
                      patch: { hidden: !e.hidden },
                    },
                  ],
                  "切换图层可见性",
                );
              }}
            >
              {e.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
            <button
              aria-label={`${e.locked ? "解锁" : "锁定"} ${e.name}`}
              onClick={(event) => {
                event.stopPropagation();
                void commit(
                  [
                    {
                      type: "element.update",
                      compositionId: cid,
                      elementId: e.id,
                      patch: { locked: !e.locked },
                    },
                  ],
                  "切换图层锁定",
                );
              }}
            >
              {e.locked ? <Lock size={12} /> : <Unlock size={12} />}
            </button>
          </div>
          {e.type === "group" && layerTree(e.id, depth + 1)}
        </div>
      ));
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <strong>ScrollWeave</strong>
          <span className="beta">开源预览版</span>
        </div>
        <div className="project-title">
          {project.name}
          <span className="save-indicator">
            <Check size={12} />
            本机保存
          </span>
        </div>
        <div className="header-actions">
          <Button title="MCP 接入与帮助" onClick={() => setHelpOpen(true)}>
            <Braces size={16} />
            <span>MCP</span>
            <i className={connected ? "connected-dot" : "offline-dot"} />
          </Button>
          <Button title="保存项目 Ctrl+S" onClick={() => void save()}>
            <Save size={15} />
            保存
          </Button>
          <Button
            title="导出独立 HTML"
            onClick={exportProject}
            className="primary"
            disabled={busy}
          >
            <Download size={15} />
            导出 HTML
          </Button>
        </div>
      </header>
      <div className="toolbar">
        <div className="tool-group">
          <Button
            title="新建项目"
            onClick={() => {
              const p = blankProject();
              void commit(
                [{ type: "project.replace", project: p }],
                "新建项目",
              ).then(() => openComposition("main"));
            }}
          >
            <FilePlus2 size={16} />
          </Button>
          <Button
            title="打开项目包"
            onClick={() => {
              importMode.current = "replace";
              projectInput.current?.click();
            }}
          >
            <FolderOpen size={16} />
          </Button>
          <span className="divider" />
          <Button
            title="撤销 Ctrl+Z"
            disabled={!snapshot.canUndo || busy}
            onClick={() => undo()}
          >
            <Undo2 size={16} />
          </Button>
          <Button
            title="重做 Ctrl+Shift+Z"
            disabled={!snapshot.canRedo || busy}
            onClick={() => undo(true)}
          >
            <Redo2 size={16} />
          </Button>
        </div>
        <div className="tool-group">
          <Button className="tool-active" title="选择与变换">
            <MousePointer2 size={16} />
          </Button>
          <Button title="添加文字" onClick={() => void add("text")}>
            <Type size={17} />
          </Button>
          <Button title="添加矩形" onClick={() => void add("shape")}>
            <Square size={16} />
          </Button>
          <Button
            title="添加圆形"
            onClick={() =>
              void add("shape", {
                name: "圆形",
                width: 300,
                height: 300,
                radius: 150,
              })
            }
          >
            <Circle size={16} />
          </Button>
          <Button title="导入图片" onClick={() => imageInput.current?.click()}>
            <ImagePlus size={17} />
          </Button>
          <span className="divider" />
          <Button
            title="将选中图层分组"
            disabled={!selection.elementIds.length}
            onClick={() =>
              void commit(
                [
                  {
                    type: "element.group",
                    compositionId: cid,
                    elementIds: selection.elementIds,
                    groupId: uid("group"),
                  },
                ],
                "图层分组",
              )
            }
          >
            <Group size={17} />
          </Button>
          <Button
            title="复制图层 Ctrl+D"
            disabled={!selected}
            onClick={duplicate}
          >
            <Copy size={15} />
          </Button>
          <Button
            title="删除选中图层"
            disabled={!selected}
            onClick={deleteSelection}
          >
            <Trash2 size={15} />
          </Button>
        </div>
        <div className="toolbar-right">
          <span className="design-size">1920 × 1080</span>
          <select
            aria-label="画布缩放"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            <option value={0.75}>75%</option>
            <option value={1}>适应画布</option>
            <option value={1.25}>125%</option>
            <option value={1.5}>150%</option>
          </select>
          <Button
            className="preview-button"
            title="打开原生滚动预览"
            onClick={() => setPreviewOpen(true)}
          >
            <Play size={14} fill="currentColor" />
            滚动预览
          </Button>
        </div>
      </div>
      <div className="workspace">
        <aside className="left-panel">
          <div className="panel-tabs">
            <button
              className={leftTab === "layers" ? "selected" : ""}
              onClick={() => setLeftTab("layers")}
            >
              <Layers size={14} />
              图层
            </button>
            <button
              className={leftTab === "components" ? "selected" : ""}
              onClick={() => setLeftTab("components")}
            >
              <Package size={14} />
              素材与组件
            </button>
          </div>
          <div className="composition-picker">
            <span>当前合成</span>
            <select
              aria-label="当前合成"
              value={cid}
              onChange={(e) => openComposition(e.target.value)}
            >
              {Object.values(project.compositions).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {leftTab === "layers" ? (
            <>
              <div className="layer-heading">
                <small>{composition.elements.length} 个图层</small>
                <span>按住 Shift 多选</span>
              </div>
              <div className="layer-tree">
                {layerTree(null)}
                {!composition.elements.length && (
                  <div className="empty">
                    <Layers size={28} />
                    <p>从上方添加第一个图层</p>
                  </div>
                )}
              </div>
              <div className="left-footer">
                <Button
                  title="图层上移一层"
                  disabled={!selected}
                  onClick={() =>
                    selected &&
                    void commit(
                      [
                        {
                          type: "element.reorder",
                          compositionId: cid,
                          elementId: selected.id,
                          index: Math.min(
                            composition.elements.length - 1,
                            composition.elements.indexOf(selected) + 1,
                          ),
                        },
                      ],
                      "图层排序",
                    )
                  }
                >
                  <ArrowUp size={14} />
                </Button>
                <Button
                  title="图层下移一层"
                  disabled={!selected}
                  onClick={() =>
                    selected &&
                    void commit(
                      [
                        {
                          type: "element.reorder",
                          compositionId: cid,
                          elementId: selected.id,
                          index: Math.max(
                            0,
                            composition.elements.indexOf(selected) - 1,
                          ),
                        },
                      ],
                      "图层排序",
                    )
                  }
                >
                  <ArrowDown size={14} />
                </Button>
                <span>底层 → 顶层绘制</span>
              </div>
            </>
          ) : (
            <div className="library">
              <h4>
                预制动画 <span>可继续编辑</span>
              </h4>
              {[...presets.values()].map((p, index) => (
                <button
                  className={`preset preset-${index}`}
                  key={p.id}
                  onClick={() =>
                    void guard(async () =>
                      updateProject(
                        await action("apply_preset", {
                          expectedRevision: state.current!.revision,
                          presetId: p.id,
                          compositionId: cid,
                          elementId: selected?.id,
                          options: insertionTiming(
                            state.current!.preview.progress,
                          ),
                        }),
                      ),
                    )
                  }
                >
                  <div className="preset-art">
                    {index === 0 ? "Aa ↗" : index === 1 ? "◈" : "▰ ▰ ▰"}
                  </div>
                  <strong>{p.name}</strong>
                  <span>{p.description}</span>
                </button>
              ))}
              <h4>可复用子合成</h4>
              {Object.values(project.compositions)
                .filter((c) => c.id !== cid)
                .map((c) => (
                  <div className="component-row" key={c.id}>
                    <button onClick={() => openComposition(c.id)}>
                      <Box size={14} />
                      {c.name}
                    </button>
                    <Button
                      title={`插入 ${c.name}`}
                      onClick={() =>
                        void add("composition", {
                          compositionId: c.id,
                          name: c.name,
                          x: 0,
                          y: 0,
                          width: c.width,
                          height: c.height,
                          fill: "transparent",
                        })
                      }
                    >
                      <Plus size={14} />
                    </Button>
                  </div>
                ))}
              <Button
                className="wide"
                onClick={() => {
                  const id = uid("comp");
                  void commit(
                    [
                      {
                        type: "composition.add",
                        composition: {
                          id,
                          name: "新子合成",
                          width: 1920,
                          height: 1080,
                          background: "transparent",
                          elements: [],
                        },
                      },
                    ],
                    "创建子合成",
                  ).then(() => openComposition(id));
                }}
              >
                <Plus size={14} />
                新建子合成
              </Button>
              <Button
                className="wide"
                onClick={() => {
                  importMode.current = "component";
                  projectInput.current?.click();
                }}
              >
                <Upload size={14} />
                导入子项目
              </Button>
              <Button className="wide" onClick={exportComponent}>
                <Download size={14} />
                保存当前子合成
              </Button>
              <h4>图片素材</h4>
              <Button
                className="wide"
                onClick={() => imageInput.current?.click()}
              >
                <ImagePlus size={14} />
                导入本地图片
              </Button>
              <div className="asset-grid">
                {Object.values(project.assets).map((a) => (
                  <button
                    key={a.id}
                    title={a.name}
                    onClick={() =>
                      void add("image", { assetId: a.id, name: a.name })
                    }
                  >
                    <img src={a.data} alt={a.name} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>
        <main className="center-panel">
          <div className="canvas-bar">
            <div>
              <span>项目</span>
              <ChevronRight size={12} />
              <strong>{composition.name}</strong>
            </div>
            <span>
              <span className="live-dot" />
              {section?.kind === "pin"
                ? "固定舞台"
                : section
                  ? "纵向内容流"
                  : "子合成"}
              {section && ` · ${section.scrollDistance.toLocaleString()} px`}
            </span>
          </div>
          <Canvas
            project={project}
            compositionId={cid}
            progress={progress}
            revision={revision}
            selected={selection.elementIds}
            autoKey={autoKey}
            zoom={zoom}
            onSelect={(ids) => {
              select(ids);
              setKeySelection(null);
            }}
            onCommit={commit}
          />
          <div className="canvas-bottom">
            <span>拖动以移动 · 拖拽边角缩放 · 上方手柄旋转</span>
            <span>像素编辑 / 16:9</span>
          </div>
        </main>
        <aside className="inspector">
          <div className="inspector-heading">
            <Settings2 size={15} />
            <strong>
              {activeKey
                ? `关键帧${selectedKeys.length > 1 ? ` · 已选 ${selectedKeys.length}` : ""}`
                : selected
                  ? "图层属性"
                  : "项目与滚动"}
            </strong>
            <span>{activeKey ? "◆" : (selected?.type ?? "设置")}</span>
          </div>
          {activeKey && keySelection ? (
            <div className="inspector-body">
              <div className="inspector-section">
                <h4>
                  {activeKeyElement?.name}{" "}
                  <small>{propertyNames[keySelection.property]}</small>
                </h4>
                <NumberField
                  label="关键帧位置"
                  value={activeKey.at * 100}
                  suffix="%"
                  step={0.1}
                  revision={revision}
                  onCommit={(v, r) => keyPatch({ at: v / 100 }, r)}
                />
                <NumberField
                  label="关键帧数值"
                  value={activeKey.value}
                  step={0.1}
                  revision={revision}
                  onCommit={(v, r) => keyPatch({ value: v }, r)}
                />
                <p className="hint">
                  位置相对于当前图层区间。缓动控制此关键帧到下一帧。
                  {selectedKeys.length > 1 &&
                    " 多选时曲线应用到全部选中帧；位置与数值编辑第一帧。"}
                </p>
              </div>
              <div className="inspector-section">
                <h4>缓动曲线</h4>
                <CurvePanel
                  key={activeKey.id}
                  value={activeKey.easing}
                  revision={revision}
                  onApply={(easing, r) => keyPatch({ easing }, r)}
                />
              </div>
              <div className="inspector-section">
                <Button
                  className="wide"
                  title="复制关键帧 (Ctrl+C)"
                  onClick={copyKeys}
                >
                  <Copy size={14} />
                  复制关键帧 <kbd>Ctrl+C</kbd>
                </Button>
                <Button
                  className="wide"
                  disabled={!hasKeyClipboard}
                  title="粘贴到播放头 (Ctrl+V)"
                  onClick={pasteAtPlayhead}
                >
                  粘贴到播放头 <kbd>Ctrl+V</kbd>
                </Button>
                <Button
                  className="wide danger"
                  title="删除选中的关键帧 (Delete)"
                  onClick={deleteSelection}
                >
                  <Trash2 size={14} />
                  删除关键帧 <kbd>Delete</kbd>
                </Button>
                <Button className="wide" onClick={() => setKeySelection(null)}>
                  返回图层属性
                </Button>
              </div>
            </div>
          ) : selected && values ? (
            <div className="inspector-body">
              <div className="inspector-section">
                <TextField
                  className="name-input"
                  label="图层名称"
                  key={`${selected.id}-name`}
                  value={selected.name}
                  revision={revision}
                  onCommit={(name, r) => patch({ name }, r)}
                />
                <div className="field-grid">
                  {properties.map((prop) => (
                    <div className="animated-field" key={prop}>
                      <NumberField
                        label={propertyNames[prop]}
                        value={values[prop]}
                        step={
                          prop.startsWith("scale") || prop === "opacity"
                            ? 0.05
                            : 1
                        }
                        suffix={
                          prop === "rotation"
                            ? "°"
                            : ["x", "y"].includes(prop)
                              ? "px"
                              : ""
                        }
                        revision={revision}
                        onCommit={(v, r) => patch({ [prop]: v }, r)}
                      />
                      <button
                        title={`为${propertyNames[prop]}添加关键帧`}
                        aria-label={`为${propertyNames[prop]}添加关键帧`}
                        className={selected.tracks[prop]?.length ? "keyed" : ""}
                        onClick={() => addKey(prop)}
                      >
                        <Diamond
                          size={11}
                          fill={
                            selected.tracks[prop]?.length
                              ? "currentColor"
                              : "none"
                          }
                        />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="field-grid">
                  <NumberField
                    label="宽度"
                    value={selected.width}
                    suffix="px"
                    revision={revision}
                    onCommit={(v, r) => patch({ width: v }, r)}
                  />
                  <NumberField
                    label="高度"
                    value={selected.height}
                    suffix="px"
                    revision={revision}
                    onCommit={(v, r) => patch({ height: v }, r)}
                  />
                </div>
                <p className="hint">
                  ◆ 添加关键帧。有轨道的属性会修改当前位置的关键帧。
                </p>
              </div>
              <div className="inspector-section">
                <h4>外观</h4>
                {selected.type === "text" && (
                  <>
                    <TextField
                      multiline
                      label="文字内容"
                      key={`${selected.id}-text`}
                      value={selected.text}
                      revision={revision}
                      onCommit={(text, r) => patch({ text }, r)}
                    />
                    <div className="field-grid">
                      <NumberField
                        label="字号"
                        value={selected.fontSize}
                        revision={revision}
                        onCommit={(v, r) => patch({ fontSize: v }, r)}
                      />
                      <NumberField
                        label="字重"
                        value={selected.fontWeight}
                        step={100}
                        revision={revision}
                        onCommit={(v, r) => patch({ fontWeight: v }, r)}
                      />
                    </div>
                    <label className="text-field">
                      链接
                      <TextField
                        label="文字链接"
                        key={`${selected.id}-href`}
                        value={selected.href}
                        revision={revision}
                        placeholder="https:// 或 #锚点"
                        onCommit={(href, r) => patch({ href }, r)}
                      />
                    </label>
                  </>
                )}
                <div className="color-row">
                  <label>
                    {selected.type === "text" ? "文字颜色" : "填充颜色"}
                    <input
                      aria-label="颜色"
                      type="color"
                      value={
                        (selected.type === "text"
                          ? selected.color
                          : selected.fill) === "transparent"
                          ? "#000000"
                          : selected.type === "text"
                            ? selected.color
                            : selected.fill
                      }
                      onChange={(e) =>
                        patch({
                          [selected.type === "text" ? "color" : "fill"]:
                            e.target.value,
                        })
                      }
                    />
                  </label>
                  <span>
                    {selected.type === "text" ? selected.color : selected.fill}
                  </span>
                </div>
                <NumberField
                  label="圆角"
                  value={selected.radius}
                  revision={revision}
                  onCommit={(v, r) => patch({ radius: v }, r)}
                />
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={selected.clip}
                    onChange={(e) => patch({ clip: e.target.checked })}
                  />
                  裁切超出边界的内容
                </label>
                <details>
                  <summary>边缘裁切</summary>
                  <div className="field-grid">
                    {(["top", "right", "bottom", "left"] as const).map(
                      (side, i) => (
                        <NumberField
                          key={side}
                          label={["上裁切", "右裁切", "下裁切", "左裁切"][i]}
                          value={selected.crop[side]}
                          suffix="%"
                          revision={revision}
                          onCommit={(v, r) =>
                            patch({ crop: { ...selected.crop, [side]: v } }, r)
                          }
                        />
                      ),
                    )}
                  </div>
                </details>
              </div>
              <div className="inspector-section">
                <h4>素材显示区间</h4>
                <div className="field-grid">
                  <NumberField
                    label="素材入点"
                    value={clipWindow(selected).start * 100}
                    suffix="%"
                    step={0.1}
                    revision={revision}
                    onCommit={(v, r) =>
                      void commit(
                        [
                          {
                            type: "element.trim",
                            compositionId: cid,
                            elementId: selected.id,
                            start: v / 100,
                            end: clipWindow(selected).end,
                          },
                        ],
                        "调整素材入点",
                        r,
                      )
                    }
                  />
                  <NumberField
                    label="素材出点"
                    value={clipWindow(selected).end * 100}
                    suffix="%"
                    step={0.1}
                    revision={revision}
                    onCommit={(v, r) =>
                      void commit(
                        [
                          {
                            type: "element.trim",
                            compositionId: cid,
                            elementId: selected.id,
                            start: clipWindow(selected).start,
                            end: v / 100,
                          },
                        ],
                        "调整素材出点",
                        r,
                      )
                    }
                  />
                </div>
                <p className="hint">
                  裁剪只隐藏区间外内容，不改变动画速度。Q 裁左 / W 裁右 / Ctrl+B
                  分割。
                </p>
                <Button
                  className="wide"
                  onClick={() =>
                    patch({ trim: { start: 0, end: 1 }, outside: "hold" })
                  }
                >
                  贯穿当前合成
                </Button>
                {selected.trim && (
                  <Button
                    className="wide"
                    onClick={() => patch({ trim: null })}
                  >
                    恢复裁剪前的时长
                  </Button>
                )}
                <details className="timing-details">
                  <summary>动画映射区间 · 修改会变速</summary>
                  <div className="field-grid">
                    <NumberField
                      label="开始"
                      value={selected.start * 100}
                      suffix="%"
                      step={0.1}
                      revision={revision}
                      onCommit={(v, r) => patch({ start: v / 100 }, r)}
                    />
                    <NumberField
                      label="结束"
                      value={selected.end * 100}
                      suffix="%"
                      step={0.1}
                      revision={revision}
                      onCommit={(v, r) => patch({ end: v / 100 }, r)}
                    />
                  </div>
                  <select
                    aria-label="区间外行为"
                    value={selected.outside}
                    onChange={(e) =>
                      patch({ outside: e.target.value as "hold" | "hide" })
                    }
                  >
                    <option value="hold">区间外保持首尾状态</option>
                    <option value="hide">区间外隐藏</option>
                  </select>
                  {selected.timeOffset !== 0 && (
                    <p className="hint">
                      素材已平移 {(selected.timeOffset * 100).toFixed(1)}
                      %，关键帧与子合成同步移动。
                    </p>
                  )}
                </details>
                {selected.type === "composition" && (
                  <Button
                    className="wide"
                    onClick={() => openComposition(selected.compositionId!)}
                  >
                    <Box size={14} />
                    进入子合成编辑
                  </Button>
                )}
                {selected.type === "group" && (
                  <Button
                    className="wide"
                    onClick={() =>
                      void commit(
                        [
                          {
                            type: "element.ungroup",
                            compositionId: cid,
                            elementId: selected.id,
                          },
                        ],
                        "取消分组",
                      )
                    }
                  >
                    取消分组
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="inspector-body">
              <div className="inspector-section">
                <h4>项目</h4>
                <input
                  aria-label="项目名称"
                  key={`project-${revision}`}
                  defaultValue={project.name}
                  onBlur={(e) =>
                    e.target.value !== project.name &&
                    void commit(
                      [
                        {
                          type: "project.update",
                          patch: { name: e.target.value },
                        },
                      ],
                      "重命名项目",
                    )
                  }
                />
                <label className="text-field">
                  整体适配
                  <select
                    aria-label="整体适配"
                    value={project.canvas.fit}
                    onChange={(e) =>
                      void commit(
                        [
                          {
                            type: "project.update",
                            patch: {
                              canvas: {
                                ...project.canvas,
                                fit: e.target.value as "contain" | "cover",
                              },
                            },
                          },
                        ],
                        "修改画布适配",
                      )
                    }
                  >
                    <option value="contain">完整显示 · 等比缩放</option>
                    <option value="cover">填满视口 · 居中裁切</option>
                  </select>
                </label>
              </div>
              <div className="inspector-section">
                <h4>滚动驱动</h4>
                <div className="mode-switch">
                  <button
                    className={project.scroll.mode === "exact" ? "active" : ""}
                    onClick={() =>
                      void commit(
                        [
                          {
                            type: "project.update",
                            patch: {
                              scroll: { ...project.scroll, mode: "exact" },
                            },
                          },
                        ],
                        "精确跟随",
                      )
                    }
                  >
                    精确跟随
                  </button>
                  <button
                    className={project.scroll.mode === "smooth" ? "active" : ""}
                    onClick={() =>
                      void commit(
                        [
                          {
                            type: "project.update",
                            patch: {
                              scroll: { ...project.scroll, mode: "smooth" },
                            },
                          },
                        ],
                        "平滑追随",
                      )
                    }
                  >
                    平滑追随
                  </button>
                </div>
                <p className="hint">
                  {project.scroll.mode === "exact"
                    ? "任意滚动位置，都对应确定的画面。支持倒放与随机跳转。"
                    : "从实际显示状态平滑追赶滚动目标，允许短暂延迟。系统减少动态效果开启时使用精确模式。"}
                </p>
                {project.scroll.mode === "smooth" && (
                  <NumberField
                    label="追随时常"
                    value={project.scroll.smoothing}
                    suffix="ms"
                    revision={revision}
                    onCommit={(v, r) =>
                      void commit(
                        [
                          {
                            type: "project.update",
                            patch: {
                              scroll: { ...project.scroll, smoothing: v },
                            },
                          },
                        ],
                        "调整追随",
                        r,
                      )
                    }
                  />
                )}
              </div>
              <div className="inspector-section">
                <h4>
                  页面区间 <small>按顺序纵向排列</small>
                </h4>
                {project.sections.map((s, i) => (
                  <div className="section-card" key={s.id}>
                    <button
                      className="section-title"
                      onClick={() => openComposition(s.compositionId)}
                    >
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      {project.compositions[s.compositionId].name}
                    </button>
                    <select
                      aria-label={`区间 ${i + 1} 模式`}
                      value={s.kind}
                      onChange={(e) =>
                        void commit(
                          [
                            {
                              type: "project.update",
                              patch: {
                                sections: project.sections.map((a) =>
                                  a.id === s.id
                                    ? {
                                        ...a,
                                        kind: e.target.value as "pin" | "flow",
                                      }
                                    : a,
                                ),
                              },
                            },
                          ],
                          "修改页面区间",
                        )
                      }
                    >
                      <option value="pin">固定舞台 · 滚动映射</option>
                      <option value="flow">正常纵向内容流</option>
                    </select>
                    <NumberField
                      label={`区间 ${i + 1} 距离`}
                      value={s.scrollDistance}
                      suffix="px"
                      revision={revision}
                      onCommit={(v, r) =>
                        void commit(
                          [
                            {
                              type: "project.update",
                              patch: {
                                sections: project.sections.map((a) =>
                                  a.id === s.id
                                    ? { ...a, scrollDistance: v }
                                    : a,
                                ),
                              },
                            },
                          ],
                          "调整滚动距离",
                          r,
                        )
                      }
                    />
                    <div className="section-actions">
                      <Button
                        title={`上移区间 ${i + 1}`}
                        disabled={i === 0}
                        onClick={() => {
                          const sections = [...project.sections];
                          [sections[i - 1], sections[i]] = [
                            sections[i],
                            sections[i - 1],
                          ];
                          void commit(
                            [{ type: "project.update", patch: { sections } }],
                            "页面排序",
                          );
                        }}
                      >
                        <ArrowUp size={12} />
                      </Button>
                      <Button
                        title={`删除区间 ${i + 1}`}
                        disabled={project.sections.length < 2}
                        onClick={() =>
                          void commit(
                            [
                              {
                                type: "project.update",
                                patch: {
                                  sections: project.sections.filter(
                                    (a) => a.id !== s.id,
                                  ),
                                },
                              },
                            ],
                            "删除页面区间",
                          )
                        }
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  className="wide"
                  onClick={() =>
                    void commit(
                      [
                        {
                          type: "project.update",
                          patch: {
                            sections: [
                              ...project.sections,
                              {
                                id: uid("section"),
                                compositionId: cid,
                                kind: "pin",
                                scrollDistance: 3000,
                              },
                            ],
                          },
                        },
                      ],
                      "添加页面区间",
                    )
                  }
                >
                  <Plus size={14} />
                  将当前合成添加到页面
                </Button>
              </div>
              <div className="inspector-section">
                <Button
                  className="wide"
                  onClick={() =>
                    void guard(async () => {
                      await action("validate_project");
                      toast("校验通过：结构、素材与嵌套关系有效");
                    })
                  }
                >
                  <Check size={14} />
                  校验项目
                </Button>
                <Button
                  className="wide"
                  onClick={() =>
                    void guard(async () => {
                      const p = await (await fetch("/api/example")).json();
                      await commit(
                        [{ type: "project.replace", project: p }],
                        "打开示例",
                      );
                      openComposition("main");
                    })
                  }
                >
                  打开完整示例
                </Button>
              </div>
            </div>
          )}
        </aside>
      </div>
      <section className="timeline-panel">
        <div className="timeline-toolbar">
          <div>
            <Layers size={14} />
            <strong>滚动时间线</strong>
            <span className="timeline-badge">连续进度</span>
          </div>
          <div className="scrub-controls">
            <Button
              title="回到起点 (Home)"
              onClick={() => {
                setPlaying(false);
                seek(0);
              }}
            >
              │◀
            </Button>
            <Button
              title={playing ? "暂停 (Space)" : "播放预览 (Space)"}
              onClick={() => {
                if (progress >= 1) seek(0);
                setPlaying((v) => !v);
              }}
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </Button>
            <input
              aria-label="播放头进度"
              type="range"
              min="0"
              max="1"
              step="0.0001"
              value={progress}
              onChange={(e) => {
                setPlaying(false);
                seek(Number(e.target.value));
              }}
            />
            <output data-testid="progress-value">
              {timelineUnit === "percent"
                ? `${(progress * 100).toFixed(1)}%`
                : `${Math.round(progress * (section?.scrollDistance ?? 1000))} px`}
            </output>
            <select
              aria-label="时间线单位"
              value={timelineUnit}
              onChange={(e) =>
                setTimelineUnit(e.target.value as "percent" | "px")
              }
            >
              <option value="percent">进度</option>
              <option value="px">滚动距离</option>
            </select>
          </div>
          <label className={`auto-key ${autoKey ? "active" : ""}`}>
            <input
              type="checkbox"
              checked={autoKey}
              onChange={(e) => setAutoKey(e.target.checked)}
            />
            <Diamond size={12} />
            自动关键帧
          </label>
        </div>
        <div className="timeline-tools">
          <div className="tool-cluster">
            <Button
              title="分割素材 (Ctrl+B)"
              disabled={!selected || busy}
              onClick={() => cutClip("split")}
            >
              <Scissors size={14} />
              分割 <kbd>Ctrl+B</kbd>
            </Button>
            <Button
              title="裁掉播放头左侧 (Q)"
              disabled={!selected || busy}
              onClick={() => cutClip("left")}
            >
              <ChevronsLeft size={14} />
              裁左 <kbd>Q</kbd>
            </Button>
            <Button
              title="裁掉播放头右侧 (W)"
              disabled={!selected || busy}
              onClick={() => cutClip("right")}
            >
              <ChevronsRight size={14} />
              裁右 <kbd>W</kbd>
            </Button>
            <span className="tool-divider" />
            <Button
              title={
                selectedKeys.length
                  ? "删除关键帧 (Delete)"
                  : "删除素材 (Delete)"
              }
              disabled={!selected || busy}
              onClick={deleteSelection}
            >
              <Trash2 size={14} />
              <kbd>Del</kbd>
            </Button>
            <Button title="上一个关键帧 (Alt+←)" onClick={() => jumpKey(-1)}>
              <SkipBack size={14} />
            </Button>
            <Button title="下一个关键帧 (Alt+→)" onClick={() => jumpKey(1)}>
              <SkipForward size={14} />
            </Button>
            <Button
              title="复制关键帧 (Ctrl+C)"
              disabled={!selectedKeys.length}
              onClick={copyKeys}
            >
              <Copy size={14} />
            </Button>
            <Button
              title="粘贴关键帧到播放头 (Ctrl+V)"
              disabled={!hasKeyClipboard}
              onClick={pasteAtPlayhead}
            >
              粘贴关键帧
            </Button>
          </div>
          <div className="tool-cluster">
            <Button
              title="吸附播放头、素材边缘和关键帧 (N)"
              className={snapping ? "active" : ""}
              onClick={() => setSnapping((v) => !v)}
            >
              <Magnet size={14} />
              吸附
            </Button>
            <Button
              title={compactTracks ? "展开全部轨道" : "收起无关轨道"}
              onClick={() => setCompactTracks((v) => !v)}
            >
              <Layers size={14} />
              {compactTracks ? "精简轨道" : "全部轨道"}
            </Button>
            <span className="tool-divider" />
            <Button
              title="缩小时间线 (-)"
              onClick={() => changeTimelineView("out")}
            >
              <ZoomOut size={14} />
            </Button>
            <Button
              title="缩放至完整时间线 (Shift+Z)"
              onClick={() => changeTimelineView("fit")}
            >
              <Maximize2 size={14} />
            </Button>
            <Button
              title="放大时间线 (+)"
              onClick={() => changeTimelineView("in")}
            >
              <ZoomIn size={14} />
            </Button>
          </div>
        </div>
        <Timeline
          project={project}
          compositionId={cid}
          revision={revision}
          progress={progress}
          selected={selection.elementIds}
          keys={selectedKeys}
          compact={compactTracks}
          snapping={snapping}
          view={timelineView}
          onSeek={(p) => {
            setPlaying(false);
            seek(p);
          }}
          onSelect={select}
          onKey={setKeySelections}
          onError={setError}
          onCommit={commit}
        />
        <div className="timeline-hint">
          滚轮：上下轨道 · Shift+滚轮：横移 · Ctrl+滚轮：缩放 · Shift/Ctrl+点击
          ◆：多选 · ← →：微调 · Space：播放/暂停
        </div>
      </section>
      <footer className="statusbar">
        <span>
          <i className={connected ? "connected-dot" : "offline-dot"} />
          {connected ? "本地服务已连接" : "连接中断，正在重试"}
          <span className="status-divider">/</span>r{revision}
          <span className="status-divider">/</span>
          {snapshot.lastAction}
        </span>
        <span>
          {busy ? "正在保存…" : "自动保存到本机"}
          <span className="status-divider">·</span>MIT 开源
        </span>
      </footer>
      {notice && (
        <div className="toast">
          <Check size={16} />
          {notice}
        </div>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <div>
            <strong>操作未完成</strong>
            <p>{error}</p>
          </div>
          <Button title="关闭错误提示" onClick={() => setError("")}>
            <X size={16} />
          </Button>
        </div>
      )}
      {previewOpen && (
        <div className="modal-backdrop">
          <div className="preview-modal">
            <div className="modal-top">
              <div>
                <Play size={15} />
                <strong>原生滚动预览</strong>
                <span>滚动条 / 鼠标 / PageDown · 与导出共用运行时</span>
              </div>
              <Button title="关闭预览" onClick={() => setPreviewOpen(false)}>
                <X size={18} />
              </Button>
            </div>
            <iframe
              title="滚动页面预览"
              ref={previewFrame}
              srcDoc={previewHTML}
              onLoad={() => {
                const p = state.current?.preview;
                if (p?.sectionId)
                  previewFrame.current?.contentWindow?.postMessage(
                    { type: "scrollweave:seek", ...p },
                    "*",
                  );
              }}
            />
            <div className="preview-progress">
              {project.scroll.mode === "exact" ? "精确跟随" : "平滑追随"} ·{" "}
              {(progress * 100).toFixed(1)}%{" "}
              <span>固定舞台结束后，继续滚动进入纵向收尾。</span>
            </div>
          </div>
        </div>
      )}
      {helpOpen && (
        <div className="modal-backdrop">
          <div className="help-modal">
            <div className="modal-top">
              <strong>MCP 与编辑指南</strong>
              <Button title="关闭帮助" onClick={() => setHelpOpen(false)}>
                <X size={18} />
              </Button>
            </div>
            <div className="help-content">
              <h3>人和 Agent，编辑同一份项目。</h3>
              <p>
                外部 Agent 可直接连接本机 MCP 服务。读取 revision
                后提交修改；界面实时同步，整批修改可按 Ctrl+Z 撤销。
              </p>
              <code>http://127.0.0.1:4100/mcp</code>
              <h4>Streamable HTTP 客户端配置</h4>
              <pre>
                {JSON.stringify(
                  {
                    mcpServers: {
                      scrollweave: {
                        type: "http",
                        url: "http://127.0.0.1:4100/mcp",
                      },
                    },
                  },
                  null,
                  2,
                )}
              </pre>
              <p>
                stdio 与 Codex TOML 配置见项目
                docs/MCP.md。核心工具：read_project、edit_project、apply_preset、undo、set_preview、get_preview_screenshot、save_project、export_html。
              </p>
              <h4>开始编辑</h4>
              <p>
                滚轮上下浏览轨道；Shift+滚轮横移；Ctrl+滚轮缩放；Shift+Z
                显示全段。新文字、图片和形状从播放头插入，占 20% 进度。
              </p>
              <p>
                Ctrl+B 分割；Q 裁掉播放头左侧；W
                裁掉右侧。裁剪保留动画节奏，所有操作可撤销。水印等长驻素材折叠到“全程静态图层”；淡出后的空白自动缩短显示色块。
              </p>
              <p>
                Shift/Ctrl+点击多选关键帧，Delete 只删所选关键帧。Ctrl+C
                复制，移动播放头后 Ctrl+V 粘贴；目标处已有关键帧时替换。←/→ 微调
                0.1%，Shift 加速至 1%，Alt+←/→ 跳到相邻关键帧。Space
                播放/暂停，Home/End 跳到首尾。
              </p>
              <p>
                ① 点击图层或画布选中元素，拖动手柄变换。
                <br />② 拖动播放头，在属性旁点击 ◆ 添加关键帧。
                <br />③ 点击时间线中的 ◆，调整数值、位置和曲线。
                <br />④ 双击子合成图层继续编辑，使用“当前合成”返回。
                <br />⑤ 打开滚动预览，再导出独立 HTML。
              </p>
              <p>
                分组使用同级图层多选。自定义曲线拖动完成后点击“应用曲线”。所有图片保存在项目包内，无须原始文件路径。
              </p>
            </div>
          </div>
        </div>
      )}
      <input
        hidden
        ref={projectInput}
        type="file"
        accept=".json,.scrollweave.json"
        onChange={(e) => {
          if (e.target.files?.[0]) importProject(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <input
        hidden
        ref={imageInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={(e) => {
          if (e.target.files?.[0]) importImage(e.target.files[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}
