export type ProviderKind = 'openai-compatible' | 'anthropic' | 'custom';

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  name?: string;
  baseUrl?: string;
  defaultCredentialId?: string;
}

export interface CredentialConfig {
  id: string;
  providerId: string;
  name?: string;
  token?: string;
  tokenEnv?: string;
}

export interface ModelConfig {
  id: string;
  providerId: string;
  model: string;
  name?: string;
  credentialId?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface RuntimeConfig {
  id: string;
  kind: 'codex';
  name?: string;
  modelId?: string;
  credentialId?: string;
}

export interface AgentConfig {
  id: string;
  runtimeId: string;
  name?: string;
  modelId?: string;
  credentialId?: string;
  personalityVersion?: string;
}

export interface ProfileConfig {
  id: string;
  modelId: string;
  name?: string;
  credentialId?: string;
  systemPrompt: string;
  userTemplate?: string;
  parameters?: {
    temperature?: number;
    maxTokens?: number;
    outputFormat?: 'text' | 'json';
  };
}

export interface RegistryConfig {
  providers: ProviderConfig[];
  credentials: CredentialConfig[];
  models: ModelConfig[];
  runtimes: RuntimeConfig[];
  agents: AgentConfig[];
  profiles: ProfileConfig[];
}
