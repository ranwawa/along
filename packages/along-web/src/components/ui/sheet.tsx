// biome-ignore-all lint/style/noJsxLiterals: shared sheet close control uses the existing dashboard close label.
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export const Sheet = DialogPrimitive.Root;

export function SheetContent({
  title,
  children,
  className,
  showOverlay = true,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  showOverlay?: boolean;
}) {
  const content = (
    <>
      {showOverlay && (
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
      )}
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-[1280px] flex-col border-l border-border-color bg-bg-secondary shadow-2xl focus:outline-none md:w-[88vw] xl:w-[82vw]',
          className,
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-color p-4 md:p-6">
          <DialogPrimitive.Title className="min-w-0 truncate text-base font-bold md:text-xl">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close className="shrink-0 rounded-lg p-2 text-text-secondary transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus:ring-1 focus:ring-brand/60">
            <X aria-hidden="true" className="h-4 w-4" />
            <span className="sr-only">关闭</span>
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </>
  );

  if (typeof document === 'undefined') return content;

  return <DialogPrimitive.Portal>{content}</DialogPrimitive.Portal>;
}
