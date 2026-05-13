// biome-ignore-all lint/nursery/noExcessiveLinesPerFile: composer controls are kept together for this interaction.
// biome-ignore-all lint/style/noJsxLiterals: existing composer controls use inline UI labels.
// biome-ignore-all lint/style/noMagicNumbers: existing composer controls use fixed UI timings and sizes.
import { Image, LoaderCircle, Paperclip, Send } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/input';
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import type {
  TaskAgentRunRecord,
  TaskExecutionMode,
  TaskRuntimeExecutionMode,
  TaskWorkspaceMode,
} from '../types-task';
import {
  ImageAttachmentPicker,
  type ImageAttachmentPickerRenderProps,
} from './TaskImageAttachments';

interface TaskComposerInputProps {
  attachments: File[];
  body: string;
  busy?: boolean;
  disabled?: boolean;
  executionMode: TaskExecutionMode;
  runtimeExecutionMode: TaskRuntimeExecutionMode;
  workspaceMode?: TaskWorkspaceMode;
  placeholder: string;
  rows?: number;
  runningRun?: TaskAgentRunRecord | null;
  submitDisabled: boolean;
  submitTitle?: string;
  onCancelAgentRun?: (runId?: string) => void;
  onAttachmentsChange: (files: File[]) => void;
  onBodyChange: (value: string) => void;
  onExecutionModeChange: (value: TaskExecutionMode) => void;
  onRuntimeExecutionModeChange: (value: TaskRuntimeExecutionMode) => void;
  onWorkspaceModeChange?: (value: TaskWorkspaceMode) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

type ComposerDisplayProps = Omit<
  TaskComposerInputProps,
  'attachments' | 'onAttachmentsChange' | 'onSubmit'
>;

const RUNTIME_MODE_OPTIONS: {
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
    value: 'ask',
    command: '/ask',
    label: 'Ask',
    description: '优先澄清需求',
  },
  {
    value: 'plan',
    command: '/plan',
    label: 'Plan',
    description: '先产出计划',
  },
  {
    value: 'build',
    command: '/build',
    label: 'Build',
    description: '优先直接构建',
  },
];

