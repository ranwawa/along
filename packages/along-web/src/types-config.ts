export interface EditorOption {
  id: string;
  name: string;
}

export interface TaskAgentConfig {
  editor?: string;
  model?: string;
  personalityVersion?: string;
}

export interface ProviderConfig {
  name?: string;
  baseUrl?: string;
  token?: string;
  models?: string[];
  tokenConfigured?: boolean;
  tokenPreview?: string;
}

export interface GlobalConfigResponse {
  configPath: string;
  editors: EditorOption[];
  defaults: {
    taskAgents: Record<string, TaskAgentConfig>;
    providers: Record<string, ProviderConfig>;
  };
  taskAgents: Record<string, TaskAgentConfig>;
  providers: Record<string, ProviderConfig>;
}
