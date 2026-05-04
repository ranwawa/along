export interface ConfigRow {
  key: string;
  editor: string;
  model: string;
  personalityVersion: string;
}

export interface ProviderRow {
  id: string;
  name: string;
  baseUrl: string;
  modelsText: string;
  token: string;
  tokenConfigured: boolean;
  tokenPreview: string;
}
