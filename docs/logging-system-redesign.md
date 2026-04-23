# Along 日志系统重新设计

## 1. 现状问题

### 1.1 日志分类维度混乱

Dashboard 的 4 个 Tab（Timeline / System Log / Agent Log / Conversation）不在同一分类维度上：

- Timeline = System + Agent 的时间合并，与后两者 100% 数据冗余
- Agent Log 里已包含 `formatJsonRecord` 格式化后的 conversation 摘要（`[assistant]`、`[tool_use]`），与 Conversation tab 部分重叠
- Conversation 是完全不同的数据源（Claude Code 的 JSONL），与其他三个 tab 无法交叉定位

### 1.2 日志写入路径碎片化

当前有 4 条独立的写入路径，彼此不感知：

| 路径 | 写入方 | 存储位置 | 读取方 |
|------|--------|---------|--------|
| consola reporter | 各模块 | 内存 (log-buffer.ts) | SSE `/api/system-logs` |
| SessionManager.logEvent/log | session-manager.ts | `system.log` 文件 | `/api/session-log?source=system` |
| drainStream/drainJsonStream | issue-agent.ts | `agent.log` 文件 | `/api/session-log?source=agent` |
| Claude Code 自身 | Claude agent 进程 | `~/.claude/projects/*.jsonl` | `/api/agent-conversation` |

`log-buffer.ts` 的 `setCurrentIssueContext` / `clearCurrentIssueContext` 已是空实现，内存日志与 per-issue 文件日志之间的关联已断裂。

### 1.3 Conversation 依赖外部私有存储

- 路径编码规则是逆向工程 Claude Code 内部实现得来的，升级随时可能 break
- 只有 Claude agent 有此数据，其他 agent（OpenCode、PI、Codex）永远为空
- 数据在 agent 进程结束后才完整，运行中无法实时展示

### 1.4 全局事件与 Session 事件混在一起

webhook-server 进程级事件（收到 webhook、兜底同步、并发限制）和 issue 级事件（分类结果、创建 worktree、启动 agent）没有分层，全部通过 consola 输出到同一个 stdout。

---

## 2. 设计目标

1. **单一数据模型**：所有日志统一为一种结构化格式，前端按字段过滤展示
2. **分层存储**：全局事件和 Session 事件分开存储，互不干扰
3. **实时可观测**：日志在产生时即可在 Dashboard 展示，不依赖 agent 进程结束
4. **Agent 无关**：所有 agent 类型（Claude、OpenCode、PI、Codex）都能产生完整日志
5. **零侵入写入**：现有 `consola.withTag(...).info(...)` 调用点不需要修改

---

## 3. 统一日志模型

### 3.1 UnifiedLogEntry

```typescript
interface UnifiedLogEntry {
  /** ISO 8601 时间戳 */
  timestamp: string;

  /** 日志分类 —— 决定前端展示在哪个 Tab */
  category: LogCategory;

  /** 日志来源模块 */
  source: string;

  /** 日志级别 */
  level: "info" | "warn" | "error" | "success";

  /** 人类可读的日志消息 */
  message: string;

  /** 结构化负载，按 category 不同携带不同字段 */
  payload?: Record<string, unknown>;
}
```

### 3.2 LogCategory

```typescript
type LogCategory =
  | "lifecycle"      // Along 框架生命周期事件
  | "conversation"   // Agent 对话（user/assistant/tool 交互）
  | "diagnostic"     // 错误、警告、异常退出
  | "webhook"        // Webhook 事件收发（仅全局层）
  | "server";        // 服务器自身事件（启动、关闭、并发控制等，仅全局层）
```

### 3.3 各 Category 的 Payload 约定

#### lifecycle

Along 框架在处理 issue 过程中产生的业务事件。

```typescript
{
  event: string;           // 事件名，如 "agent-started", "pr-created", "branch-created"
  phase?: SessionPhase;    // planning / implementation / delivery / stabilization / done
  step?: SessionStep;      // 当前步骤
  details?: Record<string, unknown>;  // 事件特有数据，如 { branchName, prNumber, exitCode }
}
```

对应现有的所有 `session.logEvent()` 调用和 `session.log()` 调用。

#### conversation

Agent 与 LLM 之间的对话记录。

