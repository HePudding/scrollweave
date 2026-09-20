import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import os from "node:os";

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
        env: {
          ...process.env,
          PORT: String(port),
          SW_WORKSPACE: workspace,
          SW_LIBRARY_PATH: path.join(
            workspace,
            ".scrollweave",
            "library-test.json",
          ),
          SW_PROJECTS_DIR: path.join(workspace, "projects"),
        },
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
      const blockedPicker = await fetch(`${origin}/api/directories/pick`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://example.com",
        },
        body: JSON.stringify({ mode: "open" }),
      });
      assert.equal(blockedPicker.status, 403);
      const invalidPicker = await fetch(`${origin}/api/directories/pick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "unknown" }),
      });
      assert.equal(invalidPicker.status, 400);
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
      const library = await (await fetch(`${origin}/api/projects`)).json();
      const projectId = library.projects[0].id;
      assert.equal(library.projects[0].directory, workspace);
      const favorite = await fetch(`${origin}/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite: true }),
      });
      assert.equal(favorite.status, 200);
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
      const reopenedLibrary = await (
        await fetch(`${origin}/api/projects`)
      ).json();
      assert.equal(
        reopenedLibrary.projects.find((p: { id: string }) => p.id === projectId)
          .favorite,
        true,
      );

      // Real HTTP project creation/opening uses the same service and preserves the previous work.
      const parentDirectory = fs.mkdtempSync(
        path.join(os.tmpdir(), "scrollweave-home-http-"),
      );
      const createdResponse = await fetch(`${origin}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Homepage acceptance", parentDirectory }),
      });
      assert.equal(createdResponse.status, 200);
      const created = await createdResponse.json();
      const createdEntry = created.projects.find(
        (p: { active: boolean }) => p.active,
      );
      assert.equal(createdEntry.name, "Homepage acceptance");
      assert.equal(
        (await call("read_project")).project.compositions.main.elements.length,
        0,
      );
      const importResponse = await fetch(`${origin}/api/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Name": "test-image.png",
        },
        body: fs.readFileSync("tests/fixtures/test-image.png"),
      });
      assert.equal(importResponse.status, 200);
      const withCover = await (await fetch(`${origin}/api/projects`)).json();
      const cover = withCover.projects.find(
        (p: { id: string }) => p.id === createdEntry.id,
      ).thumbnail;
      const coverResponse = await fetch(origin + cover);
      assert.equal(coverResponse.status, 200);
      assert.match(coverResponse.headers.get("content-type")!, /image/);
      const conflict = await fetch(
        `${origin}/api/projects/${createdEntry.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Conflict", expectedRevision: 999 }),
        },
      );
      assert.equal(conflict.status, 409);
      const restoreResponse = await fetch(`${origin}/api/projects/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory: workspace }),
      });
      // Source-tree workspaces are fixture-only; the normal open API intentionally refuses them.
      assert.equal(restoreResponse.status, 400);
      await call("new_project", {
        directory: path.join(parentDirectory, "another"),
        name: "Another",
      });
      const opened = await fetch(`${origin}/api/projects/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ directory: createdEntry.directory }),
      });
      assert.equal(opened.status, 200);
      assert.equal(
        (await call("read_project")).project.name,
        "Homepage acceptance",
      );
      const removed = await fetch(`${origin}/api/projects/${createdEntry.id}`, {
        method: "DELETE",
      });
      assert.equal(removed.status, 200);
      assert.ok(
        fs.existsSync(
          path.join(createdEntry.directory, "assets", "test-image.png"),
        ),
      );
      assert.deepEqual(
        JSON.parse(
          fs.readFileSync(
            path.join(workspace, "project.scrollweave.json"),
            "utf8",
          ),
        ).project,
        saved.project,
      );
    } finally {
      await stop(child);
    }
  },
);
