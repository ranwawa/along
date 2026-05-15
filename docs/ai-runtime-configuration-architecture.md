# Spec: AI Runtime Configuration Architecture

## Objective

本规范定义 Along 的 AI 运行时配置架构，用于把以下两类调用拆开管理：

- Agent 运行：Planning Agent、Exec Agent 等需要通过 Codex 运行完整任务回合。
- 轻量模型调用：标题摘要、分类、PR 标题生成、结构化抽取等不需要进入 Agent 生命周期的直接 LLM 调用。

目标是引入一套小型配置注册表，让 provider、model、runtime、agent、profile 之间的关系可验证、可解析、可扩展，并以 Codex 作为第一条真实 Agent 运行时。

用户是 Along 的个人使用者和维护者。成功状态是：用户可以在一个全局配置中声明多个模型提供方、模型、运行时、任务 Agent 和轻量 LLM Profile；token 只配置在 Model 上；系统能稳定解析 Agent 运行配置和 Profile 直连模型配置；Codex runner 作为第一条真实执行路径工作稳定。

## Assumptions

1. 该能力先落在 `@ranwawa/along` CLI/server 侧，前端 settings 只在后续任务中跟进。
2. 全局配置仍存储在当前 `~/.along/config.json`，不引入数据库或远程配置服务。
3. 不考虑任何向下兼容或数据迁移；新配置结构是唯一目标结构，旧配置可以直接清空。
4. MVP 只处理 Codex runtime。除 Codex 外，其他任何 runtime 的 schema 细化、校验、执行器、失败提示和测试都不进入 MVP。
5. Model 支持 `tokenEnv` 和可选 `token`；`token` 仅用于本机个人配置，不做加密、审计或团队共享。
6. `Profile` 表示一类可复用的轻量 LLM 使用档案，包含模型、提示文本和调用参数；它不代表 `.codex/prompts` 或 preset prompt 文件。

## Tech Stack

- Runtime: Bun `1.3.11`
- Language: TypeScript, ESM
- CLI/server package: `packages/along`
- Web package: `packages/along-web`
- Test framework: Vitest `^4.1.4`
- Validation: Zod `^4.3.6`
- Formatting/linting: Biome `^2.4.13`
- Existing Codex integration: `@openai/codex-sdk` `^0.128.0`

## Commands

```bash
# 开发 server
bun run dev:server

# along 包测试
bun run test

# along 包 watch 测试
bun run test:watch

# Web 构建
bun run build:web

# 格式化
bun run format

# lint
bun run lint

# Biome check 并自动写入可修复项
bun run check

# 变更文件质量门禁
bun run quality:changed

# 全量质量门禁
bun run quality:full
```

## Project Structure

```txt
packages/along/src/integration/ai-registry-store.ts
  新增：读写 ~/.along/config.json，返回唯一的 RegistryConfig，不承载旧配置兼容。

packages/along/src/integration/ai-registry-api.ts
  新增：registry HTTP API。MVP 可只返回 registry 只读视图；可编辑 UI 作为后续范围。

packages/along/src/domain/runtime-service.ts
  新增：Agent runtime 分发入口，提供 RuntimeService.runAgentTurn。

packages/along/src/domain/codex-runtime-runner.ts
  Codex runtime 实现，提供 CodexRuntimeRunner.runAgentTurn，保留现有 stream/session 生命周期逻辑。

packages/along/src/domain/ai-registry-config.ts
  新增：注册表类型、Zod schema 和引用校验。

packages/along/src/domain/ai-registry-resolver.ts
  新增：Agent runtime config 和 Profile LLM config 的解析逻辑。

packages/along/src/domain/llm-service.ts
  新增：轻量 Profile 直连模型调用入口。

packages/along/src/domain/*.{test,tsx,ts}
  与新增 domain 模块同目录放置单元测试。

packages/along-web/src/settings/*
  后续 settings UI 扩展位置，不属于第一批必须改动。

docs/ideas/ai-runtime-configuration-architecture.md
  原始 idea 来源。

docs/ai-runtime-configuration-architecture.md
  本规范。
```

## Domain Model

配置注册表由五类实体组成。Provider、Model 两条执行路径共享；Runtime/Agent 只服务 Agent 运行；Profile 只服务直接模型调用。token 只属于 Model，Provider、Runtime 和 Agent 不配置 token 或 credential。

