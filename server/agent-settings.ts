import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createModels,
  createProvider,
  Type,
  type Api,
  type Model,
  type Models,
  type Provider,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type {
  AgentProvider,
  AgentSettings,
  ProviderApi,
} from "../src/core/agent-types";

type StoredProvider = Omit<AgentProvider, "hasApiKey"> & { apiKey: string };
type StoredSettings = { providers: StoredProvider[]; activeProviderId: string };

const shortText = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !/[\x00-\x1f\x7f]/.test(value));
const providerSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/),
  name: shortText,
  api: z.enum([
    "openai-completions",
    "openai-responses",
    "anthropic-messages",
    "google-generative-ai",
  ]),
  baseUrl: z.string().trim().min(1).max(2048),
  model: shortText,
  models: z.array(shortText).max(2000),
  enabled: z.boolean(),
  apiKey: z
    .string()
    .trim()
    .max(8192)
    .refine((value) => !/[\x00-\x20\x7f]/.test(value))
    .optional(),
  clearApiKey: z.boolean().optional(),
});
const settingsSchema = z.object({
  providers: z.array(providerSchema).min(1).max(50),
  activeProviderId: z.string().min(1).max(64),
});

const presets: Omit<StoredProvider, "enabled" | "apiKey">[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    api: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-6",
    models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"],
  },
  {
    id: "openai",
    name: "OpenAI",
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1",
    models: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o"],
  },
  {
    id: "google",
    name: "Google Gemini",
    api: "google-generative-ai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    api: "openai-completions",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    api: "openai-completions",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-sonnet-4.6",
    models: [
      "anthropic/claude-sonnet-4.6",
      "openai/gpt-4.1",
      "google/gemini-2.5-flash",
    ],
  },
  {
    id: "ollama",
    name: "Ollama（本地）",
    api: "openai-completions",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen3:8b",
    models: ["qwen3:8b", "llama3.1:8b"],
  },
];

const catalogs = new Map<string, Provider>([
  ["api.anthropic.com", anthropicProvider()],
  ["api.openai.com", openaiProvider()],
  ["generativelanguage.googleapis.com", googleProvider()],
  ["api.deepseek.com", deepseekProvider()],
  ["openrouter.ai", openrouterProvider()],
]);
const apis = {
  "anthropic-messages": anthropicMessagesApi(),
  "openai-completions": openAICompletionsApi(),
  "openai-responses": openAIResponsesApi(),
  "google-generative-ai": googleGenerativeAIApi(),
};

function normalizeUrl(value: string, api: ProviderApi): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "API 地址格式无效，请填写完整的 http:// 或 https:// 地址。",
    );
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /[\x00-\x20\x7f]/.test(value)
  ) {
    throw new Error(
      "API 地址只支持 HTTP(S)，不能包含账号、密码、查询参数或片段。",
    );
  }
  let pathname = url.pathname.replace(/\/+$/, "");
  // Anthropic's SDK appends /v1/messages; Gemini's SDK expects the version in baseUrl.
  if (api === "anthropic-messages") pathname = pathname.replace(/\/v1$/, "");
  if (api === "google-generative-ai" && !pathname) pathname = "/v1beta";
  return `${url.origin}${pathname}`;
}

function isLoopback(baseUrl: string): boolean {
  const host = new URL(baseUrl).hostname;
  return host === "localhost" || host === "[::1]" || /^127\./.test(host);
}

function publicProvider(provider: StoredProvider): AgentProvider {
  const { apiKey, ...safe } = provider;
  return { ...safe, models: [...safe.models], hasApiKey: Boolean(apiKey) };
}

function parseProvider(
  input: unknown,
  previous?: StoredProvider,
): StoredProvider {
  const result = providerSchema.safeParse(input);
  if (!result.success)
    throw new Error(
      "模型提供商设置格式无效，请检查名称、模型、协议和 API Key。",
    );
  const parsed = result.data;
  const baseUrl = normalizeUrl(parsed.baseUrl, parsed.api);
  if (
    previous?.apiKey &&
    previous.baseUrl !== baseUrl &&
    !parsed.apiKey &&
    !parsed.clearApiKey
  ) {
    throw new Error(
      "API 地址已改变，请重新填写 API Key 或明确清除原 Key，避免把已保存的密钥发送到其他地址。",
    );
  }
  const apiKey = parsed.clearApiKey
    ? ""
    : parsed.apiKey || previous?.apiKey || "";
  return {
    id: parsed.id,
    name: parsed.name,
    api: parsed.api,
    baseUrl,
    model: parsed.model,
    models: [...new Set([parsed.model, ...parsed.models])],
    enabled: parsed.enabled,
    apiKey,
  };
}

