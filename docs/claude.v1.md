# Verify 阶段实现方案 v2

## Context

在 along 的 exec 流程中，需要确保 AI 写的代码通过质量验证才能进入 delivery。采用两层验证设计：
1. Exec agent 自检（增量）— 强化 prompt，要求 agent 写代码时自己跑检查
2. 独立 Verifier（全量）— commit 后由系统级验证器跑完整质量门禁

### 生产契约

提供默认契约（biome + typescript + vitest + build），所有业务项目尽量统一。特殊情况才在 `.along/production-contract.json` 中自定义。

### 防自证

验证使用默认分支上的契约，不使用任务分支修改后的版本。如果任务修改了契约/CI/质量脚本，标记为高风险。

---

## 整体流程

```
Exec Agent (自检: 增量 lint/test)
  → Auto-commit → exec.completed → verifying (ACTIVE)
    → Verifier (全量: biome + tsc + vitest + build)
      → 通过 → exec.verified → implemented (WAITING)
        → autonomous continuation → scheduleDelivery
      → 失败 → fix agent → re-commit → re-verify (最多 2 轮修复)
        → 修复后仍失败 → task.failed
```

---

## 状态机

不需要修改。现有转换完全满足：
- `exec.completed`: `implementing → verifying` (ACTIVE)
- `exec.verified`: `verifying → implemented` (WAITING)
- `task.failed`: 任何非 DONE 状态 → FAILED

验证循环在 `verifying` 状态内完成所有重试，只在最终结果时转换状态。

---

## 默认生产契约

```json
{
  "version": 1,
  "verify": {
    "commands": [
      { "name": "lint", "command": "bunx", "args": ["biome", "check", "."] },
      { "name": "typecheck", "command": "bunx", "args": ["tsc", "--noEmit"] },
      { "name": "test", "command": "bun", "args": ["run", "test"] },
      { "name": "build", "command": "bun", "args": ["run", "build"] }
    ],
    "maxFixAttempts": 2,
    "timeoutMs": 300000
  }
}
```

项目可在 `.along/production-contract.json` 中覆盖。缺失时使用默认值。

---

## 文件清单

| 文件 | 操作 |
|---|---|
| `src/app/task/verification-gate.ts` | 新建 — 执行验证命令 |
| `src/app/task/verification-gate.test.ts` | 新建 — 测试 |
| `src/app/task/verification-loop.ts` | 新建 — 验证重试循环 |
| `src/app/task/verification-loop.test.ts` | 新建 — 测试 |
| `src/agents/task-verify.ts` | 新建 — verification-fix prompt builder |
| `src/agents/workflow-node-prompts/verification-fix.md` | 新建 — fix prompt |
| `src/agents/workflow-node-prompts/executor-exec.md` | 修改 — 增加自检要求 |
| `src/app/task/exec-agent.ts` | 修改 — 插入 runVerificationLoop |
| `src/app/scheduler/task-autonomous-continuation.ts` | 修改 — guard 改为 WAITING |
| `src/app/scheduler/task-autonomous-continuation.test.ts` | 修改 — 更新测试 |
| `src/app/delivery/index.ts` | 修改 — exec.verified → task.accepted |
