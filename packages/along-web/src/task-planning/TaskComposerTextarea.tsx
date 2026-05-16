import { type KeyboardEvent, useState } from 'react';
import { Textarea } from '../components/ui/input';
import type { TaskRuntimeExecutionMode } from '../types-task';

export const RUNTIME_MODE_OPTIONS: {
  value: TaskRuntimeExecutionMode;
  command: string;
  label: string;
  description: string;
}[] = [
  {
    value: 'auto',
    command: '/auto',
    label: '自动',
    description: '让 runtime 判断路径',
  },
  {
    value: 'chat',
    command: '/chat',
    label: 'Chat',
    description: '对话讨论模式',
  },
  { value: 'plan', command: '/plan', label: 'Plan', description: '先产出计划' },
  {
    value: 'exec',
    command: '/exec',
    label: 'Exec',
    description: '优先直接执行',
  },
];

const BLUR_TIMEOUT_MS = 120;

export function getRuntimeModeLabel(value: TaskRuntimeExecutionMode) {
  return RUNTIME_MODE_OPTIONS.find((option) => option.value === value)?.label;
}

function getSlashQuery(body: string): string | null {
  if (!body.startsWith('/')) return null;
  return body.slice(1).split(/\s|\n/)[0].toLowerCase();
}

function matchesSlashQuery(
  option: (typeof RUNTIME_MODE_OPTIONS)[number],
  query: string,
) {
  return (
    option.value.startsWith(query) || option.command.slice(1).startsWith(query)
  );
}

export function stripSlashCommand(body: string): string {
  return body.replace(/^\/(?:auto|chat|plan|exec)(?:\s+|$)/i, '');
}

function stripSlashTrigger(body: string): string {
  return body.replace(/^\/\S*\s*/i, '');
}

export function applyTypedSlashCommand(
  value: string,
  onBodyChange: (value: string) => void,
  onRuntimeExecutionModeChange: (value: TaskRuntimeExecutionMode) => void,
) {
  const option = RUNTIME_MODE_OPTIONS.find((item) =>
    new RegExp(`^${item.command}(?:\\s+|$)`, 'i').test(value),
  );
  if (!option) return false;
  onRuntimeExecutionModeChange(option.value);
  onBodyChange(stripSlashCommand(value));
  return true;
}

function SlashModeMenu({
  body,
  options,
  onBodyChange,
  onRuntimeExecutionModeChange,
}: {
  body: string;
  options: typeof RUNTIME_MODE_OPTIONS;
  onBodyChange: (value: string) => void;
  onRuntimeExecutionModeChange: (value: TaskRuntimeExecutionMode) => void;
}) {
  return (
    <div className="absolute bottom-full left-0 z-30 mb-2 w-64 rounded-lg border border-border-color bg-bg-secondary p-1 shadow-xl">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onRuntimeExecutionModeChange(option.value);
            onBodyChange(stripSlashTrigger(body));
          }}
          className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-black/30 hover:text-text-primary focus:bg-black/30 focus:text-text-primary focus:outline-none"
        >
          <span className="font-semibold text-text-primary">
            {option.command}
          </span>
          <span className="truncate text-xs">{option.description}</span>
        </button>
      ))}
    </div>
  );
}

export function useComposerTextareaState(
  body: string,
  onBodyChange: (value: string) => void,
  onRuntimeExecutionModeChange: (value: TaskRuntimeExecutionMode) => void,
) {
  const [isFocused, setIsFocused] = useState(false);
  const slashQuery = getSlashQuery(body);
  const slashOptions =
    slashQuery == null
      ? []
      : RUNTIME_MODE_OPTIONS.filter((option) =>
          matchesSlashQuery(option, slashQuery),
        );
  const showSlashMenu = isFocused && slashOptions.length > 0;
  const handleChange = (value: string) => {
    if (
      !applyTypedSlashCommand(value, onBodyChange, onRuntimeExecutionModeChange)
    ) {
      onBodyChange(value);
    }
  };
  const onFocus = () => setIsFocused(true);
  const onBlur = () => {
    window.setTimeout(() => setIsFocused(false), BLUR_TIMEOUT_MS);
  };
  return { slashOptions, showSlashMenu, handleChange, onFocus, onBlur };
}

export function useComposerKeyDown(
  showSlashMenu: boolean,
  slashOptions: typeof RUNTIME_MODE_OPTIONS,
  runningRun: { runId: string } | null | undefined,
  onBodyChange: (value: string) => void,
  onRuntimeExecutionModeChange: (value: TaskRuntimeExecutionMode) => void,
  onSubmitShortcut: (form: HTMLFormElement | null) => void,
) {
  return (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    if (showSlashMenu && slashOptions[0]) {
      event.preventDefault();
      onRuntimeExecutionModeChange(slashOptions[0].value);
      onBodyChange(stripSlashCommand(slashOptions[0].command));
      return;
    }
    if (event.ctrlKey || event.altKey || event.shiftKey || runningRun) return;
    event.preventDefault();
    onSubmitShortcut(event.currentTarget.form);
  };
}

function RuntimeModeBadge({ value }: { value: TaskRuntimeExecutionMode }) {
  return (
    <div className="pointer-events-none absolute right-2 bottom-2 rounded-md border border-border-color bg-black/35 px-2 py-0.5 text-[11px] text-text-muted">
      {getRuntimeModeLabel(value)}
    </div>
  );
}

export function ComposerTextarea({
  body,
  busy,
  disabled,
  placeholder,
  rows,
  runningRun,
  runtimeExecutionMode,
  onBodyChange,
  onRuntimeExecutionModeChange,
  onSubmitShortcut,
}: {
  body: string;
  busy?: boolean;
  disabled?: boolean;
  placeholder: string;
  rows?: number;
  runningRun?: { runId: string } | null;
  runtimeExecutionMode: TaskRuntimeExecutionMode;
  onBodyChange: (value: string) => void;
  onRuntimeExecutionModeChange: (value: TaskRuntimeExecutionMode) => void;
  onSubmitShortcut: (form: HTMLFormElement | null) => void;
}) {
  const { slashOptions, showSlashMenu, handleChange, onFocus, onBlur } =
    useComposerTextareaState(body, onBodyChange, onRuntimeExecutionModeChange);
  const handleKeyDown = useComposerKeyDown(
    showSlashMenu,
    slashOptions,
    runningRun,
    onBodyChange,
    onRuntimeExecutionModeChange,
    onSubmitShortcut,
  );
  return (
    <div className="relative min-w-0">
      <Textarea
        value={body}
        onChange={(event) => handleChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled || busy}
        className="block w-full resize-none pt-2 pr-16 pb-7"
      />
      {showSlashMenu && (
        <SlashModeMenu
          body={body}
          options={slashOptions}
          onBodyChange={onBodyChange}
          onRuntimeExecutionModeChange={onRuntimeExecutionModeChange}
        />
      )}
      <RuntimeModeBadge value={runtimeExecutionMode} />
    </div>
  );
}
