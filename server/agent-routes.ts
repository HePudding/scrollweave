import type { Express } from "express";
import { z } from "zod";
import { EditorAgent } from "./agent";
import { AgentSettingsStore } from "./agent-settings";
import type { EditorService } from "./service";

export function registerAgentRoutes(app: Express, service: EditorService) {
  const settings = new AgentSettingsStore();
  const agent = new EditorAgent(service, settings);
  service.beforeWorkspaceChange = () => agent.abortAndWait();

  app.get("/api/agent/settings", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(settings.publicSettings());
  });
  app.put("/api/agent/settings", (req, res, next) => {
    try {
      res.json(settings.save(req.body));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/agent/providers/models", async (req, res, next) => {
    try {
      res.json(await settings.listModels(req.body?.provider));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/agent/providers/test", async (req, res, next) => {
    try {
      res.json(await settings.testProvider(req.body?.provider));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/agent/state", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(agent.snapshot());
  });
  app.get("/api/agent/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const send = (snapshot: ReturnType<EditorAgent["snapshot"]>) => {
      res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
    };
    agent.listeners.add(send);
    send(agent.snapshot());
    const heartbeat = setInterval(() => res.write(": keepalive\n\n"), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      agent.listeners.delete(send);
    });
  });
  app.post("/api/agent/prompt", (req, res, next) => {
    try {
      const input = z
        .object({
          message: z.string().trim().min(1).max(12000),
          projectId: z.string().min(1).max(100),
        })
        .strict()
        .parse(req.body);
      res.json(agent.prompt(input.message, input.projectId));
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/agent/abort", (_req, res) => res.json(agent.abort()));
  app.post("/api/agent/reset", (_req, res, next) => {
    try {
      res.json(agent.reset());
    } catch (error) {
      next(error);
    }
  });
  return agent;
}
