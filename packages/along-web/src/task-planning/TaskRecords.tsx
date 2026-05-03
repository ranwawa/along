import type { TaskArtifactRecord } from '../types';
import { formatTime, getArtifactClass, getArtifactLabel } from './format';

export function ArtifactItem({ artifact }: { artifact: TaskArtifactRecord }) {
  return (
    <div className={`rounded-lg border p-3 ${getArtifactClass(artifact.type)}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-xs font-semibold text-text-secondary">
          {getArtifactLabel(artifact.type)}
        </span>
        <span className="text-[11px] text-text-muted shrink-0">
          {formatTime(artifact.createdAt)}
        </span>
      </div>
      <div className="text-sm whitespace-pre-wrap break-words leading-6">
        {artifact.body}
      </div>
    </div>
  );
}

export function TaskRecordsPanel({
  artifacts,
}: {
  artifacts: TaskArtifactRecord[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-text-secondary">过程记录</h3>
      <div className="flex flex-col gap-3">
        {artifacts.length === 0 ? (
          <div className="text-sm text-text-muted">暂无记录。</div>
        ) : (
          artifacts.map((artifact) => (
            <ArtifactItem key={artifact.artifactId} artifact={artifact} />
          ))
        )}
      </div>
    </section>
  );
}
