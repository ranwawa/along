import fs from 'node:fs';
import { getErrorMessage } from '../../core/common';
import { config } from '../../core/config';
import type { Result } from '../../core/result';
import { failure, success } from '../../core/result';
import {
  parseRegistryConfig,
  type RegistryConfig,
} from '../../domain/registry/config';

let cachedRegistry: RegistryConfig | null = null;

export function readRegistryConfig(): Result<RegistryConfig> {
  if (cachedRegistry) return success(cachedRegistry);

  if (!fs.existsSync(config.CONFIG_FILE)) {
    return failure(`Registry 配置文件不存在: ${config.CONFIG_FILE}`);
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(config.CONFIG_FILE, 'utf-8'));
    const registryRes = parseRegistryConfig(parsed);
    if (!registryRes.success) return registryRes;
    cachedRegistry = registryRes.data;
    return success(registryRes.data);
  } catch (error: unknown) {
    return failure(`读取 Registry 配置失败: ${getErrorMessage(error)}`);
  }
}

export function writeRegistryConfig(
  input: RegistryConfig,
): Result<RegistryConfig> {
  const registryRes = parseRegistryConfig(input);
  if (!registryRes.success) return registryRes;

  try {
    config.ensureDataDirs();
    fs.writeFileSync(
      config.CONFIG_FILE,
      `${JSON.stringify(registryRes.data, null, 2)}\n`,
    );
    cachedRegistry = registryRes.data;
    return success(registryRes.data);
  } catch (error: unknown) {
    return failure(`写入 Registry 配置失败: ${getErrorMessage(error)}`);
  }
}

export function clearRegistryConfigCache() {
  cachedRegistry = null;
}
