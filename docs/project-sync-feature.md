# 项目集中分发功能

## 目标

把质量门禁、通用 prompts、通用 skills、hooks、通用 Agent 文档统一收敛到 along monorepo 中维护，并按项目画像自动分发到业务仓。

目标仓库不再手工维护第二份通用实现，只保留差异化配置。

## 最终架构

根目录只是 monorepo 容器，职责拆成 3 个包：

- `packages/along`
  - GitHub Agent CLI 与运行时
  - 对外公开命令入口
- `packages/preset`
  - 集中分发引擎
  - 负责读取项目配置、渲染文档、写入受管文件
- `packages/preset-assets`
  - 集中分发的唯一资产源
  - 负责保存 prompts、skills、quality engine、hooks

## 单一事实源

通用资产只允许放在 `packages/preset-assets/`：

- `packages/preset-assets/hooks/`
- `packages/preset-assets/quality/`
- `packages/preset-assets/prompts/`
- `packages/preset-assets/skills/`

后续新增新的通用能力，也只能继续扩展这里。

## 唯一配置入口

每个接入项目只使用一个配置文件：`.along.json`。

集中分发配置统一挂在 `.along.json.distribution` 下，不再新增其他配置文件，也不保留 `along.project.json` 兼容逻辑。

示例：

```json
{
  "agent": "claude",
  "distribution": {
    "id": "kinkeeper",
    "displayName": "Kinkeeper",
    "presetVersion": "0.1.0",
    "projectDocPath": "PROJECT.md",
    "cleanupPaths": ["scripts/quality"],
    "tooling": {
      "packageManager": "bun",
      "installCommand": "bun install --frozen-lockfile",
      "nodeVersion": "20",
      "bunVersionFile": ".bun-version"
    },
    "quality": {
      "rootGateFiles": [
        ".along.json",
        ".bun-version",
        "biome.json",
        "bun.lock",
        "package.json"
      ],
      "rootGatePrefixes": [".along/preset/", ".github/", ".ranwawa/"],
      "changedWorkspaceCheckTaskRef": "workspace:changed",
      "changedPrerequisiteSequence": ["build:shared"],
      "fullSequence": [
        "build:shared",
        "workspace:full",
        "typecheck:client",
        "coverage:client",
        "typecheck:server",
        "coverage:server"
      ]
    },
    "agent": {
      "editors": ["codex", "claude"]
    },
    "ci": {
      "qualityGateAction": {
        "enabled": true
      }
    }
  }
}
```

## 唯一公开命令

只保留一个公开入口：

```bash
along project-sync <project-path>
```

不再保留独立的 `scaffold` 命令心智。

## 同步结果

同步后，目标项目会生成或更新这些受管结果：

- `AGENTS.md`
- `QUALITY.md`
- `.ranwawa/pre-commit`
- `.ranwawa/commit-msg`
- `.ranwawa/preinstall.ts`
- `.along/preset/quality.config.json`
- `.along/preset/scripts/quality/*`
- `.along/preset/manifest.json`
- `prompts/along/*`
- `skills/along/*`
- `.opencode/commands/*`
- `.opencode/skills/along/*`
- `.pi/prompts/*`
- `.pi/skills/along/*`
- `.codex/prompts/*`
- `.codex/skills/along/*`
- `.claude/commands/*`
- `.claude/skills/along/*`
- `.github/actions/along-quality-gate/action.yml`

同时会更新：

- `package.json` 中的 `preinstall`
- `package.json` 中的 `prepare`
- `package.json` 中的 `quality:changed`
- `package.json` 中的 `quality:full`
- `.gitignore` 中的受管目录放行规则

## 运行时边界

`preset` 和 `along` 的边界如下：

- `preset` 负责把项目需要的通用资产同步进业务仓
- `along` 在创建 worktree 时直接复制业务仓已有内容
- `along` 不再把 `preset-assets` 当作 worktree 的 prompts / skills 源目录

这意味着：

- 项目侧 prompts / skills 的唯一来源是业务仓中已同步的文件
- `along` 只负责自身命令、运行时权限、worktree / session 管理

## 生成规则

- 只认 `.along.json`
- 必须存在 `.along.json.distribution`
- 生成 `json` / `mjs` 文件时会先走 along 当前仓库的 Biome 格式化
- 先清理受管输出目录，再写入新结果，避免历史残留
- 同步后生成 `.along/preset/manifest.json` 记录产物摘要

## 扩展规则

以后新增质量门禁、提示词、技能或其他通用资产，只允许通过两种方式扩展：

1. 在 `packages/preset-assets/` 中新增资产类型或资产内容
2. 在目标仓库 `.along.json.distribution` 中新增结构化差异配置

禁止继续在业务仓手工复制新的通用脚本、文档或提示词。
