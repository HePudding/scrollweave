import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Model,
  type Api,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { EditorAgent } from "../server/agent";
import { EditorService } from "../server/service";
import { ProjectStore } from "../src/core/commands";
import { blankProject } from "../src/core/model";
import type { AgentSnapshot, AgentProvider } from "../src/core/agent-types";
type TestStreamFn = (
  ...args: Parameters<StreamFn>
) => ReturnType<typeof createAssistantMessageEventStream>;

const model: Model<Api> = {
  id: "test-model",
  name: "Test model",
  api: "openai-completions",
  provider: "test",
  baseUrl: "http://127.0.0.1:1/v1",
  reasoning: false,
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 8192,
};
const provider: AgentProvider = {
  id: "test",
  name: "Test provider",
  api: "openai-completions",
  baseUrl: model.baseUrl,
  model: model.id,
  models: [model.id],
  enabled: true,
  hasApiKey: true,
};
function settings(streamFn: TestStreamFn, input = model.input) {
  return {
    publicSettings: () => ({ providers: [provider], activeProviderId: "test" }),
    resolveActive: () => ({
      provider,
      apiKey: "test-secret-key-1234",
      model: { ...model, input },
      streamFn,
    }),
  };
}
function response(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    stopReason,
    usage: {
      input: 1,
      output: 1,
      totalTokens: 2,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    timestamp: Date.now(),
  };
}
function completed(message: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "start", partial: response([]) });
  if (message.stopReason === "error" || message.stopReason === "aborted")
    stream.push({ type: "error", reason: message.stopReason, error: message });
  else
    stream.push({
      type: "done",
      reason: message.stopReason as "stop" | "toolUse",
      message,
    });
  return stream;
}
function waitFor(
  agent: EditorAgent,
  predicate: (snapshot: AgentSnapshot) => boolean,
): Promise<AgentSnapshot> {
  const now = agent.snapshot();
  if (predicate(now)) return Promise.resolve(now);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      agent.listeners.delete(listener);
      reject(Error("Timed out waiting for agent state"));
    }, 4000);
    const listener = (snapshot: AgentSnapshot) => {
      if (predicate(snapshot)) {
        clearTimeout(timer);
        agent.listeners.delete(listener);
        resolve(snapshot);
      }
    };
    agent.listeners.add(listener);
  });
}
async function fixture() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "scrollweave-agent-"),
  );
  const service = await EditorService.open(directory, 4198);
  return {
    service,
    close: async (agent: EditorAgent) => {
      await agent.close();
      await service.close();
      await fs.rm(directory, { recursive: true, force: true });
    },
  };
}

test("real Pi loop streams feedback and executes ordered shared editor transactions", async () => {
  const f = await fixture();
  let calls = 0;
  const contexts: TranscriptContext[] = [];
  let finishFirst!: () => void;
  const streamFn: TestStreamFn = (_model, context) => {
    contexts.push(structuredClone(context));
    if (++calls !== 1)
      return completed(
        response([{ type: "text", text: "已调整作品，并检查当前版本。" }]),
      );
    const stream = createAssistantMessageEventStream();
    const partial = response([{ type: "text", text: "正在调整作品标题。" }]);
    stream.push({ type: "start", partial: response([]) });
    stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: "正在调整作品标题。",
      partial,
    });
    finishFirst = () =>
      stream.push({
        type: "done",
        reason: "toolUse",
        message: response(
          [
            ...partial.content,
            {
              type: "toolCall",
              id: "edit-1",
              name: "edit_project",
              arguments: {
                expectedRevision: 0,
                commands: [{ type: "project.update", patch: { name: "初稿" } }],
              },
            },
            {
              type: "toolCall",
              id: "edit-2",
              name: "edit_project",
              arguments: {
                expectedRevision: 1,
                commands: [
                  { type: "project.update", patch: { name: "完成稿" } },
                ],
              },
            },
          ],
          "toolUse",
        ),
      });
    return stream;
  };
  const agent = new EditorAgent(f.service, settings(streamFn));
  const updates: AgentSnapshot[] = [];
  agent.listeners.add((snapshot) => updates.push(snapshot));
  try {
    const initial = agent.prompt("调整标题", f.service.store.project.id);
    assert.equal(initial.running, true);
    await waitFor(agent, (snapshot) =>
      snapshot.entries.some((entry) => entry.text.includes("正在调整作品标题")),
    );
    assert.equal(
      f.service.store.revision,
      0,
      "text becomes visible before any edit completes",
    );
    assert.throws(
      () => agent.prompt("重叠任务", f.service.store.project.id),
      /正在处理/,
    );
    assert.throws(() => agent.reset(), /请先停止/);
    finishFirst();
    const end = await waitFor(agent, (snapshot) => !snapshot.running);
    assert.equal(f.service.store.project.name, "完成稿");
    assert.equal(f.service.store.revision, 2);
    assert.equal(end.status, "已完成");
    assert.deepEqual(
      end.entries
        .filter((entry) => entry.kind === "tool")
        .map((entry) => entry.revision),
      [1, 2],
    );
    assert.ok(
      updates.some((snapshot) =>
        snapshot.entries.some(
          (entry) => entry.kind === "tool" && entry.status === "running",
        ),
      ),
    );
    const contextText = JSON.stringify(contexts[0]);
    assert.ok(
      contextText.includes("editor_context") &&
        contextText.includes("selection") &&
        contextText.includes("preview"),
    );
    const system = contexts[0].messages.find(
      (message) => message.role === "system",
    );
    assert.ok(system?.toolsAdded?.length);
    assert.ok(
      !system.toolsAdded.some((tool) =>
        ["open_project", "new_project"].includes(tool.name),
      ),
    );
    assert.equal(
      contexts[1].messages.filter((message) => message.role === "toolResult")
        .length,
      2,
    );
  } finally {
    await f.close(agent);
  }
});

