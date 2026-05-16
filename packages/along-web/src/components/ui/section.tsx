import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button';

const LABELS = { add: '新增' } as const;

export function Section({
  title,
  count,
  disabled,
  onAdd,
  children,
}: {
  title: string;
  count?: number;
  disabled?: boolean;
  onAdd?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border-color bg-black/25">
      <div className="flex items-center justify-between gap-3 border-b border-border-color px-4 py-3">
        <div className="text-sm font-semibold text-text-secondary">
          {title}
          {count != null && (
            <span className="ml-2 text-xs font-normal text-text-muted">
              {count}
            </span>
          )}
        </div>
        {onAdd && (
          <Button
            type="button"
            size="sm"
            onClick={onAdd}
            disabled={disabled}
            className="gap-1.5"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            {LABELS.add}
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}

export function EmptyRows({ label }: { label: string }) {
  return <div className="px-4 py-5 text-sm text-text-muted">{label}</div>;
}
