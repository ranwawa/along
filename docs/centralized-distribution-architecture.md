# 集中分发架构设计

## 设计结论

`along` monorepo 采用“三层拆分”：

- `packages/along`
  - GitHub Agent 工具
  - 唯一公开命令入口
- `packages/preset`
  - 分发引擎
  - 负责读取 `.along/setting.json`、渲染文档、生成受管文件
- `packages/preset-assets`
  - 事实源
  - 保存 prompts / skills / hooks / quality engine 资产
- `packages/biome-config`
  - 共享 Biome 规则源
  - 由 preset 分发为业务仓受管 Biome 配置

根目录不再承担业务逻辑，只作为 workspace 容器。

## 为什么这样拆

### 1. 避免两个命令模型

如果同时保留 `along` 和 `scaffold` 两套入口，用户会持续面对：

- 哪个命令才是正式入口
- 哪个命令负责 GitHub Agent
- 哪个命令负责分发

因此最终只保留：

```bash
along project-sync [project-path]
```

`preset` 只保留为内部实现包。

### 2. 避免根目录既像容器又像资产仓

既然根目录只是 monorepo 容器，那么通用资产放在根目录 `distribution/` 就会模糊职责。

因此资产整体迁移到：

```text
packages/preset-assets/
```

这样一眼就能看出这里是“集中分发资产源”。

### 3. 避免 along 运行时继续隐式消费项目资产源

项目通用 prompts / skills 应先同步进业务仓，再由 worktree 自然带过去。

因此：

- `preset-assets` 负责项目资产源
- `along` 不再把这些资产直接软链到 worktree
- `along` 只保留运行时命令、权限和状态管理

这条边界可以避免再次出现“项目里一套、along 里又隐式挂一套”的双源问题。

## 资产分层

### `packages/preset-assets`

这是唯一允许继续增长通用内容的地方。

当前资产分类：

- `hooks/`
- `quality/`
- `prompts/`
- `skills/`

Biome 配置单独由 `packages/biome-config/biome.shared.json` 维护，避免和运行时 prompt / hook 资产混在一起。

### 目标仓 `.along/setting.json`

这里只描述项目差异，不复制通用规则正文。

负责表达：

- 质量门禁编排
- 需要分发到哪些编辑器目录
- 是否生成通用 CI action
- 项目标识、安装命令、root gate 等可选覆盖项

### `packages/preset`

这里不保存事实源，只负责：

- 读取项目配置
- 组合通用资产
- 渲染文档
- 写入业务仓
- 在临时目录使用共享 Biome 配置预校验生成结果
- 通过确定性生成结果和目标仓文件比较做漂移检测
- 在写入前检查目标 Git 工作区是否干净
- 维护受管目录和 manifest

## 扩展方式

后续只允许两种正规扩展路径：

1. 新资产放进 `packages/preset-assets`
2. 新差异字段放进 `.along/setting.json.distribution`

不再接受：

- 新增 `along.project.json`
- 根目录重新长出新的 `distribution/`
- 在业务仓手工复制通用脚本
- `along` 运行时直接引用项目资产源目录
