import type {
  TaskArtifactRecord,
  TaskPlanningSnapshot,
  TaskPlanRevisionRecord,
} from './task-planning';

export const IMPLEMENTATION_STEPS_KIND = 'implementation_steps';
export const IMPLEMENTATION_STEPS_APPROVAL_KIND =
  'implementation_steps_approval';

function matchesPlan(
  artifact: TaskArtifactRecord,
  approvedPlan: TaskPlanRevisionRecord,
): boolean {
  return artifact.metadata.planId === approvedPlan.planId;
}

export function findImplementationStepsArtifact(
  snapshot: Pick<TaskPlanningSnapshot, 'artifacts'>,
  approvedPlan: TaskPlanRevisionRecord,
): TaskArtifactRecord | undefined {
  return snapshot.artifacts
    .filter(
      (artifact) =>
        artifact.type === 'agent_result' &&
        artifact.metadata.kind === IMPLEMENTATION_STEPS_KIND &&
        matchesPlan(artifact, approvedPlan),
    )
    .at(-1);
}

export function findImplementationStepsApprovalArtifact(
  snapshot: Pick<TaskPlanningSnapshot, 'artifacts'>,
  approvedPlan: TaskPlanRevisionRecord,
): TaskArtifactRecord | undefined {
  return snapshot.artifacts
    .filter(
      (artifact) =>
        artifact.type === 'approval' &&
        artifact.metadata.kind === IMPLEMENTATION_STEPS_APPROVAL_KIND &&
        matchesPlan(artifact, approvedPlan),
    )
    .at(-1);
}

export function areImplementationStepsApproved(
  snapshot: Pick<TaskPlanningSnapshot, 'artifacts'>,
  approvedPlan: TaskPlanRevisionRecord,
): boolean {
  const steps = findImplementationStepsArtifact(snapshot, approvedPlan);
  const approval = findImplementationStepsApprovalArtifact(
    snapshot,
    approvedPlan,
  );
  return Boolean(
    steps && approval && approval.metadata.stepsArtifactId === steps.artifactId,
  );
}
