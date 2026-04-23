---
description: Issue 修复流程：Implementation 阶段（按审批计划实现、提交并创建 PR）
---

我们要处理的 Issue 编号是：**$1**。

## 阶段目标

完成本阶段工作：

1. 创建语义化分支
2. 按已审批计划实施修复
3. 提交并推送代码
4. 创建 PR

## 输入

- 当前目录：Issue 对应的 worktree
- 已审批计划：`../step2-issue-comment.md`
- 追踪文件：`../todo.md`（第三步需要手动更新）

开始前先读取已审批计划：

```bash
cat ../step2-issue-comment.md
```

只有在工具调用成功返回后，才视为该步骤完成。

## 必须完成

### 1. 创建语义化分支

根据已审批计划中的 Issue 内容判断类型，参考 `branch-naming` SKILL 生成分支名：
`<type>/issue-<N>-<short-description>`

然后创建分支：

```bash
along branch-create $1 <branch-name>
```

### 2. 实施修复

严格按已审批计划修改代码。

- 逐步完成计划中的改动
- 涉及测试时，参考 `unit-testing` SKILL 补充或更新测试
- 做必要的局部验证
- 持续更新 `../todo.md` 中第三步的进度

### 3. 提交并推送

参考 `conventional-commits` SKILL 编写提交信息，然后使用：

```bash
along commit-push --message "fix(scope): 描述" --files 文件1 文件2
```

如需多次原子提交：

```bash
along commit-push --json '[{"message":"feat: first","files":["a.ts"]},{"message":"feat: second","files":["b.ts"]}]'
```

`commit-push` 会统一处理提交、rebase、推送和状态更新。若失败，先修复问题再重试。

### 4. 创建 PR

参考 `pr-summary` SKILL 准备 PR 描述，必须包含 `fixes: #$1`，然后执行：

```bash
along pr-create $1 "PR 标题" "PR 详细摘要"
```

PR 创建成功后结束本阶段。

## 失败处理

如果任务无法继续，执行：

```bash
along issue-status $1 failed --message="终止原因"
```

## 禁止事项

- 不重新制定计划或偏离已审批方案
- 不手动创建或删除 worktree
- 不手动维护会话状态
- 不直接执行底层 `git worktree` 管理操作

## 完成条件

- 代码和测试已按计划完成
- 变更已通过 `commit-push` 推送
- PR 已成功创建
