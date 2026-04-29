# Along (@ranwawa/along)

`@ranwawa/along` 是围绕 GitHub Agent 工作流的 CLI。

核心能力：

- Issue 到 PR 的自动化编排
- 多 Agent 运行支持
- worktree / session / 日志管理
- webhook 驱动的自动处理
- `along project-sync` 作为集中分发入口

包内结构：

- `bin/`：CLI 与运行时逻辑
- `types/`：补充类型声明
- `web/`：Dashboard 前端

项目通用 prompts / skills、质量门禁脚本、hooks 等基建资产不再放在本包内，而由 `packages/preset-assets` 统一维护并通过 `along project-sync` 分发到业务仓。