```typescript
{
  role: "user" | "assistant" | "tool_use" | "tool_result";
  toolName?: string;       // tool_use 时的工具名
  toolInput?: string;      // tool_use 时的输入（截断）
  isError?: boolean;       // tool_result 是否为错误
}
```

对应现有 `drainJsonStream` 中解析的 Claude JSONL 记录，以及未来其他 agent 的对话输出。

#### diagnostic

错误分析和异常信息。

```typescript
{
  errorCategory?: string;  // auth / quota / timeout / permissions / agent/process
  exitCode?: number;
  command?: string;
  hints?: string[];
}
```

**写入时机**：`SessionManager.transition()` 将状态转为 `error` 或 `crashed` 时，自动调用 `generateSessionDiagnostic()` 对最近的 system/agent 日志进行错误分类（复用现有 `classifyFailure()` 的 7 种模式），然后通过 `logWriter.writeSession()` 写入一条 `category: "diagnostic"` 的条目。这确保 Diagnostic tab 在 session 失败时一定有数据。

对应现有的 `SessionDiagnostic` 和 `classifyFailure` 逻辑。

#### webhook

GitHub webhook 事件的收发记录。仅写入全局日志。

```typescript
{
  deliveryId: string;      // X-GitHub-Delivery
  event: string;           // issues.opened, pull_request.closed 等
  repo: string;            // owner/repo
  action?: string;
}
```

#### server

webhook-server 进程自身的运维事件。仅写入全局日志。

```typescript
{
  event: string;           // "started", "shutdown", "fallback-sync", "concurrency-limit"
  details?: Record<string, unknown>;
}
```

---

## 4. 存储分层

```
~/.along/
├── along.db                              # SQLite（session 状态，不变）
├── server.jsonl                          # 全局层日志
└── {owner}/{repo}/{issueNumber}/
    └── session.jsonl                     # Session 层日志
```

### 4.1 全局层：`server.jsonl`

写入内容：
- **所有** category 的日志都写入（作为完整审计日志）
- 包括 webhook 事件、server 事件、以及所有 session 事件的副本

用途：
- Dashboard 未选中任何 session 时展示
- 运维排查、审计

### 4.2 Session 层：`session.jsonl`

写入内容：
- 仅 `lifecycle`、`conversation`、`diagnostic` 三个 category
- 不包含 `webhook` 和 `server` category

用途：
- Dashboard 选中某个 session 时展示
- 按 category 过滤为不同 Tab

### 4.3 文件格式

每行一个 JSON 对象（JSONL），便于 append 写入和 tail 读取：

```jsonl
{"timestamp":"2024-04-23T12:34:56.789Z","category":"lifecycle","source":"worktree-init","level":"info","message":"Worktree 创建完成","payload":{"event":"worktree-created","phase":"planning","details":{"worktreePath":"/Users/...","defaultBranch":"master"}}}
{"timestamp":"2024-04-23T12:34:57.234Z","category":"conversation","source":"agent","level":"info","message":"我来分析一下这个 bug 的根因...","payload":{"role":"assistant"}}
{"timestamp":"2024-04-23T12:34:58.567Z","category":"conversation","source":"agent","level":"info","message":"Read /bin/webhook-server.ts","payload":{"role":"tool_use","toolName":"Read","toolInput":"{\"file_path\":\"/bin/webhook-server.ts\"}"}}
```

---

## 5. 写入架构

### 5.1 核心写入器：LogWriter

```typescript
class LogWriter {
  private streams = new Map<string, fs.WriteStream>();

  /** 获取或创建指定文件的写入流 */
  private getStream(filePath: string): fs.WriteStream {
    let stream = this.streams.get(filePath);
    if (!stream || stream.destroyed) {
      stream = fs.createWriteStream(filePath, { flags: "a" });
      this.streams.set(filePath, stream);
    }
    return stream;
  }

  /** 写入全局日志 */
  writeGlobal(entry: UnifiedLogEntry): void {
    this.getStream(globalLogPath).write(JSON.stringify(entry) + "\n");
  }

  /** 写入 session 日志（同时写入全局日志） */
  writeSession(owner: string, repo: string, issueNumber: number, entry: UnifiedLogEntry): void {
    const sessionPath = getSessionLogPath(owner, repo, issueNumber);
    this.getStream(sessionPath).write(JSON.stringify(entry) + "\n");
    this.writeGlobal(entry);
  }

  /** 进程退出前刷新所有流 */
  async flush(): Promise<void> {
    const promises = [...this.streams.values()].map(
      (s) => new Promise<void>((resolve) => s.end(resolve)),
    );
    await Promise.all(promises);
    this.streams.clear();
  }
}
```

