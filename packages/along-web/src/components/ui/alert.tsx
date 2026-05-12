import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type AlertVariant = 'error' | 'success' | 'warning';

const variantClass: Record<AlertVariant, string> = {
  error: 'border-red-500/30 bg-red-500/10 text-red-300',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  warning: 'border-amber-500/25 bg-amber-500/10 text-amber-200',
};

export function Alert({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLDivElement> & { variant: AlertVariant }) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2 text-sm',
        variantClass[variant],
        className,
      )}
      {...props}
    />
  );
}
