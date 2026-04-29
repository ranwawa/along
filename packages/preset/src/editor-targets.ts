import type { ManagedAgentEditor } from './types';

export const EDITOR_PROMPT_DIRS: Record<ManagedAgentEditor, string> = {
  opencode: '.opencode/commands',
  pi: '.pi/prompts',
  codex: '.codex/prompts',
  claude: '.claude/commands',
};

export const EDITOR_SKILL_DIRS: Record<ManagedAgentEditor, string> = {
  opencode: '.opencode/skills/along',
  pi: '.pi/skills/along',
  codex: '.codex/skills/along',
  claude: '.claude/skills/along',
};
