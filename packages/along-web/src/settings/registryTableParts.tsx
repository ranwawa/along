// biome-ignore-all lint/style/noJsxLiterals: settings table uses compact inline labels.
import type { ReactNode } from 'react';
import { Button } from '../components/ui/button';
import {
  EmptyRows as UiEmptyRows,
  Section as UiSection,
} from '../components/ui/section';

export function optional(value: string): string | undefined {
  return value.trim() || undefined;
}

export function Section({
  title,
  count,
  disabled,
  onAdd,
  children,
}: {
  title: string;
  count: number;
  disabled: boolean;
  onAdd: () => void;
  children: ReactNode;
}) {
  return (
    <UiSection title={title} count={count} disabled={disabled} onAdd={onAdd}>
      {children}
    </UiSection>
  );
}

export function DeleteButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button type="button" onClick={onClick} disabled={disabled} size="sm">
      删除
    </Button>
  );
}

export function EmptyRows({ label }: { label: string }) {
  return <UiEmptyRows label={label} />;
}