test("revision conflicts stay visible and never overwrite concurrent human edits", async () => {
  const f = await fixture();
  let calls = 0;
  let conflictContext = "";
  const streamFn: TestStreamFn = (_model, context) => {
    if (++calls > 1) {
      conflictContext = JSON.stringify(context);
      return completed(
        response([{ type: "text", text: "发现新版本，已保留你的修改。" }]),
      );
    }
    f.service.store.commit(
      [{ type: "project.update", patch: { name: "用户刚刚修改" } }],
      0,
      "用户修改",
    );
    return completed(
      response(
        [
          {
            type: "toolCall",
            id: "conflict",
            name: "edit_project",
            arguments: {
              expectedRevision: 0,
              commands: [
                { type: "project.update", patch: { name: "旧状态修改" } },
              ],
            },
          },
        ],
        "toolUse",
      ),
    );
  };
  const agent = new EditorAgent(f.service, settings(streamFn));
  try {
    agent.prompt("改个标题", f.service.store.project.id);
    const end = await waitFor(agent, (snapshot) => !snapshot.running);
    assert.equal(f.service.store.project.name, "用户刚刚修改");
    assert.equal(f.service.store.revision, 1);
    const tools = end.entries.filter((entry) => entry.kind === "tool");
    assert.equal(tools.length, 1);
    assert.equal(tools[0].status, "error");
    assert.match(tools[0].detail!, /REVISION_CONFLICT/);
    assert.match(conflictContext, /actualRevision/);
  } finally {
    await f.close(agent);
  }
});

test("abort is observable, settled before reset, and provider errors redact credentials", async () => {
  const f = await fixture();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0;
  const streamFn: TestStreamFn = (_model, _context, options) => {
    if (++calls > 1)
      return completed({
        ...response([], "error"),
        errorMessage:
          "Request rejected: test-secret-key-1234 Authorization: Bearer other-secret",
      });
    const stream = createAssistantMessageEventStream();
    options?.signal?.addEventListener(
      "abort",
      () =>
        stream.push({
          type: "error",
          reason: "aborted",
          error: { ...response([], "aborted"), errorMessage: "aborted" },
        }),
      { once: true },
    );
    started();
    return stream;
  };
  const agent = new EditorAgent(f.service, settings(streamFn));
  try {
    agent.prompt("测试停止", f.service.store.project.id);
    await ready;
    assert.equal(agent.abort().status, "正在停止");
    assert.throws(() => agent.reset(), /请先停止/);
    let end = await waitFor(agent, (snapshot) => !snapshot.running);
    assert.match(end.status, /已停止/);
    assert.equal(agent.reset().entries.length, 0);
    agent.prompt("测试错误", f.service.store.project.id);
    end = await waitFor(agent, (snapshot) => !snapshot.running);
    assert.match(end.status, /运行失败/);
    assert.ok(end.entries.some((entry) => entry.kind === "error"));
    assert.ok(!JSON.stringify(end).includes("test-secret-key-1234"));
    assert.ok(!JSON.stringify(end).includes("other-secret"));
  } finally {
    await f.close(agent);
  }
});

