# @ranwawa/preset

`@ranwawa/preset` 是 along monorepo 内部使用的集中分发引擎。

职责只有两类：

- 读取目标仓库 `.along/setting.json` 中的 `distribution` 配置
- 组合 `@ranwawa/preset-assets` 里的通用资产和共享规则，生成受管文件

agent 工作流提示词的源头是 `packages/preset-assets/agents/prompts`。`along project-sync` 会从该集中目录读取并分发到目标仓库的编辑器 prompt 目录。

对外入口只保留：

```bash
along project-sync [project-path]
along project-sync --check [project-path]
```

这个包不再暴露独立 CLI，避免出现 `along` / `scaffold` 两套命令心智。
