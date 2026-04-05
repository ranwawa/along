import fs from "fs";
import { consola } from "consola";
import { config } from "./config";

const logger = consola.withTag("agent-config");

export interface AgentRoleConfig {
  name: string;
  githubToken: string;
}

interface AlongGlobalConfig {
  agents?: Record<string, AgentRoleConfig>;
  defaultAgent?: string;
}

let cachedConfig: AlongGlobalConfig | null = null;

/**
 * 读取全局配置文件 ~/.along/config.json
 */
function readGlobalConfig(): AlongGlobalConfig | null {
  if (cachedConfig) return cachedConfig;

  const configFile = config.CONFIG_FILE;
  if (!fs.existsSync(configFile)) return null;

  try {
    cachedConfig = JSON.parse(fs.readFileSync(configFile, "utf-8"));
    return cachedConfig;
  } catch (e: any) {
    logger.warn(`读取全局配置文件失败: ${e.message}`);
    return null;
  }
}

/**
 * 获取当前 agent 角色名称
 * 优先级: ALONG_AGENT_ROLE 环境变量 → 配置文件 defaultAgent
 */
export function getAgentRole(): string | null {
  if (process.env.ALONG_AGENT_ROLE) return process.env.ALONG_AGENT_ROLE;

  const globalConfig = readGlobalConfig();
  if (globalConfig?.defaultAgent) return globalConfig.defaultAgent;

  return null;
}

/**
 * 获取指定角色的 GitHub Token
 */
export function getAgentToken(role: string): string | null {
  const globalConfig = readGlobalConfig();
  return globalConfig?.agents?.[role]?.githubToken || null;
}

/**
 * 获取指定角色的显示名称
 */
export function getAgentName(role: string): string | null {
  const globalConfig = readGlobalConfig();
  return globalConfig?.agents?.[role]?.name || null;
}

/**
 * 尝试获取当前角色对应的 GitHub Token
 * 如果设置了角色且配置了对应 token，返回该 token；否则返回 null
 */
export function resolveAgentToken(): string | null {
  const role = getAgentRole();
  if (!role) return null;

  const token = getAgentToken(role);
  if (!token) {
    logger.debug(`角色 "${role}" 未配置 githubToken，将回退到默认认证`);
    return null;
  }

  return token;
}
