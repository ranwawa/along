import type { ManagedAgentEditor } from './types';

export const EDITOR_PROMPT_DIRS: Record<ManagedAgentEditor, string> = {
  codex: '.codex/prompts',
};

export const EDITOR_SKILL_DIRS: Record<ManagedAgentEditor, string> = {
  codex: '.codex/skills',
};
