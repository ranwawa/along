# @ranwawa/scaffold

一键初始化项目工程规范（Bun 强制、Biome、Git Hooks）。

## 快速开始

```bash
npx @ranwawa/scaffold init
```

这条命令会自动完成以下操作：

1. 创建 `bin/preinstall.ts`（强制使用 Bun 作为包管理器，npm/yarn/pnpm 执行 install 时直接报错退出）
2. 写入 `biome.json`（继承 `@ranwawa/biome-config` 共享规则）
3. 创建 `.githooks/pre-commit`（commit 时自动运行 Biome 检查）
4. 创建 `.githooks/commit-msg`（校验提交信息是否符合 Conventional Commits 规范）
5. 在 `package.json` 中配置 `preinstall`、`prepare` 等脚本
6. 安装 `@biomejs/biome` 和 `@ranwawa/biome-config` 为 devDependencies

完成后，团队成员只需 `bun install` 即可自动激活所有规范检查，无需额外配置。

## 初始化后的效果

**包管理器锁定**：使用 npm/yarn/pnpm install 时直接报错退出，强制使用 Bun。

**代码提交检查**：

```bash
git add .
git commit -m "feat: something"
# 1. pre-commit hook 自动运行：biome check --staged --write --no-errors-on-unmatched
# 2. commit-msg hook 自动校验提交信息格式
```

- 仅检查暂存区文件，不影响未暂存的改动
- 自动修复可修复的格式/lint 问题
- 检查不通过时阻止 commit
- 提交信息不符合 `<type>(<scope>): <description>` 格式时阻止 commit

## 初始化后生成的文件

```
bin/preinstall.ts         # 包管理器守卫（强制 Bun）
biome.json                # Biome 配置，extends @ranwawa/biome-config
.githooks/pre-commit      # Git pre-commit hook
.githooks/commit-msg      # Git commit-msg hook
```

## 可用的 npm scripts

初始化后会在 `package.json` 中添加以下脚本（已存在的不会覆盖）：

```bash
bun run format    # biome format --write .
bun run lint      # biome lint .
bun run check     # biome check --write .
```

## 原理

- `preinstall` 脚本检查 `npm_config_user_agent` 环境变量，非 Bun 直接退出
- 使用 git 原生 `core.hooksPath` 管理 hooks，无需 husky 等第三方依赖
- 使用 Biome 原生 `--staged` 参数检查暂存文件，无需 lint-staged
- `prepare` 脚本确保 `bun install` 后自动配置 hooks 路径
