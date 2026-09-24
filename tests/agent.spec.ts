import { test, expect } from "@playwright/test";
import http from "node:http";
import type { AddressInfo } from "node:net";

let providerServer: http.Server;
let baseUrl: string;
const requests: any[] = [];
test.describe.configure({ timeout: 30000 });

test.beforeAll(async () => {
  providerServer = http.createServer(async (req, res) => {
    if (req.url === "/v1/models") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "scrollweave-fixture" }] }));
      return;
    }
    let raw = "";
    for await (const part of req) raw += part;
    const body = JSON.parse(raw);
    requests.push(body);
    const messages: any[] = body.messages ?? [];
    const reverseUserIndex = [...messages]
      .reverse()
      .findIndex((message) => message.role === "user");
    const userIndex =
      reverseUserIndex < 0 ? -1 : messages.length - reverseUserIndex - 1;
    const userText = JSON.stringify(messages[userIndex]);
    if (userText.includes("失败演示")) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: {
            message: "fixture-secret invalid API key",
            type: "authentication_error",
          },
        }),
      );
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    const chunk = (delta: unknown, finish: string | null = null) =>
      res.write(
        `data: ${JSON.stringify({
          id: "fixture-completion",
          object: "chat.completion.chunk",
          created: 1,
          model: body.model,
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`,
      );
    const end = (reason = "stop") => {
      chunk({}, reason);
      res.end("data: [DONE]\n\n");
    };
    chunk({ role: "assistant" });
    if (userText.includes("暂停演示")) {
      chunk({ content: "正在等待停止操作。" });
      const heartbeat = setInterval(() => res.write(": waiting\n\n"), 250);
      res.on("close", () => clearInterval(heartbeat));
      return;
    }
    // The provider fixture speaks the real streaming protocol. Pi still validates
    // and executes real editor tools, so edits/undo/SSE are exercised end to end.
    const current = messages.slice(userIndex + 1);
    const tool = current.filter((message) => message.role === "tool").at(-1);
    const invoke = (id: string, name: string, args: unknown) => {
      chunk({
        tool_calls: [
          {
            index: 0,
            id,
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      });
      end("tool_calls");
    };
    if (!body.tools?.length) {
      chunk({ content: "OK" });
      end();
    } else if (!tool) {
      chunk({ content: "我先读取当前作品。" });
      invoke("call_read", "read_project", {});
    } else if (tool.tool_call_id === "call_read") {
      const snapshot = JSON.parse(
        typeof tool.content === "string" ? tool.content : tool.content[0].text,
      );
      chunk({ content: "已读取项目，现在更新作品名称。" });
      invoke("call_edit", "edit_project", {
        expectedRevision: snapshot.revision,
        label: "Pi 修改作品名称",
        commands: [
          { type: "project.update", patch: { name: "Pi 实时编辑验证" } },
        ],
      });
    } else if (tool.tool_call_id === "call_edit") {
      invoke("call_validate", "validate_project", {});
    } else {
      chunk({ content: "已将作品名称改为 Pi 实时编辑验证，项目检查通过。" });
      end();
    }
  });
  await new Promise<void>((resolve) =>
    providerServer.listen(0, "127.0.0.1", resolve),
  );
  baseUrl = `http://127.0.0.1:${(providerServer.address() as AddressInfo).port}/v1`;
});

test.afterAll(async () => {
  providerServer.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    providerServer.close((error) => (error ? reject(error) : resolve())),
  );
});

