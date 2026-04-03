# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Along

Along (`@ranwawa/along`) is a CLI automation tool that orchestrates AI coding agents (OpenCode, PI, Claude Code) to resolve GitHub Issues end-to-end. It manages the full lifecycle: fetching issues, creating worktrees, launching agents in tmux sessions, tracking progress, committing code, creating PRs, and cleaning up.

## Runtime & Language

- **Runtime**: Bun (all scripts use `#!/usr/bin/env bun` shebangs and Bun APIs like `$`, `Bun.spawn`, `Bun.write`)
- **Language**: TypeScript (ESM, `"type": "module"`)
- **No build step**: Scripts are executed directly via Bun
- **No test framework configured**: `package.json` references jest but no test files exist

## CLI Entry Point

The global command `along` maps to `bin/setup.ts`, which dispatches subcommands by spawning the corresponding `bin/<subcommand>.ts` file.

```bash
along run 42          # Main entry: fetch issue #42, create worktree, launch agent in tmux
along sync-editor     # Symlink skills/prompts into editor-specific directories
along cleanup 42      # Clean up worktree, branch, and session files for issue #42
along worktree-gc     # Batch cleanup of worktrees for closed/merged issues
along issue-list      # Show all active issue workspaces
along status          # Print task progress dashboard
along watch           # Live-refresh status board (2s interval)
along branch-create 42 feat/issue-42-desc   # Create semantic branch + WIP label
along commit-push --message "fix: msg" --files a.ts b.ts  # Atomic commit + rebase + push
along pr-create 42 "title" "body"   # Create PR via gh CLI
along issue-status 42 running       # Update session status
along issue-comment 42 "message"    # Comment on issue
along issue-label 42 WIP            # Add labels to issue
along issue-details 42              # Fetch issue with safety checks (closed/WIP guard)
along logs list                     # View agent run logs
```

## Architecture

### Data Flow

1. `along run <N>` validates environment (git repo, GitHub remote, tmux), fetches Issue #N via Octokit, creates a git worktree at `~/.along/worktrees/<N>/`, syncs skills/prompts into the worktree, then launches the configured AI agent in a tmux window.
2. The agent follows the SOP in `prompts/resolve-github-issue.md` — a 5-step workflow (understand issue → analyze code → implement fix → commit-push → create PR).
3. Subcommands (`branch-create`, `commit-push`, `pr-create`) are called by the agent during execution. Each automatically updates `~/.along/sessions/<N>-status.json` and `<N>-todo.md`.

### Directory Layout

- `bin/` — All CLI scripts. Two categories:
  - **Internal modules** (imported, not run directly): `config.ts`, `common.ts`, `exec.ts`, `github-client.ts`, `worktree-init.ts`, `session-manager.ts`, `task.ts`, `issue.ts`, `cleanup-utils.ts`, `todo-helper.ts`
  - **CLI subcommands** (dispatched by `setup.ts`): everything else in `bin/`
- `prompts/` — SOP templates consumed by AI agents. `$1` is replaced with the issue/PR number.
- `skills/` — Reusable skill definitions (branch naming, conventional commits, PR summary, unit testing) synced into worktrees.
- `types/` — Type declarations for external agent SDKs.

### Key Abstractions

- **`Result<T>`** (`common.ts`): Discriminated union `{success: true, data: T} | {success: false, error: string}` used throughout for error handling. Use `success()` / `failure()` constructors.
- **`config`** (`config.ts`): Singleton with all path constants. Data lives under `~/.along/` (worktrees, sessions, logs, tmp). Source resources live under the repo's own directory.
- **`GitHubClient`** (`github-client.ts`): Octokit wrapper. Token sourced from `GITHUB_TOKEN` env or `gh auth token`.
- **`SessionManager`** (`session-manager.ts`): Manages `<N>-status.json` lifecycle (running → completed/error/crashed).
- **`Task`** / **`Issue`** (`task.ts`, `issue.ts`): Domain objects for session state and GitHub issue data respectively.

### Editor Support

Along supports multiple AI editors via `config.EDITORS`. Each editor has directory mappings (where to copy skills/prompts) and a `runTemplate` for launching the agent. Current editors: OpenCode, PI, Claude Code. The active editor is auto-detected from the working directory (`.opencode`, `.pi`, `.claude`) or `AGENT_TYPE` env var.

### Session Files (under `~/.along/sessions/`)

- `<N>-status.json` — Session state (status, branch, worktree path, timestamps)
- `<N>-todo.md` — 5-step checklist, auto-updated by subcommand scripts
- `<N>-issue.json` — Cached GitHub issue data
- `<N>-step<M>-<script>.md` — Step output artifacts

## Conventions

- All user-facing log messages and commit descriptions are in **Chinese**.
- Logging uses `consola` with per-file tags: `consola.withTag("module-name")`.
- CLI argument parsing uses `commander`.
- Git operations use `simple-git` (imported as `git` from `common.ts`) and Bun's `$` shell for `gh` CLI calls.
- The `tmux` environment is required for non-CI execution.
