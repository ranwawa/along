# Along (@ranwawa/along)

Along 是一个端到端的 CLI 自动化工具，旨在通过调度 AI 编码代理（如 OpenCode、PI、Claude Code）来自动解决 GitHub Issues。它管理从获取 Issue 到提交 PR 的全生命周期。

## 核心功能

- **自动化工作流**：自动获取 Issue、创建 Worktree、在 tmux 会话中启动 AI 代理。
- **多代理支持**：无缝对接 OpenCode、PI 和 Claude Code。
- **状态追踪**：内置 SQLite 数据库，实时记录会话状态、任务进度。
- **集成工具**：内置分支创建、Conventional Commits 提交、PR 创建及清理工具。
- **事件驱动**：支持通过 Webhook 接收 GitHub 事件并自动处理。
- **可视化 Dashboard**：内置 Web 仪表盘，实时监控会话状态、查看日志。

## 快速开始

### 环境依赖

- **Bun** (必需): 本项目仅支持使用 Bun 作为运行时和包管理器。
- **Git**: 用于源码管理及 Worktree 操作。
- **Tmux**: 运行非 CI 任务时必需。
- **GitHub CLI (gh)**: 用于 PR 创建等操作。

### 安装

本项目强制使用 **Bun** 执行安装：

```bash
bun install
```

### 基础用法

启动 Webhook 服务器：
```bash
along webhook-server --port 9876
```

开发时启动带热重载的 Webhook 服务器：
```bash
along webhook-server --watch --port 9876
# 或
bun run dev:server
```

配置 GitHub App：
```bash
along app-init
```

手动触发 Issue 处理：
```bash
along run <ISSUE_NUMBER>
```

### Dashboard

Along 内置了一个 Web Dashboard，用于实时监控会话状态和查看日志。

开发模式：
```bash
# 1. 启动 Webhook 后端服务（端口 9876，保存 server 代码后自动重启）
along webhook-server --watch --port 9876

# 2. 启动前端开发服务器（端口 5173）
cd web && bun run dev

# 3. 浏览器访问 http://localhost:5173
```

生产模式：
```bash
# 构建前端
cd web && bun run build

# 启动服务（Dashboard 自动集成在 webhook-server 中）
along webhook-server --port 9876
# 浏览器访问 http://localhost:9876
```

## 项目结构

- `bin/`: CLI 核心逻辑及子命令实现。
- `web/`: Dashboard 前端（React + Vite）。
- `prompts/`: AI 代理使用的 SOP 模板。
- `skills/`: 可重用的技能定义，自动同步至工作区。
- `types/`: 外部代理 SDK 的类型声明。

## 开发规范

- **包管理器**: 必须通过 `bun` 安装。
- **语言**: TypeScript (ESM, 无需构建步骤)。
- **日志**: 使用 `consola` 进行结构化日志记录。
- **提交**: 遵循 Conventional Commits 规范（由代理自动执行）。

---

由 [ranwawa](https://github.com/ranwawa) 开发。
