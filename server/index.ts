import express from "express";
import fs from "node:fs";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ConflictError } from "../src/core/commands";
import { EditorService, type ToolName } from "./service";
import { createMcpServer } from "./mcp";
import { exportHTML } from "./export";
const port = Number(process.env.PORT ?? 4100);
const workspace = path.resolve(
  process.env.SW_WORKSPACE ??
    path.join(
      path.dirname(process.cwd()),
      "ScrollWeaveProjects",
      "My-first-work",
    ),
);
const service = await EditorService.open(workspace, port),
  app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  const host = (req.headers.host ?? "").split(":")[0];
  if (!["127.0.0.1", "localhost"].includes(host))
    return void res.status(403).json({ error: "仅允许本机 Host" });
  if (req.headers.origin)
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
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
app.post(
  "/api/import",
  express.raw({ type: "application/octet-stream", limit: "512mb" }),
  async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body)) throw Error("需要二进制文件");
      const name = decodeURIComponent(String(req.headers["x-file-name"] ?? ""));
      const asset = await service.assets.importBuffer(
        name,
        req.body,
        req.headers["x-replace-id"]
          ? String(req.headers["x-replace-id"])
          : undefined,
      );
      res.json({ asset, revision: service.store.revision });
    } catch (error) {
      next(error);
    }
  },
);
app.post(
  "/api/import-project",
  express.raw({ type: "application/octet-stream", limit: "512mb" }),
  async (req, res, next) => {
    try {
      if (!Buffer.isBuffer(req.body)) throw Error("需要项目文件");
      res.json(
        await service.importProject(req.body, req.query.asCompound === "true"),
      );
    } catch (error) {
      next(error);
    }
  },
);
app.use(express.json({ limit: "60mb" }));
app.get("/api/state", (_req, res) => res.json(service.store.snapshot()));
app.get("/api/workspace", (_req, res) => res.json(service.info()));
app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const send = (type: string, data: unknown) =>
    res.write("event: " + type + "\ndata: " + JSON.stringify(data) + "\n\n");
  service.listeners.add(send);
  send("state", service.store.snapshot());
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
    res.type("html").send(await exportHTML(service.store.project));
  } catch (error) {
    next(error);
  }
});
app.use("/media", (req, res, next) =>
  express.static(service.assets.cache, {
    maxAge: "1y",
    immutable: true,
    index: false,
  })(req, res, next),
);
app.use("/exports", (req, res, next) =>
  express.static(path.join(service.workspace, "exports"), {
    setHeaders: (r) => r.setHeader("Content-Disposition", "attachment"),
  })(req, res, next),
);
app.post("/mcp", async (req, res, next) => {
  const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    }),
    server = createMcpServer(service);
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
  res.status(405).json({
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
    service.store.errors = [...service.store.errors.slice(-19), error.message];
    res.status(error instanceof ConflictError ? 409 : 400).json({
      error: error.message,
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
    server: {
      middlewareMode: true,
      hmr: { port: port < 64535 ? port + 1000 : port - 1000 },
    },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const server = app.listen(port, "127.0.0.1", () =>
  console.log(
    "ScrollWeave http://127.0.0.1:" +
      port +
      "\nMCP http://127.0.0.1:" +
      port +
      "/mcp\n作品目录 " +
      workspace,
  ),
);
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  server.close();
  await service.close();
  process.exit();
};
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
process.on("exit", () => {
  const lock = path.join(service.workspace, ".scrollweave", "server.lock");
  try {
    if (fs.readFileSync(lock, "utf8") === String(process.pid))
      fs.unlinkSync(lock);
  } catch {}
});
