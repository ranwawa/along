import path from "path";
import fs from "fs";
import os from "os";

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
  mappings: EditorMapping[];
  runTemplate: string; // 启动 Agent 的指令模版，如 "{tag} run \"/{workflow} {num}\""
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
  
  // 数据目录
  WORKTREE_DIR: path.join(userAlongDir, "worktrees"),
  SESSION_DIR: path.join(userAlongDir, "sessions"),
  ARTIFACT_DIR: path.join(userAlongDir, "artifacts"),
  TEMP_DIR: path.join(userAlongDir, "tmp"),
  LOG_DIR: path.join(userAlongDir, "logs"),
  
  // 资源目录
  SKILLS_DIR: path.join(alongDir, "skills"),
  PROMPTS_DIR: path.join(alongDir, "prompts"),
  BIN_DIR: path.join(alongDir, "bin"),

  // 确保数据目录存在
  ensureDataDirs() {
    ensureDir(this.USER_ALONG_DIR);
    ensureDir(this.WORKTREE_DIR);
    ensureDir(this.SESSION_DIR);
    ensureDir(this.ARTIFACT_DIR);
    ensureDir(this.TEMP_DIR);
    ensureDir(this.LOG_DIR);
  },

  // 日志标签识别
  getLogTag(): string {
    // 1. 最高优先级：环境变量
    if (process.env.AGENT_TYPE) return process.env.AGENT_TYPE;

    // 2. 项目级配置文件：.along.json 或 package.json 中的 along.agent
    const alongConfigPath = path.join(workingDir, ".along.json");
    if (fs.existsSync(alongConfigPath)) {
      try {
        const alongConfig = JSON.parse(fs.readFileSync(alongConfigPath, "utf-8"));
        if (alongConfig.agent) return alongConfig.agent;
      } catch {}
    }
    const pkgPath = path.join(workingDir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.along?.agent) return pkg.along.agent;
      } catch {}
    }

    // 3. 目录特征检测（向后兼容已有项目）
    const execPath = process.argv[1] || "";
    if (fs.existsSync(path.join(workingDir, ".opencode")) || execPath.includes(".opencode")) return "opencode";
    if (fs.existsSync(path.join(workingDir, ".pi")) || execPath.includes(".pi")) return "pi";
    if (fs.existsSync(path.join(workingDir, ".claude")) || execPath.includes(".claude")) return "claude";

    // 4. 无法检测时报错，不再静默回退为 "along"
    throw new Error(
      `无法检测 Agent 类型。请通过以下方式之一指定：\n` +
      `  1. 设置环境变量 AGENT_TYPE=opencode|pi|claude\n` +
      `  2. 在项目根目录创建 .along.json，内容为 {"agent": "opencode|pi|claude"}\n` +
      `  3. 在 package.json 中添加 "along": {"agent": "opencode|pi|claude"}`
    );
  },
  
  // 编辑器同步配置
  EDITORS: [
    {
      id: "opencode",
      name: "OpenCode",
      runTemplate: '{tag} run --command {workflow} {num}',
      mappings: [
        { from: "skills", to: ".opencode/skills" },
        { from: "prompts", to: ".opencode/commands" },
      ],
    },
    {
      id: "pi",
      name: "PI",
      runTemplate: "{tag} --prompt-template {workflow} {num}",
      mappings: [
        { from: "skills", to: ".pi/skills" },
        { from: "prompts", to: ".pi/prompts" }
      ],
    },
    {
      id: "claude",
      name: "Claude Code",
      runTemplate: '{tag} -p "请解决 GitHub Issue #{num}，严格按照系统提示中的工作流执行" --append-system-prompt-file .claude/commands/{workflow}.md --dangerously-skip-permissions --verbose',
      mappings: [
        { from: "skills", to: ".claude/skills" },
        { from: "prompts", to: ".claude/commands" },
      ],
    },
  ] as EditorConfig[],
};
