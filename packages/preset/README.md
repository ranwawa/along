# @ranwawa/preset

`@ranwawa/preset` 是 along monorepo 内部使用的集中分发引擎。

职责只有两类：

- 读取目标仓库 `.along.json` 中的 `distribution` 配置
- 组合 `@ranwawa/preset-assets` 里的通用资产并生成受管文件

对外入口只保留：

```bash
along project-sync <project-path>
```

这个包不再暴露独立 CLI，避免出现 `along` / `scaffold` 两套命令心智。
