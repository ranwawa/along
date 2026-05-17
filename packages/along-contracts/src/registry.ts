export type ProviderKind = 'openai-compatible' | 'anthropic' | 'custom';

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  name?: string;
  baseUrl?: string;
}

export interface ModelConfig {
  id: string;
  providerId: string;
  model: string;
  name?: string;
  token?: string;
  tokenEnv?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface RuntimeConfig {
  id: string;
  kind: 'codex';
  name?: string;
  modelId?: string;
}

export interface AgentConfig {
  id: string;
  runtimeId: string;
  name?: string;
  modelId?: string;
  personalityVersion?: string;
}

export interface ProfileParametersConfig {
  temperature?: number;
  maxTokens?: number;
  outputFormat?: 'text' | 'json';
}

export interface ProfileConfig {
  id: string;
  modelId: string;
  name?: string;
  systemPrompt: string;
  userTemplate?: string;
  parameters?: ProfileParametersConfig;
}

export interface RegistryConfig {
  providers: ProviderConfig[];
  models: ModelConfig[];
  runtimes: RuntimeConfig[];
  agents: AgentConfig[];
  profiles: ProfileConfig[];
}
