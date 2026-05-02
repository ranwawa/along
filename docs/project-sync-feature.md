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
- `packages/biome-config`
  - 共享 Biome 配置源
  - 由 `project-sync` 分发到业务仓的 `.along/preset/biome.shared.json`

## 单一事实源

通用 prompts / skills / hooks / quality engine 只允许放在 `packages/preset-assets/`：

- `packages/preset-assets/hooks/`
- `packages/preset-assets/quality/`
- `packages/preset-assets/prompts/`
- `packages/preset-assets/skills/`

后续新增这几类通用能力，也只能继续扩展这里。

Biome 规则的事实源是 `packages/biome-config/biome.shared.json`，同步时会生成业务仓的 `biome.json` 并指向这份受管配置副本。

## 唯一配置入口

每个接入项目只使用一个配置文件：`.along/setting.json`。

集中分发配置统一挂在 `.along/setting.json.distribution` 下，不再新增其他配置文件，也不保留 `along.project.json` 兼容逻辑。

示例：

```json
{
  "agent": "claude",
  "distribution": {
    "quality": {
      "changedWorkspaceCheckTaskRef": "workspace:changed",
      "fullSequence": ["workspace:full", "root:typecheck", "root:test"],
      "packageExecutionOrder": ["root"],
      "tasks": {
        "workspace:changed": {
          "title": "检查变更文件格式",
          "command": "bunx",
          "args": ["biome", "check", "--write", "--no-errors-on-unmatched"],
          "appendFiles": true
        },
        "workspace:full": {
          "title": "检查全量代码格式",
          "command": "bunx",
          "args": ["biome", "check", "."]
        },
        "root:typecheck": {
          "title": "执行 root typecheck",
          "command": "bun",
          "args": ["run", "typecheck"],
          "cwd": "."
        },
        "root:test": {
          "title": "执行 root test",
          "command": "bun",
          "args": ["run", "test"],
          "cwd": "."
        }
      },
      "packages": {
        "root": {
          "path": ".",
          "typecheckTaskRef": "root:typecheck",
          "fullTestsTaskRef": "root:test"
        }
      }
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

`id`、`displayName`、`projectDocPath`、`cleanupPaths`、`tooling`、`quality.rootGateFiles`、`quality.rootGatePrefixes` 都是可选覆盖项；不配置时由 preset 从项目结构推断。

## 唯一公开命令

只保留一个公开入口：

```bash
along project-sync [project-path]
along project-sync --check [project-path]
```

不再保留独立的 `scaffold` 命令心智。

当目标项目缺少 `.along/setting.json.distribution` 时，命令会先进入初始化向导；
非交互环境可使用 `along project-sync --yes [project-path]` 采用自动推断值。
`--check` 只做漂移检测，不写入文件；它会用同一套生成逻辑在内存中产出预期结果，再和目标仓实际文件比较。

## 同步结果

同步后，目标项目会生成或更新这些受管结果：

- `AGENTS.md`
- `biome.json`
- `.along/git-hooks/pre-commit`
- `.along/git-hooks/commit-msg`
- `.along/git-hooks/preinstall.ts`
- `.along/preset/biome.shared.json`
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
- `package.json` 中的 `devDependencies["@biomejs/biome"]`
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

- 只认 `.along/setting.json`
- 必须存在 `.along/setting.json.distribution`
- 同步前要求目标 Git 工作区干净；存在未提交变更时中止，避免覆盖用户改动
- 写入前会在临时目录生成完整预期文件，并使用共享 Biome 配置执行 `biome check --write` 和 `biome check`
- `--check` 直接比较预期文件与目标仓文件，不依赖 manifest 判断漂移
- 先清理受管输出目录，再写入新结果，避免历史残留
- 同步后生成 `.along/preset/manifest.json` 记录产物摘要

## 扩展规则

以后新增质量门禁、提示词、技能或其他通用资产，只允许通过两种方式扩展：

1. 在 `packages/preset-assets/` 中新增资产类型或资产内容
2. 在目标仓库 `.along/setting.json.distribution` 中新增结构化差异配置

禁止继续在业务仓手工复制新的通用脚本、文档或提示词。