单例，所有写入通过它完成。内部使用 `fs.createWriteStream({ flags: "a" })` 异步追加写入，避免阻塞 event loop。每个文件路径复用同一个 WriteStream 实例，Node/Bun 的 writable stream 内部保证写入顺序。进程退出前调用 `flush()` 确保数据落盘。

### 5.2 写入路径总览

```
┌─────────────────────────────────────────────────────────────────┐
│                     webhook-server 主进程                        │
│                                                                  │
│  consola.withTag("xxx").info(...)                                │
│       │                                                          │
│       ▼                                                          │
│  consola reporter (拦截)                                         │
│       │                                                          │
│       ▼                                                          │
│  routeLog(tag, level, message)                                   │
│       │                                                          │
│       ├─ 判断 category ──→ webhook/server → writeGlobal()        │
│       │                                                          │
│       └─ AsyncLocalStorage.getStore()                            │
│              │                                                   │
│              ├─ 有 context → writeSession() ─┐                   │
│              │                               │                   │
│              └─ 无 context → writeGlobal()   │                   │
│                                              ▼                   │
│  drainJsonStream(stdout, {owner, repo, issueNumber})             │
│       │                                                          │
│       ▼                                                          │
│  解析每行 JSON → 构造 conversation entry → writeSession()        │
│                                                                  │
│  drainStream(stderr, {owner, repo, issueNumber})                 │
│       │                                                          │
│       ▼                                                          │
│  每行文本 → 构造 lifecycle entry → writeSession()                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.3 consola 日志的路由规则

consola reporter 拦截后，需要判断两件事：**category** 和 **issue 归属**。

#### Category 判定

| 条件 | Category |
|------|----------|
| tag 为 `webhook-server` 且消息匹配 `收到事件:` 模式 | `webhook` |
| tag 为 `webhook-server` 且消息匹配 `兜底同步` / `并发限制` / 服务启停 | `server` |
| 消息包含 `[EVENT]` 或来自 `logEvent()` | `lifecycle` |
| 其他 | `lifecycle`（默认） |

> 注：`conversation` 和 `diagnostic` 不经过 consola，有专门的写入路径。

#### Issue 归属判定（AsyncLocalStorage）

使用 Node.js `AsyncLocalStorage` 自动传播 issue context，替代基于 tag/regex 的手动判定。这样在并发处理多个 issue 时，每个异步调用链天然携带正确的 context，无需依赖消息内容匹配。

```typescript
import { AsyncLocalStorage } from "node:async_hooks";

interface IssueContext {
  owner: string;
  repo: string;
  issueNumber: number;
}

const issueContextStorage = new AsyncLocalStorage<IssueContext>();

