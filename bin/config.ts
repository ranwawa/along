import path from "path";
import fs from "fs";

/**
 * .along/bin/config.ts
 * 集中管理路径和标签配置
 */

// 获取实际执行目录（如工作树子目录）
const workingDir = process.cwd();
// 基于当前文件的物理位置，定位到真实的 .along 目录
const binDir = __dirname;
const alongDir = path.dirname(binDir);

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

export const config = {
  // 根目录
  ROOT_DIR: alongDir,

  // 数据目录
  WORKTREE_DIR: path.join(alongDir, "worktrees"),
  SESSION_DIR: path.join(alongDir, "sessions"),
  TEMP_DIR: path.join(alongDir, "tmp"),
  
  // 资源目录
  SKILLS_DIR: path.join(alongDir, "skills"),
  PROMPTS_DIR: path.join(alongDir, "prompts"),
  BIN_DIR: path.join(alongDir, "bin"),

  // 日志标签识别
  getLogTag(): string {
    const execPath = process.argv[1] || "";
    if (process.env.AGENT_TYPE) return process.env.AGENT_TYPE;
    
    // 优先检测项目目录特征
    if (fs.existsSync(path.join(workingDir, ".opencode")) || execPath.includes(".opencode")) return "opencode";
    if (fs.existsSync(path.join(workingDir, ".pi")) || execPath.includes(".pi")) return "pi";
    
    return "along";
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
  ] as EditorConfig[],
};
