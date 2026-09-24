import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { hasApi } from "@earendil-works/pi-ai";
import { AgentSettingsStore } from "../server/agent-settings";
import type { ProviderInput } from "../src/core/agent-types";

function fixture(t: test.TestContext) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "scrollweave-agent-settings-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "agent-settings.json");
  return { file, store: new AgentSettingsStore(file) };
}

function provider(overrides: Partial<ProviderInput> = {}): ProviderInput {
  return {
    id: "custom",
    name: "My server",
    api: "openai-completions",
    baseUrl: "http://localhost:11434/v1",
    model: "custom-model",
    models: ["custom-model"],
    enabled: true,
    ...overrides,
  };
}

function settings(input: ProviderInput) {
  return { providers: [input], activeProviderId: input.id };
}

async function localServer(
  t: test.TestContext,
  listener: http.RequestListener,
) {
  const server = http.createServer(listener);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

test("provider credentials persist privately, retain on blank writes, and clear explicitly", (t) => {
  const { store, file } = fixture(t);
  assert.equal(store.publicSettings().providers.length, 6);
  assert.equal(
    fs.existsSync(file),
    false,
    "merely reading defaults never creates a settings file",
  );
  const result = store.save(settings(provider({ apiKey: "sk-private-test" })));
  assert.equal(result.providers[0].hasApiKey, true);
  assert.equal(JSON.stringify(result).includes("sk-private-test"), false);
  assert.equal("apiKey" in result.providers[0], false);
  assert.equal(
    new AgentSettingsStore(file).resolveActive().apiKey,
    "sk-private-test",
  );
  store.save(settings(provider()));
  store.save(settings(provider({ apiKey: "  " })));
  assert.equal(store.resolveActive().apiKey, "sk-private-test");
  if (process.platform !== "win32")
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  store.save(settings(provider({ clearApiKey: true })));
  assert.equal(store.publicSettings().providers[0].hasApiKey, false);
  assert.equal(
    fs.readFileSync(file, "utf8").includes("sk-private-test"),
    false,
  );
  assert.equal(
    new AgentSettingsStore(file).resolveActive().apiKey,
    "scrollweave-local",
  );
  assert.equal(
    fs.readdirSync(path.dirname(file)).some((name) => name.endsWith(".tmp")),
    false,
  );
});

test("public settings are detached snapshots and save validates before touching stored data", (t) => {
  const { store, file } = fixture(t);
  store.save(settings(provider({ apiKey: "secret" })));
  const original = fs.readFileSync(file, "utf8");
  const view = store.publicSettings();
  view.providers[0].models.push("mutated");
  view.providers[0].name = "mutated";
  assert.equal(
    store.publicSettings().providers[0].models.includes("mutated"),
    false,
  );
  assert.notEqual(store.publicSettings().providers[0].name, "mutated");
  const invalid = [
    settings(provider({ api: "unsupported" as ProviderInput["api"] })),
    settings(provider({ baseUrl: "ftp://example.com" })),
    settings(provider({ baseUrl: "https://secret:secret@example.com/v1" })),
    settings(provider({ baseUrl: "https://example.com/v1?key=secret" })),
    settings(provider({ baseUrl: "https://example.com/v1#secret" })),
    settings(provider({ baseUrl: "not a URL" })),
    settings(provider({ model: "" })),
    settings(provider({ enabled: false })),
    { providers: [provider(), provider()], activeProviderId: "custom" },
    { providers: [provider()], activeProviderId: "missing" },
  ];
  for (const input of invalid) assert.throws(() => store.save(input));
  assert.equal(fs.readFileSync(file, "utf8"), original);
  assert.equal(store.resolveActive().apiKey, "secret");
});

test("changing API addresses cannot forward retained secrets without explicit replacement or clear", async (t) => {
  const { store } = fixture(t);
  store.save(settings(provider({ apiKey: "old-secret" })));
  const moved = provider({ baseUrl: "https://different.example/v1" });
  assert.throws(() => store.save(settings(moved)), /重新填写 API Key/);
  await assert.rejects(store.listModels(moved), /重新填写 API Key/);
  await assert.rejects(store.testProvider(moved), /重新填写 API Key/);
  assert.equal(store.resolveActive().apiKey, "old-secret");
  store.save(settings({ ...moved, apiKey: "new-secret" }));
  assert.equal(store.resolveActive().apiKey, "new-secret");
  store.save(settings(provider({ clearApiKey: true })));
  assert.equal(store.publicSettings().providers[0].hasApiKey, false);
});

test("built-in metadata is reused while custom models and local keyless endpoints remain supported", (t) => {
  const { store } = fixture(t);
  const anthropic = provider({
    id: "my-anthropic",
    api: "anthropic-messages",
    baseUrl: "https://api.anthropic.com/v1/",
    model: "claude-sonnet-4-6",
    apiKey: "sk-test",
  });
  store.save(settings(anthropic));
  const resolved = store.resolveActive();
  assert.equal(resolved.model.api, "anthropic-messages");
  assert.equal(resolved.model.baseUrl, "https://api.anthropic.com");
  assert.equal(resolved.model.provider, "my-anthropic");
  assert.equal(resolved.model.id, "claude-sonnet-4-6");
  assert.ok(resolved.model.contextWindow >= 200000);
  assert.equal(typeof resolved.streamFn, "function");
  store.save(settings(provider()));
  const custom = store.resolveActive();
  assert.equal(custom.model.id, "custom-model");
  assert.ok(hasApi(custom.model, "openai-completions"));
  assert.equal(custom.model.compat?.supportsDeveloperRole, false);
  assert.equal(custom.model.compat?.supportsStrictMode, false);
  assert.equal(custom.apiKey, "scrollweave-local");
  store.save(settings(provider({ baseUrl: "https://example.com/v1" })));
  assert.throws(() => store.resolveActive(), /API Key/);
});

test("lists OpenAI, Anthropic, and native Google models with the correct paths and headers", async (t) => {
  const { store } = fixture(t);
  const requests: { url: string; headers: http.IncomingHttpHeaders }[] = [];
  const root = await localServer(t, (request, response) => {
    requests.push({ url: request.url!, headers: request.headers });
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify(
        request.url === "/v1beta/models"
          ? {
              models: [
                {
                  name: "models/gemini-test",
                  supportedGenerationMethods: ["generateContent"],
                },
                {
                  name: "models/embedding-test",
                  supportedGenerationMethods: ["embedContent"],
                },
              ],
            }
          : {
              data: [
                { id: "model-b" },
                { id: "model-a" },
                { id: "model-a" },
                { id: "echo-test-key" },
              ],
            },
      ),
    );
  });
  assert.deepEqual(
    await store.listModels(
      provider({ baseUrl: `${root}/v1`, apiKey: "test-key", model: "", models: [] }),
    ),
    { models: ["model-a", "model-b"] },
  );
  assert.deepEqual(
    await store.listModels(
      provider({
        api: "anthropic-messages",
        baseUrl: `${root}/v1`,
        apiKey: "test-key",
      }),
    ),
    { models: ["model-a", "model-b"] },
  );
  assert.deepEqual(
    await store.listModels(
      provider({
        api: "google-generative-ai",
        baseUrl: root,
        apiKey: "test-key",
      }),
    ),
    { models: ["gemini-test"] },
  );
  assert.deepEqual(
    requests.map((entry) => entry.url),
    ["/v1/models", "/v1/models", "/v1beta/models"],
  );
  assert.equal(requests[0].headers.authorization, "Bearer test-key");
  assert.equal(requests[1].headers["x-api-key"], "test-key");
  assert.equal(requests[1].headers["anthropic-version"], "2023-06-01");
  assert.equal(requests[2].headers["x-goog-api-key"], "test-key");
  assert.equal(requests[2].headers.authorization, undefined);
});

