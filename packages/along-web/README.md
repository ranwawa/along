# Along Web (@ranwawa/along-web)

`@ranwawa/along-web` 是 Along Dashboard 前端包，负责展示 session、日志、诊断和人工操作入口。

开发时通过 Vite 代理访问本地 `along webhook-server`：

```bash
bun --filter @ranwawa/along-web dev
```

构建静态产物：

```bash
bun --filter @ranwawa/along-web build
```

`@ranwawa/along` 的 webhook server 会通过 package 解析读取本包的 `dist/` 目录并提供 Web UI。
