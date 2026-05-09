import type { AgentConfig, RegistryConfig } from '../types';
import type { AgentRow } from './types';

export function registryToRows(registry: RegistryConfig): AgentRow[] {
  return registry.agents.map((agent) => ({
    id: agent.id,
    runtimeId: agent.runtimeId,
    modelId: agent.modelId || '',
    credentialId: agent.credentialId || '',
    personalityVersion: agent.personalityVersion || '',
  }));
}

export function rowsToAgents(rows: AgentRow[]): AgentConfig[] {
  return rows
    .map((row) => ({
      id: row.id.trim(),
      runtimeId: row.runtimeId.trim(),
      modelId: row.modelId.trim() || undefined,
      credentialId: row.credentialId.trim() || undefined,
      personalityVersion: row.personalityVersion.trim() || undefined,
    }))
    .filter((agent) => agent.id && agent.runtimeId);
}
