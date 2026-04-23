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

The global command `along` maps to `bin/setup.ts`, which dispatches subcommands by spawning the corresponding `bin/<subcommand>.ts` file.

```bash
along webhook-server --port 9876    # 启动本地 webhook 服务器，接收 GitHub App webhook 事件
along app-init                      # 引导配置 GitHub App 以接收仓库事件
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

1. `along run <N>` validates environment (git repo, GitHub remote), fetches Issue #N via Octokit, creates a git worktree at `~/.along/{owner}/{repo}/{N}/worktree/`, then creates editor-path symlinks back to the repo `skills/` and `prompts/` directories before launching the configured AI agent via Bun.spawn.
2. The agent follows the phase-specific SOP in `prompts/resolve-github-issue-planning.md` and `prompts/resolve-github-issue-implementation.md`.
3. Subcommands (`branch-create`, `commit-push`, `pr-create`) are called by the agent during execution. Each automatically updates the session status in SQLite and `todo.md` in the issue directory.
4. **Event-driven mode**: A GitHub App sends webhook events (issue opened, issue labeled, PR created, PR review submitted, check run completed) to the local `along webhook-server`. The server directly calls handler functions in `webhook-handlers.ts` (`reviewPr`, `resolveReview`, `resolveCi`) via fire-and-forget, without spawning subprocesses. Use `along app-init` to set up the GitHub App.

### Directory Layout

- `bin/` — All CLI scripts. Two categories:
  - **Internal modules** (imported, not run directly): `config.ts`, `common.ts`, `exec.ts`, `github-client.ts`, `worktree-init.ts`, `session-manager.ts`, `task.ts`, `issue.ts`, `cleanup-utils.ts`, `todo-helper.ts`, `webhook-handlers.ts`
  - **CLI subcommands** (dispatched by `setup.ts`): everything else in `bin/`
- `prompts/` — SOP templates consumed by AI agents. `$1` is replaced with the issue/PR number.
- `skills/` — Reusable skill definitions (branch naming, conventional commits, PR summary, unit testing) synced into worktrees.
- `types/` — Type declarations for external agent SDKs.

### Key Abstractions

- **`Result<T>`** (`result.ts`, re-exported from `common.ts`): Discriminated union `{success: true, data: T} | {success: false, error: string}` used throughout for error handling. Use `success()` / `failure()` constructors.
- **`config`** (`config.ts`): Singleton with path constants. Base data directory is `~/.along/`. Per-issue artifacts live under `~/.along/{owner}/{repo}/{issueNumber}/`. Source resources live under the repo's own directory.
- **`db`** (`db.ts`): SQLite database module (`~/.along/along.db`) providing ACID transactions for session state. Key functions: `readSession()`, `upsertSession()`, `findAllSessions()`, `findSessionByPr()`, `findSessionByBranch()`.
- **`SessionManager`** (`session-manager.ts`): High-level session lifecycle manager (running → completed/error/crashed). Delegates to `db.ts` for persistence. Constructor: `(owner, repo, issueNumber)`.
- **`SessionPathManager`** (`session-paths.ts`): Centralized path resolution for per-issue file artifacts (logs, todo, worktree). Does NOT manage session status (that's in SQLite). Constructor: `(owner, repo, issueNumber)`.
- **`Task`** / **`Issue`** (`task.ts`, `issue.ts`): Domain objects for session state and GitHub issue data respectively.

### Editor Support

Along supports multiple AI editors via `config.EDITORS`. Each editor has directory mappings (where to copy skills/prompts) and a `runTemplate` for launching the agent. Current editors: OpenCode, PI, Claude Code. The active editor is auto-detected from the working directory (`.opencode`, `.pi`, `.claude`) or `AGENT_TYPE` env var.

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
- Git operations use `simple-git` (imported as `git` from `common.ts`) and Bun's `$` shell for `gh` CLI calls.
