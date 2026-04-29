---
name: code-review
description: 代码审查规范与检查清单，指导 Reviewer Agent 按统一标准审查 PR
---

# 代码审查规范 (Code Review Standards)

## 必查项（Must Check）

### 逻辑正确性
- 代码是否正确实现了 Issue/PR 描述的需求
- 边界条件是否处理（空值、空数组、零值、负数等）
- 异步操作是否正确 await，有无遗漏的错误处理
- 循环和递归是否有正确的终止条件

### 类型安全
- TypeScript 类型是否准确，避免 `any` 滥用
- 函数参数和返回值类型是否明确
- 类型断言（`as`）是否合理且必要

### 错误处理
- `Result<T>` 模式是否正确使用（`success()` / `failure()`）
- 外部调用（GitHub API、文件系统、子进程）是否有错误处理
- 错误信息是否清晰，便于排查

### 安全性
- 是否存在命令注入风险（拼接 shell 命令时）
- 敏感信息（token、密码）是否泄露到日志或输出
- 文件路径操作是否存在路径遍历风险

## 风格项（Style）

### 项目规范一致性
- 日志使用 `consola.withTag("module-name")` 格式
- 用户可见消息使用中文
- CLI 参数解析使用 `commander`
- Git 操作使用 `simple-git` 或 Bun `$` shell

### 代码组织
- 函数职责单一，不超过合理长度
- 导入顺序：外部依赖 → 内部模块
- 命名清晰，变量名和函数名能表达意图

## 架构项（Architecture）

### 模块职责
- 新代码是否放在了正确的模块中
- 是否遵循现有的分层结构（bin/ 脚本 → 共享模块）
- 是否复用了已有的工具函数和抽象（`SessionPathManager`、`SessionManager`、`GitHubClient`）

### 依赖方向
- 是否引入了不必要的新依赖
- 模块间依赖是否合理，避免循环依赖

## 审查输出格式

审查结论分为三种：

1. **APPROVE** — 代码质量达标，无阻塞性问题
2. **COMMENT** — 有建议但不阻塞合并
3. **REQUEST_CHANGES** — 存在必须修复的问题

对于 REQUEST_CHANGES，每个问题必须包含：
- 问题所在的文件和行号
- 问题描述（是什么问题、为什么是问题）
- 建议的修复方向
