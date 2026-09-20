import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Folder,
  FolderOpen,
  Grid2X2,
  Home,
  List,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Star,
  X,
  Pencil,
  Unlink,
  Monitor,
  Clapperboard,
  Sparkles,
} from "lucide-react";
import type { ProjectEntry, ProjectLibraryState } from "../core/library";
import "./projects.css";

async function api<T>(
  url: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    method,
    signal,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "操作失败，请重试");
  return result;
}
const timeLabel = (value: string) => {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  if (elapsed < 60000) return "刚刚打开";
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)} 分钟前打开`;
  if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)} 小时前打开`;
  if (elapsed < 7 * 86400000)
    return `${Math.floor(elapsed / 86400000)} 天前打开`;
  return new Date(value).toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
  });
};
const durationLabel = (duration = 0) =>
  `${Math.floor(duration / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(duration % 60)
    .toString()
    .padStart(2, "0")}`;

function Modal({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    ref.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      ref.current?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="home-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="home-dialog-heading">
        <h2>{title}</h2>
        <button aria-label="关闭对话框" disabled={busy} onClick={onClose}>
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function ProjectCard({
  project,
  busy,
  onOpen,
  onFavorite,
  onRename,
  onRemove,
  onCopy,
}: {
  project: ProjectEntry;
  busy: boolean;
  onOpen: () => void;
  onFavorite: () => void;
  onRename: () => void;
  onRemove: () => void;
  onCopy: () => void;
}) {
  const [menu, setMenu] = useState(false),
    [imageFailed, setImageFailed] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [menu]);
  useEffect(() => setImageFailed(false), [project.thumbnail]);
  const usable = project.status === "ready";
  return (
    <article
      className={`project-card ${usable ? "" : "unavailable"}`}
      data-testid={`project-${project.id}`}
    >
      <button
        className="project-card-open"
        disabled={busy || !usable}
        onClick={onOpen}
        aria-label={`打开项目 ${project.name}`}
      >
        <div
          className={`project-cover ${project.thumbnail && !imageFailed ? "has-image" : ""}`}
          style={
            {
              "--cover-color": project.background || "#1d2c29",
            } as CSSProperties
          }
        >
          {project.thumbnail && !imageFailed && (
            <img
              src={project.thumbnail}
              alt=""
              loading="lazy"
              onError={() => setImageFailed(true)}
            />
          )}
          <div className="cover-lines" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
          <span className="cover-monogram" aria-hidden="true">
            {usable ? project.coverText || project.name : <Folder size={40} />}
          </span>
          <span className="cover-tag">
            {project.active ? (
              <>
                <span className="home-live-dot" />
                当前项目
              </>
            ) : (
              "SCROLLWEAVE"
            )}
          </span>
          <span className="cover-duration">
            {usable ? durationLabel(project.duration) : "项目不可用"}
          </span>
          <span className="cover-enter">
            <ArrowRight size={20} />
          </span>
        </div>
        <div className="project-card-details">
          <h3 title={project.name}>{project.name}</h3>
          <p className="project-directory" title={project.directory}>
            {project.directory}
          </p>
          <div className="project-meta">
            {usable ? (
              <>
                <span>{project.assetCount} 份素材</span>
                <span className="meta-dot">·</span>
                <span>{timeLabel(project.lastOpenedAt)}</span>
              </>
            ) : (
              <span className="missing-label" title={project.error}>
                {project.status === "missing"
                  ? "文件夹已移动或不可用"
                  : "项目文件需要检查"}
              </span>
            )}
          </div>
        </div>
      </button>
      <div className="project-card-tools">
        <button
          className={project.favorite ? "is-favorite" : ""}
          aria-label={`${project.favorite ? "取消收藏" : "收藏"} ${project.name}`}
          aria-pressed={project.favorite}
          disabled={busy}
          onClick={onFavorite}
        >
          <Star size={16} fill={project.favorite ? "currentColor" : "none"} />
        </button>
        <div ref={menuRef} className="project-menu-anchor">
          <button
            aria-label={`项目操作 ${project.name}`}
            aria-expanded={menu}
            aria-haspopup="menu"
            disabled={busy}
            onClick={() => setMenu(!menu)}
          >
            <MoreHorizontal size={19} />
          </button>
          {menu && (
            <div
              className="project-menu"
              role="menu"
              aria-label={`${project.name} 的操作`}
            >
              <button
                role="menuitem"
                disabled={!usable}
                onClick={() => {
                  setMenu(false);
                  onRename();
                }}
              >
                <Pencil size={15} />
                重命名
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  onCopy();
                }}
              >
                <Copy size={15} />
                复制目录路径
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  onRemove();
                }}
              >
                <Unlink size={15} />
                从列表移除
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function ProjectHome({ onEnter }: { onEnter: () => void }) {
  const [library, setLibrary] = useState<ProjectLibraryState | null>(null);
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState<"recent" | "favorites">("recent");
  const [view, setView] = useState<"grid" | "list">(() =>
    localStorage.getItem("sw-project-view") === "list" ? "list" : "grid",
  );
  const [sort, setSort] = useState("opened"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<"new" | "help" | null>(null),
    [picker, setPicker] = useState<"open" | "parent" | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false),
    [pickerApplying, setPickerApplying] = useState(false),
    [pickerError, setPickerError] = useState(""),
    [directoryDraft, setDirectoryDraft] = useState("");
  const pickerRequest = useRef<AbortController | null>(null);
  const [name, setName] = useState(""),
    [parentDirectory, setParentDirectory] = useState("");
  const [renaming, setRenaming] = useState<ProjectEntry | null>(null),
    [removing, setRemoving] = useState<ProjectEntry | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const sequence = useRef(0),
    mounted = useRef(true);
  const refresh = useCallback(async () => {
    const id = ++sequence.current;
    try {
      const result = await api<ProjectLibraryState>("/api/projects");
      if (mounted.current && id === sequence.current) {
        setLibrary(result);
        setError("");
      }
    } catch (e) {
      if (mounted.current && id === sequence.current)
        setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    document.title = "项目 · ScrollWeave";
    void refresh();
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 250);
    };
    const events = new EventSource("/api/events");
    events.addEventListener("workspace", schedule);
    events.addEventListener("state", schedule);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    const key = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "k" &&
        !document.querySelector("dialog[open]")
      ) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      mounted.current = false;
      pickerRequest.current?.abort();
      events.close();
      clearTimeout(timer);
      window.removeEventListener("focus", focus);
      window.removeEventListener("keydown", key);
    };
  }, [refresh]);
  useEffect(() => {
    localStorage.setItem("sw-project-view", view);
  }, [view]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  const operate = async (work: () => Promise<void>) => {
    sequence.current++;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const open = async (directory: string) => {
    await api("/api/projects/open", "POST", { directory });
    onEnter();
  };
  const startNew = () => {
    setName("");
    setParentDirectory(library?.defaultDirectory ?? "");
    setError("");
    setDialog("new");
  };
  const useDirectory = async (mode: "open" | "parent", directory: string) => {
    setPickerApplying(true);
    try {
      if (mode === "parent") setParentDirectory(directory);
      else await open(directory);
      setPicker(null);
    } finally {
      if (mounted.current) setPickerApplying(false);
    }
  };
  const closePicker = () => {
    pickerRequest.current?.abort();
    setPicker(null);
  };
  const pickDirectory = async (mode: "open" | "parent") => {
    if (pickerRequest.current) return;
    const controller = new AbortController();
    pickerRequest.current = controller;
    const initialDirectory =
      mode === "parent" ? parentDirectory : (library?.defaultDirectory ?? "");
    setPicker(mode);
    setDirectoryDraft(initialDirectory);
    setPickerError("");
    setPickerBusy(true);
    try {
      const { directory } = await api<{ directory: string | null }>(
        "/api/directories/pick",
        "POST",
        { mode, initialDirectory },
        controller.signal,
      );
      if (directory === null) setPicker(null);
      else {
        setDirectoryDraft(directory);
        await useDirectory(mode, directory);
      }
    } catch (e) {
      if (!controller.signal.aborted) setPickerError((e as Error).message);
    } finally {
      pickerRequest.current = null;
      if (mounted.current) setPickerBusy(false);
    }
  };
  const all = library?.projects ?? [];
  const projects = all
    .filter(
      (p) =>
        (filter !== "favorites" || p.favorite) &&
        `${p.name} ${p.directory}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name, "zh-CN")
        : sort === "modified"
          ? b.modifiedAt.localeCompare(a.modifiedAt)
          : b.lastOpenedAt.localeCompare(a.lastOpenedAt),
    );
  const recent = all.filter((p) => p.status === "ready").slice(0, 4);
  return (
    <div className="project-home">
      <aside className="home-sidebar">
        <a className="home-brand" href="/" aria-label="ScrollWeave 主页">
          <span className="home-brand-symbol" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            ScrollWeave<small>创作工作台</small>
          </span>
        </a>
        <button
          className="home-new-button"
          disabled={!library || busy}
          onClick={startNew}
        >
          <Plus size={19} />
          新建项目<span>＋</span>
        </button>
        <nav className="home-navigation" aria-label="项目导航">
          <button
            className={filter === "recent" ? "selected" : ""}
            onClick={() => {
              setFilter("recent");
              setQuery("");
            }}
          >
            <Home size={18} />
            所有项目<span>{all.length}</span>
          </button>
          <button
            className={filter === "favorites" ? "selected" : ""}
            onClick={() => {
              setFilter("favorites");
              setQuery("");
            }}
          >
            <Star size={18} />
            我的收藏<span>{all.filter((p) => p.favorite).length}</span>
          </button>
          <button
            disabled={!library || busy}
            onClick={() => void pickDirectory("open")}
          >
            <FolderOpen size={18} />
            打开文件夹
          </button>
        </nav>
        <div className="sidebar-recent">
          <div className="sidebar-caption">最近打开</div>
          {recent.length ? (
            recent.map((p) => (
              <button
                key={p.id}
                disabled={busy}
                onClick={() => void operate(() => open(p.directory))}
                title={p.directory}
              >
                <span
                  className={`recent-project-dot ${p.active ? "current" : ""}`}
                />
                <span>{p.name}</span>
                <ChevronRight size={13} />
              </button>
            ))
          ) : (
            <p>你的项目会显示在这里</p>
          )}
        </div>
        <div className="home-sidebar-footer">
          <button onClick={() => setDialog("help")}>
            <CircleHelp size={17} />
            使用指南
            <ArrowRight size={14} />
          </button>
          <div className="local-workspace">
            <span className="home-live-dot" />
            <div>
              本地工作空间<small>作品保存在你的电脑上</small>
            </div>
            <Monitor size={17} />
          </div>
        </div>
      </aside>
      <main className="home-main">
        <header className="home-topbar">
          <span>工作台</span>
          <ChevronRight size={13} />
          <strong>项目</strong>
          <div className="home-topbar-right">
            <span className="home-local-badge">
              <span className="home-live-dot" />
              LOCAL
            </span>
            <span className="home-avatar">SW</span>
          </div>
        </header>
        <div className="home-content">
          <section className="home-intro">
            <div>
              <div className="home-eyebrow">YOUR CREATIVE SPACE</div>
              <h1>
                把灵感，编排成作品<span>。</span>
              </h1>
              <p>收集素材，编排动画，让故事随着滚动展开。</p>
            </div>
            <div className="intro-timeline" aria-hidden="true">
              <span>00:00</span>
              <span>00:05</span>
              <span>00:10</span>
              <i />
              <i />
              <i />
              <b />
            </div>
          </section>
          <div className="home-actions">
            <button
              className="home-action-create"
              disabled={!library || busy}
              onClick={startNew}
            >
              <span className="home-action-icon">
                <Plus size={24} />
              </span>
              <span>
                <strong>新建项目</strong>
                <small>从空白时间线开始创作</small>
              </span>
              <ArrowUpRight />
            </button>
            <button
              disabled={!library || busy}
              onClick={() => void pickDirectory("open")}
            >
              <span className="home-action-icon">
                <FolderOpen size={23} />
              </span>
              <span>
                <strong>打开已有项目</strong>
                <small>选择电脑上的作品文件夹</small>
              </span>
              <ArrowRight size={19} />
            </button>
          </div>
          {(error || notice) && (
            <div
              className={`home-notice ${error ? "has-error" : ""}`}
              role={error ? "alert" : "status"}
            >
              <span>{error || notice}</span>
              {error && (
                <button onClick={() => void refresh()}>
                  <RefreshCw size={14} />
                  重试
                </button>
              )}
              <button
                aria-label="关闭提示"
                onClick={() => {
                  setError("");
                  setNotice("");
                }}
              >
                <X size={15} />
              </button>
            </div>
          )}
          <section className="home-projects" aria-label="项目列表">
            <div className="home-section-heading">
              <div>
                <h2>{filter === "favorites" ? "我的收藏" : "最近项目"}</h2>
                <span>{projects.length} 个项目</span>
              </div>
              <label className="home-search">
                <Search size={17} />
                <input
                  ref={search}
                  aria-label="搜索项目"
                  placeholder="搜索名称或路径"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query ? (
                  <button aria-label="清空搜索" onClick={() => setQuery("")}>
                    <X size={14} />
                  </button>
                ) : (
                  <kbd>Ctrl K</kbd>
                )}
              </label>
            </div>
            <div className="home-project-toolbar">
              <div className="home-project-tabs">
                <button
                  className={filter === "recent" ? "selected" : ""}
                  onClick={() => setFilter("recent")}
                >
                  <Clock3 size={14} />
                  全部项目
                </button>
                <button
                  className={filter === "favorites" ? "selected" : ""}
                  onClick={() => setFilter("favorites")}
                >
                  <Star size={14} />
                  已收藏
                </button>
              </div>
              <div className="home-view-options">
                <select
                  aria-label="项目排序"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="opened">最近打开</option>
                  <option value="modified">最近修改</option>
                  <option value="name">名称 A–Z</option>
                </select>
                <span />
                <button
                  aria-label="网格视图"
                  aria-pressed={view === "grid"}
                  className={view === "grid" ? "selected" : ""}
                  onClick={() => setView("grid")}
                >
                  <Grid2X2 size={17} />
                </button>
                <button
                  aria-label="列表视图"
                  aria-pressed={view === "list"}
                  className={view === "list" ? "selected" : ""}
                  onClick={() => setView("list")}
                >
                  <List size={19} />
                </button>
              </div>
            </div>
            {!library ? (
              <div className="home-empty">
                <LoaderCircle size={27} className="home-spinner" />
                <h3>{error ? "暂时无法连接工作台" : "正在读取项目"}</h3>
                {error && (
                  <button className="primary" onClick={() => void refresh()}>
                    重新连接
                  </button>
                )}
              </div>
            ) : projects.length ? (
              <div className={`project-collection ${view}`}>
                {projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    busy={busy}
                    onOpen={() => void operate(() => open(project.directory))}
                    onFavorite={() =>
                      void operate(async () => {
                        setLibrary(
                          await api<ProjectLibraryState>(
                            `/api/projects/${project.id}`,
                            "PATCH",
                            { favorite: !project.favorite },
                          ),
                        );
                      })
                    }
                    onRename={() => {
                      setRenaming(project);
                      setName(project.name);
                      setError("");
                    }}
                    onRemove={() => setRemoving(project)}
                    onCopy={() =>
                      void operate(async () => {
                        await navigator.clipboard.writeText(project.directory);
                        setNotice("项目目录已复制");
                      })
                    }
                  />
                ))}
                {view === "grid" && !query && filter === "recent" && (
                  <button
                    className="new-project-tile"
                    disabled={busy}
                    onClick={startNew}
                  >
                    <span>
                      <Plus size={22} />
                    </span>
                    <strong>下一个故事，从这里开始</strong>
                    <small>新建一个项目</small>
                  </button>
                )}
              </div>
            ) : (
              <div className="home-empty">
                <span className="home-empty-icon">
                  {query ? (
                    <Search size={30} />
                  ) : filter === "favorites" ? (
                    <Star size={30} />
                  ) : (
                    <Clapperboard size={30} />
                  )}
                </span>
                <h3>
                  {query
                    ? "没有找到匹配的项目"
                    : filter === "favorites"
                      ? "把常用项目放在手边"
                      : "你的第一个故事，从这里开始"}
                </h3>
                <p>
                  {query
                    ? "试试其他名称，或搜索文件夹路径。"
                    : filter === "favorites"
                      ? "点击项目卡片上的星标，就能在这里快速找到它。"
                      : "新建一个项目，或打开已有作品文件夹。"}
                </p>
                {query ? (
                  <button onClick={() => setQuery("")}>清空搜索</button>
                ) : (
                  filter === "recent" && (
                    <button className="primary" onClick={startNew}>
                      <Plus size={16} />
                      新建项目
                    </button>
                  )
                )}
              </div>
            )}
          </section>
          <footer className="home-content-footer">
            <span>
              <span className="home-footer-mark">S</span>素材 → 时间线 →
              滚动网页
            </span>
            <button onClick={() => setDialog("help")}>
              <Sparkles size={14} />与 Agent 一起创作
              <ArrowRight size={13} />
            </button>
          </footer>
        </div>
      </main>
      {dialog === "new" && !picker && (
        <Modal title="新建项目" onClose={() => setDialog(null)} busy={busy}>
          <p className="dialog-description">
            一个独立文件夹，装下你的素材、时间线和导出作品。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void operate(async () => {
                await api("/api/projects", "POST", { name, parentDirectory });
                onEnter();
              });
            }}
          >
            <label className="home-field">
              项目名称
              <input
                autoFocus
                aria-label="项目名称"
                placeholder="给新故事起个名字"
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                required
              />
            </label>
            <label className="home-field">
              保存位置
              <div className="home-folder-field">
                <Folder size={18} />
                <span title={parentDirectory}>{parentDirectory}</span>
                <button
                  type="button"
                  aria-label="更改保存位置"
                  disabled={busy}
                  onClick={() => void pickDirectory("parent")}
                >
                  更改
                </button>
              </div>
            </label>
            <div className="new-project-spec">
              <Monitor size={20} />
              <div>
                <strong>横向画布 · 1920 × 1080</strong>
                <span>空白时间线 · 素材随导入加入项目</span>
              </div>
            </div>
            {error && (
              <div className="home-inline-error" role="alert">
                {error}
              </div>
            )}
            <div className="home-dialog-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setDialog(null)}
              >
                取消
              </button>
              <button
                type="submit"
                className="primary"
                disabled={busy || !name.trim() || !parentDirectory}
              >
                {busy ? (
                  <LoaderCircle size={16} className="home-spinner" />
                ) : (
                  <Plus size={17} />
                )}
                创建并开始
              </button>
            </div>
          </form>
        </Modal>
      )}
      {picker && (
        <Modal
          title={picker === "open" ? "打开项目文件夹" : "选择保存位置"}
          onClose={closePicker}
          busy={pickerApplying}
        >
          {pickerBusy ? (
            <p className="native-picker-status" role="status">
              <LoaderCircle size={20} className="home-spinner" />
              {pickerApplying ? "正在打开项目…" : "请在系统窗口中选择文件夹。"}
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setPickerBusy(true);
                setPickerError("");
                void useDirectory(picker, directoryDraft.trim())
                  .catch((e) => setPickerError((e as Error).message))
                  .finally(() => setPickerBusy(false));
              }}
            >
              {pickerError && (
                <div className="home-inline-error" role="alert">
                  {pickerError}
                </div>
              )}
              <label className="home-field">
                文件夹的完整路径
                <input
                  aria-label="文件夹路径"
                  value={directoryDraft}
                  onChange={(e) => setDirectoryDraft(e.target.value)}
                  required
                />
              </label>
              <div className="home-dialog-actions">
                <button
                  type="button"
                  onClick={() => void pickDirectory(picker)}
                >
                  重试系统选择器
                </button>
                <button
                  type="submit"
                  className="primary"
                  disabled={!directoryDraft.trim()}
                >
                  {picker === "open" ? "打开项目" : "使用此位置"}
                </button>
              </div>
            </form>
          )}
          <div className="home-dialog-actions">
            <button disabled={pickerApplying} onClick={closePicker}>
              取消
            </button>
          </div>
        </Modal>
      )}
      {renaming && (
        <Modal title="重命名项目" onClose={() => setRenaming(null)} busy={busy}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void operate(async () => {
                setLibrary(
                  await api<ProjectLibraryState>(
                    `/api/projects/${renaming.id}`,
                    "PATCH",
                    { name, expectedRevision: renaming.revision },
                  ),
                );
                setRenaming(null);
                setNotice("项目已重命名");
              });
            }}
          >
            <label className="home-field">
              项目名称
              <input
                autoFocus
                aria-label="新的项目名称"
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <p className="dialog-description">
              更新作品名称，文件夹路径保持不变。
            </p>
            {error && (
              <div className="home-inline-error" role="alert">
                {error}
              </div>
            )}
            <div className="home-dialog-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => setRenaming(null)}
              >
                取消
              </button>
              <button className="primary" disabled={busy || !name.trim()}>
                保存名称
              </button>
            </div>
          </form>
        </Modal>
      )}
      {removing && (
        <Modal title="从列表移除" onClose={() => setRemoving(null)} busy={busy}>
          <p>将「{removing.name}」从主页列表移除？</p>
          <div className="home-retention">
            <FolderOpen size={22} />
            <div>
              <strong>项目文件和素材会保留</strong>
              <p>以后可以通过“打开已有项目”重新加入。</p>
              <code>{removing.directory}</code>
            </div>
          </div>
          {error && (
            <div className="home-inline-error" role="alert">
              {error}
            </div>
          )}
          <div className="home-dialog-actions">
            <button disabled={busy} onClick={() => setRemoving(null)}>
              取消
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void operate(async () => {
                  setLibrary(
                    await api<ProjectLibraryState>(
                      `/api/projects/${removing.id}`,
                      "DELETE",
                    ),
                  );
                  setRemoving(null);
                  setNotice("已从列表移除，磁盘上的项目文件已保留");
                })
              }
            >
              确认移出列表
            </button>
          </div>
        </Modal>
      )}
      {dialog === "help" && (
        <Modal title="从素材，到一个滚动故事" onClose={() => setDialog(null)}>
          <div className="home-guide">
            <div>
              <span>01</span>
              <section>
                <h3>为每个作品留一个家</h3>
                <p>
                  新建项目，或打开已有作品文件夹。最近项目和收藏会保留，随时回来继续。
                </p>
              </section>
            </div>
            <div>
              <span>02</span>
              <section>
                <h3>把素材编排成故事</h3>
                <p>进入项目后，导入素材并拖入时间线，剪辑、叠放和添加动画。</p>
              </section>
            </div>
            <div>
              <span>03</span>
              <section>
                <h3>和 Agent 一起创作</h3>
                <p>
                  在项目文件夹中打开 Codex，让它把素材写进
                  assets。素材会自动入库；编辑器右上角的帮助提供 MCP 接入信息。
                </p>
              </section>
            </div>
            <div>
              <span>04</span>
              <section>
                <h3>让故事随滚动展开</h3>
                <p>
                  设置滚动区间、预览效果，再导出网页。图片与 SVG 可交付单文件
                  HTML；视频随网页一起打包。
                </p>
              </section>
            </div>
          </div>
          <div className="home-dialog-actions">
            <button className="primary" onClick={() => setDialog(null)}>
              开始创作
              <ArrowRight size={16} />
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ArrowUpRight() {
  return <ArrowRight size={19} style={{ transform: "rotate(-40deg)" }} />;
}
