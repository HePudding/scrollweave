import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  Boxes,
  Check,
  ChevronRight,
  CircleHelp,
  Code2,
  Copy,
  Diamond,
  Download,
  FilePlus2,
  Film,
  FolderOpen,
  ImageIcon,
  Layers,
  LoaderCircle,
  MousePointer2,
  Pause,
  Play,
  Plus,
  Redo2,
  Search,
  Settings2,
  Square,
  Type,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { AnimationPanel, propertyNames, type KeyEdit } from "./AnimationPanel";
import { addPropertyKeys, pairedKeys } from "../core/animation-edit";
import { Canvas, propertyCommands } from "./Canvas";
import { Timeline } from "./Timeline";
import { SourceComposition } from "./SourceComposition";
import { TextField } from "./TextField";
import { ProjectHome } from "./ProjectHome";
import { AgentPanel } from "./AgentPanel";
import {
  assetURL,
  thumbnailURL,
  createElement,
  references,
  uid,
  clone,
  properties,
  type Project,
  type Element,
  type Asset,
  type AnimProperty,
  type Keyframe,
} from "../core/model";
import {
  sampleElement,
  parentTime,
  sourceTime,
  globalTime,
} from "../core/evaluate";
import type { Command, Snapshot } from "../core/commands";
import { findAvailableTrack } from "../core/placement";
const connectionMessage = "本地服务连接中断，正在重新连接。恢复后可继续编辑。";
const names: Record<string, string> = {
  image: "图片",
  svg: "SVG",
  video: "视频",
  composition: "复合片段",
  shape: "形状",
  text: "文字",
  group: "分组",
  custom: "扩展",
};
type Workspace = {
  directory: string;
  assetDirectory: string;
  projectFile: string;
  agentInstructions: string;
  mcpUrl: string;
  watcherReady: boolean;
  pendingImports: number;
  revision: number;
};
function NumberField({
  label,
  value,
  onCommit,
  revision,
  step = 0.1,
  disabled = false,
}: {
  label: string;
  value: number;
  onCommit: (value: number, revision: number) => void;
  revision: number;
  step?: number;
  disabled?: boolean;
}) {
  // Playback values render directly. Only a focused input keeps a local draft;
  // copying every animation frame into state creates a passive update cascade.
  const [draft, setDraft] = useState<string | null>(null),
    initial = useRef(""),
    captured = useRef(revision);
  const formatted = String(Math.round(value * 10000) / 10000);
  return (
    <input
      aria-label={label}
      type="number"
      step={step}
      disabled={disabled}
      value={draft ?? formatted}
      onFocus={(event) => {
        initial.current = event.currentTarget.value;
        setDraft(event.currentTarget.value);
        captured.current = revision;
      }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      onBlur={(event) => {
        const text = event.currentTarget.value,
          number = Number(text);
        setDraft(null);
        if (
          text !== initial.current &&
          text !== "" &&
          Number.isFinite(number) &&
          number !== value
        )
          onCommit(number, captured.current);
      }}
    />
  );
}
const megabytes = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
/** Native modal dialog: focus trap, Escape and inert background come from the platform. */
function EditorDialog({
  className,
  label,
  onClose,
  closeOnBackdrop = false,
  children,
}: {
  className: string;
  label: string;
  onClose: () => void;
  closeOnBackdrop?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current!,
      previous = document.activeElement as HTMLElement | null;
    node.showModal();
    return () => {
      node.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        if (!closeOnBackdrop || event.target !== event.currentTarget) return;
        const r = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < r.left ||
          event.clientX > r.right ||
          event.clientY < r.top ||
          event.clientY > r.bottom
        )
          onClose();
      }}
    >
      {children}
    </dialog>
  );
}
export function App() {
  const [route, setRoute] = useState(location.pathname);
  useEffect(() => {
    const changed = () => setRoute(location.pathname);
    window.addEventListener("popstate", changed);
    return () => window.removeEventListener("popstate", changed);
  }, []);
  const navigate = (path: string) => {
    history.pushState(null, "", path);
    setRoute(path);
  };
  return route === "/editor" ? (
    <Editor onHome={() => navigate("/")} />
  ) : (
    <ProjectHome onEnter={() => navigate("/editor")} />
  );
}

