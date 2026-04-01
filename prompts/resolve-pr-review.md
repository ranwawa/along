---
description: 接收 PR 编号并启动代码审查反馈 (Review Comments) 的自动化处理 SOP
---

我们要着手处理 PR **$1** 的代码审查反馈。

这是一次协作过程。你作为技术专家，既要能理解并采纳合理的优化建议，也要在认为方案存在隐患或冲突时与 Reviewer 进行专业探讨。

## 前置检查

**模型（你）不负责初始化工作空间**，工作空间应由外部工具 `pr-start` 预先创建。在开始之前，确认以下条件已满足：

1. **检查状态文件存在**：`~/.along/sessions/pr-$1-status.json` 应存在且 `status` 为 `running`
2. **检查 worktree 存在**：`~/.along/worktrees/pr-$1/` 目录应存在
3. **检查 todo 文件存在**：`~/.along/sessions/pr-$1-todo.md` 应存在

**如果以上任一条件不满足**，立即停止并提示用户：
```
工作空间未正确初始化。请先运行：
  along pr-start $1
```

## 工作空间说明

- **你的工作目录**：`~/.along/worktrees/pr-$1/`（所有文件操作在此进行）
- **状态/追踪文件位置**：`~/.along/sessions/pr-$1-{status,todo}.md`（在主仓库，不在 worktree 内）
- **切换到 worktree 后执行**：`cd ~/.along/worktrees/pr-$1`

## 步骤追踪

在 `~/.along/sessions/pr-$1-todo.md` 文件中维护进度，**必须在获得明确成功结果后才标记 `[x]`**。

初始内容（已由 `pr-start` 创建）：
```markdown
- [ ] 第一步：获取 PR 详情与评论
- [ ] 第二步：分析代码变更
- [ ] 第三步：实施修正（逐条处理）
- [ ] 第四步：质量门禁检查
- [ ] 第五步：提交并更新 PR
```

**重要纪律**：
1. **真实响应为准**：收到工具调用**成功返回结果**后，才能将 `[ ]` 更新为 `[x]`
2. **留存产出证明**：标记 `[x]` 时，在该行下方贴入工具返回的关键产出或链接
3. **强串行依赖**：前一步未成功前，严禁开始下一步

## 强制工作流程

### 第一步：进入工作空间并获取 PR 详情与评论

**进入 worktree**：
```bash
cd ~/.along/worktrees/pr-$1
```

**获取 PR 详情与评论**（执行安全校验）：
```bash
along pr-reviews $1
```

**分析重点**：
- 尚未解决（没有被回复过）的评论
- 代码行评论（reviewComments）优先于通用评论
- 标记为 "Pending" 或没有回复的评论

更新 `pr-$1-todo.md`，标记第一步完成。
执行状态更新：
```bash
along issue-status $1 running "已获取 PR 详情" --step "Review 代码变更"
```

### 第二步：逐步 Review 代码变更

在 worktree 内深入分析：

1. **查看变更范围**：
   ```bash
   git diff HEAD~1 --name-only
   git diff HEAD~1 --stat
   ```

2. **逐文件分析**：
   - 使用 `Read` 读取变更文件
   - 理解原始意图和新逻辑
   - 标记潜在问题点

3. **结合评论分析**：
   - 将 reviewComments 与代码行对应
   - 理解 reviewer 的关切点

完成后更新 `pr-$1-todo.md`。
执行状态更新：
```bash
along issue-status $1 running "已完成代码 Review" --step "运行测试验证"
```

### 第三步：运行相关测试验证功能

### 第四步：实施修正（逐条处理）

对于获取到的每一条关键评注，遵循"**实施 -> 回复**"的原子逻辑：

1. **定位与分析**：
   - 通过评注中的 `path` 和 `line`，定位代码
   - 结合 `diff_hunk` 分析上下文

2. **决策与执行**：
   - **认可（Agree）**：
     a. **立即在本地实施修改**（使用 `Edit`）
     b. **修改完成后，使用 pr-reply 脚本回复评论**：
        ```bash
        along pr-reply $1 $comment_id "已按建议修正"
        ```
   - **异议（Disagree/Discuss）**：
     - 使用 pr-reply 脚本回复详述技术理由
     - 不修改对应代码

3. **闭环**：确保每一条处理过的评注都留下了回复轨迹。

**逐条处理完成后**，更新 `pr-$1-todo.md`，附上处理摘要（修改了哪些文件、回复了哪些评论）。

### 第四步：质量门禁检查

**必须全部通过才能继续**：

1. **Prettier 格式化**：
   ```bash
   npx prettier --check 修改的文件
   npx prettier --write 修改的文件  # 如有问题
   ```

2. **ESLint 检查**：
   ```bash
   npx eslint 修改的文件
   # 必须 0 error、0 warning
   ```

3. **TypeScript 类型检查**：
   ```bash
   npx tsc --noEmit
   # 必须 0 type error
   ```

4. **单元测试**：
   ```bash
   npm test -- --coverage --testPathPattern="相关文件"
   # 必须 100% 通过
   # 修改部分必须 100% 行覆盖
   ```

**任一失败**：停止，修复，重新检查，直到全部通过。

完成后更新 `pr-$1-todo.md`，附上质量门禁结果摘要。

### 第五步：提交并更新 PR

**所有检查通过后执行**：

1. **原子化提交并推送**：
   - 必须通过 `commit-push` 脚本执行
   - ```bash
     along commit-push --message "fix(scope): 按评审意见修复问题" --files 文件1
     ```

2. **更新状态为完成**：
   - ```bash
     along pr-status $1 completed --message="已按评审意见完成修改"
     ```

完成后更新 `pr-$1-todo.md`，标记所有步骤完成，附上提交信息和 PR 更新摘要。

## 终止与清理

### 正常完成
任务完成后，状态文件会归档到 `archive/` 目录，便于历史追溯。

### 异常终止
如果任务需要提前终止：

1. **更新状态为 error**：
   ```bash
   along pr-status $1 error --message="终止原因"
   ```

2. **可选清理**：
   ```bash
   # 保留现场排查
   # 或清理：
   along pr-cleanup $1
   ```

### 强制重新开始
```bash
# 1. 强制清理
along pr-cleanup $1 --force

# 2. 重新初始化
along pr-start $1

# 3. 重新开始流程
```

## 模型职责边界

### 你必须做的（非确定性任务）

1. **理解与分析**：理解 PR 评论，分析代码，制定策略
2. **决策**：判断是否采纳 review 意见，选择实现方式
3. **代码修改**：编写和修改代码
4. **验证**：检查修改是否正确解决问题
5. **回复评论**：与 reviewer 沟通

### 你不应该做的（由工具/脚本处理）

1. **工作空间初始化**：不调用 `pr-start`，这是外部工具的职责
2. **状态文件维护**：不直接读写 `status.json`，使用 `pr-status` 工具
3. **Git 底层操作**：不直接执行 `git worktree add/remove`
4. **目录管理**：不创建/删除 `~/.along/worktrees/` 目录结构

### 边界示例

| 场景 | 模型做 | 工具做 |
|------|--------|--------|
| 开始新任务 | 确认工作空间已就绪 | `pr-start` 创建 worktree |
| 记录进度 | 分析任务并更新 todo 清单 | 已创建 todo.md 模板 |
| 完成任务 | 编写代码，验证通过 | `pr-status` 更新状态 |
| 清理资源 | 提示用户或等待指令 | `pr-cleanup` 删除 worktree |

遵循以上边界，专注于你擅长的分析与实现工作，将确定性操作交给工具处理。
