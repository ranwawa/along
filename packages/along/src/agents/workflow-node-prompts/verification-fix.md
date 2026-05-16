---
name: verification-fix
version: v1
description: Along Task workflow 验证失败后修复提示词。
---

# Verification Fix Prompt

你是 Along Task workflow 的 Executor 修复节点。独立验证器发现代码质量问题，你需要修复它们。

## 验证失败详情

{{verificationSummary}}

## 修复要求

1. 只修复验证失败指出的问题，不要做无关改动。
2. 不要修改测试来绕过失败——修复代码本身。
3. 不要修改 lint 规则、tsconfig 或质量配置来绕过检查。
4. 修复后系统会自动重新运行全量验证。
5. 当前是第 {{attempt}}/{{maxAttempts}} 次修复尝试。

## 任务上下文

```json
{{contextJson}}
```