function resolveIssueContext(): IssueContext | null {
  return issueContextStorage.getStore() ?? null;
}
```

consola reporter 内部直接调用 `resolveIssueContext()` 获取当前异步链的 issue 归属，无需解析 tag 或消息内容。

### 5.4 Issue Context 管理

在处理某个 issue 的入口处通过 `AsyncLocalStorage.run()` 注入 context，整个异步调用链自动继承，无需手动注销：

```typescript
function withIssueContext<T>(
  owner: string,
  repo: string,
  issueNumber: number,
  fn: () => Promise<T>,
): Promise<T> {
  return issueContextStorage.run({ owner, repo, issueNumber }, fn);
}
```

与之前基于 `Map` 的方案相比：
- 不存在并发 issue 之间的 context 串扰（每个异步链独立）
- 不需要 `finally` 清理（`run()` 作用域结束后自动失效）
- 嵌套调用天然正确（内层 `run()` 覆盖外层）

需要包裹的入口点（约 5 处）：

| 入口 | 文件 | 说明 |
|------|------|------|
| `handleTriagedIssue` | webhook-handlers.ts | webhook 触发的 issue 处理 |
| `reviewPr` | webhook-handlers.ts | PR review 处理 |
| `resolveReview` | webhook-handlers.ts | review feedback 处理 |
| `resolveCi` | webhook-handlers.ts | CI failure 处理 |
| `launchIssueAgent` | issue-agent.ts | `along run` 手动触发 |

### 5.5 Agent 输出的写入

#### Claude Agent（JSON 流）

`drainJsonStream` 已经在逐行解析 Claude 的 JSONL 输出。改造后：

```typescript
async function drainJsonStream(
  stream: ReadableStream,
  ctx: { owner: string; repo: string; issueNumber: number },
): Promise<DrainJsonStreamResult> {
  // ...逐行读取...
  for (const line of lines) {
    const record = JSON.parse(line);

    // 1. 提取 sessionId（保留现有逻辑）
    if (!sessionId && record.sessionId) {
      sessionId = record.sessionId;
    }

    // 2. 构造 conversation entry 并写入 session 日志
    const entry = recordToConversationEntry(record);
    if (entry) {
      logWriter.writeSession(ctx.owner, ctx.repo, ctx.issueNumber, entry);
    }
  }
}
```

#### 非 Claude Agent（纯文本流）

`drainStream` 读取的是纯文本 stdout/stderr。改造后：

```typescript
async function drainStream(
  stream: ReadableStream,
  ctx: { owner: string; repo: string; issueNumber: number },
): Promise<void> {
  // ...逐行读取...
  for (const line of lines) {
    logWriter.writeSession(ctx.owner, ctx.repo, ctx.issueNumber, {
      timestamp: new Date().toISOString(),
      category: "lifecycle",
      source: "agent",
      level: "info",
      message: line,
    });
  }
}
```

---

## 6. 读取架构

### 6.1 API 端点

替换现有的 4 个日志相关端点为 2 个：

#### `GET /api/logs/global`

读取 `server.jsonl`，支持过滤和分页。

```
Query params:
  category?    过滤 category（可多选，逗号分隔）
  level?       过滤 level
  maxLines?    返回最后 N 行（默认 200）
  since?       ISO 时间戳，只返回此时间之后的日志
```

#### `GET /api/logs/session`

读取 `{owner}/{repo}/{issueNumber}/session.jsonl`，支持过滤和分页。

```
Query params:
  owner, repo, issueNumber   （必填）
  category?    过滤 category（可多选，逗号分隔）
  maxLines?    返回最后 N 行（默认 300）
  since?       ISO 时间戳，只返回此时间之后的日志
```

### 6.2 SSE 实时推送

#### `GET /api/logs/global/stream`

替换现有的 `/api/system-logs`。tail `server.jsonl`，新增行即推送。

#### `GET /api/logs/session/stream`

新增。tail 指定 session 的 `session.jsonl`，新增行即推送。

```
Query params:
  owner, repo, issueNumber   （必填）
  category?    只推送指定 category