```ts
export type ProviderKind = 'openai-compatible' | 'anthropic' | 'custom';

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  name?: string;
  baseUrl?: string;
}

export interface ModelConfig {
  id: string;
  providerId: string;
  model: string;
  name?: string;
  token?: string;
  tokenEnv?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface RuntimeConfig {
  id: string;
  kind: 'codex';
  name?: string;
  modelId?: string;
}

export interface AgentConfig {
  id: string;
  runtimeId: string;
  name?: string;
  modelId?: string;
  personalityVersion?: string;
}

export interface ProfileConfig {
  id: string;
  modelId: string;
  name?: string;
  systemPrompt: string;
  userTemplate?: string;
  parameters?: {
    temperature?: number;
    maxTokens?: number;
    outputFormat?: 'text' | 'json';
  };
}

export interface RegistryConfig {
  providers: ProviderConfig[];
  models: ModelConfig[];
  runtimes: RuntimeConfig[];
  agents: AgentConfig[];
  profiles: ProfileConfig[];
}
```

## Config Shape

`~/.along/config.json` 顶层直接使用 registry 字段，不再包一层 `aiRuntime`，也不保留 `taskAgents`：

```json
{
  "providers": [
    {
      "id": "openai",
      "kind": "openai-compatible",
      "baseUrl": "https://api.openai.com/v1"
    }
  ],
  "models": [
    {
      "id": "gpt-main",
      "providerId": "openai",
      "model": "gpt-5.2",
      "tokenEnv": "OPENAI_API_KEY"
    }
  ],
  "runtimes": [
    {
      "id": "codex-openai",
      "kind": "codex",
      "modelId": "gpt-main"
    }
  ],
  "agents": [
    {
      "id": "planner",
      "runtimeId": "codex-openai"
    }
  ],
  "profiles": [
    {
      "id": "task-title-summary",
      "modelId": "gpt-main",
      "systemPrompt": "Generate a concise task title.",
      "parameters": {
        "temperature": 0.2,
        "maxTokens": 80,
        "outputFormat": "text"
      }
    }
  ]
}
```

## Resolution Rules

### Agent Runtime Path

Agent 运行通过 RuntimeService 解析并执行：

```txt
runTaskAgentTurn
  -> RuntimeService.runAgentTurn
  -> resolveAgentRuntimeConfig
  -> CodexRuntimeRunner
```

模型优先级：

```txt
task override
> agent.modelId
> runtime.modelId
```

token 解析规则：

```txt
final model.tokenEnv -> process.env[tokenEnv]
final model.token
```

Agent、Runtime、Provider 和 Profile 不提供 credential 覆盖。Agent/Profile 先解析最终 `modelId`，再从该 Model 读取 token。

解析后的 Agent runtime config 至少包含：

```ts
export interface ResolvedAgentRuntimeConfig {
  agentId: string;
  runtimeId: string;
  runtimeKind: 'codex';
  providerId?: string;
  providerKind?: ProviderKind;
  baseUrl?: string;
  model?: string;
  modelId?: string;
  token?: string;
  tokenEnv?: string;
  personalityVersion?: string;
}
```

### Profile LLM Path

轻量调用通过 LLMService 解析并执行：

```txt
LLMService.runProfile
  -> resolveProfileLlmConfig
  -> provider client
```

Profile 不创建 agent run，不写入 agent lifecycle，不复用 Codex thread/session。它定义一类可复用的直接模型调用配置，并在执行时返回文本或 JSON。

解析后的 Profile config 至少包含：

```ts
export interface ResolvedProfileLlmConfig {
  profileId: string;
  providerId: string;
  providerKind: ProviderKind;
  baseUrl?: string;
  model: string;
  token?: string;
  tokenEnv?: string;
  systemPrompt: string;
  userTemplate?: string;
  parameters: {
    temperature?: number;
    maxTokens?: number;
    outputFormat: 'text' | 'json';
  };
}
```

## Code Style

沿用当前 Result 风格，解析器返回显式成功或失败，不抛业务异常，不用 `as any` 或 `@ts-ignore` 绕过类型。

