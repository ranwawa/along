# Issue 前置检查与本地分类门控

Along 在创建 worktree 和启动 Codex 之前，会先执行静态检查和本地 Issue 分类。只有 `bug` 或 `feature` 会进入 Codex 处理流程。

## 标签体系

| 标签 | 含义 | 来源 |
|---|---|---|
| `bug` | 缺陷、回归、异常 | 本地分类或人工打标 |
| `feature` | 新功能、增强、重构 | 本地分类或人工打标 |
| `question` | 提问、咨询 | 本地分类，回复后终止 |
| `spam` | 垃圾、无意义、测试 | 本地分类，回复后关闭 |
| `running` | 正在处理中 | 系统自动打标 |

## 流程

1. `Issue.checkHealth()` 检查 Issue 是否存在、是否 open、是否已有阻断标签或运行中标签。
2. `triageIssue()` 优先尊重已有 `bug` / `feature` 标签，否则用本地规则分类。
3. `bug` / `feature` 会打上 `running` 并启动 Codex。
4. `question` / `spam` 只回复或关闭，不启动 Codex。

当前分类不依赖外部模型或额外 Codex 配置；无法明确排除代码修改需求时，默认进入 Codex 处理流程。
