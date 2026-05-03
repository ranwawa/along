import type { ConversationFileInfo, ConversationMessage } from '../types';

function getTextContent(msg: ConversationMessage): string[] {
  return (msg.message?.content || [])
    .filter((item) => item.type === 'text' && item.text)
    .map((item) => item.text || '');
}

function getMessageKey(msg: ConversationMessage): string {
  return [
    msg.session_id || '',
    msg.type,
    msg.subtype || '',
    msg.tool_name || '',
    getTextContent(msg).join('\n').slice(0, 120),
    msg.num_turns || '',
    msg.total_cost_usd || '',
  ].join(':');
}

function ConversationMessageItem({
  msg,
  index,
}: {
  msg: ConversationMessage;
  index: number;
}) {
  if (msg.type === 'assistant') {
    const texts = getTextContent(msg);
    if (texts.length === 0) return null;
    return (
      <div
        key={`conv-${index}`}
        className="p-2 rounded bg-blue-500/10 border border-blue-500/20 whitespace-pre-wrap break-all"
      >
        <span className="text-blue-300 font-semibold text-xs mr-2">
          [assistant]
        </span>
        <span>{texts.join('\n')}</span>
      </div>
    );
  }
  if (msg.type === 'user') {
    const texts = getTextContent(msg);
    return (
      <div
        key={`conv-${index}`}
        className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20 whitespace-pre-wrap break-all"
      >
        <span className="text-emerald-300 font-semibold text-xs mr-2">
          [user]
        </span>
        <span>{texts.join('\n') || JSON.stringify(msg.message?.content)}</span>
      </div>
    );
  }
  if (msg.type === 'result') {
    const cost =
      typeof msg.total_cost_usd === 'number'
        ? `$${msg.total_cost_usd.toFixed(4)}`
        : '';
    const turns = msg.num_turns || '';
    return (
      <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20">
        <span className="text-amber-300 font-semibold text-xs mr-2">
          [result]
        </span>
        <span>
          {msg.subtype || 'done'} {turns ? `(${turns} turns` : ''}
          {cost ? `, ${cost})` : turns ? ')' : ''}
        </span>
      </div>
    );
  }
  if (msg.type === 'tool_use_summary') {
    return (
      <div className="p-2 rounded bg-purple-500/10 border border-purple-500/20">
        <span className="text-purple-300 font-semibold text-xs mr-2">
          [tool]
        </span>
        <span className="text-gray-300">{msg.tool_name || 'unknown'}</span>
        {msg.tool_input && (
          <span className="text-text-muted ml-2 text-xs">
            {String(msg.tool_input).slice(0, 200)}
          </span>
        )}
      </div>
    );
  }
  return (
    <div className="p-1.5 rounded bg-white/5 text-text-muted text-xs">
      <span className="font-semibold mr-2">
        [{msg.type}
        {msg.subtype ? `:${msg.subtype}` : ''}]
      </span>
      <span>{JSON.stringify(msg).slice(0, 300)}</span>
    </div>
  );
}

export function ConversationLog({
  files,
  activeFile,
  messages,
  loading,
  onSelectFile,
}: {
  files: ConversationFileInfo[];
  activeFile: string | null;
  messages: ConversationMessage[];
  loading: boolean;
  onSelectFile: (filename: string) => void;
}) {
  if (files.length === 0 && !loading) {
    return <div className="p-4 text-text-muted">No conversation logs yet.</div>;
  }

  return (
    <div className="flex flex-col h-full gap-2">
      {files.length > 1 && (
        <div className="flex gap-1.5 flex-wrap shrink-0">
          {files.map((file) => (
            <button
              type="button"
              key={file.filename}
              className={`px-2 py-1 rounded text-xs border transition-all cursor-pointer ${
                activeFile === file.filename
                  ? 'bg-white/10 text-white border-border-color'
                  : 'bg-transparent text-text-secondary border-transparent hover:bg-white/5'
              }`}
              onClick={() => onSelectFile(file.filename)}
            >
              {file.phase}/{file.workflow}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-1.5">
        {loading ? (
          <div className="p-4 text-text-muted">Loading conversation...</div>
        ) : messages.length === 0 ? (
          <div className="p-4 text-text-muted">No messages in this file.</div>
        ) : (
          messages.map((msg, index) => (
            <ConversationMessageItem
              key={getMessageKey(msg)}
              msg={msg}
              index={index}
            />
          ))
        )}
      </div>
    </div>
  );
}
