// biome-ignore-all lint/style/noJsxLiterals: shared UI close control uses the existing Chinese dashboard label.
import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../../lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({
  className,
  children,
  title,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  title: ReactNode;
}) {
  const content = (
    <>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />
      <DialogPrimitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[86vh] w-[calc(100vw-1.5rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border-color bg-bg-secondary shadow-xl focus:outline-none sm:w-[calc(100vw-2rem)]',
          className,
        )}
        {...props}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-color px-4 py-3">
          <DialogPrimitive.Title className="min-w-0 truncate text-sm font-semibold text-text-secondary">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close className="shrink-0 rounded-md border border-border-color px-2 py-1 text-xs font-semibold text-text-secondary hover:bg-white/5 focus:outline-none focus:ring-1 focus:ring-brand/60">
            关闭
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </>
  );

  if (typeof document === 'undefined') return content;

  return <DialogPrimitive.Portal>{content}</DialogPrimitive.Portal>;
}
