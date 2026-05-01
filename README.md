# along monorepo

这个仓库现在只承担 monorepo 容器职责。

核心包：

- `packages/along`：GitHub Agent CLI 与运行时
- `packages/preset`：集中分发引擎
- `packages/preset-assets`：分发资产唯一事实源
- `packages/biome-config`：共享 Biome 规则

常用命令：

```bash
bun run dev:server
bun run test
along project-sync [project-path]
along project-sync --check [project-path]
```