function parseSettings(
  input: unknown,
  previous?: StoredSettings,
): StoredSettings {
  const result = settingsSchema.safeParse(input);
  if (!result.success)
    throw new Error("模型设置格式无效，请至少保留一个提供商和一个当前模型。");
  const providers = result.data.providers.map((provider) =>
    parseProvider(
      provider,
      previous?.providers.find((entry) => entry.id === provider.id),
    ),
  );
  if (
    new Set(providers.map((provider) => provider.id)).size !== providers.length
  )
    throw new Error("模型提供商 ID 不能重复。");
  if (
    !providers.some(
      (provider) =>
        provider.id === result.data.activeProviderId && provider.enabled,
    )
  )
    throw new Error("当前提供商必须存在并已启用。");
  return { providers, activeProviderId: result.data.activeProviderId };
}

function requestError(status: number, timedOut = false): Error {
  if (timedOut) return new Error("连接超时，请检查 API 地址和网络后重试。");
  if (status === 401 || status === 403)
    return new Error("提供商拒绝授权，请检查 API Key 和模型访问权限。");
  if (status === 404)
    return new Error(
      "提供商接口或模型不存在，请检查 API 地址、协议和模型 ID。",
    );
  if (status === 429)
    return new Error("提供商额度不足或请求过于频繁，请稍后重试。");
  return new Error(
    status
      ? `提供商请求失败（HTTP ${status}），请检查模型和协议设置。`
      : "无法连接模型提供商，请检查 API 地址、网络和协议设置。",
  );
}

/** Credentials stay in a per-user local file and never appear in the public API. */
export class AgentSettingsStore {
  private state: StoredSettings;
  private readonly filePath: string;

