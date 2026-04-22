---
description: Issue 修复流程：Planning 阶段（首版计划与交互式修订）
---

我们要处理的 Issue 编号是：**$1**。

## 阶段目标

完成 planning 阶段，但不要进入代码实现。

你这次运行只允许做两类事情之一：

1. 发布首版官方计划
2. 处理当前讨论轮次，并且：
   - 如果只是解释，不改变计划约束和执行内容，发布 `Planning Update`
   - 如果涉及 scope / changes / risks / validation / accepted constraints 任一变化，发布新的官方 `Plan vN`

完成后立即退出。

## 输入

- 当前目录：Issue 对应的 worktree
- Issue 数据：`../issue.json`
- Planning 上下文：`../planning-context.json`
- 追踪文件：`../todo.md`（脚本自动维护）

只有在工具调用成功返回后，才视为该步骤完成。

## 必须先做

### 1. 读取输入

先读取：

```bash
cat ../issue.json
cat ../planning-context.json
```

从 `planning-context.json` 中确认：

- 是否已有 `currentPlan`
- 是否存在 `openRound`
- 当前 round 里的用户反馈具体是什么
- 本次若需要修订，必须使用的 `proposedPlan.planId` / `proposedPlan.version` / `proposedPlan.basedOnPlanId`

## 首次 planning

如果 `currentPlan` 为空：

1. 根据 Issue 内容判断类型，参考 `branch-naming` SKILL 生成分支名：
   `<type>/issue-<N>-<short-description>`
2. 创建分支：

```bash
along branch-create $1 <branch-name>
```

3. 发布官方计划评论：

```md
<!-- along:plan {"planId":"<planning-context.json 中的 proposedPlan.planId>","version":<proposedPlan.version>} -->
## Plan v<proposedPlan.version>

一句话摘要。

### Scope
- ...

### Changes
- ...

### Risks
- ...

### Validation
- ...

### Decision Log
- ...
```

然后执行：

```bash
along issue-comment $1 "上面的完整 Markdown" --step 2
```

## 处理讨论轮次

如果 `openRound` 不为空：

先阅读 round 内的人类评论，判断属于哪种情况：

- 纯解释：只回答问题，不接受新约束，不改变计划字段
- 计划修订：任何新增约束、范围变化、风险变化、验证变化，都必须修订计划

### A. 纯解释时

发布：

```md
<!-- along:planning-update {"roundId":"<openRound.roundId>","basedOnPlanId":"<currentPlan.planId>"} -->
## Planning Update

### Answered
- Q: ...
  A: ...

### Next Status
- Current official plan: v<currentPlan.version>
- Current state: awaiting approval

> 本次更新仅包含解释，未修改官方计划。
```

然后执行：

```bash
along issue-comment $1 "上面的完整 Markdown"
```

### B. 需要修订计划时

必须发布新的官方计划评论，且：

- 使用 `proposedPlan.planId`
- 使用 `proposedPlan.version`
- `basedOnPlanId` 填 `proposedPlan.basedOnPlanId`
- 明确说明相对上一版的变化

模板：

```md
<!-- along:plan {"planId":"<proposedPlan.planId>","version":<proposedPlan.version>,"basedOnPlanId":"<proposedPlan.basedOnPlanId>","roundId":"<openRound.roundId>"} -->
## Plan v<proposedPlan.version>

一句话摘要。

### Changes Since Last Version
- Added: ...
- Removed: ...
- Clarified: ...

### Scope
- ...

### Changes
- ...

### Risks
- ...

### Validation
- ...

### Decision Log
- Accepted: ...
- Rejected: ...
```

然后执行：

```bash
along issue-comment $1 "上面的完整 Markdown"
```

## 严格约束

- 不进入实施阶段，不修改代码
- 不手动更新会话状态或 `../todo.md`
- 不手动创建或删除 worktree
- 不直接执行底层 `git worktree` 管理操作
- 不要省略 `<!-- along:... -->` 元数据注释
- 只有在“纯解释”时才允许发布 `Planning Update`
- 只要接受了新约束或修改了计划，就必须发布新的 `Plan vN`

## 完成条件

- 首次 planning：分支已创建，且官方计划已发布
- 讨论轮次：已发布 `Planning Update` 或新版 `Plan vN`
- 正常退出，等待系统继续收敛或人工审批
