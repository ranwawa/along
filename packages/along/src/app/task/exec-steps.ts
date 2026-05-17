import type {
  TaskArtifactRecord,
  TaskPlanningSnapshot,
  TaskPlanRevisionRecord,
} from '../planning';

export const EXEC_STEPS_KIND = 'exec_steps';
export const EXECUTOR_TACTICAL_PLAN_ROLE = 'executor_tactical_plan';
export const EXEC_STEPS_APPROVAL_KIND = 'exec_steps_approval';

function matchesPlan(
  artifact: TaskArtifactRecord,
  approvedPlan: TaskPlanRevisionRecord,
): boolean {
  return artifact.metadata.planId === approvedPlan.planId;
}

export function findExecStepsArtifact(
  snapshot: Pick<TaskPlanningSnapshot, 'artifacts'>,
  approvedPlan: TaskPlanRevisionRecord,
): TaskArtifactRecord | undefined {
  return snapshot.artifacts
    .filter(
      (artifact) =>
        artifact.type === 'agent_result' &&
        artifact.metadata.kind === EXEC_STEPS_KIND &&
        matchesPlan(artifact, approvedPlan),
    )
    .at(-1);
}

export function findExecStepsApprovalArtifact(
  snapshot: Pick<TaskPlanningSnapshot, 'artifacts'>,
  approvedPlan: TaskPlanRevisionRecord,
): TaskArtifactRecord | undefined {
  return snapshot.artifacts
    .filter(
      (artifact) =>
        artifact.type === 'approval' &&
        artifact.metadata.kind === EXEC_STEPS_APPROVAL_KIND &&
        matchesPlan(artifact, approvedPlan),
    )
    .at(-1);
}

export function areExecStepsApproved(
  snapshot: Pick<TaskPlanningSnapshot, 'artifacts'>,
  approvedPlan: TaskPlanRevisionRecord,
): boolean {
  const steps = findExecStepsArtifact(snapshot, approvedPlan);
  const approval = findExecStepsApprovalArtifact(snapshot, approvedPlan);
  return Boolean(
    steps && approval && approval.metadata.stepsArtifactId === steps.artifactId,
  );
}
