---
description: Issue 修复流程：Planning 阶段（创建分支并提交实施计划）
---

我们要处理的 Issue 编号是：**$1**。

## 阶段目标

完成本阶段工作：

1. 理解 Issue 并创建语义化分支
2. 分析代码并提交实施计划

完成后立即退出，等待人工审批。此阶段禁止进入代码实现。

## 输入

- 当前目录：Issue 对应的 worktree
- Issue 数据：`../issue.json`
- 追踪文件：`../todo.md`（脚本自动维护）

只有在工具调用成功返回后，才视为该步骤完成。

## 必须完成

### 1. 读取 Issue 并创建分支

先读取 Issue 数据：

```bash
cat ../issue.json
```

根据 Issue 内容判断类型，参考 `branch-naming` SKILL 生成分支名：

`<type>/issue-<N>-<short-description>`

然后创建分支：

```bash
along branch-create $1 <branch-name>
```

### 2. 分析代码并提交计划

围绕 Issue 相关关键词搜索代码，确认：

- 需要修改的模块或文件
- 主要改动点和依赖关系
- 验证与测试方式

将实施计划同步到 Issue 评论：

```bash
along issue-comment $1 "计划内容（Markdown）" --step 2
```

计划应聚焦改什么、为什么、按什么顺序做，以及如何验证。

## 禁止事项

- 不进入实施阶段，不修改代码
- 不手动更新会话状态或 `../todo.md`
- 不手动创建或删除 worktree
- 不直接执行底层 `git worktree` 管理操作

## 完成条件

- 分支已成功创建
- 实施计划已成功评论到 Issue
- 正常退出，等待审批通过后进入 Implementation 阶段
