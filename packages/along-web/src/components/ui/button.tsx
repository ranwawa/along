import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type ButtonVariant =
  | 'default'
  | 'destructive'
  | 'ghost'
  | 'outline'
  | 'softDanger'
  | 'softPrimary'
  | 'tab';
type ButtonSize = 'default' | 'icon' | 'sm' | 'xs';

const variantClass: Record<ButtonVariant, string> = {
  default:
    'border border-brand bg-brand text-white hover:bg-brand-hover focus:ring-brand/70',
  destructive:
    'border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/25 focus:ring-red-500/50',
  ghost:
    'border border-transparent text-text-secondary hover:bg-white/5 hover:text-text-primary focus:ring-brand/60',
  outline:
    'border border-border-color text-text-secondary hover:bg-white/5 focus:ring-brand/60',
  softDanger:
    'border border-transparent bg-white/5 text-text-secondary hover:bg-red-500/20 hover:text-red-300 focus:ring-red-500/50',
  softPrimary:
    'border border-blue-500/30 bg-blue-500/10 text-status-running hover:bg-blue-500/25 focus:ring-blue-500/50',
  tab: 'border border-border-color bg-transparent text-text-secondary hover:bg-white/5 focus:ring-brand/60',
};

const sizeClass: Record<ButtonSize, string> = {
  default: 'h-9 px-3 text-sm',
  icon: 'h-9 w-9 p-0',
  sm: 'h-8 px-3 text-xs',
  xs: 'px-2 py-1 text-xs',
};

export function Button({
  className,
  variant = 'outline',
  size = 'default',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-semibold transition-colors focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-50',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...props}
    />
  );
}