test("connection test performs a real streamed model request with tool schema, without saving drafts", async (t) => {
  const { store, file } = fixture(t);
  let calls = 0;
  let payload: Record<string, unknown> = {};
  const root = await localServer(t, (request, response) => {
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.headers.authorization, "Bearer draft-secret");
    calls++;
    let body = "";
    request.on("data", (chunk) => {
      body += String(chunk);
    });
    request.on("end", () => {
      payload = JSON.parse(body);
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write(
        `data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", created: 1, model: "custom-model", choices: [{ index: 0, delta: { role: "assistant", content: "OK" }, finish_reason: null }] })}\n\n`,
      );
      response.write(
        `data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", created: 1, model: "custom-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
      );
      response.end("data: [DONE]\n\n");
    });
  });
  const result = await store.testProvider(
    provider({ baseUrl: `${root}/v1`, apiKey: "draft-secret" }),
  );
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.equal(payload.model, "custom-model");
  assert.equal(payload.stream, true);
  assert.ok(Array.isArray(payload.tools) && payload.tools.length === 1);
  assert.equal(payload.store, undefined);
  assert.equal(payload.stream_options, undefined);
  assert.equal(fs.existsSync(file), false);
  assert.equal(
    store.publicSettings().providers.some((entry) => entry.hasApiKey),
    false,
  );
});

test("provider errors and redirects never expose upstream body or send keys to a redirected host", async (t) => {
  const { store } = fixture(t);
  let redirectedCalls = 0;
  const other = await localServer(t, (_request, response) => {
    redirectedCalls++;
    response.end("{}");
  });
  const root = await localServer(t, (request, response) => {
    if (request.url === "/redirect/models") {
      response.writeHead(302, { Location: `${other}/models` });
      response.end();
    } else {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          error: {
            message: "upstream echoes sensitive-secret",
            type: "authentication_error",
          },
        }),
      );
    }
  });
  for (const operation of [
    () =>
      store.listModels(
        provider({ baseUrl: `${root}/v1`, apiKey: "sensitive-secret" }),
      ),
    () =>
      store.testProvider(
        provider({ baseUrl: `${root}/v1`, apiKey: "sensitive-secret" }),
      ),
    () =>
      store.listModels(
        provider({ baseUrl: `${root}/redirect`, apiKey: "sensitive-secret" }),
      ),
  ]) {
    await assert.rejects(
      operation,
      (error: Error) =>
        !error.message.includes("sensitive-secret") &&
        !error.message.includes("upstream"),
    );
  }
  assert.equal(redirectedCalls, 0);
});

test("malformed persisted settings fail safely without echoing their contents", (t) => {
  const { file } = fixture(t);
  fs.writeFileSync(file, '{"apiKey":"private-do-not-echo"');
  assert.throws(
    () => new AgentSettingsStore(file),
    (error: Error) =>
      /无法读取/.test(error.message) &&
      !error.message.includes("private-do-not-echo"),
  );
});
