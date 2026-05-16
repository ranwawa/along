import type { FormEvent } from 'react';
import type {
  TaskAgentRunRecord,
  TaskExecutionMode,
  TaskRuntimeExecutionMode,
  TaskWorkspaceMode,
} from '../types-task';
import { ComposerActionRow } from './TaskComposerActions';
import { ComposerTextarea } from './TaskComposerTextarea';
import {
  ImageAttachmentPicker,
  type ImageAttachmentPickerRenderProps,
} from './TaskImageAttachments';

const DEFAULT_ROWS = 2;
const DEFAULT_SUBMIT_TITLE = '发送';

export interface TaskComposerInputProps {
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
  rows = DEFAULT_ROWS,
  submitTitle = DEFAULT_SUBMIT_TITLE,
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