  constructor(
    filePath = process.env.SW_AGENT_SETTINGS_PATH ||
      path.join(os.homedir(), ".scrollweave", "agent-settings.json"),
  ) {
    this.filePath = path.resolve(filePath);
    this.state = {
      providers: presets.map((provider) => ({
        ...provider,
        models: [...provider.models],
        enabled: true,
        apiKey: "",
      })),
      activeProviderId: "anthropic",
    };
    try {
      this.state = parseSettings(
        JSON.parse(fs.readFileSync(this.filePath, "utf8")),
      );
      fs.chmodSync(this.filePath, 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("无法读取本地模型设置，请检查设置文件的格式和权限。");
    }
  }

  publicSettings(): AgentSettings {
    return {
      providers: this.state.providers.map(publicProvider),
      activeProviderId: this.state.activeProviderId,
    };
  }

  save(input: unknown): AgentSettings {
    const next = parseSettings(input, this.state);
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    let fd: number | undefined;
    try {
      fs.mkdirSync(path.dirname(this.filePath), {
        recursive: true,
        mode: 0o700,
      });
      fd = fs.openSync(temporary, "wx", 0o600);
      fs.writeFileSync(fd, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temporary, this.filePath);
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      throw new Error("模型设置保存失败，请检查本地设置目录的写入权限。");
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try {
        fs.unlinkSync(temporary);
      } catch {
        /* File was renamed or never created. */
      }
    }
    this.state = next;
    return this.publicSettings();
  }

  private resolve(provider: StoredProvider): {
    provider: AgentProvider;
    apiKey: string;
    model: Model<Api>;
    streamFn: Models["streamSimple"];
  } {
    if (!provider.enabled) throw new Error("请先启用此模型提供商。");
    if (!provider.apiKey && !isLoopback(provider.baseUrl))
      throw new Error("请先在设置中填写此提供商的 API Key。");
    const catalog = catalogs.get(new URL(provider.baseUrl).hostname);
    const builtin = catalog
      ?.getModels()
      .find(
        (entry) => entry.id === provider.model && entry.api === provider.api,
      );
    const model: Model<Api> = {
      ...(builtin || {
        id: provider.model,
        name: provider.model,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 4096,
      }),
      id: provider.model,
      provider: provider.id,
      api: provider.api,
      baseUrl: provider.baseUrl,
    };
    if (provider.api === "openai-completions") {
      model.compat = {
        ...model.compat,
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        supportsUsageInStreaming: false,
        supportsStrictMode: false,
        maxTokensField: "max_tokens",
      };
    }
    const apiKey = provider.apiKey || "scrollweave-local";
    const models = createModels();
    models.setProvider(
      createProvider({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        models: [model],
        api: apis[provider.api],
        auth: {
          apiKey: {
            name: "ScrollWeave API Key",
            resolve: async () => ({ auth: { apiKey } }),
          },
        },
      }),
    );
    const origin = new URL(provider.baseUrl).origin;
    const endpointFetch: typeof fetch = async (input, init) => {
      const target = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (target.origin !== origin)
        throw new Error("模型请求地址与配置不一致。");
      return fetch(input, { ...init, redirect: "error" });
    };
    const streamFn: Models["streamSimple"] = (selected, context, options) =>
      models.streamSimple(selected, context, {
        ...options,
        transport: "sse",
        fetch: endpointFetch,
      });
    return { provider: publicProvider(provider), apiKey, model, streamFn };
  }

  resolveActive() {
    const provider = this.state.providers.find(
      (entry) => entry.id === this.state.activeProviderId,
    );
    if (!provider) throw new Error("请先选择一个可用的模型提供商。");
    return this.resolve(provider);
  }

  private requestProvider(input: unknown, discovery = false): StoredProvider {
    const schema = discovery
      ? providerSchema.extend({ model: shortText.or(z.literal("")).optional() })
      : providerSchema;
    const result = schema.safeParse(input);
    if (!result.success) throw new Error("模型提供商设置格式无效。");
    return parseProvider(
      { ...result.data, model: result.data.model || "model-discovery" },
      this.state.providers.find((entry) => entry.id === result.data.id),
    );
  }

  async testProvider(input: unknown): Promise<{ ok: true; message: string }> {
    const { model, streamFn } = this.resolve(this.requestProvider(input));
    const signal = AbortSignal.timeout(20000);
    let status = 0;
    try {
      const response = await streamFn(
        model,
        {
          messages: [
            {
              role: "user",
              content:
                "Reply with OK to verify this connection. You may use the connection_check tool.",
              timestamp: Date.now(),
            },
          ],
          tools: [
            {
              name: "connection_check",
              description:
                "Confirm that this connection supports tools. This tool has no side effects.",
              parameters: Type.Object({}),
            },
          ],
        },
        {
          maxTokens: 128,
          signal,
          timeoutMs: 20000,
          maxRetries: 0,
          cacheRetention: "none",
          onResponse: (response) => {
            status = response.status;
          },
        },
      ).result();
      if (
        response.stopReason === "error" ||
        response.stopReason === "aborted" ||
        !response.content.some(
          (block) =>
            (block.type === "text" && block.text.trim()) ||
            block.type === "toolCall",
        )
      )
        throw new Error("Invalid model response");
      return { ok: true, message: "连接成功，模型已接受工具定义并返回响应。" };
    } catch {
      throw requestError(status >= 400 ? status : 0, signal.aborted);
    }
  }

  async listModels(input: unknown): Promise<{ models: string[] }> {
    const provider = this.requestProvider(input, true);
    if (!provider.apiKey && !isLoopback(provider.baseUrl))
      throw new Error("请先填写此提供商的 API Key。");
    const suffix =
      provider.api === "anthropic-messages" ? "/v1/models" : "/models";
    const headers: Record<string, string> = { Accept: "application/json" };
    if (provider.api === "anthropic-messages") {
      headers["anthropic-version"] = "2023-06-01";
      if (provider.apiKey) headers["x-api-key"] = provider.apiKey;
    } else if (provider.api === "google-generative-ai") {
      if (provider.apiKey) headers["x-goog-api-key"] = provider.apiKey;
    } else if (provider.apiKey)
      headers.Authorization = `Bearer ${provider.apiKey}`;
    const signal = AbortSignal.timeout(15000);
    let status = 0;
    try {
      const response = await fetch(`${provider.baseUrl}${suffix}`, {
        headers,
        signal,
        redirect: "error",
      });
      status = response.status;
      if (!response.ok) throw new Error("Request rejected");
      const body: unknown = await response.json();
      if (!body || typeof body !== "object")
        throw new Error("Invalid models response");
      const list =
        provider.api === "google-generative-ai"
          ? (body as { models?: unknown }).models
          : (body as { data?: unknown }).data;
      if (!Array.isArray(list)) throw new Error("Invalid models response");
      const models = [
        ...new Set(
          list.flatMap((item: unknown): string[] => {
            if (!item || typeof item !== "object") return [];
            const entry = item as {
              id?: unknown;
              name?: unknown;
              supportedGenerationMethods?: unknown;
            };
            if (
              provider.api === "google-generative-ai" &&
              Array.isArray(entry.supportedGenerationMethods) &&
              !entry.supportedGenerationMethods.includes("generateContent")
            )
              return [];
            const id =
              provider.api === "google-generative-ai" ? entry.name : entry.id;
            if (
              typeof id !== "string" ||
              !shortText.safeParse(id).success ||
              (provider.apiKey && id.includes(provider.apiKey))
            )
              return [];
            return [
              provider.api === "google-generative-ai"
                ? id.replace(/^models\//, "")
                : id,
            ];
          }),
        ),
      ]
        .slice(0, 2000)
        .sort();
      return { models };
    } catch {
      throw requestError(status >= 400 ? status : 0, signal.aborted);
    }
  }
}