test("workspace/project changes abort the old task and block late tools against the new project", async () => {
  const f = await fixture();
  let finish!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const streamFn: TestStreamFn = (_model, _context, options) => {
    const stream = createAssistantMessageEventStream();
    options?.signal?.addEventListener(
      "abort",
      () =>
        stream.push({
          type: "error",
          reason: "aborted",
          error: { ...response([], "aborted"), errorMessage: "aborted" },
        }),
      { once: true },
    );
    finish = () =>
      stream.push({
        type: "done",
        reason: "toolUse",
        message: response(
          [
            {
              type: "toolCall",
              id: "late",
              name: "edit_project",
              arguments: {
                expectedRevision: 0,
                commands: [
                  { type: "project.update", patch: { name: "不应发生" } },
                ],
              },
            },
          ],
          "toolUse",
        ),
      });
    started();
    return stream;
  };
  const agent = new EditorAgent(f.service, settings(streamFn));
  try {
    const previousId = f.service.store.project.id;
    agent.prompt("旧作品任务", previousId);
    await ready;
    f.service.store = new ProjectStore({ ...blankProject(), name: "新作品" });
    f.service.emit();
    assert.equal(agent.snapshot().entries.length, 0);
    finish();
    const end = await waitFor(agent, (snapshot) => !snapshot.running);
    assert.equal(f.service.store.project.name, "新作品");
    assert.equal(f.service.store.revision, 0);
    assert.equal(end.entries.length, 0);
    assert.equal(end.projectId, f.service.store.project.id);
    assert.notEqual(end.projectId, previousId);
    assert.throws(() => agent.prompt("过时请求", previousId), /作品已切换/);
  } finally {
    await f.close(agent);
  }
});

test("workspace replacement with the same project ID clears active and future model context", async () => {
  const f = await fixture();
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0;
  let latestContext = "";
  const streamFn: TestStreamFn = (_model, context, options) => {
    if (++calls > 1) {
      latestContext = JSON.stringify(context);
      return completed(response([{ type: "text", text: "新作品已读取" }]));
    }
    const stream = createAssistantMessageEventStream();
    options?.signal?.addEventListener(
      "abort",
      () =>
        stream.push({
          type: "error",
          reason: "aborted",
          error: { ...response([], "aborted"), errorMessage: "aborted" },
        }),
      { once: true },
    );
    started();
    return stream;
  };
  const agent = new EditorAgent(f.service, settings(streamFn));
  try {
    const id = f.service.store.project.id;
    agent.prompt("旧上下文唯一标识", id);
    await ready;
    await f.service.run("edit_project", {
      expectedRevision: f.service.store.revision,
      commands: [
        {
          type: "project.replace",
          project: { ...blankProject(), id, name: "同 ID 替换作品" },
        },
      ],
    });
    const cleared = await waitFor(agent, (snapshot) => !snapshot.running);
    assert.equal(cleared.entries.length, 0);
    agent.prompt("读取替换后的作品", id);
    await waitFor(agent, (snapshot) => !snapshot.running);
    assert.ok(!latestContext.includes("旧上下文唯一标识"));
    assert.ok(latestContext.includes("同 ID 替换作品"));
  } finally {
    await f.close(agent);
  }
});

test("tool execution is blocked as soon as workspace switching begins", async () => {
  const f = await fixture();
  const streamFn: TestStreamFn = () => {
    f.service.switching = true;
    return completed(
      response(
        [
          {
            type: "toolCall",
            id: "switching",
            name: "edit_project",
            arguments: {
              expectedRevision: 0,
              commands: [
                { type: "project.update", patch: { name: "不应发生" } },
              ],
            },
          },
        ],
        "toolUse",
      ),
    );
  };
  const agent = new EditorAgent(f.service, settings(streamFn));
  try {
    const original = f.service.store.project.name;
    agent.prompt("测试切换间隙", f.service.store.project.id);
    const end = await waitFor(agent, (snapshot) => !snapshot.running);
    assert.equal(f.service.store.project.name, original);
    assert.equal(f.service.store.revision, 0);
    assert.match(end.status, /作品已切换/);
  } finally {
    f.service.switching = false;
    await f.close(agent);
  }
});

