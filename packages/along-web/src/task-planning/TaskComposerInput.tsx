// biome-ignore-all lint/style/noJsxLiterals: existing composer controls use inline UI labels.
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import type { TaskAgentRunRecord, TaskExecutionMode } from '../types-task';
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
  placeholder: string;
  rows?: number;
  runningRun?: TaskAgentRunRecord | null;
  submitDisabled: boolean;
  submitTitle?: string;
  onCancelAgentRun?: (runId?: string) => void;
  onAttachmentsChange: (files: File[]) => void;
  onBodyChange: (value: string) => void;
  onExecutionModeChange: (value: TaskExecutionMode) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

type ComposerDisplayProps = Omit<
  TaskComposerInputProps,
  'attachments' | 'onAttachmentsChange' | 'onSubmit'
>;

function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.8"
    >
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
    >
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <path d="m6 13 3-3 2 2 2-3 3 4" />
      <circle cx="8" cy="8" r="1" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      <path d="m3 10 14-7-4 14-3-6-7-1Z" />
      <path d="m10 11 7-8" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 animate-spin rounded-full border-2 border-white/45 border-t-white motion-reduce:animate-none"
    />
  );
}

function isTaskExecutionMode(value: string): value is TaskExecutionMode {
  return value === 'manual' || value === 'autonomous';
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
  const [isOpen, setIsOpen] = useState(false);
  const isDisabled = disabled || !canAdd;
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label="添加附件"
        aria-expanded={isOpen}
        disabled={isDisabled}
        title={
          count >= maxCount ? `单次最多上传 ${maxCount} 张图片` : '添加附件'
        }
        onClick={() => setIsOpen((value) => !value)}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-color bg-black/25 text-text-secondary transition-colors hover:text-text-primary focus:outline-none focus:ring-1 focus:ring-brand/70 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <PlusIcon />
      </button>
      {isOpen && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-36 rounded-lg border border-border-color bg-bg-secondary p-1 shadow-xl">
          <button
            type="button"
            disabled={isDisabled}
            onClick={() => {
              openPicker();
              setIsOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-black/30 hover:text-text-primary focus:bg-black/30 focus:text-text-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ImageIcon />
            <span>图片</span>
          </button>
        </div>
      )}
    </div>
  );
}

function ComposerTextarea({
  body,
  busy,
  disabled,
  placeholder,
  rows,
  runningRun,
  onBodyChange,
  onSubmitShortcut,
}: Pick<
  TaskComposerInputProps,
  | 'body'
  | 'busy'
  | 'disabled'
  | 'placeholder'
  | 'rows'
  | 'runningRun'
  | 'onBodyChange'
> & {
  onSubmitShortcut: (form: HTMLFormElement | null) => void;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    if (event.ctrlKey || event.altKey || event.shiftKey || runningRun) return;
    event.preventDefault();
    onSubmitShortcut(event.currentTarget.form);
  };
  return (
    <textarea
      value={body}
      onChange={(event) => onBodyChange(event.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      rows={rows}
      disabled={disabled || busy}
      className="min-w-0 resize-none rounded-lg border border-border-color bg-black/35 px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-brand/60 disabled:opacity-50"
    />
  );
}

function ExecutionModeSelect({
  busy,
  disabled,
  executionMode,
  onExecutionModeChange,
}: Pick<
  TaskComposerInputProps,
  'busy' | 'disabled' | 'executionMode' | 'onExecutionModeChange'
>) {
  return (
    <label className="min-w-0 shrink text-xs text-text-muted">
      <span className="sr-only">执行模式</span>
      <select
        value={executionMode}
        disabled={disabled || busy}
        onChange={(event) => {
          const value = event.target.value;
          if (isTaskExecutionMode(value)) onExecutionModeChange(value);
        }}
        className="h-9 max-w-[132px] rounded-lg border border-border-color bg-black/25 px-3 text-sm text-text-primary outline-none focus:ring-1 focus:ring-brand/60 disabled:opacity-50"
      >
        <option value="manual">人工确认</option>
        <option value="autonomous">全自动</option>
      </select>
    </label>
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
    <button
      type={isCancelling ? 'button' : 'submit'}
      aria-label={isCancelling ? '中断当前 Agent' : busy ? '发送中' : '发送'}
      title={isCancelling ? '中断当前 Agent' : busy ? '发送中' : submitTitle}
      disabled={submitDisabled || busy}
      onClick={() => {
        if (runningRun) onCancelAgentRun?.(runningRun.runId);
      }}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-brand bg-brand text-white transition-colors hover:bg-brand-hover focus:outline-none focus:ring-1 focus:ring-brand/70 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isCancelling ? <SpinnerIcon /> : busy ? <SpinnerIcon /> : <SendIcon />}
    </button>
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
      <ExecutionModeSelect {...props} />
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
