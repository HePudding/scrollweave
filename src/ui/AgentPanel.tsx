import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  LoaderCircle,
  MessageCircle,
  Plus,
  Settings2,
  Sparkles,
  Square,
  Terminal,
  X,
} from "lucide-react";
import type {
  AgentEntry,
  AgentSettings as Settings,
  AgentSnapshot,
} from "../core/agent-types";
import { AgentSettings, agentApi, providerInput } from "./AgentSettings";
import "./agent.css";

const toolNames: Record<string, string> = {
  read_project: "读取项目",
  validate_project: "检查项目",
  get_project: "读取项目",
  get_state: "读取编辑状态",
  workspace_info: "查看作品目录",
  get_workspace_info: "查看作品目录",
  list_assets: "读取素材",
  create_svg: "创建 SVG 素材",
  write_asset: "写入素材",
  import_asset: "导入素材",
  insert_asset: "添加素材到时间线",
  get_preview_screenshot: "检查预览",
  apply_commands: "编辑时间线",
  edit_project: "编辑项目",
  set_keyframe: "设置关键帧",
  save_project: "保存项目",
  export_html: "导出网页",
};

function downloadUrl(text: string): string | undefined {
  const candidate = text.match(/\/exports\/[a-zA-Z0-9_%().!~*'-]+/)?.[0];
  if (!candidate) return;
  try {
    const file = decodeURIComponent(candidate.slice("/exports/".length));
    if (file && file !== "." && file !== ".." && !/[\\/\x00-\x1f]/.test(file))
      return candidate;
  } catch {
    /* Incomplete streamed links are rendered as text. */
  }
}

function isLocalProvider(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname;
    return (
      hostname === "localhost" ||
      hostname === "[::1]" ||
      /^127\./.test(hostname)
    );
  } catch {
    return false;
  }
}

function Entry({ entry }: { entry: AgentEntry }) {
  const download =
    entry.status === "done" || entry.kind === "assistant"
      ? downloadUrl(entry.detail ?? entry.text)
      : undefined;
  if (entry.kind === "tool")
    return (
      <details className={`agent-tool ${entry.status ?? "done"}`}>
        <summary>
          {entry.status === "running" ? (
            <LoaderCircle size={14} className="agent-spin" />
          ) : entry.status === "error" ? (
            <CircleAlert size={14} />
          ) : (
            <Check size={14} />
          )}
          <span>
            {toolNames[entry.toolName ?? ""] ?? entry.text ?? "项目操作"}
            <small>{entry.detail || entry.text}</small>
          </span>
          <span className="agent-tool-result">
            {entry.status === "running"
              ? "执行中"
              : entry.status === "error"
                ? "失败"
                : entry.revision !== undefined
                  ? `r${entry.revision}`
                  : "完成"}
          </span>
          {download && (
            <a
              className="agent-download"
              href={download}
              download
              aria-label="下载 Agent 生成的作品"
              onClick={(e) => e.stopPropagation()}
            >
              <Download size={13} />
              下载
            </a>
          )}
          <ChevronDown size={13} />
        </summary>
        {entry.detail && <pre>{entry.detail}</pre>}
      </details>
    );
  if (entry.kind === "status")
    return (
      <div className="agent-inline-status">
        <span />
        {entry.text}
      </div>
    );
  return (
    <article className={`agent-message ${entry.kind}`}>
      <div className="agent-message-label">
        {entry.kind === "user"
          ? "你"
          : entry.kind === "error"
            ? "执行遇到问题"
            : "Pi"}
        {entry.kind === "assistant" && <Sparkles size={11} />}
      </div>
      <div className="agent-message-text">
        {entry.text || (entry.status === "running" ? "正在生成…" : "")}
      </div>
      {download && (
        <a className="agent-download" href={download} download>
          <Download size={13} />
          下载生成的作品
        </a>
      )}
    </article>
  );
}

export function AgentPanel({
  projectId,
  workspace,
  projectName,
  settingsOpen,
  onSettingsChange,
}: {
  projectId: string;
  workspace: string;
  projectName: string;
  settingsOpen: boolean;
  onSettingsChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false),
    [settings, setSettings] = useState<Settings | null>(null),
    [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null);
  const [connected, setConnected] = useState(false),
    [draft, setDraft] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [switching, setSwitching] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null),
    bubble = useRef<HTMLButtonElement>(null),
    feed = useRef<HTMLDivElement>(null),
    nearBottom = useRef(true),
    mounted = useRef(true),
    generation = useRef(0),
    streamVersion = useRef(0);
  const active = settings?.providers.find(
    (provider) => provider.id === settings.activeProviderId,
  );
  const enabledProviders =
    settings?.providers.filter((provider) => provider.enabled) ?? [];
  const ready = !!(
    active?.enabled &&
    active.model.trim() &&
    active.baseUrl.trim() &&
    (active.hasApiKey || isLocalProvider(active.baseUrl))
  );
  const running = snapshot?.running ?? false;
  const current =
    snapshot?.projectId === projectId && snapshot.workspace === workspace;
  useEffect(() => {
    mounted.current = true;
    const token = ++generation.current;
    setSnapshot(null);
    setConnected(false);
    setDraft("");
    setError("");
    setBusy(false);
    const controller = new AbortController();
    void agentApi<Settings>("/settings", "GET", undefined, controller.signal)
      .then(setSettings)
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      });
    const events = new EventSource("/api/agent/events");
    events.onopen = () => {
      if (generation.current === token) setConnected(true);
    };
    events.onerror = () => {
      if (generation.current === token) setConnected(false);
    };
    events.addEventListener("snapshot", (event) => {
      if (generation.current !== token) return;
      try {
        const next = JSON.parse((event as MessageEvent).data) as AgentSnapshot;
        if (next.projectId === projectId && next.workspace === workspace) {
          streamVersion.current++;
          setSnapshot(next);
          setConnected(true);
        } else {
          setSnapshot(null);
          setConnected(false);
        }
      } catch {
        setError("Agent 状态暂时无法读取，正在等待重新同步。");
      }
    });
    const refreshSettings = () => {
      void agentApi<Settings>("/settings", "GET", undefined, controller.signal)
        .then((next) => {
          if (generation.current === token) setSettings(next);
        })
        .catch(() => {});
    };
    window.addEventListener("focus", refreshSettings);
    return () => {
      mounted.current = false;
      generation.current++;
      controller.abort();
      events.close();
      window.removeEventListener("focus", refreshSettings);
    };
  }, [projectId, workspace]);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open && nearBottom.current && feed.current)
      feed.current.scrollTop = feed.current.scrollHeight;
  }, [snapshot, open]);
  const close = () => {
    setOpen(false);
    bubble.current?.focus();
  };
  const request = async (action: "prompt" | "abort" | "reset") => {
    if (
      busy ||
      !connected ||
      !current ||
      (action === "prompt" && (!ready || running || !draft.trim()))
    )
      return;
    const token = generation.current;
    const version = streamVersion.current;
    setBusy(true);
    setError("");
    try {
      const next = await agentApi<AgentSnapshot>(
        `/${action}`,
        "POST",
        action === "prompt" ? { message: draft.trim(), projectId } : {},
      );
      if (generation.current !== token || !mounted.current) return;
      if (
        streamVersion.current === version &&
        next.projectId === projectId &&
        next.workspace === workspace
      )
        setSnapshot(next);
      if (action === "prompt") {
        setDraft("");
        nearBottom.current = true;
      }
    } catch (e) {
      if (generation.current === token && mounted.current)
        setError((e as Error).message);
    } finally {
      if (generation.current === token && mounted.current) setBusy(false);
    }
  };
  const switchModel = async (providerId: string, model?: string) => {
    if (!settings || running || busy || switching) return;
    const token = generation.current;
    setSwitching(true);
    setError("");
    try {
      const next = await agentApi<Settings>("/settings", "PUT", {
        activeProviderId: providerId,
        providers: settings.providers.map((provider) => ({
          ...providerInput(provider),
          ...(provider.id === providerId && model ? { model } : {}),
        })),
      });
      if (generation.current === token && mounted.current) setSettings(next);
    } catch (e) {
      if (generation.current === token && mounted.current)
        setError((e as Error).message);
    } finally {
      if (generation.current === token && mounted.current) setSwitching(false);
    }
  };
  const stateLabel = !connected
    ? "正在连接"
    : running
      ? snapshot?.status || "正在编辑"
      : !ready
        ? "等待连接模型"
        : "准备就绪";
  return (
    <>
      <div
        className={`agent-dock ${open ? "expanded" : ""}`}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" && open) {
            e.preventDefault();
            close();
          }
        }}
      >
        {open && (
          <section
            className="agent-panel"
            aria-label="Pi 创作助手"
            id="pi-agent-panel"
          >
            <header className="agent-panel-header">
              <span className="agent-pi-mark">π</span>
              <div>
                <strong>Pi 创作助手</strong>
                <span>
                  <i
                    className={
                      running ? "working" : connected ? "online" : "offline"
                    }
                  />
                  {stateLabel}
                </span>
              </div>
              <button
                className="agent-icon-button"
                aria-label="新对话"
                title="清空对话，项目编辑会保留"
                disabled={
                  running || busy || !current || !snapshot?.entries.length
                }
                onClick={() => void request("reset")}
              >
                <Plus size={18} />
              </button>
              <button
                className="agent-icon-button"
                aria-label="模型服务商设置"
                onClick={() => onSettingsChange(true)}
              >
                <Settings2 size={17} />
              </button>
              <button
                className="agent-icon-button"
                aria-label="收起 Pi 助手"
                onClick={close}
              >
                <ChevronDown size={20} />
              </button>
            </header>
            <div className="agent-project-context">
              <span>
                <Terminal size={12} />
                当前作品
              </span>
              <strong title={workspace}>{projectName}</strong>
            </div>
            <div
              ref={feed}
              className="agent-feed"
              role="log"
              aria-label="Agent 实时编辑记录"
              aria-live="polite"
              aria-relevant="additions text"
              onScroll={(e) => {
                const node = e.currentTarget;
                nearBottom.current =
                  node.scrollHeight - node.scrollTop - node.clientHeight < 75;
              }}
            >
              {snapshot?.entries.length ? (
                snapshot.entries.map((entry) => (
                  <Entry key={entry.id} entry={entry} />
                ))
              ) : (
                <div className="agent-welcome">
                  <span className="agent-welcome-icon">
                    <Sparkles size={26} />
                  </span>
                  <h3>把想法交给 Pi</h3>
                  <p>
                    描述你想要的画面和动效。
                    <br />
                    我会查看当前作品，边编辑边反馈。
                  </p>
                  <div className="agent-suggestions">
                    {[
                      "介绍当前项目，给我三个动效建议",
                      "给标题添加柔和的淡入上移动画",
                      "检查时间线和滚动区间是否合理",
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => {
                          setDraft(suggestion);
                          input.current?.focus();
                        }}
                      >
                        {suggestion}
                        <ArrowUp size={13} />
                      </button>
                    ))}
                  </div>
                  <small>编辑会实时同步到画布与时间线</small>
                </div>
              )}
              {running && (
                <div className="agent-running" role="status">
                  <LoaderCircle size={14} className="agent-spin" />
                  <span>{snapshot?.status || "Pi 正在编辑项目…"}</span>
                  <span className="agent-working-dots">···</span>
                </div>
              )}
            </div>
            {!connected && (
              <div className="agent-connection-status" role="status">
                <LoaderCircle size={13} className="agent-spin" />
                正在连接本地 Agent，恢复后自动同步进度
              </div>
            )}
            {error && (
              <div className="agent-panel-error" role="alert">
                <CircleAlert size={15} />
                <span>{error}</span>
                <button
                  aria-label="关闭 Agent 错误"
                  onClick={() => setError("")}
                >
                  <X size={13} />
                </button>
              </div>
            )}
            {!ready && settings && (
              <button
                className="agent-setup-callout"
                onClick={() => onSettingsChange(true)}
              >
                <Settings2 size={16} />
                <span>
                  连接一个模型服务商
                  <small>填写 API 密钥并选择模型，即可开始</small>
                </span>
                <span>设置 →</span>
              </button>
            )}
            <form
              className="agent-composer"
              onSubmit={(e) => {
                e.preventDefault();
                void request("prompt");
              }}
            >
              <textarea
                ref={input}
                aria-label="给 Pi 的创作指令"
                placeholder={
                  running
                    ? "任务完成后，继续描述你的想法…"
                    : "描述你的创作想法…"
                }
                value={draft}
                maxLength={12000}
                rows={3}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void request("prompt");
                  }
                }}
              />
              <div className="agent-composer-footer">
                <span>Enter 发送 · Shift Enter 换行</span>
                {running ? (
                  <button
                    type="button"
                    className="agent-stop"
                    onClick={() => void request("abort")}
                    disabled={busy || !connected}
                  >
                    <Square size={12} fill="currentColor" />
                    停止
                  </button>
                ) : (
                  <button
                    className="agent-send"
                    type="submit"
                    aria-label="发送给 Pi"
                    disabled={
                      !draft.trim() ||
                      !ready ||
                      !connected ||
                      !current ||
                      busy ||
                      switching
                    }
                  >
                    {busy ? (
                      <LoaderCircle size={17} className="agent-spin" />
                    ) : (
                      <ArrowUp size={19} />
                    )}
                  </button>
                )}
              </div>
            </form>
            <div className="agent-model-bar">
              <span className="agent-model-dot" />
              <select
                aria-label="切换模型服务商"
                value={active?.id ?? ""}
                disabled={
                  running || busy || switching || !enabledProviders.length
                }
                onChange={(e) => void switchModel(e.target.value)}
              >
                <option value="" disabled>
                  选择服务商
                </option>
                {enabledProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
              <span>/</span>
              <select
                aria-label="切换 Agent 模型"
                value={active?.model ?? ""}
                disabled={running || busy || switching || !active}
                onChange={(e) =>
                  active && void switchModel(active.id, e.target.value)
                }
              >
                <option value="" disabled>
                  选择模型
                </option>
                {[
                  ...new Set(
                    [active?.model, ...(active?.models ?? [])].filter(
                      (model): model is string => !!model,
                    ),
                  ),
                ].map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
              {switching && <LoaderCircle size={12} className="agent-spin" />}
            </div>
          </section>
        )}
        <button
          ref={bubble}
          className={`agent-bubble ${running ? "is-running" : ""} ${open ? "is-open" : ""}`}
          aria-label={open ? "收起 Pi 创作助手" : "展开 Pi 创作助手"}
          aria-expanded={open}
          aria-controls="pi-agent-panel"
          onClick={() => (open ? close() : setOpen(true))}
        >
          {running ? (
            <LoaderCircle size={19} className="agent-spin" />
          ) : open ? (
            <X size={20} />
          ) : (
            <MessageCircle size={20} />
          )}
          <strong>{open ? "Pi" : running ? "Pi 正在编辑" : "Pi 助手"}</strong>
          {!open && <span className="agent-bubble-dot" />}
        </button>
      </div>
      {settingsOpen && (
        <AgentSettings
          onClose={() => onSettingsChange(false)}
          onSaved={setSettings}
          locked={running}
        />
      )}
    </>
  );
}