test("stopping a real asset wait cancels its 30 second poll promptly", async () => {
  const f = await fixture();
  let waiting!: () => void;
  const ready = new Promise<void>((resolve) => {
    waiting = resolve;
  });
  const originalWait = f.service.assets.waitFor.bind(f.service.assets);
  let signalReceived: AbortSignal | undefined;
  f.service.assets.waitFor = (query, signal) => {
    signalReceived = signal;
    const result = originalWait(query, signal);
    waiting();
    return result;
  };
  const streamFn: TestStreamFn = () =>
    completed(
      response(
        [
          {
            type: "toolCall",
            id: "wait",
            name: "wait_for_asset",
            arguments: { name: "missing.svg", timeoutMs: 30000 },
          },
        ],
        "toolUse",
      ),
    );
  const agent = new EditorAgent(f.service, settings(streamFn));
  try {
    agent.prompt("等待素材", f.service.store.project.id);
    await ready;
    const startedAt = Date.now();
    await agent.abortAndWait();
    assert.ok(
      Date.now() - startedAt < 1500,
      "stop must not wait for the asset timeout",
    );
    assert.equal(signalReceived?.aborted, true);
    assert.equal(agent.snapshot().running, false);
    assert.match(agent.snapshot().status, /已停止/);
  } finally {
    await f.close(agent);
  }
});

test("real project import acquires its gate before cancelling tools and resets same-ID context", async () => {
  const f = await fixture();
  let waiting!: () => void;
  const ready = new Promise<void>((resolve) => {
    waiting = resolve;
  });
  const originalWait = f.service.assets.waitFor.bind(f.service.assets);
  f.service.assets.waitFor = (query, signal) => {
    const result = originalWait(query, signal);
    waiting();
    return result;
  };
  const streamFn: TestStreamFn = () =>
    completed(
      response(
        [
          {
            type: "toolCall",
            id: "wait-import",
            name: "wait_for_asset",
            arguments: { name: "missing.svg", timeoutMs: 30000 },
          },
        ],
        "toolUse",
      ),
    );
  const agent = new EditorAgent(f.service, settings(streamFn));
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  let enteredGate!: () => void;
  const atGate = new Promise<void>((resolve) => {
    enteredGate = resolve;
  });
  f.service.beforeWorkspaceChange = async () => {
    assert.equal(f.service.switching, true);
    await agent.abortAndWait();
    enteredGate();
    await gate;
  };
  try {
    const id = f.service.store.project.id;
    agent.prompt("即将被导入替换的旧任务", id);
    await ready;
    const startedAt = Date.now();
    const imported = f.service.importProject(
      Buffer.from(
        JSON.stringify({ ...blankProject(), id, name: "导入替换作品" }),
      ),
    );
    await atGate;
    assert.ok(
      Date.now() - startedAt < 1500,
      "import should cancel the asset wait promptly",
    );
    await assert.rejects(
      f.service.run("edit_project", {
        expectedRevision: f.service.store.revision,
        commands: [
          { type: "project.update", patch: { name: "导入期间不应修改" } },
        ],
      }),
      /正在切换/,
    );
    releaseGate();
    await imported;
    assert.equal(f.service.switching, false);
    assert.equal(f.service.store.project.id, id);
    assert.equal(f.service.store.project.name, "导入替换作品");
    assert.equal(agent.snapshot().running, false);
    assert.deepEqual(agent.snapshot().entries, []);
  } finally {
    releaseGate();
    await f.close(agent);
  }
});

test("agent same-ID project replacement commits once and discards the old tool batch", async () => {
  const f = await fixture();
  let calls = 0;
  const replacement = {
    ...blankProject(),
    id: f.service.store.project.id,
    name: "Agent 替换作品",
  };
  const streamFn: TestStreamFn = () => {
    calls++;
    return completed(
      response(
        [
          {
            type: "toolCall",
            id: "replace",
            name: "edit_project",
            arguments: {
              expectedRevision: 0,
              commands: [
                {
                  type: "project.replace",
                  project: JSON.parse(JSON.stringify(replacement)),
                },
              ],
            },
          },
          {
            type: "toolCall",
            id: "stale-edit",
            name: "edit_project",
            arguments: {
              expectedRevision: 1,
              commands: [
                { type: "project.update", patch: { name: "旧工具不应继续" } },
              ],
            },
          },
        ],
        "toolUse",
      ),
    );
  };
  const agent = new EditorAgent(f.service, settings(streamFn));
  try {
    agent.prompt("替换作品", f.service.store.project.id);
    const end = await waitFor(agent, (snapshot) => !snapshot.running);
    assert.equal(calls, 1);
    assert.equal(f.service.store.revision, 1);
    assert.equal(f.service.store.project.name, "Agent 替换作品");
    assert.deepEqual(end.entries, []);
  } finally {
    await f.close(agent);
  }
});

