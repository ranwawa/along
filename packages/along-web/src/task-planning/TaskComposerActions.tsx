import { Image, LoaderCircle, Paperclip, Send } from 'lucide-react';
import { Button } from '../components/ui/button';
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
import type { ImageAttachmentPickerRenderProps } from './TaskImageAttachments';

const LABELS = {
  addAttachment: '添加附件',
  addAttachmentMaxTitle: (max: number) => `单次最多上传 ${max} 张图片`,
  imageOption: '图片',
  autoMode: '自动模式',
  executionLocation: '执行位置',
  worktree: 'worktree',
  defaultBranch: '默认分支',
  cancelAgent: '中断当前 Agent',
  sending: '发送中',
} as const;

type ComposerActionProps = {
  busy?: boolean;
  disabled?: boolean;
  executionMode: TaskExecutionMode;
  runtimeExecutionMode: TaskRuntimeExecutionMode;
  workspaceMode?: TaskWorkspaceMode;
  runningRun?: TaskAgentRunRecord | null;
  submitDisabled: boolean;
  submitTitle?: string;
  onCancelAgentRun?: (runId?: string) => void;
  onExecutionModeChange: (value: TaskExecutionMode) => void;
  onRuntimeExecutionModeChange: (value: TaskRuntimeExecutionMode) => void;
  onWorkspaceModeChange?: (value: TaskWorkspaceMode) => void;
};

function AttachmentPickerButton({
  isDisabled,
  openPicker,
}: {
  isDisabled: boolean;
  openPicker: () => void;
}) {
  return (
    <PopoverClose asChild={true}>
      <button
        type="button"
        disabled={isDisabled}
        onClick={openPicker}
        className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-black/30 hover:text-text-primary focus:bg-black/30 focus:text-text-primary focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Image aria-hidden="true" className="h-4 w-4" />
        <span>{LABELS.imageOption}</span>
      </button>
    </PopoverClose>
  );
}

export function AttachmentPopover({
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
          aria-label={LABELS.addAttachment}
          disabled={isDisabled}
          title={
            count >= maxCount
              ? LABELS.addAttachmentMaxTitle(maxCount)
              : LABELS.addAttachment
          }
          size="icon"
          className="bg-black/25 hover:text-text-primary"
        >
          <Paperclip aria-hidden="true" className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-36">
        <AttachmentPickerButton
          isDisabled={isDisabled}
          openPicker={openPicker}
        />
      </PopoverContent>
    </Popover>
  );
}

export function AutomaticModeCheckbox({
  busy,
  disabled,
  executionMode,
  onExecutionModeChange,
}: Pick<
  ComposerActionProps,
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
      <span>{LABELS.autoMode}</span>
    </label>
  );
}

export function WorkspaceModeSelect({
  busy,
  disabled,
  workspaceMode,
  onWorkspaceModeChange,
}: Pick<
  ComposerActionProps,
  'busy' | 'disabled' | 'workspaceMode' | 'onWorkspaceModeChange'
>) {
  if (!onWorkspaceModeChange) return null;
  return (
    <select
      aria-label={LABELS.executionLocation}
      value={workspaceMode || 'worktree'}
      disabled={disabled || busy}
      onChange={(event) =>
        onWorkspaceModeChange(event.target.value as TaskWorkspaceMode)
      }
      className="h-9 shrink-0 rounded-lg border border-border-color bg-black/25 px-3 text-sm text-text-secondary outline-none focus:ring-1 focus:ring-brand/60 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <option value="worktree">{LABELS.worktree}</option>
      <option value="default_branch">{LABELS.defaultBranch}</option>
    </select>
  );
}

export function SubmitIconButton({
  busy,
  runningRun,
  submitDisabled,
  submitTitle,
  onCancelAgentRun,
}: Pick<
  ComposerActionProps,
  'busy' | 'runningRun' | 'submitDisabled' | 'submitTitle' | 'onCancelAgentRun'
>) {
  const isCancelling = Boolean(runningRun);
  const ariaLabel = isCancelling ? LABELS.cancelAgent : LABELS.sending;
  const title = isCancelling
    ? LABELS.cancelAgent
    : busy
      ? LABELS.sending
      : submitTitle;
  return (
    <Button
      type={isCancelling ? 'button' : 'submit'}
      aria-label={ariaLabel}
      title={title}
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

export function ComposerActionRow({
  controls,
  ...props
}: ComposerActionProps & {
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