```ts
import type { Result } from '../core/result';
import { failure, success } from '../core/result';

export function resolveProfileLlmConfig(input: {
  registry: RegistryConfig;
  profileId: string;
}): Result<ResolvedProfileLlmConfig> {
  const profile = findById(input.registry.profiles, input.profileId);
  if (!profile) return failure(`未知 Profile: ${input.profileId}`);

  const model = findById(input.registry.models, profile.modelId);
  if (!model) return failure(`Profile 引用了未知 Model: ${profile.modelId}`);

  const provider = findById(input.registry.providers, model.providerId);
  if (!provider) return failure(`Model 引用了未知 Provider: ${model.providerId}`);

  const token = model.tokenEnv ? process.env[model.tokenEnv] : model.token;
  if (!token) return failure(`Model ${model.id} 未配置 token 或 tokenEnv`);

  return success({
    profileId: profile.id,
    providerId: provider.id,
    providerKind: provider.kind,
    baseUrl: provider.baseUrl,
    model: model.model,
    token,
    tokenEnv: model.tokenEnv,
    systemPrompt: profile.systemPrompt,
    userTemplate: profile.userTemplate,
    parameters: {
      ...profile.parameters,
      outputFormat: profile.parameters?.outputFormat || 'text',
    },
  });
}
```

Conventions:

- 类型名使用 `*Config` 后缀表达配置记录，不再添加冗余 `Ai` 前缀。
- 领域错误信息使用中文，保持现有用户可见日志风格。
- 配置字段使用 camelCase，顶层配置文件直接表达 registry。
- 文件改动保持局部化，优先新增 domain 模块，再让现有入口调用新模块。

## Validation Strategy

注册表读取后必须执行结构校验和引用校验。

Always validate:

- 所有实体 `id` 非空且在各自集合内唯一。
- `Model.providerId` 必须指向已存在 Provider。
- `Model.token` 和 `Model.tokenEnv` 可二选一；若最终执行用到的 Model 两者都没有，解析阶段必须失败。
- `Runtime.kind` 在 MVP 中只能是 `codex`。
- `Runtime.modelId` 若存在，必须指向已存在 Model。
- `Agent.runtimeId` 必须指向已存在 Runtime。
- `Agent.modelId` 若存在，必须指向已存在 Model。
- `Profile.modelId` 必须指向已存在 Model。
- `Profile.parameters.maxTokens` 若存在，必须是正整数；若模型声明了 `maxOutputTokens`，不得超过该值。
- `Profile.parameters.temperature` 若存在，必须在 provider/model 支持的范围内；MVP 至少校验为非负数。

MVP should fail fast:

- 配置引用不存在时，返回 `Result.failure`，不隐式跳过。
- provider kind 未支持执行时，LLMService 返回清晰失败。
- runtime kind 非 `codex` 时，配置校验失败；MVP 不为其他 runtime 建立执行路径。

## Testing Strategy

测试以 `packages/along` 单元测试为主，优先覆盖纯解析逻辑，再覆盖运行入口。

Required tests:

- `ai-registry-config.test.ts`
  - 接受最小合法 registry。
  - 拒绝重复 id。
  - 拒绝未知引用。
  - 兼容旧 credentials/credentialId 配置并迁移到 Model token 字段。
  - 缺失必需集合或必需引用时返回清晰错误。

- `ai-registry-resolver.test.ts`
  - Agent model priority: task override > agent > runtime。
  - Agent/Profile 只从最终 Model 解析 token。
  - Profile 解析到 provider、model、提示文本和 parameters。
  - `tokenEnv` 能从环境变量读取到 token；环境变量缺失时解析失败。

- `runtime-service.test.ts`
  - registry 中 Codex agent 能调用 `CodexRuntimeRunner.runAgentTurn`。
  - 非 Codex runtime 配置校验失败，不进入 runtime 分发。

- `llm-service.test.ts`
  - openai-compatible profile 构造请求时使用 provider `baseUrl`、model name、resolved token 和 parameters。
  - JSON outputFormat 失败时返回可读错误。

Verification commands:

```bash
bun run test
bun run lint
bun run quality:changed
```

## Boundaries

Always:

- 先解析、校验配置，再进入 runtime 或 LLM 调用。
- 对用户可见错误使用简短中文。
- 新增 resolver/service 先用单元测试覆盖优先级和失败路径。
- 不把 Profile 直接塞进 Agent lifecycle。

Ask first:

- 引入 OpenAI SDK、Anthropic SDK 等新增 LLM provider 依赖。
- 给 token 增加加密、系统 keychain 或远端同步能力。
- 改 CI、hook 或质量门禁脚本。

Never:

- 不提交真实 token、示例 token 或 `.env` 文件。
- 不用 `as any`、`@ts-ignore`、`@ts-expect-error` 绕过类型系统。
- 不在 MVP 中接入、模拟或测试 Codex 之外的 runtime。
- 不让轻量 Profile 继承 Agent 会话、权限、artifact 或 cancellation 语义。
- 不在新架构中保留 `taskAgents`、旧顶层 GitHub token role `agents` 或 `aiRuntime` 包裹层。
- 不在 UI、配置、API、领域模型或逻辑代码中继续使用 `Editor` 表示 Agent 运行时；统一使用 `Runtime`。
- 不移除现有失败测试来适配新架构。

