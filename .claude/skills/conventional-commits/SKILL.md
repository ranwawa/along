---
name: conventional-commits
description: 详细指导如何编写符合规范的 Git 提交信息（Conventional Commits），确保历史记录整洁清晰
---

# Conventional Commits 规范要求

所有的 Git 提交信息都必须严格遵循 Conventional Commits（约定式提交）规范。这有助于自动化生成 Changelog，并使审查者快速了解修改意图。

## 提交信息结构

每个提交信息都需要包含 **header**，其格式如下：

```txt
<type>(<scope>): <description>
```

## Types (类型)

使用以下类型来标识你的提交性质：

- **feat**: 增加新功能 (`feat(api): 新增了用户画像接口，支持前端展示更丰富的用户基础信息`)
- **fix**: 修复 Bug (`fix(auth): 修复了 Token 解析错误，解决了部分老用户无法正常登录的问题`)
- **docs**: 文档更新 (`docs(readme): 更新了安装步骤，解决了新员工本地环境无法顺利运行大仓的问题`)
- **style**: 格式调整，不影响代码运行 (`style: 使用 Prettier 统一了代码格式，消除了团队协作时的风格警告`)
- **refactor**: 代码重构，既不修 bug 也不加新功能 (`refactor(utils): 简化了日期格式化逻辑，提升了代码可读性并剔除了无用逻辑`)
- **perf**: 性能优化 (`perf(db): 为用户查询字段增加了索引，解决了管理后台加载列表过慢的问题`)
- **test**: 增加或更新测试用例 (`test(auth): 补充了缺失 Token 的边界测试，防止未来重构时引起逻辑回归`)
- **chore**: 构建系统、工具链更新或杂项 (`chore(deps): 升级了 typebox 版本，以便支持最新版本的 TS 语法推导`)
- **ci**: CI/CD 配置文件调整 (`ci(github): 增加了全量 Matrix 测试链路，解决了构建平台无法及时发现跨平台构建错误的问题`)

## Scope (作用域)

- `scope` 是可选的，用于说明修改影响的模块或目录。
- 建议使用简短的英文小写单词。

## Description (描述)

- **必须使用简短的中文**作为 Commit 描述。
- **采用用户故事的形式**：明确说明你“做了什么改动”，以及“解决了什么问题/带来了什么价值”。
- 结尾不加句号。

## 示例

✅ **正确示例：**

- `feat(cart): 新增了优惠券输入组件，解决了用户无法在购物车使用专属折扣的问题`
- `fix(login): 添加了无 Token 时的非空拦截，修复了用户在未登录状态下白屏的 Bug`
- `refactor: 提取了统一的日期处理工具函数，降低了未来处理跨时区逻辑的维护成本`

❌ **错误示例：**

- `Fixed a bug in login` (未使用中文，也没有说明解决了什么具体问题)
- `feat: 加了优惠券` (极其简短，未采用用户故事形式说明解决了什么问题)
- `update docs` (没有 type 约束)
