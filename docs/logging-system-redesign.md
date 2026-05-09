# Along 日志系统重新设计

## 目标

日志统一写入结构化 JSONL，让 Dashboard 可以按 `lifecycle`、`conversation`、`diagnostic`、`webhook`、`server` 分类展示。Codex 的实时事件通过 Along 自己的 session 日志落盘，不读取执行器私有目录。

## 数据模型

```ts
interface UnifiedLogEntry {
  timestamp: string;
  category: 'lifecycle' | 'conversation' | 'diagnostic' | 'webhook' | 'server';
  source: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  payload?: Record<string, unknown>;
}
```

## 存储

```text
~/.along/
├── along.db
├── server.jsonl
└── {owner}/{repo}/{issueNumber}/
    └── session.jsonl
```

- `server.jsonl` 保存全局 server/webhook 事件和 session 事件副本。
- `session.jsonl` 保存单个 session 的 lifecycle、conversation、diagnostic。

## 写入路径

- `SessionManager.logEvent/log` 写入 lifecycle。
- Codex SDK stream 映射为 conversation。
- 状态进入 error/crashed 时写入 diagnostic。
- webhook-server 进程事件写入 server 或 webhook。

## 读取 API

- `GET /api/logs/global`
- `GET /api/logs/session`
- `GET /api/logs/global/stream`
- `GET /api/logs/session/stream`

旧的分散日志接口最终收敛到上述 API；Dashboard 只消费统一日志模型。
