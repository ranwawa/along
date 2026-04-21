# Session State Model v2

## 1. Purpose

本规范定义任务会话的统一状态模型，用于：

- 驱动自动化流程流转
- 表达任务当前所处业务阶段
- 向人类清晰展示当前进度与阻塞点
- 为恢复、诊断、统计和审计提供稳定基础

本模型采用三层结构：

- `lifecycle`：控制态
- `phase`：业务主流程态
- `step`：细粒度工作单元态

## 2. Design Goals

- 顶层状态保持少而稳定
- 过程表达足够细，便于观察和诊断
- 状态语义与实现方式解耦
- 避免状态枚举爆炸
- 支持中断恢复、失败定位、UI 展示和后续扩展

## 3. Non-Goals

- 不规定具体脚本、命令或执行器实现
- 不将日志系统纳入本规范
- 不定义权限审批机制本身，只定义其状态表达
- 不约束具体存储介质

## 4. Model Overview

```ts
interface SessionState {
  lifecycle: Lifecycle;
  phase: Phase;
  step: Step;

  message?: string;
  progress?: ProgressInfo;
  context?: SessionContext;
  timestamps: SessionTimestamps;
  error?: SessionError;
}
```

其中：

- `lifecycle` 决定系统当前是否运行、等待、完成或失败
- `phase` 决定当前处于哪段主流程
- `step` 决定当前具体动作
- 其他字段为观察、诊断和上下文信息

## 5. Normative Definitions

### 5.1 Lifecycle

`lifecycle` 是控制态，必须稳定、稀疏、可直接用于流程判断。

```ts
type Lifecycle =
  | "running"
  | "waiting_human"
  | "waiting_external"
  | "completed"
  | "failed"
  | "interrupted";
```

定义如下：

- `running`
  系统正在主动执行自动化工作。
- `waiting_human`
  系统暂停，等待人工输入、审批、确认或选择。
- `waiting_external`
  系统自身无进一步动作，等待外部事件变化。
- `completed`
  任务已成功完成。
- `failed`
  任务因错误、阻塞或约束未满足而失败。
- `interrupted`
  任务因非业务性原因中断，例如进程退出、宿主崩溃、外部终止。

约束：

- `completed`、`failed`、`interrupted` 为终态
- 终态一旦写入，不应再转回非终态，除非建立新会话

### 5.2 Phase

`phase` 是业务主流程态，必须表达稳定的业务分段，而非技术实现细节。

```ts
type Phase =
  | "planning"
  | "implementation"
  | "delivery"
  | "stabilization"
  | "done";
```

定义如下：

- `planning`
  理解需求、分析代码、形成方案、等待审批
- `implementation`
  执行代码修改、测试修改、局部验证
- `delivery`
  提交、推送、整理 PR 并发起交付
- `stabilization`
  处理 review、CI 和合并前后稳定化工作
- `done`
  主流程完成后的停靠阶段

约束：

- 正常流向应为  
  `planning -> implementation -> delivery -> stabilization -> done`
- 允许在 `stabilization` 内部反复处理反馈
- 非明确事件下，不应跨 phase 倒退

### 5.3 Step

`step` 是当前最小可观察工作单元，必须具有业务语义。

```ts
type Step =
  | "read_issue"
  | "understand_scope"
  | "prepare_workspace"
  | "prepare_branch"
  | "analyze_codebase"
  | "identify_change_set"
  | "draft_plan"
  | "publish_plan"
  | "await_approval"
  | "sync_approved_plan"
  | "edit_code"
  | "update_tests"
  | "run_targeted_validation"
  | "record_progress"
  | "prepare_commit"
  | "push_commits"
  | "draft_pr"
  | "open_pr"
  | "triage_review_feedback"
  | "address_review_feedback"
  | "triage_ci_failures"
  | "fix_ci"
  | "await_merge"
  | "archive_result";
```

约束：

- 每个 `step` 必须归属于一个 `phase`
- `step` 不得表达错误原因、数量、URL 或脚本名
- `step` 可以被重复进入，但必须由显式事件触发

## 6. Supporting Structures

```ts
interface ProgressInfo {
  current?: number;
  total?: number;
  unit?: string;
  label?: string;
}
```

- 用于表达阶段性推进
- 不参与状态控制判断

```ts
interface SessionContext {
  issueNumber: number;
  title?: string;
  repo?: string;
  branchName?: string;
  commitShas?: string[];
  prNumber?: number;
  prUrl?: string;
  reviewCommentCount?: number;
  failedCiCount?: number;
  changedFiles?: string[];
}
```

- 用于承载任务事实信息
- 不得替代状态字段

```ts
interface SessionTimestamps {
  startedAt: string;
  updatedAt: string;
  phaseStartedAt?: string;
  stepStartedAt?: string;
  endedAt?: string;
}
```

- `startedAt`：会话开始时间
- `updatedAt`：最近状态更新时间
- `phaseStartedAt`：当前 phase 开始时间
- `stepStartedAt`：当前 step 开始时间
- `endedAt`：终态写入时间

```ts
interface SessionError {
  code?: string;
  message: string;
  retryable?: boolean;
  details?: string;
}
```

- 仅用于失败或中断相关信息
- 不得将错误编码进 `step` 或 `phase`

## 7. Phase-Step Mapping

`planning` 包含：

