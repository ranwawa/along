import {
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';

const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGE_COUNT = 6;
const MAX_SINGLE_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 30 * 1024 * 1024;

function formatFileSize(bytes: number): string {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10}MB`;
}

function validateImageFiles(existing: File[], incoming: File[]) {
  const next = [...existing];
  for (const file of incoming) {
    if (!IMAGE_MIME_TYPES.includes(file.type)) {
      return { files: existing, error: '只支持 PNG、JPEG、WebP 或 GIF 图片' };
    }
    if (file.size <= 0) return { files: existing, error: '不能上传空图片' };
    if (file.size > MAX_SINGLE_IMAGE_BYTES) {
      return {
        files: existing,
        error: `单张图片不能超过 ${formatFileSize(MAX_SINGLE_IMAGE_BYTES)}`,
      };
    }
    if (next.length >= MAX_IMAGE_COUNT) {
      return {
        files: existing,
        error: `单次最多上传 ${MAX_IMAGE_COUNT} 张图片`,
      };
    }
    next.push(file);
  }
  const totalSize = next.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > MAX_TOTAL_IMAGE_BYTES) {
    return {
      files: existing,
      error: `单次图片总大小不能超过 ${formatFileSize(MAX_TOTAL_IMAGE_BYTES)}`,
    };
  }
  return { files: next, error: null };
}

function ImageAttachmentThumb({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return (
    <div className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border-color bg-black/25">
      {url && (
        <img
          src={url}
          alt="待发送图片"
          className="h-full w-full object-cover"
        />
      )}
      <button
        type="button"
        aria-label="删除图片"
        onClick={onRemove}
        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-border-color bg-black/70 text-text-primary opacity-0 transition-opacity hover:bg-black focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-brand/70 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <span aria-hidden="true" className="text-base leading-none">
          ×
        </span>
      </button>
    </div>
  );
}

function ImageAttachmentList({
  attachments,
  onChange,
}: {
  attachments: File[];
  onChange: (files: File[]) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((file) => (
        <ImageAttachmentThumb
          key={`${file.name}-${file.size}-${file.lastModified}`}
          file={file}
          onRemove={() => onChange(attachments.filter((item) => item !== file))}
        />
      ))}
    </div>
  );
}

function DefaultImageAttachmentActions({
  attachments,
  disabled,
  inputRef,
}: Pick<ImageAttachmentPickerProps, 'attachments' | 'disabled'> & {
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={disabled || attachments.length >= MAX_IMAGE_COUNT}
        onClick={() => inputRef.current?.click()}
        className="rounded-lg border border-border-color bg-black/25 px-3 py-2 text-xs font-semibold text-text-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
      >
        图片
      </button>
      <span className="text-[11px] text-text-muted">
        {attachments.length}/{MAX_IMAGE_COUNT}
      </span>
    </div>
  );
}

export interface ImageAttachmentPickerRenderProps {
  canAdd: boolean;
  count: number;
  error: ReactNode;
  maxCount: number;
  openPicker: () => void;
  previews: ReactNode;
}

function HiddenImageInput({
  inputRef,
  onFileChange,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={IMAGE_MIME_TYPES.join(',')}
      multiple
      className="hidden"
      onChange={onFileChange}
    />
  );
}

function useImageAttachmentInput({
  attachments,
  onChange,
}: Pick<ImageAttachmentPickerProps, 'attachments' | 'onChange'>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const addFiles = (files: File[]) => {
    const result = validateImageFiles(attachments, files);
    setError(result.error);
    onChange(result.files);
  };
  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(event.target.files || []));
    event.target.value = '';
  };
  return { addFiles, error, inputRef, onFileChange };
}

function buildPickerRenderProps({
  attachments,
  canAdd,
  error,
  onChange,
  openPicker,
}: {
  attachments: File[];
  canAdd: boolean;
  error: string | null;
  onChange: (files: File[]) => void;
  openPicker: () => void;
}): ImageAttachmentPickerRenderProps {
  return {
    canAdd,
    count: attachments.length,
    error: error ? (
      <div className="text-xs text-status-error">{error}</div>
    ) : null,
    maxCount: MAX_IMAGE_COUNT,
    openPicker,
    previews: (
      <ImageAttachmentList attachments={attachments} onChange={onChange} />
    ),
  };
}

function DefaultImageAttachmentPickerContent({
  attachments,
  disabled,
  inputRef,
  renderProps,
}: Pick<ImageAttachmentPickerProps, 'attachments' | 'disabled'> & {
  inputRef: RefObject<HTMLInputElement | null>;
  renderProps: ImageAttachmentPickerRenderProps;
}) {
  return (
    <>
      <DefaultImageAttachmentActions
        attachments={attachments}
        disabled={disabled}
        inputRef={inputRef}
      />
      {renderProps.previews}
      {renderProps.error}
    </>
  );
}

function useImageAttachmentDrop(
  disabled: boolean | undefined,
  addFiles: (files: File[]) => void,
) {
  return (event: DragEvent<HTMLFieldSetElement>) => {
    event.preventDefault();
    if (disabled) return;
    addFiles(Array.from(event.dataTransfer.files));
  };
}

export function ImageAttachmentPicker({
  attachments,
  children,
  disabled,
  onChange,
}: ImageAttachmentPickerProps) {
  const { addFiles, error, inputRef, onFileChange } = useImageAttachmentInput({
    attachments,
    onChange,
  });
  const onDrop = useImageAttachmentDrop(disabled, addFiles);
  const canAdd = !disabled && attachments.length < MAX_IMAGE_COUNT;
  const openPicker = () => {
    if (canAdd) inputRef.current?.click();
  };
  const renderProps = buildPickerRenderProps({
    attachments,
    canAdd,
    error,
    onChange,
    openPicker,
  });
  return (
    <fieldset
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className="flex flex-col gap-2"
    >
      <HiddenImageInput inputRef={inputRef} onFileChange={onFileChange} />
      <legend className="sr-only">图片附件</legend>
      {children ? (
        children(renderProps)
      ) : (
        <DefaultImageAttachmentPickerContent
          attachments={attachments}
          disabled={disabled}
          inputRef={inputRef}
          renderProps={renderProps}
        />
      )}
    </fieldset>
  );
}
interface ImageAttachmentPickerProps {
  attachments: File[];
  children?: (props: ImageAttachmentPickerRenderProps) => ReactNode;
  disabled?: boolean;
  onChange: (files: File[]) => void;
}
