# GitHub App 配置指南

Along 通过 GitHub App 的 webhook 机制直接接收仓库事件（Issue 创建、PR 提交、CI 结果等），自动触发对应的 AI Agent 处理流程。

## 架构概览

```
GitHub 仓库事件
  → GitHub 直接 POST 到你的 webhook 服务器
    → along webhook-server 解析事件并调度子命令
      → AI Agent 自动处理
```

相比 GitHub Actions 中转方案，GitHub App 方案：
- 无 Actions 分钟数消耗
- 延迟从 10-30s 降到毫秒级
- 无需在每个仓库部署 workflow 文件

## 前置条件

- 一个 GitHub 账号
- 本地已安装 Along CLI (`@ranwawa/along`)
- 一个隧道工具将本地端口暴露到公网（ngrok / cloudflared / 其他）

## Step 1: 获取公网 URL

webhook 服务器默认监听 `localhost:9876`，GitHub 无法直接访问。需要通过隧道工具暴露：

**方式 A: ngrok（推荐）**

```bash
# 安装
brew install ngrok

# 启动隧道
ngrok http 9876
```

复制输出中的 `https://xxxx.ngrok-free.app` 地址。

**方式 B: cloudflared**

```bash
# 安装
brew install cloudflared

# 启动隧道（无需注册）
cloudflared tunnel --url http://localhost:9876
```

复制输出中的 `https://xxxx.trycloudflare.com` 地址。

> 注意：免费隧道地址每次重启会变化。如需固定地址，需要 ngrok 付费版或 cloudflared 配置命名隧道。

## Step 2: 创建 GitHub App

打开 https://github.com/settings/apps/new ，按以下说明填写每个字段：

### 基本信息

| 字段 | 填写内容 | 说明 |
|---|---|---|
| **GitHub App name** | `along-webhook`（或任意名称） | 必填，全 GitHub 唯一 |
| **Description** | `Along 自动化 webhook 接收器` | 可选，给自己看的描述 |
| **Homepage URL** | `https://github.com` | 必填，但无实际用途，随便填 |

### 用户授权（Identifying and authorizing users）

| 字段 | 填写内容 | 说明 |
|---|---|---|
| **Callback URL** | 留空 | Along 不需要 OAuth 授权 |
| **Expire user authorization tokens** | 保持默认 | 不影响 webhook 功能 |
| **Request user authorization (OAuth) during installation** | 不勾选 | 不需要 |
| **Enable Device Flow** | 不勾选 | 不需要 |

### 安装后（Post installation）

| 字段 | 填写内容 | 说明 |
|---|---|---|
| **Setup URL** | 留空 | 不需要安装后跳转 |
| **Redirect on update** | 不勾选 | 不需要 |

### Webhook

| 字段 | 填写内容 | 说明 |
|---|---|---|
| **Active** | 勾选 | 必须启用才能接收事件 |
| **Webhook URL** | `https://你的隧道地址/webhook` | Step 1 获取的公网地址 + `/webhook` 路径 |
| **Webhook secret** | 用 `openssl rand -hex 32` 生成 | 用于验证请求来源，**务必记下这个值** |

### 权限（Permissions）

**Repository permissions（只需设置以下 4 项，其余保持 No access）：**

| 权限 | 级别 | 用途 |
|---|---|---|
| **Issues** | Read & write | 读取 Issue 内容、管理标签 |
| **Pull requests** | Read-only | 读取 PR 信息 |
| **Checks** | Read-only | 读取 CI 运行结果 |
| **Metadata** | Read-only | 默认已勾选，不可取消 |

**Organization permissions：** 全部保持默认（No access）

**Account permissions：** 全部保持默认（No access）

### 订阅事件（Subscribe to events）

设置权限后，页面下方会出现可订阅的事件列表。**只勾选以下 4 个**：

| 事件 | 触发时机 |
|---|---|
| **Issues** | Issue 创建、标签变更、关闭等 |
| **Pull request** | PR 创建、代码推送、合并等 |
| **Pull request review** | PR Review 提交 |
| **Check run** | CI 检查运行完成 |

其余事件不要勾选，避免产生不必要的 webhook 请求。

### 安装范围

| 选项 | 选择 |
|---|---|
| **Only on this account** | 选这个 |
| Any account | 不选 |

点击 **Create GitHub App** 完成创建。

## Step 3: 安装 App 到仓库

创建完成后会跳转到 App 设置页：

1. 点击左侧菜单 **Install App**
2. 点击你的账号旁边的 **Install** 按钮
3. 选择 **Only select repositories** → 选中你要自动化的仓库
4. 点击 **Install** 完成安装

> 后续如需添加更多仓库，回到 App 设置页 → Install App → Configure → 添加仓库即可。

## Step 4: 启动 webhook 服务器

```bash
# 使用 Step 2 中生成的 webhook secret
along webhook-server --port 9876 --secret <你的-webhook-secret>
```

也可以通过环境变量设置 secret：

```bash
export ALONG_WEBHOOK_SECRET=<你的-webhook-secret>
along webhook-server --port 9876
```

## 验证

1. 确保隧道工具和 webhook 服务器都在运行
2. 在目标仓库创建一个测试 Issue
3. 观察 webhook-server 终端输出，应该看到：
   ```
   收到事件: issues.opened | 仓库: owner/repo
   已触发 along run <N>
   ```

也可以用 curl 手动测试：

```bash
# 测试 ping（无需签名）
curl -X POST http://localhost:9876/webhook \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: ping" \
  -d '{"zen": "test", "repository": {"full_name": "test/repo"}}'

# 应返回: {"message":"pong"}
```

## 事件映射

webhook 服务器收到事件后，会自动调度以下命令：

| GitHub 事件 | 条件 | 触发命令 |
|---|---|---|
| `issues` (opened) | 非 Bot 创建 | `along run <N> --ci` |
| `issues` (labeled) | 标签名为 `approved` | `along run <N> --ci`（Phase 2） |
| `pull_request` (opened / synchronize) | — | `reviewPr()` |
| `pull_request_review` (submitted) | — | `resolveReview()` |
| `check_run` (completed) | conclusion 为 failure 且关联了 PR | `resolveCi()` |

## 常见问题

### 隧道地址变了怎么办？

免费隧道每次重启会生成新地址。需要去 GitHub App 设置页更新 Webhook URL：

Settings → Developer settings → GitHub Apps → 你的 App → 修改 Webhook URL → Save changes

### 如何查看 webhook 投递记录？

GitHub App 设置页 → Advanced → Recent Deliveries

可以看到每次事件的请求/响应详情，方便排查问题。

### 一个 App 能管多个仓库吗？

可以。安装 App 时选择多个仓库即可，所有仓库的事件都会推送到同一个 webhook URL。

### webhook-server 重启后需要重新配置吗？

不需要。GitHub App 的配置保存在 GitHub 端，只要 webhook URL 和 secret 不变，重启服务器后自动恢复。

### 签名验证失败怎么办？

确认 `--secret` 参数（或 `ALONG_WEBHOOK_SECRET` 环境变量）与 GitHub App 设置中的 Webhook secret 完全一致。
