# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Along

Along (`@ranwawa/along`) is a CLI automation tool that orchestrates AI coding agents (OpenCode, PI, Claude Code) to resolve GitHub Issues end-to-end. It manages the full lifecycle: fetching issues, creating worktrees, launching agents, tracking progress, committing code, creating PRs, and cleaning up.

## Runtime & Language

- **Runtime**: Bun (all scripts use `#!/usr/bin/env bun` shebangs and Bun APIs like `$`, `Bun.spawn`, `Bun.write`)
- **Language**: TypeScript (ESM, `"type": "module"`)
- **No build step**: Scripts are executed directly via Bun
- **Test framework**: Vitest (`vitest run`)

## CLI Entry Point

The global command `along` maps to `bin/along.ts`, a thin executable shim that imports `src/cli.ts`. The CLI dispatches subcommands by spawning the corresponding `src/commands/<subcommand>.ts` file.

```bash
along webhook-server --port 9876    # 启动本地 webhook 服务器，接收 GitHub App webhook 事件
along run 42                        # 手动触发：fetch issue #42, create worktree, launch agent
```

Agent SOP 内部调用的命令（不在 `along --help` 中显示，但仍可执行）：

```bash
along branch-create 42 feat/issue-42-desc   # Create semantic branch + running label
along commit-push --message "fix: msg" --files a.ts b.ts  # Atomic commit + rebase + push
along pr-create 42 "title" "body"   # Create PR via gh CLI
along issue-status 42 running       # Update session status
along issue-comment 42 "message"    # Comment on issue
along cleanup 42                    # Clean up worktree, branch, and session files for issue #42
along worktree-gc                   # Batch cleanup of worktrees for closed/merged issues
```

## Architecture

### Data Flow

1. `along run <N>` validates environment (git repo, GitHub remote), runs idempotent project bootstrap (auto-creates `.along.json`, syncs editor mappings/permissions), fetches Issue #N via Octokit, creates a git worktree at `~/.along/{owner}/{repo}/{N}/worktree/`, then creates editor-path symlinks back to the repo `skills/` and `prompts/` directories before launching the configured AI agent via Bun.spawn.
2. The agent follows the phase-specific SOP in `prompts/resolve-github-issue-planning.md` and `prompts/resolve-github-issue-implementation.md`.
3. Subcommands (`branch-create`, `commit-push`, `pr-create`) are called by the agent during execution. Each automatically updates the session status in SQLite and `todo.md` in the issue directory.
4. **Event-driven mode**: A GitHub App sends webhook events (issue opened, issue labeled, PR created, PR review submitted, check run completed) to the local `along webhook-server`. The server resolves the webhook secret via three-level priority (CLI `--secret` > `ALONG_WEBHOOK_SECRET` env var > `~/.along/config.json` `webhookSecret` field); if no secret is found, it prints the GitHub App setup guide and exits.

### Directory Layout

- `bin/` — Thin executable entry points:
  - `bin/along.ts` — CLI shim, imports `src/cli.ts`
- `src/` — Runtime source modules, with tests colocated beside source files:
  - `src/cli.ts` — CLI dispatcher
  - `src/commands/` — CLI subcommands: `run.ts`, `webhook-server.ts`, `cleanup.ts`, `worktree-gc.ts`, `branch-create.ts`, `commit-push.ts`, `pr-create.ts`, `issue-comment.ts`, `issue-status.ts`, `label-sync.ts`, `log-reader.ts`
  - `src/core/` — Foundational modules: `config.ts`, `common.ts`, `result.ts`, `exec.ts`, `db.ts`, `types.ts`, `session-paths.ts`
  - `src/domain/` — Business logic: `session-manager.ts`, `session-state-machine.ts`, `session-diagnostics.ts`, `planning-state.ts`, `task.ts`, `issue.ts`, `issue-agent.ts`, `issue-triage.ts`, `todo-helper.ts`, `analyze-error.ts`, `cleanup-utils.ts`, `worktree-init.ts`, `bootstrap.ts`
  - `src/integration/` — External service adapters: `github-client.ts`, `agent-config.ts`, `webhook-handlers.ts`, `workspace-registry.ts`
  - `src/logging/` — Structured logging: `log-types.ts`, `log-writer.ts`, `log-router.ts`
- `prompts/` — SOP templates consumed by AI agents. `$1` is replaced with the issue/PR number.
- `skills/` — Reusable skill definitions (branch naming, conventional commits, PR summary, unit testing) synced into worktrees.
- `types/` — Type declarations for external agent SDKs.

### Key Abstractions

- **`Result<T>`** (`core/result.ts`, re-exported from `core/common.ts`): Discriminated union `{success: true, data: T} | {success: false, error: string}` used throughout for error handling. Use `success()` / `failure()` constructors.
- **`config`** (`core/config.ts`): Singleton with path constants. Base data directory is `~/.along/`. Per-issue artifacts live under `~/.along/{owner}/{repo}/{issueNumber}/`. Source resources live under the repo's own directory.
- **`db`** (`core/db.ts`): SQLite database module (`~/.along/along.db`) providing ACID transactions for session state. Key functions: `readSession()`, `upsertSession()`, `findAllSessions()`, `findSessionByPr()`, `findSessionByBranch()`.
- **`SessionManager`** (`domain/session-manager.ts`): High-level session lifecycle manager (running → completed/error/crashed). Delegates to `core/db.ts` for persistence. Constructor: `(owner, repo, issueNumber)`.
- **`SessionPathManager`** (`core/session-paths.ts`): Centralized path resolution for per-issue file artifacts (logs, todo, worktree). Does NOT manage session status (that's in SQLite). Constructor: `(owner, repo, issueNumber)`.
- **`Task`** / **`Issue`** (`domain/task.ts`, `domain/issue.ts`): Domain objects for session state and GitHub issue data respectively.

### Editor Support

Along supports multiple AI editors via `config.EDITORS`. Each editor entry includes: `id`, `name`, `detectDir` (for auto-detection), `mappings` (source→target directory symlinks), `runTemplate` (agent launch command), and optional `ensurePermissions` callback (worktree-level authorization). Current editors: OpenCode, PI, Codex, Kira Code. The active editor is auto-detected from the working directory or `AGENT_TYPE` env var. Adding a new editor only requires appending an entry to the `EDITORS` array; adding a new source type (e.g., subagent, tool, hook) only requires adding a mapping entry.

### Issue Artifacts (under `~/.along/{owner}/{repo}/{issueNumber}/`)

- `~/.along/along.db` — SQLite database storing all session state (status, branch, worktree path, timestamps, etc.)
- `todo.md` — 5-step checklist, auto-updated by subcommand scripts
- `issue.json` — Cached GitHub issue data
- `step{M}-{script}.md` — Step output artifacts
- `session.log` — Structured session log
- `worktree/` — Git worktree directory

## Conventions

- All user-facing log messages and commit descriptions are in **Chinese**.
- Logging uses `consola` with per-file tags: `consola.withTag("module-name")`.
- CLI argument parsing uses `commander`.
- Git operations use `simple-git` (imported as `git` from `core/common.ts`) and Bun's `$` shell for `gh` CLI calls.
