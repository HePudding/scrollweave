import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";

test(
  "真实服务进程重启恢复项目、revision、选择和预览；第二进程不能占用工作区",
  { timeout: 60000 },
  async () => {
    fs.mkdirSync(".scrollweave", { recursive: true });
    const workspace = fs.mkdtempSync(path.resolve(".scrollweave/restart-"));
    const socket = net.createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = (socket.address() as net.AddressInfo).port;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    const origin = `http://127.0.0.1:${port}`;
    const start = () =>
      spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
        cwd: process.cwd(),
        env: { ...process.env, PORT: String(port), SW_WORKSPACE: workspace },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    const ready = async (child: ChildProcess) =>
      new Promise<void>((resolve, reject) => {
        let output = "";
        const timer = setTimeout(
          () => reject(new Error(`启动超时: ${output}`)),
          12000,
        );
        const listener = (chunk: Buffer) => {
          output += chunk;
          if (output.includes(`ScrollWeave ${origin}`)) {
            clearTimeout(timer);
            resolve();
          }
        };
        child.stdout!.on("data", listener);
        child.stderr!.on("data", (chunk) => {
          output += chunk;
        });
        child.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`提前退出 ${code}: ${output}`));
        });
      });
    const stop = async (child: ChildProcess) => {
      if (child.exitCode !== null) return;
      const done = once(child, "exit");
      child.kill("SIGTERM");
      await done;
    };
    const call = async (name: string, args: unknown = {}) => {
      const r = await fetch(`${origin}/api/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, args }),
      });
      const value = await r.json();
      assert.equal(r.status, 200, JSON.stringify(value));
      return value;
    };
    let child = start();
    try {
      await ready(child);
      const before = await call("read_project");
      const after = await call("edit_project", {
        expectedRevision: before.revision,
        label: "重启验收",
        commands: [
          {
            type: "element.add",
            compositionId: "main",
            element: {
              id: "title",
              name: "重启文字",
              type: "text",
              text: "重启后仍然可编辑",
            },
          },
        ],
      });
      await call("set_selection", {
        compositionId: "main",
        elementIds: ["title"],
      });
      await call("set_preview", {
        compositionId: "main",
        progress: 6.4,
        sectionId: "stage",
      });
      await call("save_project", {
        expectedRevision: after.revision,
        filename: "restart",
      });
      const saved = await call("read_project");
      const duplicate = start();
      const [exitCode] = await once(duplicate, "exit");
      assert.notEqual(exitCode, 0);
      await stop(child);
      child = start();
      await ready(child);
      const restored = await call("read_project");
      assert.deepEqual(restored.project, saved.project);
      assert.equal(restored.revision, after.revision);
      assert.deepEqual(restored.selection.elementIds, ["title"]);
      assert.equal(restored.preview.progress, 6.4);
      assert.equal(restored.canUndo, false);
    } finally {
      await stop(child);
    }
  },
);
