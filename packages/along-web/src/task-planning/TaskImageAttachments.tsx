import {
  type ChangeEvent,
  type DragEvent,
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
    <div className="flex h-16 min-w-0 items-center gap-2 rounded-lg border border-border-color bg-black/25 p-2">
      {url && (
        <img
          src={url}
          alt={file.name}
          className="h-12 w-12 shrink-0 rounded object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs text-text-secondary">{file.name}</div>
        <div className="text-[11px] text-text-muted">
          {formatFileSize(file.size)}
        </div>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 rounded border border-border-color px-2 py-1 text-[11px] text-text-muted hover:text-text-primary"
      >
        删除
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
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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

function ImageAttachmentActions({
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
        添加图片
      </button>
      <span className="text-[11px] text-text-muted">
        {attachments.length}/{MAX_IMAGE_COUNT}
      </span>
    </div>
  );
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

export function ImageAttachmentPicker({
  attachments,
  disabled,
  onChange,
}: ImageAttachmentPickerProps) {
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
  const onDrop = (event: DragEvent<HTMLFieldSetElement>) => {
    event.preventDefault();
    if (disabled) return;
    addFiles(Array.from(event.dataTransfer.files));
  };
  return (
    <fieldset
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      className="flex flex-col gap-2"
    >
      <HiddenImageInput inputRef={inputRef} onFileChange={onFileChange} />
      <legend className="sr-only">图片附件</legend>
      <ImageAttachmentActions
        attachments={attachments}
        disabled={disabled}
        inputRef={inputRef}
      />
      <ImageAttachmentList attachments={attachments} onChange={onChange} />
      {error && <div className="text-xs text-status-error">{error}</div>}
    </fieldset>
  );
}
interface ImageAttachmentPickerProps {
  attachments: File[];
  disabled?: boolean;
  onChange: (files: File[]) => void;
}