## Success Criteria

- `docs/ai-runtime-configuration-architecture.md` 明确记录目标、结构、命令、代码风格、测试策略和边界。
- `~/.along/config.json` 顶层直接表达 registry，包含 `providers`、`models`、`runtimes`、`agents` 和 `profiles`。
- Agent runtime 解析能产出完整 `ResolvedAgentRuntimeConfig`，并遵守模型优先级，token 只来自最终 Model。
- Profile 解析能产出完整 `ResolvedProfileLlmConfig`，且不进入 Agent runtime。
- registry 校验能捕获缺失 id 和未知引用。
- 第一条真实执行路径复用现有 Codex runner。
- 至少一个轻量 Profile 用例通过 LLMService 路径运行，证明直接模型调用不依赖 Agent。

## Non-Goals

- 不设计长期记忆层；记忆应作为后续上下文注入层加入。
- 不实现 token 加密、审计和团队级权限管理。
- 不实现自动模型路由、fallback 或 provider capability matrix。
- 不把 Codex runner 重写为全新执行器。
- 不在 MVP 中处理 Codex 之外的任何 runtime。

## Open Questions

无。

## Implementation Plan

### Components

| Component | Responsibility | Depends On |
|---|---|---|
| `ai-registry-config.ts` | 定义 `RegistryConfig` 等配置类型、Zod schema、结构校验、引用校验 | `core/result.ts` |
| `ai-registry-store.ts` | 读写 `~/.along/config.json`，只返回新 registry 结构 | `core/config.ts`, `ai-registry-config.ts` |
| `ai-registry-resolver.ts` | 解析 Agent runtime config 与 Profile LLM config，处理模型优先级和 Model token | `ai-registry-config.ts` |
| `codex-runtime-runner.ts` | 承接现有 Codex runner 行为，暴露 `CodexRuntimeRunner.runAgentTurn` | 现有 `task-codex-runner.ts` 逻辑 |
| `runtime-service.ts` | 根据解析后的 Runtime 调用 Codex runner，拒绝非 Codex runtime | `ai-registry-resolver.ts`, `codex-runtime-runner.ts` |
| `llm-service.ts` | 执行 Profile 直连模型调用，MVP 支持 openai-compatible provider | `ai-registry-resolver.ts` |
| `ai-registry-api.ts` | 提供 registry HTTP API，替换旧 config API 的 editor/taskAgents 语义 | `ai-registry-store.ts` |
| Settings UI | UI 文案和类型统一使用 Runtime/Profile，不再使用 Editor | `ai-registry-api.ts` |

### Implementation Order

1. Registry schema and validation
   - 先实现纯类型、schema 和引用校验。
   - 这是所有后续解析、API、运行入口的基础。
   - 验证点：`ai-registry-config.test.ts` 覆盖合法最小配置、重复 id、未知引用和旧 credential 配置迁移。

2. Registry store
   - 用 `ai-registry-store.ts` 替换旧全局配置读取语义。
   - 不保留 `taskAgents`、旧顶层 GitHub token role `agents` 或 `aiRuntime` 包裹层。
   - 验证点：读不到配置、非法 JSON、非法 registry 时返回中文错误；合法配置可写回格式化 JSON。

3. Resolver
   - 实现 Agent runtime 和 Profile LLM 两条解析路径。
   - Agent 模型优先级为 `task override > agent.modelId > runtime.modelId`。
   - token 只从最终 Model 解析。
   - `tokenEnv` 缺失必须在解析阶段失败。
   - 验证点：`ai-registry-resolver.test.ts` 覆盖优先级、token 解析、失败路径。

4. Codex runtime runner boundary
   - 将现有 `task-codex-runner.ts` 的对外入口收敛到 `CodexRuntimeRunner.runAgentTurn`。
   - 保留现有 stream、thread resume、artifact、progress、cancellation 行为。
   - 验证点：现有 Codex runner 相关测试继续通过，新的 runner facade 有最小覆盖。

5. RuntimeService
   - 用 `runtime-service.ts` 替换旧 `task-agent-runtime.ts` 的 editor 分发。
   - 输入和调用方统一使用 runtime，不再暴露 editor 字段。
   - MVP 只允许 `codex`，非 Codex runtime 在配置校验阶段失败。
   - 验证点：`runtime-service.test.ts` 确认 Codex agent 调用 runner，非 Codex 不进入分发。

