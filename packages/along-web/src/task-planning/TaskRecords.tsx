import type { ReactNode } from 'react';
import type { TaskArtifactRecord, TaskAttachmentRecord } from '../types';
import { formatTime, getArtifactClass, getArtifactLabel } from './format';
import { MarkdownContent } from './MarkdownContent';

function formatAttachmentSize(bytes: number): string {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10}MB`;
}

function attachmentUrl(attachment: TaskAttachmentRecord): string {
  return `/api/tasks/${attachment.taskId}/attachments/${attachment.attachmentId}`;
}

function ArtifactAttachments({
  attachments,
}: {
  attachments: TaskAttachmentRecord[];
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {attachments.map((attachment) => (
        <a
          key={attachment.attachmentId}
          href={attachmentUrl(attachment)}
          target="_blank"
          rel="noreferrer"
          className="group min-w-0 rounded-lg border border-border-color bg-black/20 p-2 hover:border-brand/60"
        >
          {attachment.missing ? (
            <div className="flex aspect-square items-center justify-center rounded bg-black/30 text-xs text-status-error">
              文件缺失
            </div>
          ) : (
            <img
              src={attachmentUrl(attachment)}
              alt={attachment.originalName}
              className="aspect-square w-full rounded object-cover"
              loading="lazy"
            />
          )}
          <div className="mt-1 truncate text-[11px] text-text-secondary">
            {attachment.originalName}
          </div>
          <div className="text-[11px] text-text-muted">
            {formatAttachmentSize(attachment.sizeBytes)}
          </div>
        </a>
      ))}
    </div>
  );
}

export function ArtifactItem({ artifact }: { artifact: TaskArtifactRecord }) {
  return (
    <div className={`rounded-lg border p-3 ${getArtifactClass(artifact.type)}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-xs font-semibold text-text-secondary">
          {getArtifactLabel(artifact.type, artifact.metadata)}
        </span>
        <span className="text-[11px] text-text-muted shrink-0">
          {formatTime(artifact.createdAt)}
        </span>
      </div>
      <MarkdownContent value={artifact.body} />
      <ArtifactAttachments attachments={artifact.attachments || []} />
    </div>
  );
}

export function isDuplicatePlannerAgentResult(
  artifact: TaskArtifactRecord,
): boolean {
  if (
    artifact.type !== 'agent_result' ||
    artifact.metadata.agentId !== 'planner'
  ) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(artifact.body);
    if (!parsed || typeof parsed !== 'object') return false;
    const action = (parsed as { action?: unknown }).action;
    return action === 'plan_revision' || action === 'planning_update';
  } catch {
    return false;
  }
}

export function getReadableArtifacts(
  artifacts: TaskArtifactRecord[],
): TaskArtifactRecord[] {
  return artifacts.filter(
    (artifact) => !isDuplicatePlannerAgentResult(artifact),
  );
}

export function TaskRecordsPanel({
  artifacts,
  children,
}: {
  artifacts: TaskArtifactRecord[];
  children?: ReactNode;
}) {
  const readableArtifacts = getReadableArtifacts(artifacts);

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-text-secondary">过程记录</h3>
      <div className="flex flex-col gap-3">
        {readableArtifacts.length === 0 ? (
          <div className="text-sm text-text-muted">暂无记录。</div>
        ) : (
          readableArtifacts.map((artifact) => (
            <ArtifactItem key={artifact.artifactId} artifact={artifact} />
          ))
        )}
      </div>
      {children}
    </section>
  );
}
