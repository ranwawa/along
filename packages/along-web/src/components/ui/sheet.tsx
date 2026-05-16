import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import {
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  useState,
} from 'react';
import { cn } from '../../lib/utils';

const LABELS = { resizeHandle: '调整抽屉宽度', close: '关闭' } as const;

export const Sheet = DialogPrimitive.Root;

type SheetResizeOptions = {
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  minMainWidth: number;
};

export function clampSheetWidth(
  width: number,
  options: Pick<SheetResizeOptions, 'minWidth' | 'maxWidth' | 'minMainWidth'>,
  viewportWidth = typeof window === 'undefined'
    ? Number.POSITIVE_INFINITY
    : window.innerWidth,
) {
  const viewportMax = Math.max(
    options.minWidth,
    viewportWidth - options.minMainWidth,
  );
  return Math.min(
    Math.max(width, options.minWidth),
    options.maxWidth,
    viewportMax,
  );
}

function getSheetResizeStyle(
  width: number | undefined,
  resizable: SheetResizeOptions | undefined,
) {
  if (!resizable) return undefined;

  return {
    '--sheet-width': `${clampSheetWidth(width ?? resizable.defaultWidth, resizable)}px`,
    '--sheet-min-width': `${resizable.minWidth}px`,
    '--sheet-max-width': `min(${resizable.maxWidth}px, calc(100vw - ${resizable.minMainWidth}px))`,
  } as CSSProperties;
}

function SheetResizeHandle({
  resizable,
  onWidthChange,
}: {
  resizable: SheetResizeOptions;
  onWidthChange: (width: number) => void;
}) {
  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (event.buttons !== 1) return;

    onWidthChange(
      clampSheetWidth(window.innerWidth - event.clientX, resizable),
    );
  }

  return (
    <button
      type="button"
      aria-label={LABELS.resizeHandle}
      className="absolute inset-y-0 left-0 hidden w-3 -translate-x-1/2 cursor-col-resize touch-none md:block"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
    />
  );
}

export function SheetContent({
  title,
  children,
  className,
  showOverlay = true,
  resizable,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  showOverlay?: boolean;
  resizable?: SheetResizeOptions;
}) {
  const [width, setWidth] = useState(resizable?.defaultWidth);
  const sheetStyle = getSheetResizeStyle(width, resizable);

  const content = (
    <>
      {showOverlay && (
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
      )}
      <DialogPrimitive.Content
        data-resizable-sheet={resizable ? 'true' : undefined}
        style={sheetStyle}
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-[1280px] flex-col border-l border-border-color bg-bg-secondary shadow-2xl focus:outline-none',
          !resizable && 'md:w-[88vw] xl:w-[82vw]',
          resizable &&
            'md:w-[var(--sheet-width)] md:min-w-[var(--sheet-min-width)] md:max-w-[var(--sheet-max-width)]',
          className,
        )}
      >
        {resizable && (
          <SheetResizeHandle resizable={resizable} onWidthChange={setWidth} />
        )}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-color p-4 md:p-6">
          <DialogPrimitive.Title className="min-w-0 truncate text-base font-bold md:text-xl">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close className="shrink-0 rounded-lg p-2 text-text-secondary transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-1 focus:ring-brand/60">
            <X aria-hidden="true" className="h-4 w-4" />
            <span className="sr-only">{LABELS.close}</span>
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </>
  );

  if (typeof document === 'undefined') return content;

  return <DialogPrimitive.Portal>{content}</DialogPrimitive.Portal>;
}