6. LLMService
   - 实现 `LLMService.runProfile`，以 Profile 执行轻量 direct LLM 调用。
   - MVP 支持 openai-compatible HTTP 调用；不引入 SDK 依赖，除非后续单独批准。
   - 验证点：`llm-service.test.ts` 使用 mocked fetch 覆盖 baseUrl、model、token、parameters、JSON outputFormat。

7. API and UI naming unification
   - 新增或替换 registry API，响应字段统一为 runtime/profile。
   - Settings UI 和前端类型删除 editor/taskAgents 命名。
   - 验证点：Web build 通过，相关 UI 单元测试或类型检查通过。

8. Remove obsolete surfaces
   - 删除或停用旧 `agent-config.ts` 中 GitHub token role、`taskAgents`、`getTaskAgentConfig`、editor 配置 API。
   - 删除旧前端 `EditorOption` / `TaskAgentConfig.editor` 等类型。
   - 验证点：`rg "taskAgents|editor|Editor"` 只允许出现在历史文档、非 runtime 语义或明确例外处。

### Dependency Flow

```txt
ai-registry-config
  -> ai-registry-store
  -> ai-registry-resolver
  -> runtime-service -> codex-runtime-runner
  -> llm-service
  -> ai-registry-api
  -> settings UI
```

`codex-runtime-runner` 可以和 `ai-registry-config` 并行整理 facade，但 `runtime-service` 必须等 resolver 稳定后再接入。

### Risks And Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| 旧 `editor/taskAgents` 引用分散 | 编译失败或 UI/API 语义不一致 | 接入后用 `rg "taskAgents|editor|Editor"` 做全局清理检查 |
| Codex runner 文件较大 | 重命名或移动容易引入行为回归 | 先加 facade，保留内部实现，再小步改调用方 |
| `tokenEnv` 解析阶段失败影响本地运行 | 配置不完整时 Agent 无法启动 | 错误信息明确指出 model id 和缺失 env 名 |
| 直接 LLM HTTP 调用 provider 差异 | openai-compatible 之外 provider 行为不确定 | MVP 只实现 openai-compatible，其他 provider kind 返回失败 |
| 删除旧 GitHub token role 配置 | 依赖该 token 的 GitHub 调用可能断裂 | 本轮只按新 registry 目标架构设计；若实现阶段发现 GitHub auth 仍需要单独模型，先更新 spec 再实施 |

### Parallel Work

- 可并行：
  - `ai-registry-config.ts` 与 `codex-runtime-runner.ts` facade 梳理。
  - `llm-service.ts` 的 HTTP client 测试设计与 settings UI 类型梳理。

- 必须顺序：
  - resolver 必须在 schema 后实现。
  - RuntimeService 必须在 resolver 和 Codex runner facade 后接入。
  - API/UI 必须在 store/resolver 的数据形态稳定后改。
  - 全局旧命名清理必须在新入口接通后做。

### Verification Checkpoints

1. Schema checkpoint
   - Run: `bun --filter @ranwawa/along test -- ai-registry-config`
   - Expected: registry 结构和引用校验测试通过。

2. Resolver checkpoint
   - Run: `bun --filter @ranwawa/along test -- ai-registry-resolver`
   - Expected: Agent/Profile 解析和 tokenEnv 失败路径通过。

3. Runtime checkpoint
   - Run: `bun --filter @ranwawa/along test -- runtime-service codex-runtime`
   - Expected: Codex Agent 路径可执行，非 Codex 不进入分发。

4. LLM checkpoint
   - Run: `bun --filter @ranwawa/along test -- llm-service`
   - Expected: Profile direct LLM 调用请求构造和输出解析通过。

5. Integration checkpoint
   - Run: `bun run test`
   - Expected: along 包测试通过。

6. Quality checkpoint
   - Run: `bun run lint`
   - Run: `bun run quality:changed`
   - Expected: lint 和变更质量门禁通过。

7. Naming checkpoint
   - Run: `rg "taskAgents|editor|Editor" packages/along packages/along-web`
   - Expected: 没有 Agent runtime 语义上的旧命名残留。

## Implementation Tasks

- [x] Task: Implement registry config schema and validation
  - Acceptance: `RegistryConfig`、实体配置类型、Zod schema、结构校验和引用校验可独立使用；非法配置返回中文 `Result.failure`。
  - Verify: `bun --filter @ranwawa/along test -- ai-registry-config`
  - Files: `packages/along/src/domain/ai-registry-config.ts`, `packages/along/src/domain/ai-registry-config.test.ts`

