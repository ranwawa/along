import fs from 'node:fs';
import path from 'node:path';

export interface LoadWorkflowNodePromptInput {
  name: string;
}

export interface LoadedWorkflowNodePrompt {
  name: string;
  sourcePath: string;
  content: string;
}

export function renderAgentMarkdownTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (match, key) =>
    key in variables ? variables[key] : match,
  );
}

function stripMarkdownFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
}

export function loadWorkflowNodePrompt(
  input: LoadWorkflowNodePromptInput,
): LoadedWorkflowNodePrompt {
  const sourcePath = path.join(
    import.meta.dirname,
    'workflow-node-prompts',
    `${input.name}.md`,
  );

  return {
    name: input.name,
    sourcePath,
    content: stripMarkdownFrontmatter(fs.readFileSync(sourcePath, 'utf8')),
  };
}
