# @ranwawa/preset-assets

这是集中分发的唯一资产源。

当前包含：

- `biome/`：共享 Biome 规则
- `gitignore/`：共享 Git ignore 规则
- `hooks/`：Git hooks 与 preinstall 模板
- `quality/`：通用质量门禁执行引擎
- `prompts/`：项目侧通用提示词
- `skills/`：项目侧通用技能

约束：

- `.along/preset/` 是 `biome.json` 和质量脚本依赖的基础配置，必须可被 Git 跟踪，确保 `git worktree add` 后自然存在。
- `node_modules/` 始终是 bun 管理的本地安装产物，不复制、不软链、不入库。
