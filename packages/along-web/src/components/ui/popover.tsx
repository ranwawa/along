import * as PopoverPrimitive from '@radix-ui/react-popover';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../../lib/utils';

export const Popover = PopoverPrimitive.Root;
export const PopoverClose = PopoverPrimitive.Close;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  align = 'start',
  className,
  side = 'top',
  sideOffset = 8,
  ...props
}: ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        side={side}
        sideOffset={sideOffset}
        className={cn(
          'z-50 rounded-lg border border-border-color bg-bg-secondary p-1 shadow-xl focus:outline-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
