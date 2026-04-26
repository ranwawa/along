# @ranwawa/scaffold

一键初始化项目工程规范（Biome、Git Hooks 等）。

## 快速开始

```bash
npx @ranwawa/scaffold init
```

这条命令会自动完成以下操作：

1. 写入 `biome.json`（继承 `@ranwawa/biome-config` 共享规则）
2. 创建 `.githooks/pre-commit`（commit 时自动运行 Biome 检查）
3. 在 `package.json` 中配置 `prepare` 脚本（`bun install` 后自动激活 Git Hooks）
4. 安装 `@biomejs/biome` 和 `@ranwawa/biome-config` 为 devDependencies

完成后，团队成员只需 `bun install` 即可自动激活 pre-commit 检查，无需额外配置。

## 初始化后的效果

```bash
git add .
git commit -m "feat: something"
# pre-commit hook 自动运行：
# biome check --staged --write --no-errors-on-unmatched
```

- 仅检查暂存区文件，不影响未暂存的改动
- 自动修复可修复的格式/lint 问题
- 检查不通过时阻止 commit

## 初始化后生成的文件

```
biome.json              # Biome 配置，extends @ranwawa/biome-config
.githooks/pre-commit    # Git pre-commit hook
```

## 可用的 npm scripts

初始化后会在 `package.json` 中添加以下脚本（已存在的不会覆盖）：

```bash
bun run format    # biome format --write .
bun run lint      # biome lint .
bun run check     # biome check --write .
```

## 原理

- 使用 git 原生 `core.hooksPath` 管理 hooks，无需 husky 等第三方依赖
- 使用 Biome 原生 `--staged` 参数检查暂存文件，无需 lint-staged
- `prepare` 脚本确保 `bun install` 后自动配置 hooks 路径