function Editor({ onHome }: { onHome: () => void }) {
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [source] = useState(() => uid("ui"));
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    state = useRef<Snapshot | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null),
    [time, setTime] = useState(0),
    timeRef = useRef(0),
    [playing, setPlaying] = useState(false),
    playingRef = useRef(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [connected, setConnected] = useState(false),
    [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [assetId, setAssetId] = useState<string | null>(null),
    [confirmArchive, setConfirmArchive] = useState(false),
    [tab, setTab] = useState<"library" | "page">("library");
  useEffect(() => setConfirmArchive(false), [assetId]);
  const [autoKey, setAutoKey] = useState(false),
    [snap, setSnap] = useState(true),
    [linked, setLinked] = useState(false),
    [placement, setPlacement] = useState<"place" | "insert" | "overwrite">(
      "place",
    ),
    [previewMode, setPreviewMode] = useState<"edit" | "scroll">("edit");
  const [activeProperty, setActiveProperty] = useState<AnimProperty>("x");
  const [keyEdit, setKeyEdit] = useState<KeyEdit | null>(null),
    [navigation, setNavigation] = useState<string[]>([]),
    [dialog, setDialog] = useState<"workspace" | "help" | null>(null),
    [directory, setDirectory] = useState(""),
    [newName, setNewName] = useState("新作品");
  const [clipboard, setClipboard] = useState<Element[]>([]),
    mediaInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    replaceInput = useRef<HTMLInputElement>(null),
    iframe = useRef<HTMLIFrameElement>(null),
    importAsCompound = useRef(false);
  const [download, setDownload] = useState<{
    download: string;
    format: string;
  } | null>(null);
  const scrollFrame = useRef<{
    revision: number;
    ready: boolean;
    progress: number;
    sectionId?: string;
  }>({ revision: -1, ready: false, progress: 0 });
  const setPosition = (t: number) => {
    timeRef.current = t;
    setTime(t);
  };
  const report = (message: string) => {
    setError(
      /failed to fetch|networkerror|load failed/i.test(message)
        ? connectionMessage
        : message,
    );
    setNotice("");
  };
  async function readJSON(path: string, init?: RequestInit) {
    let response: Response;
    try {
      response = await fetch(path, init);
    } catch {
      setConnected(false);
      setPlaying(false);
      throw Error(connectionMessage);
    }
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409) accept(await readJSON("/api/state"));
      throw Error(result.error ?? "操作失败，请重试");
    }
    return result;
  }
  const accept = (next: Snapshot, initial = false) => {
    if (
      state.current &&
      next.project.id === state.current.project.id &&
      next.revision < state.current.revision
    )
      return;
    // A same-revision snapshot can be fetched before a local selection lands and
    // arrive after it; keep the local selection and preview. Other clients'
    // selection changes arrive through "session" events instead.
    if (
      !initial &&
      state.current &&
      next.project.id === state.current.project.id &&
      next.revision === state.current.revision
    )
      next = {
        ...next,
        selection: state.current.selection,
        preview: state.current.preview,
      };
    const changed =
      next.project.id !== state.current?.project.id ||
      next.selection.compositionId !== state.current?.selection.compositionId;
    state.current = next;
    setSnapshot(next);
    if (initial || changed) {
      setPosition(next.preview.progress);
      setNavigation([]);
    }
  };
  async function request(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<any> {
    return readJSON("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, args }),
    });
  }
  async function action(name: string, args: Record<string, unknown> = {}) {
    try {
      setError("");
      return await request(name, args);
    } catch (e) {
      report((e as Error).message);
    }
  }
  const refreshWorkspace = async () => {
    try {
      const w = await readJSON("/api/workspace");
      setWorkspace(w);
      setDirectory(w.directory);
    } catch (error) {
      report((error as Error).message);
    }
  };
  const reconnect = async () => {
    try {
      const s = await readJSON("/api/state");
      accept(s, !state.current);
      await refreshWorkspace();
      setError((previous) => (previous === connectionMessage ? "" : previous));
    } catch (error) {
      report((error as Error).message);
    }
  };
  useEffect(() => {
    if (snapshot) document.title = snapshot.project.name + " · ScrollWeave";
  }, [snapshot?.project.name]);
  useEffect(() => {
    let alive = true;
    void readJSON("/api/state")
      .then((s) => {
        // The SSE connection pushes its own snapshot and may win this race.
        if (alive) accept(s, !state.current);
      })
      .catch((e) => report(e.message));
    void refreshWorkspace();
    const events = new EventSource("/api/events");
    events.onopen = () => {
      if (alive) {
        setConnected(true);
        void reconnect();
      }
    };
    events.onerror = () => {
      setConnected(false);
      setPlaying(false);
    };
    events.addEventListener("state", (event) => {
      const s = JSON.parse(event.data);
      accept(s);
    });
    events.addEventListener("workspace", () => {
      state.current = null;
      void refreshWorkspace();
      setPlaying(false);
      setNavigation([]);
    });
    events.addEventListener("session", (event) => {
      const session = JSON.parse(event.data);
      if (session.source === source || !state.current) return;
      setPlaying(false);
      playingRef.current = false;
      const next = {
        ...state.current,
        selection: session.selection,
        preview: session.preview,
      };
      state.current = next;
      setSnapshot(next);
      setPosition(session.preview.progress);
      iframe.current?.contentWindow?.postMessage(
        {
          type: "scrollweave:seek",
          progress: session.preview.progress,
          sectionId: session.preview.sectionId,
        },
        location.origin,
      );
    });
    const mediaError = (event: Event) => report((event as CustomEvent).detail);
    window.addEventListener("sw-media-error", mediaError);
    return () => {
      alive = false;
      events.close();
      window.removeEventListener("sw-media-error", mediaError);
    };
  }, []);
  useEffect(() => {
    playingRef.current = playing;
    if (!playing) return;
    let frame = 0,
      last = performance.now(),
      sent = 0;
    const tick = (now: number) => {
      const s = state.current;
      if (!s) return;
      const c = s.project.compositions[s.selection.compositionId],
        next = Math.min(c.duration, timeRef.current + (now - last) / 1000);
      last = now;
      setPosition(next);
      if (now - sent > 250 || next === c.duration) {
        sent = now;
        void action("set_preview", {
          compositionId: c.id,
          progress: next,
          source,
        });
      }
      if (next >= c.duration) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  const commit = async (
    commands: Command[],
    label: string,
    revision = state.current!.revision,
  ) => {
    setPlaying(false);
    const result = await action("edit_project", {
      commands,
      label,
      expectedRevision: revision,
    });
    if (result) {
      try {
        accept(await readJSON("/api/state"));
      } catch (error) {
        report((error as Error).message);
      }
    }
  };
  const select = (ids: string[]) => {
    const s = state.current!;
    const selection = {
      compositionId: s.selection.compositionId,
      elementIds: ids,
    };
    state.current = { ...s, selection };
    setSnapshot(state.current);
    setKeyEdit(null);
    const element = s.project.compositions[
      s.selection.compositionId
    ].elements.find((e) => e.id === ids[0]);
    if (element && !element.tracks[activeProperty]?.length)
      setActiveProperty(
        properties.find((property) => element.tracks[property]?.length) ?? "x",
      );
    void action("set_selection", { ...selection, source });
  };
  const seek = (at: number, final = false) => {
    const s = state.current;
    if (!s) return;
    const c = s.project.compositions[s.selection.compositionId],
      t = Math.min(c.duration, Math.max(0, at));
    setPlaying(false);
    setPosition(t);
    if (previewMode === "scroll")
      iframe.current?.contentWindow?.postMessage(
        {
          type: "scrollweave:seek",
          progress: t,
          sectionId: s.preview.sectionId,
        },
        location.origin,
      );
    if (final)
      void action("set_preview", { compositionId: c.id, progress: t, source });
  };
  const enter = async (id: string, back = false) => {
    const s = state.current!;
    setPlaying(false);
    if (!back) setNavigation((n) => [...n, s.selection.compositionId]);
    const result = await action("set_preview", {
      compositionId: id,
      progress: 0,
      source,
    });
    if (result) {
      const selection = { compositionId: id, elementIds: [] };
      state.current = { ...s, selection, preview: result };
      setSnapshot(state.current);
      setPosition(0);
      void action("set_selection", { ...selection, source });
      setKeyEdit(null);
    }
  };
  const addTrack = async () => {
    const s = state.current!,
      id = uid("track");
    await commit(
      [
        {
          type: "track.add",
          compositionId: s.selection.compositionId,
          track: {
            id,
            name:
              "轨道 " +
              (s.project.compositions[s.selection.compositionId].tracks.length +
                1),
          },
        },
      ],
      "添加轨道",
    );
    return id;
  };
  const insert = async (id: string, trackId?: string, at = timeRef.current) => {
    const s = state.current!,
      cid = s.selection.compositionId,
      c = s.project.compositions[cid],
      asset = s.project.assets[id];
    if (!asset) return;
    const commands: Command[] = [];
    const duration =
      asset.kind === "video"
        ? (asset.duration ?? 5)
        : asset.kind === "composition"
          ? s.project.compositions[asset.compositionId!].duration
          : 5;
    if (!trackId) {
      const available = findAvailableTrack(
        c,
        [{ start: at, end: at + duration }],
        c.elements.find((e) => s.selection.elementIds.includes(e.id))?.trackId,
      );
      if (available) trackId = available.id;
      else {
        trackId = uid("track");
        commands.push({
          type: "track.add",
          compositionId: cid,
          track: { id: trackId, name: "轨道 " + (c.tracks.length + 1) },
        });
      }
    }
    const newId = uid("clip");
    commands.push({
      type: "clip.insert",
      compositionId: cid,
      assetId: id,
      trackId,
      at,
      newId,
      mode: placement,
    });
    await commit(commands, "放入素材");
    if (
      state.current?.project.compositions[cid]?.elements.some(
        (e) => e.id === newId,
      )
    )
      select([newId]);
  };
  const importFiles = async (
    files: File[],
    trackId?: string,
    at = timeRef.current,
    replaceId?: string,
  ) => {
    setBusy(true);
    let cursor = at;
    try {
      for (const file of files) {
        const response = await fetch("/api/import", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-File-Name": encodeURIComponent(file.name),
            ...(replaceId ? { "X-Replace-Id": replaceId } : {}),
          },
          body: file,
        });
        const result = await response.json();
        if (!response.ok || result.asset?.status === "error")
          throw Error(result.error ?? result.asset?.error ?? "导入失败");
        accept(await (await fetch("/api/state")).json());
        if (trackId) {
          await insert(result.asset.id, trackId, cursor);
          cursor += result.asset.kind === "video" ? result.asset.duration : 5;
        }
      }
      setNotice(
        trackId
          ? "文件已导入并创建片段"
          : replaceId
            ? "素材已重新关联，已有剪辑与关键帧保留"
            : "素材已进入素材库，可以预览或拖入时间线",
      );
    } catch (e) {
      report((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const create = (type: "text" | "shape") => {
    const s = state.current!,
      cid = s.selection.compositionId,
      c = s.project.compositions[cid],
      at = timeRef.current,
      available = findAvailableTrack(
        c,
        [{ start: at, end: at + 5 }],
        c.elements.find((e) => s.selection.elementIds.includes(e.id))?.trackId,
      ),
      trackId = available?.id ?? uid("track"),
      id = uid("clip");
    void commit(
      [
        ...(!available
          ? [
              {
                type: "track.add",
                compositionId: cid,
                track: { id: trackId, name: "轨道 " + (c.tracks.length + 1) },
              } as Command,
            ]
          : []),
        {
          type: "element.add",
          compositionId: cid,
          element: createElement({
            id,
            type,
            name: type === "text" ? "新的文字" : "矩形",
            text: type === "text" ? "让素材，讲一个故事。" : "",
            trackId,
            start: timeRef.current,
            end: timeRef.current + 5,
            x: type === "text" ? 160 : 710,
            y: type === "text" ? 170 : 290,
            width: type === "text" ? 1500 : 500,
            height: type === "text" ? 140 : 500,
            radius: type === "shape" ? 40 : 0,
            fontSize: 90,
            fill: "#c4f36b",
          }),
        },
      ],
      "添加" + names[type],
    ).then(() => {
      if (
        state.current?.project.compositions[c.id].elements.some(
          (e) => e.id === id,
        )
      )
        select([id]);
    });
  };
  const copy = () => {
    const s = state.current!,
      c = s.project.compositions[s.selection.compositionId],
      ids = new Set(s.selection.elementIds);
    let count = -1;
    while (count !== ids.size) {
      count = ids.size;
      for (const e of c.elements)
        if (e.parentId && ids.has(e.parentId)) ids.add(e.id);
    }
    setClipboard(clone(c.elements.filter((e) => ids.has(e.id))));
    setNotice(
      "已复制 " +
        s.selection.elementIds.length +
        " 个片段；Ctrl+V 在播放头粘贴，优先使用已有轨道",
    );
  };
  const paste = async () => {
    if (!clipboard.length) return;
    const s = state.current!,
      cid = s.selection.compositionId,
      c = s.project.compositions[cid],
      roots = clipboard.filter(
        (e) => !clipboard.some((x) => x.id === e.parentId),
      ),
      first = Math.min(...roots.map((e) => e.start)),
      available =
        new Set(clipboard.map((e) => e.trackId)).size === 1
          ? findAvailableTrack(
              c,
              roots.map((e) => ({
                start: e.start + timeRef.current - first,
                end: e.end + timeRef.current - first,
              })),
              c.elements.find((e) => s.selection.elementIds.includes(e.id))
                ?.trackId,
            )
          : undefined,
      id = available?.id ?? uid("track");
    await commit(
      [
        ...(!available
          ? [
              {
                type: "track.add",
                compositionId: cid,
                track: { id, name: "轨道 " + (c.tracks.length + 1) },
              } as Command,
            ]
          : []),
        {
          type: "clips.paste",
          compositionId: cid,
          elements: clipboard,
          at: timeRef.current,
          trackId: id,
        },
      ],
      "粘贴片段",
    );
  };
  const remove = (ripple = false) => {
    const s = state.current!;
    if (!s.selection.elementIds.length) return;
    void commit(
      [
        {
          type: "clips.delete",
          compositionId: s.selection.compositionId,
          elementIds: s.selection.elementIds,
          ripple,
          linked,
        },
      ],
      ripple ? "波纹删除" : "删除片段 · 保留空隙",
    );
  };
  const split = () => {
    const s = state.current!,
      cid = s.selection.compositionId,
      c = s.project.compositions[cid],
      chosen = c.elements.filter((e) => s.selection.elementIds.includes(e.id));
    if (
      chosen.some((e) => timeRef.current <= e.start || timeRef.current >= e.end)
    ) {
      report("播放头需要位于每个选中片段内部");
      return;
    }
    void commit(
      chosen.map((e) => ({
        type: "element.split",
        compositionId: cid,
        elementId: e.id,
        at: timeRef.current,
        newId: uid("clip"),
      })),
      "分割片段",
    );
  };
  const compound = () => {
    const s = state.current!;
    if (!s.selection.elementIds.length) return;
    void commit(
      [
        {
          type: "compound.create",
          compositionId: s.selection.compositionId,
          elementIds: s.selection.elementIds,
          newId: uid("comp"),
          name: "复合片段 " + Object.keys(s.project.compositions).length,
        },
      ],
      "创建共享复合片段",
    );
  };
  const history = async (name: "undo" | "redo") => {
    setPlaying(false);
    await action(name, { expectedRevision: state.current!.revision });
    accept(await (await fetch("/api/state")).json());
  };
  const togglePlay = () => {
    if (previewMode !== "edit") return;
    if (
      !playing &&
      timeRef.current >=
        state.current!.project.compositions[
          state.current!.selection.compositionId
        ].duration
    )
      setPosition(0);
    setPlaying((p) => !p);
  };
  function addKeys(
    channels: AnimProperty[],
    focus: AnimProperty = channels[0],
  ) {
    const s = state.current;
    if (!s || s.selection.elementIds.length !== 1) return;
    const cid = s.selection.compositionId,
      c = s.project.compositions[cid];
    const element = c.elements.find((e) => e.id === s.selection.elementIds[0]);
    if (
      !element ||
      element.locked ||
      c.tracks.find((t) => t.id === element.trackId)?.locked
    )
      return;
    const at = sourceTime(
      element,
      parentTime(s.project, cid, element, timeRef.current),
    );
    if (
      at < element.sourceIn - 1e-5 ||
      at >
        element.sourceIn + (element.end - element.start) * element.speed + 1e-5
    ) {
      report("请先把播放头移到所选素材的时间范围内");
      return;
    }
    const commands = addPropertyKeys(
      s.project,
      cid,
      element,
      timeRef.current,
      channels,
    );
    const command = commands.find(
      (c) => c.type === "keyframe.set" && c.property === focus,
    );
    setActiveProperty(focus);
    void commit(commands, "添加关键帧", s.revision).then(() => {
      if (command?.type === "keyframe.set")
        setKeyEdit({
          elementId: element.id,
          property: focus,
          keyId: command.keyframe.id,
        });
    });
  }
  function navigateKey(direction: -1 | 1) {
    const s = state.current;
    if (!s || s.selection.elementIds.length !== 1) return;
    const cid = s.selection.compositionId,
      element = s.project.compositions[cid].elements.find(
        (e) => e.id === s.selection.elementIds[0],
      );
    if (!element) return;
    const keys = (element.tracks[activeProperty] ?? []).map((key) => ({
      key,
      time: globalTime(s.project, cid, element, key.at),
    }));
    const candidate =
      direction === 1
        ? keys.find((k) => k.time > timeRef.current + 1e-5)
        : keys.filter((k) => k.time < timeRef.current - 1e-5).at(-1);
    if (candidate) {
      seek(candidate.time, true);
      setKeyEdit({
        elementId: element.id,
        property: activeProperty,
        keyId: candidate.key.id,
      });
    }
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        (event.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable=true],[role=slider],[role=separator],.agent-dock,.agent-settings",
        ) ||
        dialog ||
        agentSettingsOpen ||
        assetId
      )
        return;
      if (!state.current) return;
      // Space activates focused controls; only unfocused Space toggles playback.
      if (
        event.code === "Space" &&
        (event.target as HTMLElement)?.closest(
          "button,a[href],summary,[role=button],[role=menuitem]",
        )
      )
        return;
      const mod = event.ctrlKey || event.metaKey;
      if (!mod && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (event.shiftKey) setAutoKey((v) => !v);
        else if (!event.repeat) addKeys(["x", "y"]);
      }
      if (!mod && !event.altKey && (event.key === "[" || event.key === "]")) {
        event.preventDefault();
        navigateKey(event.key === "[" ? -1 : 1);
      }
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      }
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void history(event.shiftKey ? "redo" : "undo");
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        void history("redo");
      }
      if (mod && event.key.toLowerCase() === "a") {
        event.preventDefault();
        const s = state.current!;
        select(
          s.project.compositions[s.selection.compositionId].elements
            .filter((e) => !e.parentId)
            .map((e) => e.id),
        );
      }
      if (mod && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copy();
      }
      if (mod && event.key.toLowerCase() === "v") {
        event.preventDefault();
        void paste();
      }
      if (mod && event.key.toLowerCase() === "b") {
        event.preventDefault();
        split();
      }
      if (event.altKey && event.key.toLowerCase() === "g") {
        event.preventDefault();
        compound();
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        if (keyEdit) {
          const s = state.current!;
          const element = s.project.compositions[
            s.selection.compositionId
          ].elements.find((e) => e.id === keyEdit.elementId);
          const frame = element?.tracks[keyEdit.property]?.find(
            (k) => k.id === keyEdit.keyId,
          );
          if (element && frame)
            void commit(
              pairedKeys(element, keyEdit.property, frame).map(
                ({ property, key }) => ({
                  type: "keyframe.delete",
                  compositionId: s.selection.compositionId,
                  elementId: element.id,
                  property,
                  keyframeId: key.id,
                }),
              ),
              "删除关键帧",
            );
          setKeyEdit(null);
        } else remove(event.shiftKey);
      }
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        seek(
          timeRef.current +
            (event.key === "ArrowRight" ? 1 : -1) *
              (event.shiftKey ? 1 : 1 / 30),
          true,
        );
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    let sent = 0;
    const message = (event: MessageEvent) => {
      if (
        event.source !== iframe.current?.contentWindow ||
        event.origin !== location.origin ||
        previewMode !== "scroll"
      )
        return;
      if (event.data?.type === "scrollweave:ready") {
        scrollFrame.current.ready = true;
        return;
      }
      if (
        event.data?.type !== "scrollweave:progress" ||
        !scrollFrame.current.ready
      )
        return;
      const position = event.data.position;
      setPosition(position.progress);
      if (performance.now() - sent > 250) {
        sent = performance.now();
        void action("set_preview", {
          compositionId: position.compositionId,
          sectionId: position.sectionId,
          progress: position.progress,
          source,
        });
      }
      const s = state.current;
      if (s)
        state.current = {
          ...s,
          preview: {
            compositionId: position.compositionId,
            sectionId: position.sectionId,
            progress: position.progress,
          },
        };
      if (s && s.selection.compositionId !== position.compositionId) {
        state.current = {
          ...s,
          selection: { compositionId: position.compositionId, elementIds: [] },
          preview: position,
        };
        setSnapshot(state.current);
      }
    };
    window.addEventListener("message", message);
    return () => window.removeEventListener("message", message);
  }, [previewMode]);
  if (!snapshot)
    return (
      <div className="loading">
        <LoaderCircle className="spin" />
        正在打开作品…{error && <p>{error}</p>}
      </div>
    );
  const { project, revision, selection } = snapshot,
    cid = selection.compositionId,
    c = project.compositions[cid],
    selected = selection.elementIds,
    e =
      selected.length === 1
        ? c.elements.find((e) => e.id === selected[0])
        : undefined;
  if (previewMode !== "scroll") scrollFrame.current.revision = -1;
  else if (scrollFrame.current.revision !== revision) {
    const candidates = project.sections.filter(
      (s) =>
        s.compositionId === cid &&
        timeRef.current >= s.start &&
        timeRef.current <= (s.end ?? c.duration),
    );
    const section =
      candidates.find((s) => s.id === state.current?.preview.sectionId) ??
      candidates[0] ??
      project.sections.find((s) => s.compositionId === cid);
    scrollFrame.current = {
      revision,
      ready: false,
      progress: timeRef.current,
      sectionId: section?.id,
    };
  }
  const value = e ? sampleElement(e, parentTime(project, cid, e, time)) : null,
    asset = assetId ? project.assets[assetId] : undefined;
  const assets = Object.values(project.assets).filter(
    (a) =>
      !a.archived &&
      (filter === "all" || a.kind === filter) &&
      a.name.toLowerCase().includes(query.toLowerCase()),
  );
  const update = (values: Partial<Element>, rev = revision) => {
    if (!e) return;
    void commit(
      propertyCommands(project, cid, e, time, values, autoKey),
      "修改片段属性",
      rev,
    );
  };
  const addKey = (property: AnimProperty) =>
    addKeys(
      property === "x" || property === "y" ? ["x", "y"] : [property],
      property,
    );
  const save = async (name: "save_project" | "export_html") => {
    setBusy(true);
    const result = await action(name, {
      expectedRevision: revision,
      filename:
        project.name
          .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, "_")
          .slice(0, 70) || "作品",
    });
    if (result) {
      setDownload(result);
      setNotice(
        name === "save_project"
          ? "作品已保存，可下载完整项目包" +
              (result.warnings?.length ? "；" + result.warnings.join("；") : "")
          : "导出完成：" + result.format,
      );
    }
    setBusy(false);
  };
  const sections = (next: Project["sections"]) =>
    void commit(
      [{ type: "project.update", patch: { sections: next } }],
      "修改滚动映射",
    );
  return (
    <div className="editor-shell">
      <h1 className="sr-only">{project.name} · ScrollWeave 编辑器</h1>
      <header className="app-header">
        <button aria-label="返回项目主页" title="返回项目主页" onClick={onHome}>
          <ArrowLeft size={18} />
        </button>
        <div className="brand">
          <span className="brand-mark">S</span>ScrollWeave
          <span className="version">02</span>
        </div>
        <span className="header-divider" />
        <TextField
          label="作品名称"
          className="project-name"
          value={project.name}
          revision={revision}
          onCommit={(name, r) =>
            void commit(
              [{ type: "project.update", patch: { name } }],
              "重命名作品",
              r,
            )
          }
        />
        <span className="save-state">
          <span className={connected ? "live-dot" : "offline-dot"} />
          {connected ? "已自动保存" : "连接中…"} · r{revision}
        </span>
        <div className="spacer" />
        <button
          title="作品目录 / 新建 / 打开"
          onClick={() => setDialog("workspace")}
        >
          <FolderOpen size={16} />
          作品
        </button>
        <button
          title="撤销 Ctrl+Z"
          aria-label="撤销"
          disabled={!snapshot.canUndo}
          onClick={() => void history("undo")}
        >
          <Undo2 size={16} />
        </button>
        <button
          title="重做 Ctrl+Shift+Z"
          aria-label="重做"
          disabled={!snapshot.canRedo}
          onClick={() => void history("redo")}
        >
          <Redo2 size={16} />
        </button>
        <button onClick={() => void save("save_project")} disabled={busy}>
          <Download size={16} />
          保存项目包
        </button>
        <button
          className="primary"
          onClick={() => void save("export_html")}
          disabled={busy}
        >
          <ArrowDownToLine size={16} />
          导出网页
        </button>
        <button
          title="设置 · 模型服务商"
          aria-label="设置 · 模型服务商"
          onClick={() => setAgentSettingsOpen(true)}
        >
          <Settings2 size={17} />
        </button>
        <button
          title="Agent 接入与快捷键"
          aria-label="Agent 接入与快捷键"
          onClick={() => setDialog("help")}
        >
          <CircleHelp size={18} />
        </button>
      </header>
      {!connected && (
        <div className="connection-banner" role="status">
          本地服务连接中断，正在自动重连
          <button onClick={() => void reconnect()}>重新连接</button>
        </div>
      )}
      {(error || notice) && (
        <div
          className={"message " + (error ? "error" : "success")}
          role={error ? "alert" : "status"}
        >
          <span>{error || notice}</span>
          {!error && download && (
            <a href={download.download} download>
              下载 · {download.format}
            </a>
          )}
          <button
            aria-label="关闭提示"
            onClick={() => {
              setError("");
              setNotice("");
            }}
          >
            <X size={14} />
          </button>
        </div>
      )}
      <AgentPanel
        projectId={project.id}
        projectName={project.name}
        workspace={workspace?.directory ?? ""}
        settingsOpen={agentSettingsOpen}
        onSettingsChange={setAgentSettingsOpen}
      />
      <div className="workspace-grid">
        <aside className="library-panel">
          <div className="panel-tabs">
            <button
              className={tab === "library" ? "active" : ""}
              aria-pressed={tab === "library"}
              onClick={() => setTab("library")}
            >
              <Boxes size={16} />
              素材库
            </button>
            <button
              className={tab === "page" ? "active" : ""}
              aria-pressed={tab === "page"}
              onClick={() => setTab("page")}
            >
              <Settings2 size={16} />
              滚动编排
            </button>
          </div>
          {tab === "library" ? (
            <>
              <div className="library-actions">
                <button
                  className="import-button"
                  onClick={() => mediaInput.current?.click()}
                  disabled={busy}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Upload size={16} />
                  )}
                  导入素材
                </button>
                <button
                  title="创建文字片段"
                  aria-label="创建文字片段"
                  onClick={() => create("text")}
                >
                  <Type size={18} />
                </button>
                <button
                  title="创建形状片段"
                  aria-label="创建形状片段"
                  onClick={() => create("shape")}
                >
                  <Square size={16} />
                </button>
              </div>
              <div className="asset-search">
                <Search size={15} />
                <input
                  aria-label="搜索素材"
                  placeholder="搜索素材…"
                  autoComplete="off"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="asset-filters">
                {[
                  ["all", "全部"],
                  ["video", "视频"],
                  ["image", "图片"],
                  ["svg", "SVG"],
                  ["composition", "复合"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    className={filter === id ? "active" : ""}
                    aria-pressed={filter === id}
                    onClick={() => setFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div
                className="asset-grid"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files.length)
                    void importFiles(Array.from(e.dataTransfer.files));
                }}
              >
                {assets.map((a) => (
                  <div
                    key={a.id}
                    draggable={a.status === "ready"}
                    data-testid={"asset-" + a.id}
                    className={
                      "asset-card " +
                      (a.status !== "ready" ? "asset-error" : "")
                    }
                    onDragStart={(event) => {
                      event.dataTransfer.setData(
                        "application/x-scrollweave-asset",
                        a.id,
                      );
                      event.dataTransfer.effectAllowed = "copy";
                    }}
                  >
                    <button
                      type="button"
                      className="asset-open"
                      aria-label={"预览素材 " + a.name}
                      onClick={() => {
                        setPlaying(false);
                        setAssetId(a.id);
                      }}
                    >
                      <span className="asset-thumb">
                        {a.kind === "composition" ? (
                          <Layers size={30} />
                        ) : thumbnailURL(a) ? (
                          <img
                            src={thumbnailURL(a)}
                            alt=""
                            width={a.width || undefined}
                            height={a.height || undefined}
                            loading="lazy"
                            draggable={false}
                          />
                        ) : (
                          <Film size={28} />
                        )}
                        <span className="asset-kind">{names[a.kind]}</span>
                        {a.duration !== undefined && (
                          <span className="asset-duration">
                            {a.duration.toFixed(1)}s
                          </span>
                        )}
                      </span>
                      <strong title={a.name}>{a.name}</strong>
                      <small>
                        {a.status === "ready"
                          ? a.width + " × " + a.height
                          : a.status === "missing"
                            ? "素材缺失 · 重新关联"
                            : "导入失败 · 查看原因"}
                      </small>
                    </button>
                    <button
                      type="button"
                      className="asset-add"
                      title={"添加 " + a.name + " 到时间线"}
                      aria-label={"添加 " + a.name + " 到时间线"}
                      disabled={a.status !== "ready"}
                      onClick={() => void insert(a.id)}
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                ))}
                {!assets.length && (
                  <div className="empty-library">
                    <div className="empty-art">
                      <ImageIcon size={34} />
                      <Film size={25} />
                    </div>
                    <h3>从一份素材开始</h3>
                    <p>
                      导入图片、SVG 或视频
                      <br />
                      预览，再拖入时间线
                    </p>
                    <button onClick={() => mediaInput.current?.click()}>
                      选择本地文件
                    </button>
                    <small>也可以让 Agent 写入 assets 文件夹</small>
                  </div>
                )}
              </div>
              {!!c.elements.length && (
                <details className="structure">
                  <summary>片段结构 · {c.elements.length}</summary>
                  <div>
                    {c.elements.map((node) => (
                      <button
                        key={node.id}
                        className={selected.includes(node.id) ? "active" : ""}
                        style={{ paddingLeft: node.parentId ? 24 : 10 }}
                        onClick={() => select([node.id])}
                        onDoubleClick={() => {
                          if (node.compositionId)
                            void enter(node.compositionId);
                        }}
                      >
                        {node.type === "composition"
                          ? "◈ "
                          : node.parentId
                            ? "↳ "
                            : ""}
                        {node.name}
                      </button>
                    ))}
                  </div>
                </details>
              )}
              <div className="library-footer">
                <span className="live-dot" />
                {workspace?.watcherReady
                  ? "素材文件夹正在同步"
                  : "连接素材文件夹"}
                <button
                  title="查看作品目录"
                  aria-label="查看作品目录"
                  onClick={() => {
                    void refreshWorkspace();
                    setDialog("workspace");
                  }}
                >
                  <FolderOpen size={14} />
                </button>
              </div>
            </>
          ) : (
            <div className="page-settings">
              <h3>让时间线跟随滚动</h3>
              <p>选择一段秒数，映射为页面距离。动画节奏和剪辑保持不变。</p>
              <label>
                跟随方式
                <select
                  aria-label="滚动跟随方式"
                  value={project.scroll.mode}
                  onChange={(event) =>
                    void commit(
                      [
                        {
                          type: "project.update",
                          patch: {
                            scroll: {
                              ...project.scroll,
                              mode: event.target.value as "exact" | "smooth",
                            },
                          },
                        },
                      ],
                      "滚动跟随方式",
                    )
                  }
                >
                  <option value="exact">精确跟随</option>
                  <option value="smooth">平滑追随</option>
                </select>
              </label>
              {project.scroll.mode === "smooth" && (
                <label>
                  追随时间 ms
                  <NumberField
                    label="平滑追随时间"
                    value={project.scroll.smoothing}
                    revision={revision}
                    onCommit={(smoothing) =>
                      void commit(
                        [
                          {
                            type: "project.update",
                            patch: { scroll: { ...project.scroll, smoothing } },
                          },
                        ],
                        "追随时间",
                      )
                    }
                  />
                </label>
              )}
              {project.sections.map((section, index) => (
                <div className="section-card" key={section.id}>
                  <div className="section-title">
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <TextField
                      label={"区间名称 " + index}
                      value={section.name}
                      revision={revision}
                      onCommit={(name) =>
                        sections(
                          project.sections.map((s) =>
                            s.id === section.id ? { ...s, name } : s,
                          ),
                        )
                      }
                    />
                    {project.sections.length > 1 && (
                      <button
                        title="移除滚动区间"
                        aria-label="移除滚动区间"
                        onClick={() =>
                          sections(
                            project.sections.filter((s) => s.id !== section.id),
                          )
                        }
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>
                  <label>
                    时间线
                    <select
                      aria-label={"区间时间线 " + index}
                      value={section.compositionId}
                      onChange={(event) =>
                        sections(
                          project.sections.map((s) =>
                            s.id === section.id
                              ? {
                                  ...s,
                                  compositionId: event.target.value,
                                  start: 0,
                                  end: null,
                                }
                              : s,
                          ),
                        )
                      }
                    >
                      {Object.values(project.compositions).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    页面行为
                    <select
                      value={section.kind}
                      onChange={(event) =>
                        sections(
                          project.sections.map((s) =>
                            s.id === section.id
                              ? {
                                  ...s,
                                  kind: event.target.value as "pin" | "flow",
                                }
                              : s,
                          ),
                        )
                      }
                    >
                      <option value="pin">固定舞台 · 在舞台内播放</option>
                      <option value="flow">随页面纵向经过</option>
                    </select>
                  </label>
                  <div className="field-grid">
                    <label>
                      从 / 秒
                      <NumberField
                        label={"区间起点 " + index}
                        value={section.start}
                        revision={revision}
                        onCommit={(start) =>
                          sections(
                            project.sections.map((s) =>
                              s.id === section.id ? { ...s, start } : s,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      到 / 秒
                      <NumberField
                        label={"区间终点 " + index}
                        value={
                          section.end ??
                          project.compositions[section.compositionId].duration
                        }
                        revision={revision}
                        onCommit={(end) =>
                          sections(
                            project.sections.map((s) =>
                              s.id === section.id ? { ...s, end } : s,
                            ),
                          )
                        }
                      />
                    </label>
                  </div>
                  <label>
                    滚动距离 / px
                    <NumberField
                      label={"滚动距离 " + index}
                      value={section.scrollDistance}
                      step={100}
                      revision={revision}
                      onCommit={(scrollDistance) =>
                        sections(
                          project.sections.map((s) =>
                            s.id === section.id ? { ...s, scrollDistance } : s,
                          ),
                        )
                      }
                    />
                  </label>
                  <div className="section-buttons">
                    <button
                      onClick={() =>
                        sections(
                          project.sections.map((s) =>
                            s.id === section.id
                              ? { ...s, start: 0, end: null }
                              : s,
                          ),
                        )
                      }
                    >
                      跟随整条时长
                    </button>
                    {index > 0 && (
                      <button
                        onClick={() => {
                          const next = [...project.sections];
                          [next[index - 1], next[index]] = [
                            next[index],
                            next[index - 1],
                          ];
                          sections(next);
                        }}
                      >
                        上移
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <button
                className="wide"
                onClick={() =>
                  sections([
                    ...project.sections,
                    {
                      id: uid("section"),
                      compositionId: cid,
                      kind: "pin",
                      scrollDistance: 3000,
                      start: 0,
                      end: null,
                      name: "滚动区间",
                    },
                  ])
                }
              >
                <Plus size={14} />
                增加页面区间
              </button>
              <p>
                横向展示：给片段或复合片段的 X
                位置添加关键帧即可。页面仍然纵向滚动。
              </p>
            </div>
          )}
        </aside>
        <main className="preview-panel">
          <div className="preview-toolbar">
            <div className="breadcrumbs">
              {navigation.length > 0 && (
                <button
                  title="返回外层时间线"
                  aria-label="返回外层时间线"
                  onClick={() => {
                    const next = [...navigation],
                      id = next.pop()!;
                    setNavigation(next);
                    void enter(id, true);
                  }}
                >
                  <ArrowLeft size={15} />
                </button>
              )}
              <span>{c.name}</span>
              {navigation.length > 0 && (
                <small>共享内容 · 修改会影响所有引用</small>
              )}
            </div>
            <div className="mode-switch">
              <button
                className={previewMode === "edit" ? "active" : ""}
                aria-pressed={previewMode === "edit"}
                onClick={() => {
                  setPreviewMode("edit");
                  setPlaying(false);
                }}
              >
                <MousePointer2 size={13} />
                剪辑预览
              </button>
              <button
                className={previewMode === "scroll" ? "active" : ""}
                aria-pressed={previewMode === "scroll"}
                onClick={() => {
                  setPreviewMode("scroll");
                  setPlaying(false);
                }}
              >
                <Code2 size={14} />
                滚动预览
              </button>
            </div>
          </div>
          <div className="stage-wrap">
            {previewMode === "edit" ? (
              <Canvas
                project={project}
                compositionId={cid}
                progress={time}
                revision={revision}
                selected={selected}
                autoKey={autoKey}
                playing={playing}
                zoom={1}
                onSelect={select}
                onCommit={commit}
              />
            ) : (
              <iframe
                title="滚动网页预览"
                ref={iframe}
                src={"/api/preview?r=" + revision}
                onLoad={() =>
                  iframe.current?.contentWindow?.postMessage(
                    {
                      type: "scrollweave:seek",
                      progress: scrollFrame.current.progress,
                      sectionId: scrollFrame.current.sectionId,
                    },
                    location.origin,
                  )
                }
              />
            )}
            {!c.elements.length && previewMode === "edit" && (
              <div className="empty-stage">
                <span>YOUR NEXT STORY</span>
                <h2>每个故事，都从素材开始。</h2>
                <p>从左侧拖入一份素材，或创建文字和形状。</p>
                <div>
                  <button onClick={() => mediaInput.current?.click()}>
                    <Upload size={15} />
                    导入素材
                  </button>
                  <button onClick={() => create("text")}>
                    <Type size={15} />
                    添加文字
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="transport">
            <span className="preview-size">
              {c.width} × {c.height}
              {previewMode === "scroll" ? " · 滚动默认静音" : ""}
            </span>
            <div>
              <button
                title="回到开始"
                aria-label="回到开始"
                onClick={() => seek(0, true)}
              >
                ↤
              </button>
              <button
                aria-label={playing ? "暂停" : "播放"}
                className="play-button"
                disabled={previewMode === "scroll"}
                onClick={togglePlay}
              >
                {playing ? <Pause size={17} /> : <Play size={17} />}
              </button>
              <NumberField
                label="播放头秒数"
                value={time}
                revision={revision}
                onCommit={(t) => seek(t, true)}
              />
              <span>/ {c.duration.toFixed(2)} s</span>
            </div>
            <span className="preview-size">
              {previewMode === "edit"
                ? "SPACE 播放 / 暂停"
                : "在预览内滚动查看作品"}
            </span>
          </div>
        </main>
        <aside className="inspector">
          <div className="panel-heading">
            <Settings2 size={15} />
            {e ? "片段属性" : selected.length ? "多选片段" : "作品信息"}
            <span className="spacer" />
            {e && <span className="type-tag">{names[e.type]}</span>}
          </div>
          <div className="inspector-body" key={e?.id ?? "overview"}>
            {e && value ? (
              <>
                <TextField
                  label="片段名称"
                  className="clip-name-input"
                  value={e.name}
                  revision={revision}
                  onCommit={(name, r) => update({ name }, r)}
                />
                <AnimationPanel
                  project={project}
                  cid={cid}
                  element={e}
                  time={time}
                  revision={revision}
                  autoKey={autoKey}
                  onAutoKey={() => setAutoKey((v) => !v)}
                  activeProperty={activeProperty}
                  onProperty={setActiveProperty}
                  keyEdit={keyEdit}
                  onKey={setKeyEdit}
                  onAddPosition={() => addKeys(["x", "y"])}
                  onNavigate={navigateKey}
                  onSeek={seek}
                  onCommit={commit}
                />
                {e.type === "text" && (
                  <div className="property-section">
                    <h4>文字</h4>
                    <TextField
                      label="文字内容"
                      multiline
                      value={e.text}
                      revision={revision}
                      onCommit={(text, r) => update({ text }, r)}
                    />
                    <label>
                      字号
                      <NumberField
                        label="字号"
                        value={e.fontSize}
                        revision={revision}
                        onCommit={(fontSize, r) => update({ fontSize }, r)}
                      />
                    </label>
                    <label>
                      文字颜色
                      <input
                        type="color"
                        aria-label="文字颜色"
                        value={e.color}
                        onChange={(event) =>
                          update({ color: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      点击链接
                      <TextField
                        label="点击链接"
                        value={e.href}
                        revision={revision}
                        onCommit={(href, r) => update({ href }, r)}
                        placeholder="https://…"
                      />
                    </label>
                  </div>
                )}
                {e.type === "shape" && (
                  <div className="property-section">
                    <h4>形状</h4>
                    <label>
                      填充
                      <input
                        type="color"
                        aria-label="形状填充"
                        value={e.fill}
                        onChange={(event) =>
                          update({ fill: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      圆角
                      <NumberField
                        label="圆角"
                        value={e.radius}
                        revision={revision}
                        onCommit={(radius, r) => update({ radius }, r)}
                      />
                    </label>
                  </div>
                )}
                <div className="property-section">
                  <h4>
                    剪辑范围 <span>秒</span>
                  </h4>
                  <div className="field-grid">
                    <label>
                      开始
                      <NumberField
                        label="片段开始"
                        value={e.start}
                        revision={revision}
                        onCommit={(start, r) =>
                          void commit(
                            [
                              {
                                type: "element.move",
                                compositionId: cid,
                                elementId: e.id,
                                delta: start - e.start,
                              },
                            ],
                            "移动片段",
                            r,
                          )
                        }
                      />
                    </label>
                    <label>
                      结束
                      <NumberField
                        label="片段结束"
                        value={e.end}
                        revision={revision}
                        onCommit={(end, r) =>
                          void commit(
                            [
                              {
                                type: "element.trim",
                                compositionId: cid,
                                elementId: e.id,
                                start: e.start,
                                end,
                              },
                            ],
                            "右裁边",
                            r,
                          )
                        }
                      />
                    </label>
                    <label>
                      左裁边
                      <NumberField
                        label="片段左裁边"
                        value={e.start}
                        revision={revision}
                        onCommit={(start, r) =>
                          void commit(
                            [
                              {
                                type: "element.trim",
                                compositionId: cid,
                                elementId: e.id,
                                start,
                                end: e.end,
                              },
                            ],
                            "左裁边",
                            r,
                          )
                        }
                      />
                    </label>
                    <label>
                      源起点
                      <NumberField
                        label="源起点"
                        value={e.sourceIn}
                        revision={revision}
                        onCommit={(sourceIn, r) => update({ sourceIn }, r)}
                      />
                    </label>
                  </div>
                  <label>
                    所在轨道
                    <select
                      aria-label="片段轨道"
                      value={e.trackId}
                      onChange={(event) =>
                        void commit(
                          [
                            {
                              type: "element.move",
                              compositionId: cid,
                              elementId: e.id,
                              delta: 0,
                              trackId: event.target.value,
                            },
                          ],
                          "跨轨移动",
                        )
                      }
                    >
                      {c.tracks.map((t, index) => (
                        <option value={t.id} key={t.id}>
                          轨道 {index + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    变速 · 保持源取用范围
                    <NumberField
                      label="播放速度"
                      value={e.speed}
                      revision={revision}
                      onCommit={(speed, r) =>
                        void commit(
                          [
                            {
                              type: "clip.speed",
                              compositionId: cid,
                              elementId: e.id,
                              speed,
                            },
                          ],
                          "明确变速",
                          r,
                        )
                      }
                    />
                  </label>
                </div>
                <div className="property-section">
                  <h4>
                    画面变换
                    <button
                      className={autoKey ? "active" : ""}
                      aria-pressed={autoKey}
                      onClick={() => setAutoKey((v) => !v)}
                      title="开启后，修改属性在播放头自动建立关键帧"
                    >
                      <Diamond size={12} />
                      自动关键帧
                    </button>
                  </h4>
                  {!value.visible && (
                    <p className="hint">
                      播放头在片段外。定位到片段内部添加关键帧。
                    </p>
                  )}
                  <div className="field-grid">
                    {properties.map((property) => (
                      <label key={property}>
                        {propertyNames[property]}
                        <div className="key-field">
                          <NumberField
                            label={propertyNames[property]}
                            value={value[property]}
                            revision={revision}
                            onCommit={(n, r) => update({ [property]: n }, r)}
                          />
                          <button
                            title={"添加关键帧 " + propertyNames[property]}
                            aria-label={"添加关键帧 " + propertyNames[property]}
                            disabled={!value.visible}
                            className={
                              e.tracks[property]?.some(
                                (k) => Math.abs(k.at - value.progress) < 0.015,
                              )
                                ? "key-active"
                                : ""
                            }
                            onClick={() => addKey(property)}
                          >
                            ◇
                          </button>
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="field-grid">
                    <label>
                      宽
                      <NumberField
                        label="片段宽度"
                        value={e.width}
                        revision={revision}
                        onCommit={(width, r) => update({ width }, r)}
                      />
                    </label>
                    <label>
                      高
                      <NumberField
                        label="片段高度"
                        value={e.height}
                        revision={revision}
                        onCommit={(height, r) => update({ height }, r)}
                      />
                    </label>
                  </div>
                </div>
                {["image", "svg", "video"].includes(e.type) && (
                  <div className="property-section">
                    <h4>
                      裁切 <span>% · 不修改源素材</span>
                    </h4>
                    <div className="field-grid">
                      {[
                        ["top", "上"],
                        ["right", "右"],
                        ["bottom", "下"],
                        ["left", "左"],
                      ].map(([side, label]) => (
                        <label key={side}>
                          {label}
                          <NumberField
                            label={"裁切" + label}
                            value={e.crop[side as "top"]}
                            revision={revision}
                            onCommit={(v, r) =>
                              update({ crop: { ...e.crop, [side]: v } }, r)
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {["video", "composition"].includes(e.type) && (
                  <div className="property-section">
                    <h4>声音</h4>
                    <label>
                      音量
                      <NumberField
                        label="音量"
                        value={e.volume}
                        revision={revision}
                        onCommit={(volume, r) => update({ volume }, r)}
                      />
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={e.muted}
                        onChange={(event) =>
                          update({ muted: event.target.checked })
                        }
                      />
                      静音
                    </label>
                    <p>普通播放有声，滚动预览始终静音。</p>
                  </div>
                )}
                {e.type === "composition" && (
                  <div className="property-section">
                    <h4>复合片段 · 共享内容</h4>
                    <p>
                      {
                        Object.values(project.compositions)
                          .flatMap((c) => c.elements)
                          .filter((n) => n.compositionId === e.compositionId)
                          .length
                      }{" "}
                      个实例引用此内容。内部修改会同时更新它们。
                    </p>
                    <button
                      className="wide"
                      onClick={() => void enter(e.compositionId!)}
                    >
                      进入内部时间线
                      <ChevronRight size={14} />
                    </button>
                    <button
                      className="wide"
                      onClick={() =>
                        void commit(
                          [
                            {
                              type: "compound.independent",
                              compositionId: cid,
                              elementId: e.id,
                            },
                          ],
                          "创建独立副本",
                        )
                      }
                    >
                      将此实例变为独立副本
                    </button>
                  </div>
                )}
                <div className="property-section">
                  <h4>显示与锁定</h4>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={e.hidden}
                      onChange={(event) =>
                        update({ hidden: event.target.checked })
                      }
                    />
                    隐藏片段
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={e.locked}
                      onChange={(event) =>
                        void commit(
                          [
                            {
                              type: "element.update",
                              compositionId: cid,
                              elementId: e.id,
                              patch: { locked: event.target.checked },
                            },
                          ],
                          "片段锁定",
                        )
                      }
                    />
                    锁定片段
                  </label>
                  {e.assetId && (
                    <button
                      className="wide"
                      onClick={() => setAssetId(e.assetId!)}
                    >
                      查看源素材与引用
                    </button>
                  )}
                </div>
              </>
            ) : selected.length > 1 ? (
              <div className="multi-selection">
                <Layers size={28} />
                <h3>{selected.length} 个片段已选中</h3>
                <p>可一起移动、复制、删除、分割和创建复合片段。</p>
                <p>
                  画布变换与属性编辑请单选。所有多选操作作用于全部选中片段。
                </p>
                <button className="wide" onClick={compound}>
                  创建复合片段
                </button>
                <button className="wide" onClick={() => remove(false)}>
                  删除所选 · 保留空隙
                </button>
              </div>
            ) : (
              <>
                <div className="project-overview">
                  <span className="overview-icon">
                    <Film size={25} />
                  </span>
                  <h3>{project.name}</h3>
                  <p>用时间编排，用滚动讲述。</p>
                  <dl>
                    <dt>画面</dt>
                    <dd>
                      {c.width} × {c.height}
                    </dd>
                    <dt>片段</dt>
                    <dd>{c.elements.filter((e) => !e.parentId).length} 个</dd>
                    <dt>轨道</dt>
                    <dd>{c.tracks.length} 条</dd>
                    <dt>素材</dt>
                    <dd>
                      {
                        Object.values(project.assets).filter((a) => !a.archived)
                          .length
                      }{" "}
                      份
                    </dd>
                  </dl>
                  <label>
                    时间线长度 / 秒
                    <NumberField
                      label="时间线长度"
                      value={c.duration}
                      revision={revision}
                      onCommit={(duration) =>
                        void commit(
                          [
                            {
                              type: "composition.update",
                              compositionId: cid,
                              patch: { duration },
                            },
                          ],
                          "设置编排时长",
                        )
                      }
                    />
                  </label>
                  <p>后续内容会自动延长时间线，前面的动画不会缩短。</p>
                  <label>
                    舞台背景
                    <input
                      type="color"
                      aria-label="舞台背景"
                      value={
                        c.background === "transparent"
                          ? "#101312"
                          : c.background
                      }
                      onChange={(event) =>
                        void commit(
                          [
                            {
                              type: "composition.update",
                              compositionId: cid,
                              patch: { background: event.target.value },
                            },
                          ],
                          "舞台背景",
                        )
                      }
                    />
                  </label>
                </div>
                <div className="getting-started">
                  <span>01</span>
                  <p>导入或生成素材</p>
                  <span>02</span>
                  <p>拖入时间线，剪辑与叠放</p>
                  <span>03</span>
                  <p>制作动画，再映射为滚动</p>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
      <Timeline
        project={project}
        cid={cid}
        time={time}
        selected={selected}
        revision={revision}
        snap={snap}
        mode={placement}
        linked={linked}
        onSnap={() => setSnap((v) => !v)}
        onMode={setPlacement}
        onLinked={() => setLinked((v) => !v)}
        onSelect={select}
        onSeek={seek}
        onCommit={commit}
        onInsert={(a, t, s) => void insert(a, t, s)}
        onFiles={(f, t, s) => void importFiles(f, t, s)}
        onSplit={split}
        onDelete={remove}
        onCopy={copy}
        onCompound={compound}
        onEnter={(id) => void enter(id)}
        onAddTrack={() => void addTrack()}
        activeProperty={activeProperty}
        selectedKeyId={keyEdit?.keyId}
        onKey={(e, property, k) => {
          if (!selected.includes(e.id)) select([e.id]);
          setActiveProperty(property);
          setKeyEdit({ elementId: e.id, property, keyId: k.id });
        }}
        onError={report}
      />
      <input
        ref={mediaInput}
        data-testid="media-import"
        type="file"
        multiple
        accept=".png,.jpg,.jpeg,.webp,.svg,.mp4,.webm"
        hidden
        onChange={(event) => {
          void importFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <input
        ref={projectInput}
        data-testid="project-import"
        type="file"
        accept=".json,.zip"
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            const r = await fetch(
                "/api/import-project?asCompound=" + importAsCompound.current,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/octet-stream" },
                  body: file,
                },
              ),
              result = await r.json();
            if (!r.ok) throw Error(result.error);
            accept(await (await fetch("/api/state")).json(), true);
            setNotice(
              importAsCompound.current
                ? "子项目已作为共享复合素材进入素材库"
                : "项目包已打开",
            );
          } catch (e) {
            report((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      {asset && (
        <EditorDialog
          className="asset-modal"
          label="源素材预览"
          closeOnBackdrop
          onClose={() => setAssetId(null)}
        >
          {/* Lives inside the modal so it is not inert while the dialog is open. */}
          <input
            ref={replaceInput}
            data-testid="media-relink"
            type="file"
            accept=".png,.jpg,.jpeg,.webp,.svg,.mp4,.webm"
            hidden
            onChange={(event) => {
              void importFiles(
                Array.from(event.target.files ?? []),
                undefined,
                0,
                asset.id,
              );
              event.target.value = "";
            }}
          />
          <div className="modal-heading">
            <div>
              <small>源素材预览 · 独立于作品播放头</small>
              <h3>{asset.name}</h3>
            </div>
            <button aria-label="关闭源素材" onClick={() => setAssetId(null)}>
              <X size={19} />
            </button>
          </div>
          <div className="source-preview">
            {asset.kind === "video" ? (
              <video
                key={asset.hash}
                controls
                src={assetURL(asset)}
                playsInline
              />
            ) : asset.kind === "composition" ? (
              <SourceComposition
                project={project}
                compositionId={asset.compositionId!}
              />
            ) : (
              <img key={asset.hash} src={assetURL(asset)} alt={asset.name} />
            )}
          </div>
          <div className="asset-meta">
            <span>{names[asset.kind]}</span>
            <span>
              {asset.width} × {asset.height}
            </span>
            {asset.duration !== undefined && (
              <span>{asset.duration.toFixed(3)} 秒</span>
            )}
            {asset.codec && (
              <span>
                {asset.codec}
                {asset.hasAudio ? " / " + asset.audioCodec : ""}
              </span>
            )}
            <span>
              {megabytes.format(asset.size / 1024 / 1024)}
              {" "}MB
            </span>
          </div>
          {asset.status !== "ready" && (
            <p className="error-text">{asset.error}</p>
          )}
          {asset.warnings.map((w, i) => (
            <p key={i} className="warning-text">
              {w}
            </p>
          ))}
          <div className="references">
            <b>引用 · {references(project, asset.id).length} 个片段</b>
            <p>
              {references(project, asset.id)
                .map((r) => r.compositionName + " / " + r.name)
                .join("、") || "尚未用于时间线"}
            </p>
            {asset.path && <code>{asset.path}</code>}
            <p>重新关联会更新以上所有引用；位置、剪辑与关键帧保留。</p>
          </div>
          <div className="modal-actions">
            <button
              disabled={asset.kind === "composition"}
              onClick={() => replaceInput.current?.click()}
            >
              替换 / 重新关联源文件
            </button>
            <button
              className={confirmArchive ? "danger" : ""}
              disabled={references(project, asset.id).length > 0 || busy}
              title="仅移出素材库，保留源文件"
              onClick={async () => {
                if (!confirmArchive) {
                  setConfirmArchive(true);
                  return;
                }
                setBusy(true);
                const result = await action("archive_asset", {
                  assetId: asset.id,
                  expectedRevision: revision,
                });
                setBusy(false);
                if (result) setAssetId(null);
              }}
            >
              {confirmArchive ? "确认移出素材库" : "移出素材库"}
            </button>
            <span className="spacer" />
            <button
              className="primary"
              disabled={asset.status !== "ready"}
              onClick={() => {
                void insert(asset.id);
                setAssetId(null);
              }}
            >
              放到播放头
            </button>
          </div>
          {confirmArchive && (
            <p className="warning-text" role="status">
              再次点击确认移出。源文件会保留在磁盘上。
            </p>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </EditorDialog>
      )}
      {dialog && (
        <EditorDialog
          className="workspace-modal"
          label={dialog === "workspace" ? "作品目录" : "Agent 接入"}
          onClose={() => setDialog(null)}
        >
          <div className="modal-heading">
            <h3>
              {dialog === "workspace" ? "作品文件夹" : "与 Agent 一起创作"}
            </h3>
            <button aria-label="关闭对话框" onClick={() => setDialog(null)}>
              <X size={18} />
            </button>
          </div>
          <p>
            当前作品：<code>{workspace?.directory}</code>
          </p>
          <p>
            素材入口：<code>{workspace?.assetDirectory}</code>
          </p>
          {dialog === "workspace" ? (
            <>
              <p>
                作品目录与编辑器源码分开。把素材写入 assets，编辑器会自动发现。
              </p>
              <label>
                作品目录
                <input
                  aria-label="作品目录路径"
                  name="directory"
                  autoComplete="off"
                  spellCheck={false}
                  value={directory}
                  onChange={(e) => setDirectory(e.target.value)}
                />
              </label>
              <label>
                新作品名称
                <input
                  aria-label="新作品名称"
                  name="projectName"
                  autoComplete="off"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </label>
              <div className="modal-actions">
                {(
                  [
                    ["open_project", "打开目录", FolderOpen],
                    ["new_project", "在此新建", FilePlus2],
                  ] as const
                ).map(([name, label, Icon]) => (
                  <button
                    key={name}
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const result = await action(
                          name,
                          name === "open_project"
                            ? { directory }
                            : { directory, name: newName },
                        );
                        if (result) {
                          await refreshWorkspace();
                          accept(
                            await (await fetch("/api/state")).json(),
                            true,
                          );
                          setDialog(null);
                        }
                      } catch (e) {
                        report((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {busy ? (
                      <LoaderCircle className="spin" size={15} />
                    ) : (
                      <Icon size={15} />
                    )}
                    {label}
                  </button>
                ))}
              </div>
              {error && (
                <p className="error-text" role="alert">
                  {error}
                </p>
              )}
              <hr />
              <p>可编辑项目包包含完整结构和 assets，支持在其他目录打开。</p>
              <div className="modal-actions">
                <button
                  onClick={(event) => {
                    importAsCompound.current = false;
                    // The file input sits outside the modal; close first so it is not inert.
                    event.currentTarget.closest("dialog")?.close();
                    projectInput.current?.click();
                    setDialog(null);
                  }}
                >
                  打开项目包 / 旧版 JSON
                </button>
                <button
                  onClick={(event) => {
                    importAsCompound.current = true;
                    event.currentTarget.closest("dialog")?.close();
                    projectInput.current?.click();
                    setDialog(null);
                  }}
                >
                  导入为复合素材
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                在当前作品目录打开 Codex，按 AGENTS.md 将 SVG 写入 assets。用
                MCP 负责时间线编辑。
              </p>
              <label>
                MCP · Streamable HTTP
                <code className="code-block">{workspace?.mcpUrl}</code>
              </label>
              <code className="code-block">
                codex mcp add scrollweave --url {workspace?.mcpUrl}
              </code>
              <p>
                建议顺序：workspace_info → wait_for_asset → insert_asset →
                set_keyframe → get_preview_screenshot → save_project。
              </p>
              <p>
                例如：“生成 SVG 箭头，等待入库，放到第二轨第 3 秒，显示 2
                秒，添加淡入上移。”
              </p>
              <p>
                外部文件修改不参与时间线撤销。复合片段默认共享，可在属性面板创建独立副本。
              </p>
              <hr />
              <p>
                K 添加位置关键帧 · Shift+K 自动记录 · [ / ] 前后关键帧 · Space
                播放 / 暂停 · Ctrl+B 分割 · Ctrl+C/V 复制粘贴 · Shift 多选 ·
                Ctrl+A 全选 · Delete 留空 · Shift+Delete 波纹删除 · Alt+G
                复合片段 · Ctrl+Z / Ctrl+Shift+Z 撤销重做。
              </p>
            </>
          )}
        </EditorDialog>
      )}
    </div>
  );
}
