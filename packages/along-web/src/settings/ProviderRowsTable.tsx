import type { ProviderRow } from './types';

interface ProviderRowsTableProps {
  rows: ProviderRow[];
  loading: boolean;
  saving: boolean;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<ProviderRow>) => void;
  onRemove: (id: string) => void;
}

interface ProviderRowEditorProps
  extends Omit<ProviderRowsTableProps, 'rows' | 'onAdd'> {
  row: ProviderRow;
}

function ProviderHeader({
  disabled,
  onAdd,
}: {
  disabled: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="px-4 py-3 border-b border-border-color flex items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-text-secondary">Providers</h3>
        <p className="text-xs text-text-muted mt-1">
          Token 仅在保存时提交，已配置 token 不会回显。
        </p>
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        className="px-3 py-2 rounded-lg text-xs font-semibold border border-border-color hover:bg-white/5 disabled:opacity-50"
      >
        新增
      </button>
    </div>
  );
}

function TextInput({
  value,
  disabled,
  placeholder,
  className,
  onChange,
}: {
  value: string;
  disabled: boolean;
  placeholder?: string;
  className: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={`bg-black/35 border border-border-color rounded-lg px-2 py-1.5 outline-none focus:ring-1 focus:ring-brand/60 disabled:opacity-60 ${className}`}
    />
  );
}

function ProviderRowEditor({
  row,
  loading,
  saving,
  onUpdate,
  onRemove,
}: ProviderRowEditorProps) {
  const disabled = loading || saving;
  return (
    <tr className="border-t border-border-color">
      <td className="px-3 py-2">
        <TextInput
          value={row.id}
          disabled={disabled || row.id === 'deepseek'}
          className="w-36"
          onChange={(value) => onUpdate(row.id, { id: value })}
        />
      </td>
      <td className="px-3 py-2">
        <TextInput
          value={row.name}
          disabled={disabled}
          className="w-36"
          onChange={(value) => onUpdate(row.id, { name: value })}
        />
      </td>
      <ProviderEndpointCells
        row={row}
        disabled={disabled}
        onUpdate={onUpdate}
      />
      <td className="px-3 py-2 text-right">
        <button
          type="button"
          onClick={() => onRemove(row.id)}
          disabled={disabled || row.id === 'deepseek'}
          className="px-2 py-1.5 rounded-lg text-xs border border-border-color text-red-300 hover:bg-red-500/10 disabled:opacity-50"
        >
          删除
        </button>
      </td>
    </tr>
  );
}

function ProviderEndpointCells({
  row,
  disabled,
  onUpdate,
}: {
  row: ProviderRow;
  disabled: boolean;
  onUpdate: (id: string, patch: Partial<ProviderRow>) => void;
}) {
  const tokenPlaceholder = row.tokenConfigured
    ? `已配置 ${row.tokenPreview}`
    : '输入 token';
  return (
    <>
      <td className="px-3 py-2">
        <TextInput
          value={row.baseUrl}
          disabled={disabled}
          className="w-64"
          onChange={(value) => onUpdate(row.id, { baseUrl: value })}
        />
      </td>
      <td className="px-3 py-2">
        <textarea
          value={row.modelsText}
          disabled={disabled}
          rows={2}
          onChange={(event) =>
            onUpdate(row.id, { modelsText: event.target.value })
          }
          className="w-52 bg-black/35 border border-border-color rounded-lg px-2 py-1.5 outline-none resize-none focus:ring-1 focus:ring-brand/60 disabled:opacity-60"
        />
      </td>
      <td className="px-3 py-2">
        <TextInput
          value={row.token}
          disabled={disabled}
          placeholder={tokenPlaceholder}
          className="w-48"
          onChange={(value) => onUpdate(row.id, { token: value })}
        />
      </td>
    </>
  );
}

export function ProviderRowsTable({
  rows,
  loading,
  saving,
  onAdd,
  onUpdate,
  onRemove,
}: ProviderRowsTableProps) {
  const disabled = loading || saving;
  return (
    <section className="rounded-lg border border-border-color overflow-hidden bg-black/20">
      <ProviderHeader disabled={disabled} onAdd={onAdd} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white/5 text-text-muted">
            <tr>
              {['Provider', 'Name', 'Base URL', 'Models', 'Token', ''].map(
                (label) => (
                  <th key={label} className="text-left font-medium px-3 py-2">
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <ProviderRowEditor
                key={row.id}
                row={row}
                loading={loading}
                saving={saving}
                onUpdate={onUpdate}
                onRemove={onRemove}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