test("provider settings can add, discover, test, save and reopen a custom connection", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "设置 · 模型服务商", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "模型服务商" });
  await dialog.getByRole("button", { name: "添加服务商", exact: true }).click();
  await dialog.getByRole("button", { name: /自定义服务商/ }).click();
  await dialog.getByLabel("服务商名称", { exact: true }).fill("GUI 测试连接");
  await dialog.getByLabel("API 地址").fill(baseUrl);
  await dialog.getByLabel("API 密钥", { exact: true }).fill("fixture-secret");
  await dialog.getByRole("button", { name: "获取模型", exact: true }).click();
  await expect(
    dialog.getByText("已获取 1 个模型", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("textbox", { name: "当前模型", exact: true })
    .fill("scrollweave-fixture");
  await dialog.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(dialog.getByText(/连接成功，模型/)).toBeVisible();
  await dialog
    .getByRole("button", { name: "设为当前服务商", exact: true })
    .click();
  await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(
    dialog.getByText("设置已保存，可以回到项目开始创作。", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/pi-agent-providers.png" });
  await dialog
    .getByRole("button", { name: "关闭模型设置", exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("button", { name: "设置 · 模型服务商", exact: true })
    .click();
  await expect(dialog.getByLabel("服务商名称", { exact: true })).toHaveValue(
    "GUI 测试连接",
  );
  await expect(dialog.getByLabel("API 密钥", { exact: true })).toHaveValue("");
  await expect(
    dialog.getByRole("textbox", { name: "当前模型", exact: true }),
  ).toHaveValue("scrollweave-fixture");
  const saved = await (await request.get("/api/agent/settings")).json();
  expect(
    saved.providers.find((entry: any) => entry.id === saved.activeProviderId)
      .name,
  ).toBe("GUI 测试连接");
  expect(JSON.stringify(saved)).not.toContain("fixture-secret");
});

test("Pi provider configuration, streamed tool edits, undo, cancellation and redacted failures", async ({
  page,
  request,
}) => {
  const settings = await (await request.get("/api/agent/settings")).json();
  const provider = {
    id: "fixture",
    name: "本地测试提供商",
    api: "openai-completions",
    baseUrl,
    model: "scrollweave-fixture",
    models: ["scrollweave-fixture"],
    enabled: true,
    apiKey: "fixture-secret",
  };
  const save = await request.put("/api/agent/settings", {
    data: {
      providers: [...settings.providers, provider],
      activeProviderId: provider.id,
    },
  });
  expect(save.ok(), await save.text()).toBeTruthy();
  const publicSettings = await save.json();
  expect(JSON.stringify(publicSettings)).not.toContain("fixture-secret");
  expect(
    publicSettings.providers.find((item: any) => item.id === provider.id)
      .hasApiKey,
  ).toBe(true);
  expect(
    (
      await request.post("/api/agent/providers/models", {
        data: { provider: { ...provider, apiKey: "" } },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.post("/api/agent/providers/test", {
        data: { provider: { ...provider, apiKey: "" } },
      })
    ).ok(),
  ).toBeTruthy();

  const before = await (await request.get("/api/state")).json();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/editor");
  await page
    .getByRole("button", { name: "展开 Pi 创作助手", exact: true })
    .click();
  const input = page.getByRole("textbox", { name: "给 Pi 的创作指令" });
  await input.fill("将当前作品改名为 Pi 实时编辑验证");
  await page.getByRole("button", { name: "发送给 Pi", exact: true }).click();
  await expect(
    page.getByText("已将作品名称改为 Pi 实时编辑验证，项目检查通过。", {
      exact: true,
    }),
  ).toBeVisible();
  const edited = await (await request.get("/api/state")).json();
  expect(edited.project.name).toBe("Pi 实时编辑验证");
  expect(edited.revision).toBeGreaterThan(before.revision);
  const transcript = await (await request.get("/api/agent/state")).json();
  expect(transcript.running).toBe(false);
  expect(
    transcript.entries.some(
      (entry: any) =>
        entry.kind === "tool" &&
        entry.toolName === "edit_project" &&
        entry.status === "done",
    ),
  ).toBe(true);
  expect(
    requests.some((body) => JSON.stringify(body.messages).includes("源时钟")),
  ).toBe(true);
  await page.screenshot({ path: "test-results/pi-agent-editor.png" });
  const undo = await request.post("/api/action", {
    data: { name: "undo", args: { expectedRevision: edited.revision } },
  });
  expect(undo.ok()).toBe(true);
  expect((await (await request.get("/api/state")).json()).project.name).toBe(
    before.project.name,
  );

  await input.fill("暂停演示");
  await page.getByRole("button", { name: "发送给 Pi", exact: true }).click();
  await expect(
    page.getByText("正在等待停止操作。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "停止", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/agent/state")).json()).running,
    )
    .toBe(false);
  await input.fill("失败演示");
  await page.getByRole("button", { name: "发送给 Pi", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/agent/state")).json()).running,
    )
    .toBe(false);
  const failed = await (await request.get("/api/agent/state")).json();
  expect(failed.entries.some((entry: any) => entry.kind === "error")).toBe(
    true,
  );
  expect(JSON.stringify(failed)).not.toContain("fixture-secret");
  await page.reload();
  await page
    .getByRole("button", { name: "展开 Pi 创作助手", exact: true })
    .click();
  await expect(
    page.getByText("已将作品名称改为 Pi 实时编辑验证，项目检查通过。", {
      exact: true,
    }),
  ).toBeVisible();
  expect(errors).toEqual([]);
  const alternate = publicSettings.providers.find(
    (entry: any) => entry.name === "GUI 测试连接",
  );
  if (alternate) {
    await page.getByLabel("切换模型服务商").selectOption(alternate.id);
    await expect
      .poll(
        async () =>
          (await (await request.get("/api/agent/settings")).json())
            .activeProviderId,
      )
      .toBe(alternate.id);
  }
});
