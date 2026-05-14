import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Result } from './result';
import { failure, success } from './result';

/**
 * @ranwawa/along 路径与标签配置
 * 集中管理路径和标签配置
 */

// 基于当前文件的物理位置，定位到 @ranwawa/along 包根目录
const coreDir = __dirname;
const sourceDir = path.dirname(coreDir);
const alongPackageDir = path.dirname(sourceDir);
// 用户数据目录
const userHome = os.homedir();
const userAlongDir = path.join(userHome, '.along');

export interface RuntimeMapping {
  from: string;
  to: string;
}

export interface RuntimeConfig {
  id: string;
  name: string;
  detectDir: string;
  mappings: RuntimeMapping[];
  runTemplate: string;
  ensurePermissions?: (worktreePath: string, userAlongDir: string) => void;
}

type JsonObject = Record<string, unknown>;

// 确保目录存在
function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function toJsonObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function readJsonObject(filePath: string): JsonObject {
  return toJsonObject(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
}

function normalizeRuntimeId(value: string): Result<string> {
  const runtime = config.RUNTIMES.find((item) => item.id === value);
  return runtime
    ? success(runtime.id)
    : failure(
        `仅支持 Codex Agent，请将 Agent 类型改为 codex（当前: ${value}）`,
      );
}

export const config = {
  // @ranwawa/along 包根目录
  ROOT_DIR: alongPackageDir,

  // @ranwawa/along 源码目录
  SOURCE_DIR: sourceDir,

  // 用户数据目录
  USER_ALONG_DIR: userAlongDir,

  // 全局配置文件路径
  CONFIG_FILE: path.join(userAlongDir, 'config.json'),

  /**
   * 获取 issue 级别的数据目录: ~/.along/{owner}/{repo}/{issueNumber}/
   */
  getIssueDir(owner: string, repo: string, issueNumber: number): string {
    return path.join(userAlongDir, owner, repo, String(issueNumber));
  },

  /**
   * 获取 task 级别的数据目录: ~/.along/{owner}/{repo}/tasks/{taskId}/
   */
  getTaskDir(owner: string, repo: string, taskId: string): string {
    return path.join(userAlongDir, owner, repo, 'tasks', taskId);
  },

  /**
   * 获取基于 seq 的 task 数据目录: ~/.along/{owner}/{repo}/tasks/{seq}/
   */
  getTaskDirBySeq(owner: string, repo: string, seq: number): string {
    return path.join(userAlongDir, owner, repo, 'tasks', String(seq));
  },

  // 确保用户数据根目录存在
  ensureDataDirs() {
    ensureDir(this.USER_ALONG_DIR);
  },

  // 日志标签识别
  getLogTag(): Result<string> {
    // 1. 最高优先级：环境变量
    if (process.env.AGENT_TYPE)
      return normalizeRuntimeId(process.env.AGENT_TYPE);

    // 2. 项目级配置文件：.along/setting.json 或 package.json 中的 along.agent
    const workingDir = process.cwd();
    const settingConfigPath = path.join(workingDir, '.along/setting.json');
    if (fs.existsSync(settingConfigPath)) {
      try {
        const alongConfig = readJsonObject(settingConfigPath);
        if (typeof alongConfig.agent === 'string') {
          return normalizeRuntimeId(alongConfig.agent);
        }
      } catch {}
    }
    const pkgPath = path.join(workingDir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = readJsonObject(pkgPath);
        const along = toJsonObject(pkg.along);
        if (typeof along.agent === 'string')
          return normalizeRuntimeId(along.agent);
      } catch {}
    }

    // 3. 目录特征检测
    const execPath = process.argv[1] || '';
    for (const runtime of config.RUNTIMES) {
      if (
        fs.existsSync(path.join(workingDir, runtime.detectDir)) ||
        execPath.includes(runtime.detectDir)
      ) {
        return success(runtime.id);
      }
    }

    // 4. 无法检测时报错，不再静默回退为 "along"
    const runtimeIds = config.RUNTIMES.map((e) => e.id).join('|');
    return failure(
      `无法检测 Agent 类型。请通过以下方式之一指定：\n` +
        `  1. 设置环境变量 AGENT_TYPE=${runtimeIds}\n` +
        `  2. 在项目根目录创建 .along/setting.json，内容为 {"agent": "${runtimeIds}"}\n` +
        `  3. 在 package.json 中添加 "along": {"agent": "${runtimeIds}"}`,
    );
  },

  // 运行时运行配置
  RUNTIMES: [
    {
      id: 'codex',
      name: 'Codex',
      detectDir: '.codex',
      runTemplate:
        'codex exec "请解决任务 #{num}，严格按照 .codex/prompts/{workflow}.md 工作流执行"',
      mappings: [],
    },
  ] as RuntimeConfig[],
};