function getRuntimeModeLabel(value: TaskRuntimeExecutionMode) {
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

function stripSlashCommand(body: string): string {
  return body.replace(/^\/(?:auto|ask|plan|build)(?:\s+|$)/i, '');
}

function stripSlashTrigger(body: string): string {
  return body.replace(/^\/\S*\s*/i, '');
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

function applyTypedSlashCommand(
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

function AttachmentPopover({
  canAdd,
  count,
  disabled,
  maxCount,
  openPicker,
}: {
  canAdd: boolean;
  count: number;
  disabled?: boolean;
  maxCount: number;
  openPicker: () => void;
}) {
  const isDisabled = disabled || !canAdd;
  return (
    <Popover>
      <PopoverTrigger asChild={true}>
        <Button
          type="button"
          aria-label="添加附件"
          disabled={isDisabled}
          title={
            count >= maxCount ? `单次最多上传 ${maxCount} 张图片` : '添加附件'
          }
          size="icon"
          className="bg-black/25 hover:text-text-primary"
        >
          <Paperclip aria-hidden="true" className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-36">
        <PopoverClose asChild={true}>
          <button
            type="button"
            disabled={isDisabled}
            onClick={openPicker}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-black/30 hover:text-text-primary focus:bg-black/30 focus:text-text-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Image aria-hidden="true" className="h-4 w-4" />
            <span>图片</span>
          </button>
        </PopoverClose>
      </PopoverContent>
    </Popover>
  );
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: textarea owns keyboard, slash menu, and focus state together.
function ComposerTextarea({
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
}: Pick<
  TaskComposerInputProps,
  | 'body'
  | 'busy'
  | 'disabled'
  | 'placeholder'
  | 'rows'
  | 'runningRun'
  | 'runtimeExecutionMode'
  | 'onBodyChange'
  | 'onRuntimeExecutionModeChange'
> & {
  onSubmitShortcut: (form: HTMLFormElement | null) => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const slashQuery = getSlashQuery(body);
  const slashOptions =
    slashQuery == null
      ? []
      : RUNTIME_MODE_OPTIONS.filter((option) =>
          matchesSlashQuery(option, slashQuery),
        );
  const showSlashMenu = isFocused && slashOptions.length > 0;
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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
  return (
    <div className="relative min-w-0">
      <Textarea
        value={body}
        onChange={(event) => {
          const value = event.target.value;
          if (
            !applyTypedSlashCommand(
              value,
              onBodyChange,
              onRuntimeExecutionModeChange,
            )
          )
            onBodyChange(value);
        }}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          window.setTimeout(() => setIsFocused(false), 120);
        }}
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
      <div className="pointer-events-none absolute right-2 bottom-2 rounded-md border border-border-color bg-black/35 px-2 py-0.5 text-[11px] text-text-muted">
        {getRuntimeModeLabel(runtimeExecutionMode)}
      </div>
    </div>
  );
}

function AutomaticModeCheckbox({
  busy,
  disabled,
  executionMode,
  onExecutionModeChange,
}: Pick<
  TaskComposerInputProps,
  'busy' | 'disabled' | 'executionMode' | 'onExecutionModeChange'
>) {
  return (
    <label className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-border-color bg-black/25 px-3 text-sm text-text-secondary">
      <input
        type="checkbox"
        checked={executionMode === 'autonomous'}
        disabled={disabled || busy}
        onChange={(event) => {
          onExecutionModeChange(event.target.checked ? 'autonomous' : 'manual');
        }}
        className="h-4 w-4 accent-brand disabled:opacity-50"
      />
      <span>自动模式</span>
    </label>
  );
}

function WorkspaceModeSelect({
  busy,
  disabled,
  workspaceMode,
  onWorkspaceModeChange,
}: Pick<
  TaskComposerInputProps,
  'busy' | 'disabled' | 'workspaceMode' | 'onWorkspaceModeChange'
>) {
  if (!onWorkspaceModeChange) return null;
  return (
    <select
      aria-label="执行位置"
      value={workspaceMode || 'worktree'}
      disabled={disabled || busy}
      onChange={(event) =>
        onWorkspaceModeChange(event.target.value as TaskWorkspaceMode)
      }
      className="h-9 shrink-0 rounded-lg border border-border-color bg-black/25 px-3 text-sm text-text-secondary outline-none focus:ring-1 focus:ring-brand/60 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <option value="worktree">worktree</option>
      <option value="default_branch">默认分支</option>
    </select>
  );
}

function SubmitIconButton({
  busy,
  runningRun,
  submitDisabled,
  submitTitle,
  onCancelAgentRun,
}: Pick<
  TaskComposerInputProps,
  'busy' | 'runningRun' | 'submitDisabled' | 'submitTitle' | 'onCancelAgentRun'
>) {
  const isCancelling = Boolean(runningRun);
  return (
    <Button
      type={isCancelling ? 'button' : 'submit'}
      aria-label={isCancelling ? '中断当前 Agent' : busy ? '发送中' : '发送'}
      title={isCancelling ? '中断当前 Agent' : busy ? '发送中' : submitTitle}
      disabled={submitDisabled || busy}
      onClick={() => {
        if (runningRun) onCancelAgentRun?.(runningRun.runId);
      }}
      variant="default"
      size="icon"
    >
      {isCancelling || busy ? (
        <LoaderCircle
          aria-hidden="true"
          className="h-4 w-4 animate-spin motion-reduce:animate-none"
        />
      ) : (
        <Send aria-hidden="true" className="h-4 w-4" />
      )}
    </Button>
  );
}

function ComposerActionRow({
  controls,
  ...props
}: ComposerDisplayProps & {
  controls: ImageAttachmentPickerRenderProps;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <AttachmentPopover
        canAdd={controls.canAdd}
        count={controls.count}
        disabled={props.disabled || props.busy}
        maxCount={controls.maxCount}
        openPicker={controls.openPicker}
      />
      <AutomaticModeCheckbox {...props} />
      <WorkspaceModeSelect {...props} />
      <div className="min-w-0 flex-1" />
      <SubmitIconButton {...props} />
    </div>
  );
}

function ComposerContent({
  controls,
  onSubmitShortcut,
  ...props
}: ComposerDisplayProps & {
  controls: ImageAttachmentPickerRenderProps;
  onSubmitShortcut: (form: HTMLFormElement | null) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {controls.previews}
      <ComposerTextarea {...props} onSubmitShortcut={onSubmitShortcut} />
      {controls.error}
      <ComposerActionRow controls={controls} {...props} />
    </div>
  );
}

export function TaskComposerInput({
  attachments,
  busy,
  disabled,
  rows = 2,
  submitTitle = '发送',
  onAttachmentsChange,
  onSubmit,
  ...props
}: TaskComposerInputProps) {
  const composerProps: ComposerDisplayProps = {
    ...props,
    busy,
    disabled,
    rows,
    submitTitle,
  };
  return (
    <form onSubmit={onSubmit} className="min-w-0">
      <ImageAttachmentPicker
        attachments={attachments}
        disabled={disabled || busy}
        onChange={onAttachmentsChange}
      >
        {(controls) => (
          <ComposerContent
            controls={controls}
            {...composerProps}
            onSubmitShortcut={(form) => {
              if (!composerProps.submitDisabled && !composerProps.runningRun) {
                form?.requestSubmit();
              }
            }}
          />
        )}
      </ImageAttachmentPicker>
    </form>
  );
}