- `read_issue`
- `understand_scope`
- `prepare_workspace`
- `prepare_branch`
- `analyze_codebase`
- `identify_change_set`
- `draft_plan`
- `publish_plan`
- `await_approval`

`implementation` 包含：

- `sync_approved_plan`
- `edit_code`
- `update_tests`
- `run_targeted_validation`
- `record_progress`

`delivery` 包含：

- `prepare_commit`
- `push_commits`
- `draft_pr`
- `open_pr`

`stabilization` 包含：

- `triage_review_feedback`
- `address_review_feedback`
- `triage_ci_failures`
- `fix_ci`
- `await_merge`

`done` 包含：

- `archive_result`

## 8. Transition Rules

### 8.1 Lifecycle transitions

允许的通用流转：

- `running -> waiting_human`
- `running -> waiting_external`
- `running -> completed`
- `running -> failed`
- `running -> interrupted`
- `waiting_human -> running`
- `waiting_human -> failed`
- `waiting_human -> interrupted`
- `waiting_external -> running`
- `waiting_external -> completed`
- `waiting_external -> failed`
- `waiting_external -> interrupted`

禁止：

- 任意终态返回非终态
- 无业务事件支撑的 `waiting_human <-> waiting_external` 直接切换

### 8.2 Phase transitions

正常顺序：

- `planning -> implementation`
- `implementation -> delivery`
- `delivery -> stabilization`
- `stabilization -> done`

允许特殊回环：

- `stabilization` 内部 step 重复
- 因明确业务策略允许重新进入 `implementation`，但必须有事件语义支撑

### 8.3 Step transitions

- `step` 必须属于当前 `phase`
- 同一 `phase` 内的 step 应按业务顺序推进
- 等待类 step 可与等待类 lifecycle 搭配：
  - `await_approval` 对应 `waiting_human`
  - `await_merge` 对应 `waiting_external`

## 9. Semantics

本模型要求：

- 系统控制逻辑只依赖 `lifecycle`
- 业务流程观察主要依赖 `phase`
- 实时执行进度主要依赖 `step`
- 文案展示主要依赖 `message`
- 计数、链接、标识符等事实主要依赖 `context`
- 错误诊断主要依赖 `error`

换句话说：

- “系统该不该继续跑”看 `lifecycle`
- “它在干哪类工作”看 `phase`
- “它现在具体做到哪”看 `step`

## 10. Example Snapshots

```json
{
  "lifecycle": "running",
  "phase": "planning",
  "step": "draft_plan",
  "message": "已收敛变更范围，正在整理实施步骤与测试策略",
  "context": {
    "issueNumber": 142,
    "repo": "acme/web",
    "branchName": "fix/issue-142-login-redirect-loop"
  },
  "timestamps": {
    "startedAt": "2026-04-21T01:00:00Z",
    "updatedAt": "2026-04-21T01:12:00Z",
    "phaseStartedAt": "2026-04-21T01:00:00Z",
    "stepStartedAt": "2026-04-21T01:10:30Z"
  }
}
```

```json
{
  "lifecycle": "waiting_human",
  "phase": "planning",
  "step": "await_approval",
  "message": "计划已同步，等待审批",
  "context": {
    "issueNumber": 142
  },
  "timestamps": {
    "startedAt": "2026-04-21T01:00:00Z",
    "updatedAt": "2026-04-21T01:18:00Z",
    "phaseStartedAt": "2026-04-21T01:00:00Z",
    "stepStartedAt": "2026-04-21T01:18:00Z"
  }
}
```

```json
{
  "lifecycle": "failed",
  "phase": "delivery",
  "step": "push_commits",
  "message": "推送未完成",
  "error": {
    "code": "PRE_PUSH_CHECK_FAILED",
    "message": "quality gate failed",
    "retryable": true
  },
  "timestamps": {
    "startedAt": "2026-04-21T01:00:00Z",
    "updatedAt": "2026-04-21T01:48:40Z",
    "phaseStartedAt": "2026-04-21T01:42:00Z",
    "stepStartedAt": "2026-04-21T01:45:20Z",
    "endedAt": "2026-04-21T01:48:40Z"
  }
}
```

## 11. UI Guidance

推荐展示优先级：

- 主徽标：`lifecycle`
- 主标签：`phase`
- 次标签：`step`
- 描述文案：`message`
- 附加信息：`progress`、`context`

这样可以稳定支持：

- 过滤：按 `lifecycle` 或 `phase`
- 观察：按 `step`
- 诊断：按 `error` 和 timestamps
- 统计：按 `phase`/`lifecycle` 聚合

## 12. Extension Policy

扩展规则如下：

- 若要表达新的控制语义，评估是否必须新增 `lifecycle`
- 若要表达新的业务段，新增 `phase`
- 若要表达更细过程，优先新增 `step`
- 若只是新增数量、链接、引用、对象标识，放入 `context`
- 若只是增强进度表达，放入 `progress`
- 若只是展示优化，不应改动状态枚举

扩展优先级：

1. `context`
2. `progress`
3. `step`
4. `phase`
5. `lifecycle`

这保证顶层稳定、底层灵活。

## 13. Summary

`Session State Model v2` 的核心是：

- 用少量稳定 `lifecycle` 管控制
- 用业务化 `phase` 管流程
- 用细粒度 `step` 管观察
- 用 `context/progress/error` 承载非状态信息

这套模型的好处是，既能让系统行为清晰可控，也能让“阶段1太粗”这类问题自然消失，而且不会再次走向状态爆炸。
