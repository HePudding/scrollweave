import express from "express";
import fs from "node:fs";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ProjectStore, ConflictError } from "../src/core/commands";
import { exampleProject } from "../src/core/example";
import { EditorService, type ToolName } from "./service";
import { createMcpServer } from "./mcp";
import { exportHTML } from "./export";

const port = Number(process.env.PORT ?? 4100);
const workspace = path.resolve(process.env.SW_WORKSPACE ?? ".scrollweave");
fs.mkdirSync(workspace, { recursive: true });
// A second process must never silently own a second copy of the current project.
const lockPath = path.join(workspace, "server.lock");
if (fs.existsSync(lockPath)) {
  const pid = Number(fs.readFileSync(lockPath, "utf8"));
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {}
  if (alive)
    throw new Error(
      `工作区已由进程 ${pid} 打开。请使用现有服务或设置不同 SW_WORKSPACE。`,
    );
  fs.unlinkSync(lockPath);
}
fs.writeFileSync(lockPath, String(process.pid), { flag: "wx" });
process.on("exit", () => {
  try {
    if (fs.readFileSync(lockPath, "utf8") === String(process.pid))
      fs.unlinkSync(lockPath);
  } catch {}
});
const current = path.join(workspace, "workspace.json");
const saved = fs.existsSync(current)
  ? JSON.parse(fs.readFileSync(current, "utf8"))
  : null;
const store = new ProjectStore(
  saved?.project ?? exampleProject(),
  saved?.revision ?? 0,
);
if (saved?.selection) {
  try {
    store.select(saved.selection);
  } catch {}
}
if (saved?.preview) {
  try {
    store.seek(saved.preview);
  } catch {}
}
const service = new EditorService(store, workspace);
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  const host = (req.headers.host ?? "").split(":")[0];
  if (!["127.0.0.1", "localhost"].includes(host))
    return void res.status(403).json({ error: "仅允许本机 Host" });
  if (req.headers.origin) {
    try {
      const origin = new URL(req.headers.origin);
      if (
        !["127.0.0.1", "localhost"].includes(origin.hostname) ||
        origin.port !== String(port)
      )
        return void res.status(403).json({ error: "拒绝跨站请求" });
    } catch {
      return void res.sendStatus(403);
    }
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
app.use(express.json({ limit: "60mb" }));
app.get("/api/state", (_req, res) => res.json(store.snapshot()));
app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const send = (type: string, data: unknown) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  service.listeners.add(send);
  send("state", store.snapshot());
  const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15000);
  req.on("close", () => {
    clearInterval(heartbeat);
    service.listeners.delete(send);
  });
});
app.post("/api/action", async (req, res, next) => {
  try {
    res.json(await service.run(req.body.name as ToolName, req.body.args));
  } catch (error) {
    next(error);
  }
});
app.get("/api/preview", async (_req, res, next) => {
  try {
    res.type("html").send(await exportHTML(store.project));
  } catch (error) {
    next(error);
  }
});
app.get("/api/example", (_req, res) => res.json(exampleProject()));
app.use(
  "/exports",
  express.static(path.join(workspace, "exports"), {
    setHeaders: (res) => res.setHeader("Content-Disposition", "attachment"),
  }),
);
app.post("/mcp", async (req, res, next) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createMcpServer(service);
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    next(error);
  }
});
app.all("/mcp", (_req, res) =>
  res
    .status(405)
    .json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Use stateless Streamable HTTP POST" },
      id: null,
    }),
);
app.use(
  (
    error: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const message = error.message;
    store.errors = [...store.errors.slice(-19), message];
    res
      .status(error instanceof ConflictError ? 409 : 400)
      .json({
        error: message,
        ...(error instanceof ConflictError
          ? { code: "REVISION_CONFLICT", actualRevision: error.actualRevision }
          : {}),
      });
  },
);
if (
  process.env.NODE_ENV === "production" ||
  process.argv.includes("--production")
) {
  app.use(express.static(path.resolve("dist/client")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/client/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true, hmr: { port: port + 1000 } },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const server = app.listen(port, "127.0.0.1", () =>
  console.log(
    `ScrollWeave http://127.0.0.1:${port}\nMCP http://127.0.0.1:${port}/mcp\nWorkspace ${workspace}`,
  ),
);
const close = () => {
  void service.browser?.close();
  server.close(() => process.exit());
  setTimeout(() => process.exit(), 1000).unref();
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