```

### 6.3 读取实现

```typescript
function readLogFile(
  filePath: string,
  options: { category?: string[]; level?: string; maxLines?: number; since?: string },
): UnifiedLogEntry[] {
  const lines = readLastLines(filePath, maxLines * 2); // 多读一些，过滤后可能不够
  return lines
    .map(line => JSON.parse(line) as UnifiedLogEntry)
    .filter(entry => {
      if (options.category && !options.category.includes(entry.category)) return false;
      if (options.level && entry.level !== options.level) return false;
      if (options.since && entry.timestamp < options.since) return false;
      return true;
    })
    .slice(-options.maxLines);
}
```

---

## 7. Dashboard Tab 设计

### 7.1 全局视图（未选中 Session）

| Tab | 数据源 | 过滤条件 |
|-----|--------|---------|
| **Server** | `server.jsonl` | `category in (webhook, server)` |

只有一个 tab，展示 webhook-server 进程级事件。

### 7.2 Session 详情视图（选中某个 Session）

| Tab | 数据源 | 过滤条件 | 展示内容 |
|-----|--------|---------|---------|
| **Timeline** | `session.jsonl` | 无过滤 | 所有事件按时间排列，不同 category 用颜色/图标区分 |
| **Lifecycle** | `session.jsonl` | `category === "lifecycle"` | Along 框架事件：创建 worktree、切换 phase/step、提交代码、创建 PR 等 |
| **Conversation** | `session.jsonl` | `category === "conversation"` | Agent 对话：user 输入、assistant 回复、工具调用和结果 |
| **Diagnostic** | `session.jsonl` | `category === "diagnostic"` | 错误分析、退出码、失败分类、修复建议 |

### 7.3 Tab 渲染差异

虽然数据模型统一，但不同 category 的渲染方式不同：

- **Timeline**：统一的时间线列表，每条日志前用彩色标签标注 category（`lifecycle` 蓝色、`conversation` 绿色、`diagnostic` 红色）
- **Lifecycle**：按 phase 分组折叠，每个 phase 内按 step 排列，展示事件名和关键 payload
- **Conversation**：聊天气泡样式，user 靠右蓝色、assistant 靠左灰色、tool_use 用代码块、tool_result 用折叠面板
- **Diagnostic**：卡片样式，展示错误分类、摘要、hints 列表、相关日志上下文

---

## 8. 迁移映射

### 8.1 删除的文件/概念

| 现有 | 替代 |
|------|------|
| `system.log` | `session.jsonl` 中 `category === "lifecycle"` |
| `agent.log` | `session.jsonl` 中 `category === "lifecycle"` (agent 文本输出) + `category === "conversation"` (结构化对话) |
| `diagnostic.json` | `session.jsonl` 中 `category === "diagnostic"`，由 `SessionManager.transition()` 在状态转为 error/crashed 时写入 |
| `log-buffer.ts` | `LogWriter` + SSE tail |
| `session-diagnostics.ts` 中的 `readSessionLog` / `parseSystemLogLines` / `parseAgentLogLines` / `mergeSessionLogs` | `readLogFile()` 统一读取 |
| `~/.claude/projects/*.jsonl` 读取逻辑 | `drainJsonStream` 实时写入 `session.jsonl` |
| `/api/session-log` | `/api/logs/session` |
| `/api/system-logs` (SSE) | `/api/logs/global/stream` |
| `/api/agent-conversation` | `/api/logs/session?category=conversation` |
| `/api/session-diagnostic` | `/api/logs/session?category=diagnostic` + 聚合逻辑 |

### 8.2 保留不变的部分

| 组件 | 原因 |
|------|------|
| `along.db` (SQLite) | Session 状态管理，与日志系统职责不同 |
| `SessionManager` | 状态机和生命周期管理，不变 |
| `SessionPathManager` | 路径管理，新增 `getSessionLogFile()` 返回 `session.jsonl` 路径 |
| `consola.withTag(...)` 调用点 | 零侵入，通过 reporter 拦截 |
| `todo.md` / `issue.json` / `planning-context.json` | 业务数据文件，不属于日志系统 |

### 8.3 现有 logEvent 调用的映射

所有现有的 `session.logEvent("event-name", details)` 调用自动映射为：

```typescript
{
  category: "lifecycle",
  source: tag,  // 从 consola tag 或调用方模块名获取
  level: "info",
  message: "event-name",  // 或人类可读的描述
  payload: { event: "event-name", ...details }
}
```

无需修改调用点，只需修改 `SessionManager.logEvent()` 的内部实现，从写 `system.log` 改为调用 `logWriter.writeSession()`。

---

## 9. 新增模块清单

| 模块 | 文件 | 职责 | 预估行数 |
|------|------|------|---------|
| `UnifiedLogEntry` 类型定义 | `bin/log-types.ts` | 日志数据模型 | ~50 |
| `LogWriter` | `bin/log-writer.ts` | 统一写入器（append JSONL） | ~80 |
| `LogRouter` | `bin/log-router.ts` | consola reporter + AsyncLocalStorage context 管理 + category 判定 | ~100 |
| `LogReader` | `bin/log-reader.ts` | 统一读取器（过滤、分页） | ~60 |
| 前端类型更新 | `web/src/types.ts` | 更新 `ConversationMessage` → 使用 `UnifiedLogEntry` | ~20 |

总新增约 330 行，删除 `log-buffer.ts`（61 行）、`session-diagnostics.ts` 中的日志解析函数（约 80 行）、`webhook-server.ts` 中的 4 个旧端点（约 200 行）。

---

## 10. 数据流全景图

```
                          GitHub
                            │
                            ▼
                     ┌──────────────┐
                     │ webhook-server│
                     └──────┬───────┘
                            │
              ┌─────────────┼─────────────────┐
              │             │                  │
              ▼             ▼                  ▼
        webhook 事件    issue 处理         server 事件
        (收到/去重)    (triage/launch)    (启停/并发/同步)
              │             │                  │
              │             │                  │
              ▼             ▼                  ▼
         ┌────────────────────────────────────────┐
         │              LogRouter                  │
         │                                         │
         │  consola reporter 拦截                   │
         │    → 判定 category                       │
         │    → 判定 issue 归属                     │
         │                                         │
         │  drainJsonStream 回调                    │
         │    → 解析 conversation                   │
         │    → 已知 issue 归属                     │
         └────────────┬───────────────────────────┘
                      │
              ┌───────┴───────┐
              ▼               ▼
      ┌──────────────┐  ┌─────────────────────────────┐
      │ server.jsonl │  │ {owner}/{repo}/{N}/          │
      │  (全局层)     │  │   session.jsonl (Session 层) │
      └──────┬───────┘  └─────────────┬───────────────┘
             │                        │
             ▼                        ▼
      ┌──────────────┐  ┌─────────────────────────────┐
      │ /api/logs/   │  │ /api/logs/session            │
      │   global     │  │   ?category=lifecycle        │
      │   global/    │  │   ?category=conversation     │
      │   stream     │  │   ?category=diagnostic       │
      └──────┬───────┘  │ /api/logs/session/stream     │
             │          └─────────────┬───────────────┘
             │                        │
             ▼                        ▼
      ┌──────────────────────────────────────────────┐
      │              Dashboard                        │
      │                                               │
      │  全局视图:  [Server]                           │
      │                                               │
      │  Session 视图:                                 │
      │    [Timeline] [Lifecycle] [Conversation] [Diagnostic] │
      └──────────────────────────────────────────────┘
```

---

## 11. 评审反馈决策记录

### 11.1 已采纳

#### Issue 归属判定改用 AsyncLocalStorage

**问题**：原方案用 `activeContexts` Map + `tagContextMap` + 消息 regex 判定日志归属，并发多个 issue 时容易误归类（多个 handler 共用 `"webhook-handlers"` tag，`activeContexts.size === 1` 兜底在并发下永远不命中）。现有 `log-buffer.ts` 的 `setCurrentIssueContext` 已是空实现，说明此路径之前就被放弃过。

**改法**：使用 `AsyncLocalStorage` 在 5 个入口点通过 `.run()` 注入 context，consola reporter 内通过 `.getStore()` 获取。每个异步调用链天然携带正确 context，无需手动清理，并发安全。

**影响范围**：5.3 节（归属判定）、5.4 节（context 管理）、5.2 节（写入路径图）。

#### LogWriter 改为异步写入

**问题**：原方案使用 `fs.appendFileSync` 同步写入，`drainJsonStream` 解析 Claude JSONL 时 conversation 日志写入频率较高，会阻塞 event loop。

**改法**：`LogWriter` 内部使用 `fs.createWriteStream({ flags: "a" })` 异步追加，每个文件路径复用同一个 WriteStream 实例（stream 内部保证写入顺序）。不需要额外的串行队列抽象。新增 `flush()` 方法供进程退出前调用。

**影响范围**：5.1 节（LogWriter 实现）。

#### 补充 diagnostic 写入时机

**问题**：原方案只定义了 diagnostic 的 payload schema，未说明谁在什么时机写入，迁移后 Diagnostic tab 可能为空。

**改法**：明确 `SessionManager.transition()` 在状态转为 `error`/`crashed` 时调用 `generateSessionDiagnostic()`（复用现有 `classifyFailure()` 的 7 种错误模式），通过 `logWriter.writeSession()` 写入 `category: "diagnostic"` 条目。

**影响范围**：3.3 节（diagnostic payload 说明）、8.1 节（迁移映射表）。

### 11.2 未采纳

#### SSE 重连语义（cursor / last-event-id / 轮转策略）

**理由**：Along 是本地 CLI 工具，最多 3 个并发 issue，Dashboard 单用户使用。当前 `since` + `maxLines` 在此规模下足够。JSONL 每行的 timestamp 天然可作为 cursor，未来需要时可无损扩展。现阶段引入会增加不必要的复杂度。

#### UnifiedLogEntry 保留 raw payload

**理由**：conversation 类日志的原始 Claude JSONL 包含完整 tool input/output，体积很大。保留 raw 会让 session.jsonl 膨胀数倍。当前设计已在 payload 中保留结构化的关键字段（role、toolName、toolInput 截断版），信息量足够用于 Dashboard 展示和问题排查。
