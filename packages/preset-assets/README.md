# @ranwawa/preset-assets

这是集中分发的唯一资产源。

当前包含：

- `biome/`：共享 Biome 规则
- `gitignore/`：共享 Git ignore 规则
- `hooks/`：Git hooks 与 preinstall 模板
- `quality/`：通用质量门禁执行引擎
- `agents/prompts/`：项目侧通用 agent 工作流提示词
- `skills/`：项目侧通用技能

约束：

- `.along/preset/` 是 `biome.json` 和质量脚本依赖的基础配置，必须可被 Git 跟踪，确保 `git worktree add` 后自然存在。
- agent 工作流提示词统一维护在 `agents/prompts/`，同步时分发到目标编辑器的 prompt 目录，不再维护旧的顶层 `prompts/` 入口。
- Along Web Task 的 Planner / Executor / Tester 等节点角色是 Along runtime 内部细节，不通过 preset-assets 分发到业务项目。
- `node_modules/` 始终是 bun 管理的本地安装产物，不复制、不软链、不入库。
