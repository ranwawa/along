---
name: branch-naming
description: 详细指导如何规范地命名针对特定 Issue 的 Git 开发分支，确保团队规范和可追踪性
---

# 分支命名规范 (Branch Naming Convention)

为了保持 Git 分支历史的整洁和任务的可追溯性，我们在切出新的开发分支时，必须严格遵循统一的命名格式。

## 核心结构

必须采用小写字母、数字以及中划线（kebab-case）组合，格式如下：

```txt
<type>/issue-<issueNumber>-<short-description>
```

## 组成部分说明

### 1. Type (类型)

与 Conventional Commits (约定式提交) 保持一致，根据 Issue 需要解决的核心问题选择最匹配的前缀：

- **feat**: 增加新功能 (`feat/issue-12-add-login`)
- **fix**: 修复 Bug (`fix/issue-34-token-crash`)
- **docs**: 文档更新 (`docs/issue-45-update-readme`)
- **style**: 格式调整而不影响运行 (`style/issue-56-format-css`)
- **refactor**: 代码重构 (`refactor/issue-67-extract-utils`)
- **perf**: 性能优化 (`perf/issue-78-db-index`)
- **test**: 增加或更新测试 (`test/issue-89-auth-tests`)
- **chore**: 构建系统或杂项 (`chore/issue-90-update-deps`)

### 2. issueNumber (关联 Issue 号)

必须紧跟着前缀，使用 `issue-` 加上原始传入的 Issue 数字编号。例如：`issue-102`。这能确保所有分支都能与其解决的源头需求强制对应。

### 3. short-description (简短描述)

- 使用2到4个英文单词精简概括所做的事情。
- **全部使用小写英文**。
- 单词之间必须使用单个中划线 `-` 连接。
- **绝对不要包含空格或大写字母**。

## 示例

✅ **正确示例：**

- `feat/issue-89-user-profile` (开发了 89 号 Issue 要求的用户配置功能)
- `fix/issue-104-typo-in-nav` (修复了 104 号 Issue 提出导航栏拼写错误)
- `refactor/issue-202-user-service` (依据 202 号 Issue 重构了 User Service)

❌ **错误示例：**

- `fix-login-bug` (缺少 type 层级，缺少 Issue 编号)
- `feat/issue#12/AddLogin` (包含非法字符 `#` 且使用了大写，没有使用中划线连读)
- `fix/123/database-crash` (未包含 `issue-` 关键字，层级嵌套过深)
