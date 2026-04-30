import fs from 'node:fs';
import path from 'node:path';
import type {
  LoadedManagedProject,
  ManagedProjectConfig,
  ManagedProjectRootConfig,
} from './types';

export const CONFIG_FILE_NAME = '.along.json';

export function loadManagedProject(projectDir: string): LoadedManagedProject {
  const configPath = path.join(projectDir, CONFIG_FILE_NAME);

  if (!fs.existsSync(configPath)) {
    throw new Error(`未找到 ${CONFIG_FILE_NAME}: ${projectDir}`);
  }

  const rootConfig = JSON.parse(
    fs.readFileSync(configPath, 'utf8'),
  ) as ManagedProjectRootConfig;
  const config = extractManagedProjectConfig(rootConfig, configPath);

  validateProjectConfig(config, configPath);

  return {
    configPath,
    projectDir,
    config,
    rootConfig,
  };
}

function extractManagedProjectConfig(
  parsed: ManagedProjectRootConfig,
  configPath: string,
): ManagedProjectConfig {
  if ('distribution' in parsed && parsed.distribution) {
    return parsed.distribution;
  }

  throw new Error(`${configPath}: 缺少 distribution 配置`);
}

function validateProjectConfig(
  config: ManagedProjectConfig,
  configPath: string,
) {
  if (!config.id) {
    throw new Error(`${configPath}: 缺少 id`);
  }

  if (!config.displayName) {
    throw new Error(`${configPath}: 缺少 displayName`);
  }

  if (!config.presetVersion) {
    throw new Error(`${configPath}: 缺少 presetVersion`);
  }

  if (!config.projectDocPath) {
    throw new Error(`${configPath}: 缺少 projectDocPath`);
  }

  if (!config.agent?.editors?.length) {
    throw new Error(`${configPath}: agent.editors 不能为空`);
  }

  if (config.ci?.qualityGateAction?.enabled) {
    if (!config.tooling?.installCommand) {
      throw new Error(`${configPath}: 缺少 tooling.installCommand`);
    }

    if (!config.tooling?.nodeVersion) {
      throw new Error(`${configPath}: 缺少 tooling.nodeVersion`);
    }

    if (!config.tooling?.bunVersionFile) {
      throw new Error(`${configPath}: 缺少 tooling.bunVersionFile`);
    }
  }

  if (!config.quality?.changedWorkspaceCheckTaskRef) {
    throw new Error(`${configPath}: 缺少 quality.changedWorkspaceCheckTaskRef`);
  }

  if (
    !config.quality?.tasks ||
    Object.keys(config.quality.tasks).length === 0
  ) {
    throw new Error(`${configPath}: quality.tasks 不能为空`);
  }

  if (!config.quality?.packageExecutionOrder?.length) {
    throw new Error(`${configPath}: quality.packageExecutionOrder 不能为空`);
  }

  if (
    !config.quality?.packages ||
    Object.keys(config.quality.packages).length === 0
  ) {
    throw new Error(`${configPath}: quality.packages 不能为空`);
  }

  if (!config.quality?.fullSequence?.length) {
    throw new Error(`${configPath}: quality.fullSequence 不能为空`);
  }

  for (const packageId of config.quality.packageExecutionOrder) {
    if (!config.quality.packages[packageId]) {
      throw new Error(
        `${configPath}: quality.packageExecutionOrder 引用了未知包 ${packageId}`,
      );
    }
  }
}
