# Spec: Along Architecture Reorganization

## Objective

将 `@ranwawa/along` 从历史前缀拆分后的中间态，整理为边界清晰的分层架构。

成功状态：

- 后端目录按 `domain / app / adapters / server / cli` 组织。
- 前后端共享 DTO 和 registry 类型收敛到 `@ranwawa/along-contracts`。
- 入口层只做命令或 HTTP 适配，不承载 task 编排。
- domain 层不依赖 DB、HTTP、Bun、Codex、Git 或文件系统。
- 质量门禁 `bun run quality:changed` 通过。

## Tech Stack

- Runtime: Bun `1.3.11`
- Language: TypeScript ESM
- Backend package: `packages/along`
- Frontend package: `packages/along-web`
- Shared contracts package: `packages/along-contracts`
- Test framework: Vitest
- Lint/format: Biome

## Commands

```bash
bun --filter='@ranwawa/along' run test
bun run build:web
bun run quality:changed
bun run quality:full
```

## Project Structure

```txt
packages/along-contracts/src
  registry.ts        Shared AI registry DTO/types
  task.ts            Shared task snapshot, artifact, flow and progress DTO/types
  workflow.ts        Shared workflow DTO/types
  index.ts           Public contract exports

packages/along/src
  core/              Shared backend primitives with no business dependencies
  domain/            Pure business types/rules/state projections
    registry/        Registry validation and resolving rules
    workflow/        Workflow reducer and display projection
  app/               Use cases and orchestration
    planning/        Task planning store, flow projection and plan mutations
    task/            Create/message/chat/planning/exec/verify/delivery flows
    delivery/        PR delivery orchestration
    scheduler/       Queue, task locks, autonomous continuation
    worktree/        Task worktree preparation and branch operations
    runtimes/codex/  Codex SDK runner, stream, session event mapping
  adapters/          IO implementations
    config/          Registry store and config-file persistence
    logging/         Log routing and log file writer
    workspace/       Workspace discovery/registry
  agents/            Prompt builders and workflow-node prompt templates
  server/            Bun server and HTTP route composition
  cli/               Thin CLI dispatchers and command entrypoints
```

## Code Style

Use dependency direction as the primary style rule:

```ts
// Good: app layer orchestrates domain and adapters.
import { readTaskPlanningSnapshot } from '../../app/planning/read';
import { readRegistryConfig } from '../../adapters/config/registry-store';

// Bad: domain cannot import app/adapters/runtime/server.
import { readRegistryConfig } from '../../adapters/config/registry-store';
```

Keep imports relative until a package-wide path alias exists.

## Testing Strategy

- Keep tests colocated with moved modules.
- After each migration batch, run `bun --filter='@ranwawa/along' run test` when feasible.
- Final verification must include `bun run quality:changed`.
- If shared contracts move affects frontend imports, run `bun run build:web`.

## Boundaries

- Always: preserve public behavior and existing HTTP shape.
- Always: update imports and docs together with moves.
- Always: keep generated/shared files out of `.along/tmp/`.
- Ask first: adding runtime dependencies or changing database schema.
- Never: remove tests to make a move pass.
- Never: reintroduce a catch-all `domain` directory that imports infrastructure.

## Success Criteria

- `packages/along/src/domain` exists only for pure rules/types/state.
- No backend source import matches `../integration`, `../commands`, or old `task-*` module names.
- `server`/`cli` depend inward on `app`; `app` depends on `domain`, `adapters`, `agents` and `core`; `domain` depends only on `core` and contracts.
- `@ranwawa/along-web` imports shared API/config DTOs from `@ranwawa/along-contracts`.
- `bun run quality:changed` passes.

## Open Questions

无。用户已要求按本方案推进到完成。