- [x] Task: Implement registry store
  - Acceptance: `ai-registry-store.ts` 能读取、校验、写入 `~/.along/config.json`；不存在配置、非法 JSON、非法 registry 都有明确错误。
  - Verify: `bun --filter @ranwawa/along test -- ai-registry-store`
  - Files: `packages/along/src/integration/ai-registry-store.ts`, `packages/along/src/integration/ai-registry-store.test.ts`, `packages/along/src/domain/ai-registry-config.ts`

- [x] Task: Implement registry resolver
  - Acceptance: Agent runtime 和 Profile LLM 两条解析路径可用；模型优先级符合 spec；token 只来自最终 Model；`tokenEnv` 缺失在解析阶段失败。
  - Verify: `bun --filter @ranwawa/along test -- ai-registry-resolver`
  - Files: `packages/along/src/domain/ai-registry-resolver.ts`, `packages/along/src/domain/ai-registry-resolver.test.ts`, `packages/along/src/domain/ai-registry-config.ts`

- [x] Task: Add Codex runtime runner facade
  - Acceptance: `CodexRuntimeRunner.runAgentTurn` 暴露稳定入口；现有 Codex stream、resume、artifact、progress、cancellation 行为保持不变。
  - Verify: `bun --filter @ranwawa/along test -- codex-runtime task-codex`
  - Files: `packages/along/src/domain/codex-runtime-runner.ts`, `packages/along/src/domain/codex-runtime-runner.test.ts`, `packages/along/src/domain/task-codex-runner.ts`

- [x] Task: Replace agent runtime dispatch with RuntimeService
  - Acceptance: Agent 执行入口统一使用 RuntimeService；输入、解析、错误信息中不再使用 editor 语义；Codex agent 能调用 Codex runtime runner。
  - Verify: `bun --filter @ranwawa/along test -- runtime-service`
  - Files: `packages/along/src/domain/runtime-service.ts`, `packages/along/src/domain/runtime-service.test.ts`, current callers of `packages/along/src/domain/task-agent-runtime.ts`

- [x] Task: Implement LLMService Profile path
  - Acceptance: `LLMService.runProfile` 能按 Profile 构造 openai-compatible HTTP 请求；传入 resolved token、model、parameters；JSON 输出失败返回可读错误。
  - Verify: `bun --filter @ranwawa/along test -- llm-service`
  - Files: `packages/along/src/domain/llm-service.ts`, `packages/along/src/domain/llm-service.test.ts`, `packages/along/src/domain/ai-registry-resolver.ts`

- [x] Task: Replace config API with registry API
  - Acceptance: HTTP API 返回/写入顶层 registry；响应字段统一为 providers、models、runtimes、agents、profiles；不再暴露 credentials/editors/taskAgents。
  - Verify: `bun --filter @ranwawa/along test -- ai-registry-api`
  - Files: `packages/along/src/integration/ai-registry-api.ts`, `packages/along/src/integration/ai-registry-api.test.ts`, server route registration file

- [x] Task: Update settings UI and shared frontend types
  - Acceptance: UI、类型和配置映射统一使用 Runtime/Profile；不再显示或提交 Editor/taskAgents 语义。
  - Verify: `bun run build:web`
  - Files: `packages/along-web/src/types-config.ts`, `packages/along-web/src/settings/*`, `packages/along-web/src/SettingsView.tsx`, `packages/along-web/src/types.ts`

- [x] Task: Remove obsolete config/runtime surfaces
  - Acceptance: 删除或停用旧 `agent-config.ts`、`config-api.ts`、`task-agent-runtime.ts` 中旧语义；项目编译和测试不再依赖 `getTaskAgentConfig`、`editor`、`taskAgents`。
  - Verify: `bun run test`
  - Files: `packages/along/src/integration/agent-config.ts`, `packages/along/src/integration/config-api.ts`, `packages/along/src/domain/task-agent-runtime.ts`, affected imports

- [x] Task: Global naming and quality gate
  - Acceptance: Agent runtime 语义中无 `Editor/editor/taskAgents` 残留；所有相关测试、lint、变更质量门禁通过。
  - Verify: `rg "taskAgents|editor|Editor" packages/along packages/along-web`; `bun run lint`; `bun run quality:changed`
  - Files: package-wide affected runtime/config/settings references
