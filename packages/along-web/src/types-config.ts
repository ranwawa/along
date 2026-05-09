export interface EditorOption {
  id: string;
  name: string;
}

export interface TaskAgentConfig {
  editor?: string;
  model?: string;
  personalityVersion?: string;
}

export interface GlobalConfigResponse {
  configPath: string;
  editors: EditorOption[];
  defaults: {
    taskAgents: Record<string, TaskAgentConfig>;
  };
  taskAgents: Record<string, TaskAgentConfig>;
}
