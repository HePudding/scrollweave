/** Public agent API. Credentials are accepted on writes, never returned. */
export type ProviderApi =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative-ai";
export interface AgentProvider {
  id: string;
  name: string;
  api: ProviderApi;
  baseUrl: string;
  model: string;
  models: string[];
  enabled: boolean;
  hasApiKey: boolean;
}
export interface ProviderInput extends Omit<AgentProvider, "hasApiKey"> {
  apiKey?: string;
  clearApiKey?: boolean;
}
export interface AgentSettings {
  providers: AgentProvider[];
  activeProviderId: string;
}
export interface AgentSettingsInput {
  providers: ProviderInput[];
  activeProviderId: string;
}
export interface AgentEntry {
  id: string;
  kind: "user" | "assistant" | "tool" | "status" | "error";
  text: string;
  timestamp: number;
  toolName?: string;
  status?: "running" | "done" | "error";
  detail?: string;
  revision?: number;
}
export interface AgentSnapshot {
  workspace: string;
  projectId: string;
  running: boolean;
  status: string;
  entries: AgentEntry[];
  providerId?: string;
  model?: string;
}
