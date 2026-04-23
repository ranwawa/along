import path from "path";
import fs from "fs";
import os from "os";
import { success, failure } from "./result";
import type { Result } from "./result";

/**
 * .along/bin/config.ts
 * 集中管理路径和标签配置
 */

// 获取实际执行目录（如工作树子目录）
const workingDir = process.cwd();
// 基于当前文件的物理位置，定位到真实的 .along 目录
const binDir = __dirname;
const alongDir = path.dirname(binDir);
// 用户数据目录
const userHome = os.homedir();
const userAlongDir = path.join(userHome, ".along");

export interface EditorMapping {
  from: string;
  to: string;
}

export interface EditorConfig {
  id: string;
  name: string;
  detectDir: string;
  mappings: EditorMapping[];
  runTemplate: string;
  ensurePermissions?: (worktreePath: string, userAlongDir: string) => void;
}

// 确保目录存在
function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export const config = {
  // 根目录
  ROOT_DIR: alongDir,

  // 用户数据目录
  USER_ALONG_DIR: userAlongDir,

  // 全局配置文件路径
  CONFIG_FILE: path.join(userAlongDir, "config.json"),

  /**
   * 获取 issue 级别的数据目录: ~/.along/{owner}/{repo}/{issueNumber}/
   */
  getIssueDir(owner: string, repo: string, issueNumber: number): string {
    return path.join(userAlongDir, owner, repo, String(issueNumber));
  },

  // 资源目录
  SKILLS_DIR: path.join(alongDir, "skills"),
  PROMPTS_DIR: path.join(alongDir, "prompts"),
  BIN_DIR: path.join(alongDir, "bin"),

  // 确保用户数据根目录存在
  ensureDataDirs() {
    ensureDir(this.USER_ALONG_DIR);
  },

  // 日志标签识别
  getLogTag(): Result<string> {
    // 1. 最高优先级：环境变量
    if (process.env.AGENT_TYPE) return success(process.env.AGENT_TYPE);

    // 2. 项目级配置文件：.along.json 或 package.json 中的 along.agent
    const workingDir = process.cwd();
    const alongConfigPath = path.join(workingDir, ".along.json");
    if (fs.existsSync(alongConfigPath)) {
      try {
        const alongConfig = JSON.parse(fs.readFileSync(alongConfigPath, "utf-8"));
        if (alongConfig.agent) return success(alongConfig.agent);
      } catch { }
    }
    const pkgPath = path.join(workingDir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.along?.agent) return success(pkg.along.agent);
      } catch { }
    }

    // 3. 目录特征检测（向后兼容已有项目）
    const execPath = process.argv[1] || "";
    for (const editor of config.EDITORS) {
      if (fs.existsSync(path.join(workingDir, editor.detectDir)) || execPath.includes(editor.detectDir)) {
        return success(editor.id);
      }
    }

    // 4. 无法检测时报错，不再静默回退为 "along"
    const editorIds = config.EDITORS.map(e => e.id).join("|");
    return failure(
      `无法检测 Agent 类型。请通过以下方式之一指定：\n` +
      `  1. 设置环境变量 AGENT_TYPE=${editorIds}\n` +
      `  2. 在项目根目录创建 .along.json，内容为 {"agent": "${editorIds}"}\n` +
      `  3. 在 package.json 中添加 "along": {"agent": "${editorIds}"}`
    );
  },

  // 编辑器同步配置
  EDITORS: [
    {
      id: "opencode",
      name: "OpenCode",
      detectDir: ".opencode",
      runTemplate: '{tag} run --command {workflow} {num}',
      mappings: [
        { from: "skills", to: ".opencode/skills" },
        { from: "prompts", to: ".opencode/commands" },
      ],
      ensurePermissions: (worktreePath: string, userAlongDir: string) => {
        const configPath = path.join(worktreePath, "opencode.json");
        let existing: any = {};
        if (fs.existsSync(configPath)) {
          try { existing = JSON.parse(fs.readFileSync(configPath, "utf-8")); } catch { existing = {}; }
        }
        const alongPattern = `${userAlongDir}/**`;
        const permission = existing.permission || {};
        const extDir = permission.external_directory || {};
        if (extDir[alongPattern] === "allow") return;
        extDir[alongPattern] = "allow";
        permission.external_directory = extDir;
        existing.permission = permission;
        if (!existing.$schema) existing.$schema = "https://opencode.ai/config.json";
        fs.writeFileSync(configPath, JSON.stringify(existing, null, 2) + "\n");
      },
    },
    {
      id: "pi",
      name: "PI",
      detectDir: ".pi",
      runTemplate: "{tag} --prompt-template {workflow} {num}",
      mappings: [
        { from: "skills", to: ".pi/skills" },
        { from: "prompts", to: ".pi/prompts" }
      ],
    },
    {
      id: "codex",
      name: "Codex",
      detectDir: ".codex",
      runTemplate: 'codex exec "请解决 GitHub Issue #{num}，严格按照 .codex/prompts/{workflow}.md 工作流执行"',
      mappings: [
        { from: "skills", to: ".codex/skills" },
        { from: "prompts", to: ".codex/prompts" },
      ],
    },
    {
      id: "claude",
      name: "Kira Code",
      detectDir: ".claude",
      runTemplate: '{tag} "请解决 GitHub Issue #{num}，严格按照系统提示中的工作流执行" --append-system-prompt-file .claude/commands/{workflow}.md --dangerously-skip-permissions --output-format stream-json --verbose --print',
      mappings: [
        { from: "skills", to: ".claude/skills" },
        { from: "prompts", to: ".claude/commands" },
      ],
      ensurePermissions: (worktreePath: string, userAlongDir: string) => {
        const claudeDir = path.join(worktreePath, ".claude");
        if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
        const configPath = path.join(claudeDir, "settings.local.json");
        let existing: any = {};
        if (fs.existsSync(configPath)) {
          try { existing = JSON.parse(fs.readFileSync(configPath, "utf-8")); } catch { existing = {}; }
        }
        const permissions = existing.permissions || {};
        const allow: string[] = permissions.allow || [];
        const requiredPatterns = [
          `Bash(along *)`,
          `Read(${userAlongDir}/**)`,
          `Edit(${userAlongDir}/**)`,
          `Write(${userAlongDir}/**)`,
        ];
        const missing = requiredPatterns.filter(p => !allow.includes(p));
        if (missing.length === 0) return;
        allow.push(...missing);
        permissions.allow = allow;
        existing.permissions = permissions;
        fs.writeFileSync(configPath, JSON.stringify(existing, null, 2) + "\n");
      },
    },
  ] as EditorConfig[],
};