test("cancelling a screenshot closes its page without closing the shared browser", async () => {
  const f = await fixture();
  let captureStarted!: () => void;
  const ready = new Promise<void>((resolve) => {
    captureStarted = resolve;
  });
  let rejectLoad!: (error: Error) => void;
  let pageClosed = false;
  let browserClosed = false;
  const fakePage = {
    on() {},
    setContent: () =>
      new Promise<void>((_resolve, reject) => {
        rejectLoad = reject;
        captureStarted();
      }),
    close: async () => {
      pageClosed = true;
      rejectLoad?.(Error("capture closed"));
    },
  };
  f.service.browser = {
    newPage: async () => fakePage,
    close: async () => {
      browserClosed = true;
    },
  } as unknown as NonNullable<EditorService["browser"]>;
  const agent = new EditorAgent(
    f.service,
    settings(() => completed(response([]))),
  );
  try {
    const controller = new AbortController();
    const capture = f.service.run(
      "get_preview_screenshot",
      {},
      controller.signal,
    );
    await ready;
    controller.abort();
    await assert.rejects(capture, /capture closed/);
    assert.equal(pageClosed, true);
    assert.equal(browserClosed, false);
  } finally {
    await f.close(agent);
  }
});

test("screenshots reach vision models but never enter the public transcript", async () => {
  for (const supportsImages of [true, false]) {
    const f = await fixture();
    const originalRun = f.service.run.bind(f.service);
    f.service.run = async (name, args) =>
      name === "get_preview_screenshot"
        ? {
            data: "private-image-base64",
            mimeType: "image/png",
            errors: [],
            revision: 0,
          }
        : originalRun(name, args);
    let calls = 0;
    let receivedImage = false;
    let resultText = "";
    const streamFn: TestStreamFn = (_model, context) => {
      if (++calls === 1)
        return completed(
          response(
            [
              {
                type: "toolCall",
                id: "screenshot",
                name: "get_preview_screenshot",
                arguments: {},
              },
            ],
            "toolUse",
          ),
        );
      const result = context.messages.find(
        (message) => message.role === "toolResult",
      );
      assert.ok(result && result.role === "toolResult");
      receivedImage = result.content.some((block) => block.type === "image");
      resultText = JSON.stringify(result.content);
      return completed(response([{ type: "text", text: "检查完成" }]));
    };
    const agent = new EditorAgent(
      f.service,
      settings(streamFn, supportsImages ? ["text", "image"] : ["text"]),
    );
    try {
      agent.prompt("检查预览", f.service.store.project.id);
      const end = await waitFor(agent, (snapshot) => !snapshot.running);
      assert.equal(receivedImage, supportsImages);
      assert.ok(!JSON.stringify(end).includes("private-image-base64"));
      if (!supportsImages) assert.match(resultText, /当前模型不支持图片/);
    } finally {
      await f.close(agent);
    }
  }
});

test("bounded tool loops stop and keep completed changes reviewable", async () => {
  const f = await fixture();
  let calls = 0;
  const streamFn: TestStreamFn = () =>
    completed(
      response(
        [
          {
            type: "toolCall",
            id: "loop-" + ++calls,
            name: "read_project",
            arguments: {},
          },
        ],
        "toolUse",
      ),
    );
  const agent = new EditorAgent(f.service, settings(streamFn), {
    maxToolCalls: 2,
  });
  try {
    agent.prompt("测试上限", f.service.store.project.id);
    const end = await waitFor(agent, (snapshot) => !snapshot.running);
    assert.match(end.status, /操作限制/);
    assert.equal(calls, 3);
    assert.equal(
      end.entries.filter(
        (entry) => entry.kind === "tool" && entry.status === "done",
      ).length,
      2,
    );
  } finally {
    await f.close(agent);
  }
});
