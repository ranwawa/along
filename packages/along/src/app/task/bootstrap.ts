import fs from 'node:fs';
import path from 'node:path';
import { consola } from 'consola';
import { ensureRuntimePermissions } from '../../core/common';
import { config } from '../../core/config';
import type { Result } from '../../core/result';
import { failure, success } from '../../core/result';
import { syncRuntimeMappings } from '../worktree/init';

const logger = consola.withTag('bootstrap');

export async function ensureProjectBootstrap(): Promise<Result<void>> {
  const workingDir = process.cwd();
  const settingPath = path.join(workingDir, '.along/setting.json');

  if (!fs.existsSync(settingPath)) {
    const tagRes = config.getLogTag();
    if (tagRes.success) {
      try {
        fs.mkdirSync(path.dirname(settingPath), { recursive: true });
        fs.writeFileSync(
          settingPath,
          `${JSON.stringify({ agent: tagRes.data }, null, 2)}\n`,
        );
        logger.info(`已自动创建 .along/setting.json (agent: ${tagRes.data})`);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        logger.warn(`创建 .along/setting.json 失败: ${message}`);
      }
    }
  }

  const tagRes = config.getLogTag();
  if (!tagRes.success) {
    return failure(tagRes.error);
  }

  const runtime = config.RUNTIMES.find((e) => e.id === tagRes.data);
  if (runtime) {
    const syncRes = syncRuntimeMappings(workingDir, runtime);
    if (!syncRes.success) {
      logger.warn(`运行时映射同步失败: ${syncRes.error}`);
    }
    ensureRuntimePermissions(workingDir);
  }

  return success(undefined);
}
