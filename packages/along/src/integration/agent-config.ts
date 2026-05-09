/**
 * Environment-backed GitHub integration helpers.
 *
 * AI runtime configuration lives in ai-registry-store.ts. This module no longer
 * reads ~/.along/config.json registry data.
 */

export function getAgentRole(): string | null {
  return process.env.ALONG_AGENT_ROLE || null;
}

export function resolveAgentToken(): string | null {
  return process.env.ALONG_GITHUB_TOKEN || null;
}

export function getWebhookSecret(): string | null {
  return process.env.ALONG_WEBHOOK_SECRET || null;
}

export function getWorkspaces(): string[] | null {
  const raw = process.env.ALONG_WORKSPACES;
  if (!raw) return null;
  const workspaces = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return workspaces.length > 0 ? workspaces : null;
}
