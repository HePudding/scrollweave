import { useEffect, useRef, useState } from "react";
import {
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings2,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import type {
  AgentProvider,
  AgentSettings as Settings,
  ProviderApi,
  ProviderInput,
} from "../core/agent-types";
import "./agent.css";

export async function agentApi<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/agent${path}`, {
    method,
    signal,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const result = await response
    .json()
    .catch(() => ({ error: "Agent 服务暂时不可用，请确认本地服务正在运行。" }));
  if (!response.ok) throw new Error(result.error || "操作失败，请重试。");
  return result as T;
}

export const providerInput = ({
  hasApiKey: _key,
  ...provider
}: AgentProvider): ProviderInput => provider;
type DraftProvider = ProviderInput & { hasApiKey: boolean };
const protocols: { value: ProviderApi; label: string }[] = [
  { value: "openai-completions", label: "OpenAI 兼容 · Chat Completions" },
  { value: "openai-responses", label: "OpenAI · Responses" },
  { value: "anthropic-messages", label: "Anthropic · Messages" },
  { value: "google-generative-ai", label: "Google · Gemini" },
];
const presets: { name: string; api: ProviderApi; baseUrl: string }[] = [
  {
    name: "Anthropic",
    api: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
  },
  {
    name: "OpenAI",
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
  },
  {
    name: "Google Gemini",
    api: "google-generative-ai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
  {
    name: "DeepSeek",
    api: "openai-completions",
    baseUrl: "https://api.deepseek.com/v1",
  },
  {
    name: "OpenRouter",
    api: "openai-completions",
    baseUrl: "https://openrouter.ai/api/v1",
  },
  {
    name: "Ollama",
    api: "openai-completions",
    baseUrl: "http://localhost:11434/v1",
  },
  { name: "自定义服务商", api: "openai-completions", baseUrl: "" },
];
const asInput = ({
  hasApiKey: _has,
  ...draft
}: DraftProvider): ProviderInput => ({
  ...draft,
  apiKey: draft.apiKey?.trim() || undefined,
  models: [...new Set([draft.model.trim(), ...draft.models].filter(Boolean))],
  model: draft.model.trim(),
  name: draft.name.trim(),
  baseUrl: draft.baseUrl.trim(),
});

export function AgentSettings({
  onClose,
  onSaved,
  locked = false,
}: {
  onClose: () => void;
  onSaved?: (settings: Settings) => void;
  locked?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [providers, setProviders] = useState<DraftProvider[]>([]),
    [activeId, setActiveId] = useState(""),
    [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState(""),
    [showKey, setShowKey] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState("");
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [addOpen, setAddOpen] = useState(false),
    [modelDraft, setModelDraft] = useState(""),
    [confirmDiscard, setConfirmDiscard] = useState(false);
  const mounted = useRef(true),
    request = useRef<AbortController | null>(null),
    saved = useRef("");
  const selected = providers.find((p) => p.id === selectedId);
  const fingerprint = (list: DraftProvider[], id: string) =>
    JSON.stringify({ providers: list, activeId: id });
  const dirty = !loading && fingerprint(providers, activeId) !== saved.current;
  useEffect(() => setConfirmDiscard(false), [providers, activeId]);
  const requestClose = () => {
    if (busy) return;
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    const controller = new AbortController();
    void agentApi<Settings>("/settings", "GET", undefined, controller.signal)
      .then((settings) => {
        saved.current = fingerprint(
          settings.providers,
          settings.activeProviderId,
        );
        setProviders(settings.providers);
        setActiveId(settings.activeProviderId);
        setSelectedId(
          settings.activeProviderId || settings.providers[0]?.id || "",
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      mounted.current = false;
      controller.abort();
      request.current?.abort();
      dialog.current?.close();
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    setShowKey(false);
    setModelDraft("");
    setNotice("");
  }, [selectedId]);
  const update = (patch: Partial<DraftProvider>) => {
    setProviders((all) =>
      all.map((p) => (p.id === selectedId ? { ...p, ...patch } : p)),
    );
    setNotice("");
  };
  const run = async (
    kind: string,
    work: (signal: AbortSignal) => Promise<void>,
  ) => {
    const controller = new AbortController();
    request.current = controller;
    setBusy(kind);
    setError("");
    setNotice("");
    try {
      await work(controller.signal);
    } catch (e) {
      if (!controller.signal.aborted && mounted.current)
        setError((e as Error).message);
    } finally {
      if (mounted.current) {
        setBusy("");
        request.current = null;
      }
    }
  };
  const save = () =>
    void run("save", async (signal) => {
      const active = providers.find((p) => p.id === activeId);
      if (
        !activeId ||
        !active?.enabled ||
        !active.model.trim() ||
        !active.baseUrl.trim()
      )
        throw new Error("请为当前服务商启用服务、填写 API 地址并选择模型。");
      const incomplete = providers.find(
        (p) => !p.name.trim() || !p.baseUrl.trim() || !p.model.trim(),
      );
      if (incomplete) {
        setSelectedId(incomplete.id);
        throw new Error(
          `请补全「${incomplete.name || "新服务商"}」的名称、API 地址和模型 ID，或移除该服务商。`,
        );
      }
      const settings = await agentApi<Settings>(
        "/settings",
        "PUT",
        { providers: providers.map(asInput), activeProviderId: activeId },
        signal,
      );
      if (!mounted.current) return;
      saved.current = fingerprint(
        settings.providers,
        settings.activeProviderId,
      );
      setProviders(settings.providers);
      setActiveId(settings.activeProviderId);
      setNotice("设置已保存，可以回到项目开始创作。");
      onSaved?.(settings);
    });
  const add = (preset: (typeof presets)[number]) => {
    const id = `provider_${crypto.randomUUID().replaceAll("-", "")}`;
    setProviders((all) => [
      ...all,
      { ...preset, id, model: "", models: [], enabled: true, hasApiKey: false },
    ]);
    setSelectedId(id);
    if (!activeId) setActiveId(id);
    setQuery("");
    setAddOpen(false);
  };
  const blocked = !!busy || locked;
  return (
    <dialog
      ref={dialog}
      className="agent-settings"
      aria-labelledby="agent-settings-title"
      onKeyDown={(e) => e.stopPropagation()}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
    >
      <header className="agent-settings-header">
        <span className="agent-settings-symbol">
          <Settings2 size={21} />
        </span>
        <div>
          <h2 id="agent-settings-title">模型服务商</h2>
          <p>连接你喜欢的模型，交给 Pi 一起创作</p>
        </div>
        <button
          className="agent-icon-button"
          aria-label="关闭模型设置"
          disabled={!!busy}
          onClick={requestClose}
        >
          <X size={20} />
        </button>
      </header>
      <div className="agent-settings-body">
        <aside className="agent-provider-sidebar" aria-label="服务商列表">
          <label className="agent-provider-search">
            <Search size={14} />
            <input
              aria-label="搜索服务商"
              placeholder="搜索服务商…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="agent-provider-list">
            {providers
              .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
              .map((p) => (
                <button
                  key={p.id}
                  disabled={!!busy}
                  className={`agent-provider-item ${selectedId === p.id ? "selected" : ""}`}
                  onClick={() => {
                    setSelectedId(p.id);
                    setError("");
                    setAddOpen(false);
                  }}
                  aria-pressed={selectedId === p.id}
                >
                  <span className="agent-provider-avatar">
                    {p.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    {p.name}
                    <small>
                      {p.id === activeId
                        ? "当前使用"
                        : p.enabled
                          ? "已启用"
                          : "未启用"}
                    </small>
                  </span>
                  {p.id === activeId ? (
                    <Check size={14} />
                  ) : (
                    <i className={p.enabled ? "enabled" : ""} />
                  )}
                </button>
              ))}
          </div>
          <button
            className="agent-add-provider"
            disabled={blocked || loading}
            onClick={() => setAddOpen(!addOpen)}
            aria-expanded={addOpen}
          >
            <Plus size={16} />
            添加服务商
          </button>
        </aside>
        <main className="agent-provider-detail">
          {loading ? (
            <div className="agent-settings-empty">
              <LoaderCircle className="agent-spin" size={25} />
              <p>正在加载设置…</p>
            </div>
          ) : addOpen ? (
            <>
              <div className="agent-detail-title">
                <div>
                  <h3>添加模型服务商</h3>
                  <p>选择预设，或接入任意兼容 API。</p>
                </div>
              </div>
              <div className="agent-presets">
                {presets.map((preset) => (
                  <button key={preset.name} onClick={() => add(preset)}>
                    <Server size={19} />
                    <span>
                      {preset.name}
                      <small>
                        {protocols.find((p) => p.value === preset.api)?.label}
                      </small>
                    </span>
                    <Plus size={15} />
                  </button>
                ))}
              </div>
            </>
          ) : selected ? (
            <>
              <div className="agent-detail-title">
                <div>
                  <h3>{selected.name || "新服务商"}</h3>
                  <p>
                    {selected.id === activeId
                      ? "Pi 当前使用的模型服务商"
                      : "独立配置 API 和可用模型"}
                  </p>
                </div>
                <label className="agent-toggle">
                  <input
                    type="checkbox"
                    aria-label="启用服务商"
                    checked={selected.enabled}
                    disabled={blocked}
                    onChange={(e) => {
                      update({ enabled: e.target.checked });
                      if (!e.target.checked && activeId === selected.id)
                        setActiveId(
                          providers.find(
                            (p) => p.id !== selected.id && p.enabled,
                          )?.id ?? selected.id,
                        );
                    }}
                  />
                  <span />
                  启用
                </label>
              </div>
              <fieldset disabled={blocked} className="agent-provider-fields">
                <label className="agent-field">
                  服务商名称
                  <input
                    aria-label="服务商名称"
                    value={selected.name}
                    onChange={(e) => update({ name: e.target.value })}
                    maxLength={100}
                    placeholder="例如：我的 OpenAI…"
                  />
                </label>
                <label className="agent-field">
                  API 协议
                  <select
                    aria-label="API 协议"
                    value={selected.api}
                    onChange={(e) =>
                      update({ api: e.target.value as ProviderApi })
                    }
                  >
                    {protocols.map((protocol) => (
                      <option value={protocol.value} key={protocol.value}>
                        {protocol.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="agent-field">
                  API 地址
                  <input
                    aria-label="API 地址"
                    type="url"
                    value={selected.baseUrl}
                    onChange={(e) => update({ baseUrl: e.target.value })}
                    placeholder="https://api.example.com/v1"
                    spellCheck={false}
                  />
                  <small>
                    填写服务商的完整 Base URL，兼容接口通常以 /v1 结尾。
                  </small>
                </label>
                <label className="agent-field">
                  API 密钥
                  <div className="agent-secret-field">
                    <input
                      aria-label="API 密钥"
                      type={showKey ? "text" : "password"}
                      value={selected.apiKey ?? ""}
                      onChange={(e) =>
                        update({ apiKey: e.target.value, clearApiKey: false })
                      }
                      placeholder={
                        selected.clearApiKey
                          ? "保存后将清除密钥"
                          : selected.hasApiKey
                            ? "已保存密钥，留空保留"
                            : "输入 API Key（本地服务可留空）…"
                      }
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      aria-label={showKey ? "隐藏 API 密钥" : "显示 API 密钥"}
                      onClick={() => setShowKey(!showKey)}
                    >
                      {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  <small>
                    密钥保存在本机服务端配置中，浏览器不会保存密钥。
                  </small>
                </label>
                {(selected.hasApiKey || selected.clearApiKey) && (
                  <button
                    className="agent-clear-secret"
                    type="button"
                    onClick={() =>
                      update({ apiKey: "", clearApiKey: !selected.clearApiKey })
                    }
                  >
                    {selected.clearApiKey ? "撤销清除密钥" : "清除已保存密钥"}
                  </button>
                )}
                <div className="agent-model-heading">
                  <strong>模型</strong>
                  <button
                    type="button"
                    disabled={!selected.baseUrl.trim()}
                    onClick={() =>
                      void run("models", async (signal) => {
                        const result = await agentApi<{ models: string[] }>(
                          "/providers/models",
                          "POST",
                          { provider: asInput(selected) },
                          signal,
                        );
                        if (mounted.current) {
                          update({
                            models: [
                              ...new Set([
                                ...selected.models,
                                ...result.models,
                              ]),
                            ],
                          });
                          setNotice(
                            result.models.length
                              ? `已获取 ${result.models.length} 个模型`
                              : "未获取到模型，请手动填写模型 ID。",
                          );
                        }
                      })
                    }
                  >
                    {busy === "models" ? (
                      <LoaderCircle size={14} className="agent-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    获取模型
                  </button>
                </div>
                <label className="agent-field">
                  当前模型
                  <input
                    aria-label="当前模型"
                    value={selected.model}
                    onChange={(e) => update({ model: e.target.value })}
                    placeholder="填写模型 ID，或在下方选择…"
                    spellCheck={false}
                  />
                </label>
                <div
                  className="agent-model-list"
                  role="group"
                  aria-label="已添加模型"
                >
                  {[
                    ...new Set(
                      [selected.model.trim(), ...selected.models].filter(
                        Boolean,
                      ),
                    ),
                  ].map((model) => (
                    <div
                      key={model}
                      className={model === selected.model ? "selected" : ""}
                    >
                      <button
                        type="button"
                        className="agent-model-choice"
                        aria-pressed={model === selected.model}
                        onClick={() => update({ model })}
                        title={model}
                      >
                        {model === selected.model ? (
                          <Check size={14} />
                        ) : (
                          <span className="agent-model-dot" />
                        )}
                        {model}
                      </button>
                      <button
                        aria-label={`移除模型 ${model}`}
                        type="button"
                        onClick={() =>
                          update({
                            models: selected.models.filter(
                              (item) => item !== model,
                            ),
                            ...(selected.model === model ? { model: "" } : {}),
                          })
                        }
                      >
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="agent-model-add">
                  <input
                    aria-label="添加模型 ID"
                    placeholder="输入其他模型 ID…"
                    value={modelDraft}
                    onChange={(e) => setModelDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && modelDraft.trim()) {
                        e.preventDefault();
                        update({
                          models: [
                            ...new Set([...selected.models, modelDraft.trim()]),
                          ],
                          ...(!selected.model
                            ? { model: modelDraft.trim() }
                            : {}),
                        });
                        setModelDraft("");
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={!modelDraft.trim()}
                    onClick={() => {
                      update({
                        models: [
                          ...new Set([...selected.models, modelDraft.trim()]),
                        ],
                        ...(!selected.model
                          ? { model: modelDraft.trim() }
                          : {}),
                      });
                      setModelDraft("");
                    }}
                  >
                    <Plus size={15} />
                    添加
                  </button>
                </div>
                <div className="agent-provider-actions">
                  <button
                    type="button"
                    className="agent-secondary"
                    disabled={
                      !selected.baseUrl.trim() || !selected.model.trim()
                    }
                    onClick={() =>
                      void run("test", async (signal) => {
                        const result = await agentApi<{ message: string }>(
                          "/providers/test",
                          "POST",
                          { provider: asInput(selected) },
                          signal,
                        );
                        if (mounted.current)
                          setNotice(
                            result.message || "连接成功，模型可以使用。",
                          );
                      })
                    }
                  >
                    {busy === "test" ? (
                      <LoaderCircle size={14} className="agent-spin" />
                    ) : (
                      <Zap size={14} />
                    )}
                    测试连接
                  </button>
                  <button
                    type="button"
                    className={
                      selected.id === activeId
                        ? "agent-current"
                        : "agent-secondary"
                    }
                    disabled={
                      !selected.enabled ||
                      !selected.model.trim() ||
                      !selected.baseUrl.trim()
                    }
                    onClick={() => setActiveId(selected.id)}
                  >
                    <Check size={14} />
                    {selected.id === activeId ? "当前使用" : "设为当前服务商"}
                  </button>
                  <button
                    className="agent-remove-provider"
                    type="button"
                    aria-label="移除服务商"
                    disabled={providers.length <= 1}
                    onClick={() => {
                      const remaining = providers.filter(
                        (p) => p.id !== selected.id,
                      );
                      setProviders(remaining);
                      setSelectedId(remaining[0]?.id ?? "");
                      if (activeId === selected.id)
                        setActiveId(
                          remaining.find((p) => p.enabled)?.id ??
                            remaining[0]?.id ??
                            "",
                        );
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </fieldset>
            </>
          ) : (
            <div className="agent-settings-empty">
              <Server size={30} />
              <h3>从一个服务商开始</h3>
              <p>添加 API 和模型，即可启用内置 Pi Agent。</p>
              <button className="primary" onClick={() => setAddOpen(true)}>
                <Plus size={16} />
                添加服务商
              </button>
            </div>
          )}
        </main>
      </div>
      <footer className="agent-settings-footer">
        <div
          role={error || confirmDiscard ? "alert" : "status"}
          className={
            error || confirmDiscard
              ? "agent-error-text"
              : "agent-settings-notice"
          }
        >
          {error ||
            (confirmDiscard
              ? "有未保存的修改。保存设置，或再次关闭以放弃修改。"
              : locked
                ? "Agent 正在执行，请先停止任务再修改设置。"
                : notice || "设置对本机所有项目生效")}
        </div>
        <button disabled={!!busy} onClick={requestClose}>
          {confirmDiscard ? "放弃修改并关闭" : "关闭"}
        </button>
        <button
          className="primary"
          disabled={blocked || loading}
          onClick={save}
        >
          {busy === "save" ? (
            <LoaderCircle size={15} className="agent-spin" />
          ) : (
            <Check size={16} />
          )}
          保存设置
        </button>
      </footer>
    </dialog>
  );
}
