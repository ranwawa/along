import { Image, X } from 'lucide-react';
import {
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Button } from '../components/ui/button';

const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGE_COUNT = 6;
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = BYTES_PER_KB * BYTES_PER_KB;
const MAX_SINGLE_IMAGE_MB = 10;
const MAX_TOTAL_IMAGE_MB = 30;
const MAX_SINGLE_IMAGE_BYTES = MAX_SINGLE_IMAGE_MB * BYTES_PER_MB;
const MAX_TOTAL_IMAGE_BYTES = MAX_TOTAL_IMAGE_MB * BYTES_PER_MB;

const LABELS = {
  onlyImageTypes: '只支持 PNG、JPEG、WebP 或 GIF 图片',
  emptyImage: '不能上传空图片',
  singleTooLarge: (size: string) => `单张图片不能超过 ${size}`,
  tooManyImages: (max: number) => `单次最多上传 ${max} 张图片`,
  totalTooLarge: (size: string) => `单次图片总大小不能超过 ${size}`,
  pendingImageAlt: '待发送图片',
  removeImage: '删除图片',
  addAttachment: '添加附件',
  addAttachmentTitle: (max: number) => `单次最多上传 ${max} 张图片`,
  imageLabel: '图片',
  imageAttachments: '图片附件',
} as const;

const FORMAT_PRECISION = 10;

function formatFileSize(bytes: number): string {
  return `${Math.round((bytes / BYTES_PER_MB) * FORMAT_PRECISION) / FORMAT_PRECISION}MB`;
}

function validateImageFiles(existing: File[], incoming: File[]) {
  const next = [...existing];
  for (const file of incoming) {
    if (!IMAGE_MIME_TYPES.includes(file.type)) {
      return { files: existing, error: LABELS.onlyImageTypes };
    }
    if (file.size <= 0) return { files: existing, error: LABELS.emptyImage };
    if (file.size > MAX_SINGLE_IMAGE_BYTES) {
      return {
        files: existing,
        error: LABELS.singleTooLarge(formatFileSize(MAX_SINGLE_IMAGE_BYTES)),
      };
    }
    if (next.length >= MAX_IMAGE_COUNT) {
      return {
        files: existing,
        error: LABELS.tooManyImages(MAX_IMAGE_COUNT),
      };
    }
    next.push(file);
  }
  const totalSize = next.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > MAX_TOTAL_IMAGE_BYTES) {
    return {
      files: existing,
      error: LABELS.totalTooLarge(formatFileSize(MAX_TOTAL_IMAGE_BYTES)),
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
          alt={LABELS.pendingImageAlt}
          className="h-full w-full object-cover"
        />
      )}
      <Button
        type="button"
        aria-label={LABELS.removeImage}
        onClick={onRemove}
        size="icon"
        className="absolute right-1 top-1 h-6 w-6 rounded-full bg-black/70 text-text-primary opacity-0 hover:bg-black focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </Button>
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
      <Button
        type="button"
        disabled={disabled || attachments.length >= MAX_IMAGE_COUNT}
        onClick={() => inputRef.current?.click()}
        size="sm"
        className="gap-1.5 bg-black/25 hover:text-text-primary"
      >
        <Image aria-hidden="true" className="h-4 w-4" />
        {LABELS.imageLabel}
      </Button>
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
      <legend className="sr-only">{LABELS.imageAttachments}</legend>
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
