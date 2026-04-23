# Issue 前置检查与 AI 分类门控

在创建 worktree 和启动 Agent 之前，Along 会对 Issue 进行两层检查：**静态规则拦截** + **AI 分类门控**。只有被分类为 `bug` 或 `feature` 的 Issue 才会进入后续流程。

## 标签体系

| 标签 | 含义 | 来源 |
|---|---|---|
| `bug` | 缺陷/回归/异常 | AI triage 打标 |
| `feature` | 新功能/增强/重构 | AI triage 打标 |
| `question` | 提问/咨询 | AI triage 打标，回复后终止 |
| `spam` | 垃圾/无意义/测试 | AI triage 打标，回复后关闭 |
| `running` | 正在处理中 | 系统自动打标 |

## 检查流程

```
along run <N> / webhook issues.opened
  │
  ├─ 1. 静态检查（Issue.checkHealth）
  │   ├─ Issue 是否存在                → 不存在则终止
  │   ├─ Issue 是否 open               → 已关闭则终止
  │   ├─ 是否带有阻断标签 spam         → 有则终止
  │   └─ 是否带有 running 标签          → 有则终止（可尝试自动恢复）
  │
  ├─ 2. AI 分类门控（triageIssue）
  │   ├─ 已有 bug/feature 标签         → 跳过分类，直接进入流程
  │   ├─ bug/feature                   → 打标签 + running，继续
  │   ├─ question                      → 回复 Issue，终止
  │   ├─ spam                          → 打标签 + 关闭，终止
  │   └─ 分类失败                      → 直接终止（不回退）
  │
  └─ 3. 创建 worktree + 启动 Agent
```

## 关键文件

| 文件 | 职责 |
|---|---|
| `bin/issue.ts` | `Issue.checkHealth()` — 静态规则检查（状态、标签） |
| `bin/issue-triage.ts` | `triageIssue()` — AI 分类；`handleTriagedIssue()` — 根据分类结果打标签/回复/关闭 |
| `bin/run.ts` | CLI 路径入口，在 `handleAction()` 中串联静态检查 → AI 分类 → 启动 Agent |
| `bin/webhook-server.ts` | Webhook 路径入口，在 `issues.opened` 事件中调用 triage |

## CLI 路径详细流程（`bin/run.ts`）

1. `checkEnv()` — 验证 git 仓库、远程仓库
2. `checkIssue(taskNo)` — 加载 Issue 数据 + 静态健康检查
3. 持久化 `issue.json`
4. `checkTask()` — 检查 session 健康
5. `detectPhase()` — 确定执行阶段
6. **（仅 planning 阶段）AI 分类门控**：
   - 如果 Issue 已有 `bug`/`feature` 标签 → 跳过
   - 否则调用 `triageIssue()` 进行 AI 分类
   - 非 bug/feature → 处理后终止
   - bug/feature → 打标签，继续
7. `launchIssueAgent()` — 创建 worktree + 启动 Agent

## Webhook 路径详细流程（`bin/webhook-server.ts`）

1. 收到 `issues.opened` 事件
2. 过滤 Bot 创建的 Issue
3. 调用 `triageIssue()` 进行 AI 分类
4. 分类失败 → 直接终止（不回退）
5. 分类成功 → `handleTriagedIssue()` 处理（bug/feature 会启动 Agent）

## AI 分类配置

- **模型**: DeepSeek（通过 `DEEPSEEK_API_KEY` 环境变量配置）
- **可选模型覆盖**: `ALONG_TRIAGE_MODEL` 环境变量
- **缺少 API Key**: 直接返回失败，不会默认为 bug

## `handleTriagedIssue` 选项

```typescript
handleTriagedIssue(owner, repo, issueNumber, result, options?)
```

- `options.skipAgentLaunch?: boolean` — 为 `true` 时，bug/feature 分支只打标签不启动 Agent。CLI 路径使用此选项，因为 CLI 自己会调用 `launchIssueAgent()`。
