import { useState } from 'react';
import { TaskDetail } from './task-planning/TaskDetail';
import { TaskListPanel } from './task-planning/TaskSidebar';
import { useTaskPlanningController } from './task-planning/useTaskPlanningController';

type TaskPlanningController = ReturnType<typeof useTaskPlanningController>;

const SIDEBAR_COLLAPSE_ICON = '<';
const SIDEBAR_EXPAND_ICON = '>';

function SidebarToggleButton({
  ariaLabel,
  children,
  className,
  onClick,
}: {
  ariaLabel: string;
  children: string;
  className: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={className}
    >
      {children}
    </button>
  );
}

function CollapsedSidebar({
  onToggleCollapsed,
}: {
  onToggleCollapsed: () => void;
}) {
  return (
    <div className="min-h-0 xl:h-full border-b xl:border-b-0 xl:border-r border-border-color flex xl:flex-col items-center justify-end xl:justify-start gap-2 bg-bg-glass p-2">
      <SidebarToggleButton
        ariaLabel="展开左侧栏"
        onClick={onToggleCollapsed}
        className="h-9 w-9 rounded-lg border border-border-color text-text-secondary hover:bg-white/5"
      >
        {SIDEBAR_EXPAND_ICON}
      </SidebarToggleButton>
    </div>
  );
}

function TaskPlanningSidebar({
  collapsed,
  onToggleCollapsed,
  taskPlanning,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  taskPlanning: TaskPlanningController;
}) {
  if (collapsed) {
    return <CollapsedSidebar onToggleCollapsed={onToggleCollapsed} />;
  }

  return (
    <div className="min-h-[360px] xl:min-h-0 xl:h-full border-b xl:border-b-0 xl:border-r border-border-color flex flex-col bg-bg-glass">
      <div className="shrink-0 px-4 pt-3 flex justify-end">
        <SidebarToggleButton
          ariaLabel="折叠左侧栏"
          onClick={onToggleCollapsed}
          className="h-8 w-8 rounded-lg border border-border-color text-text-secondary hover:bg-white/5"
        >
          {SIDEBAR_COLLAPSE_ICON}
        </SidebarToggleButton>
      </div>
      <TaskListPanel
        draft={taskPlanning.draft}
        repositories={taskPlanning.repositories}
        error={taskPlanning.error}
        onDraftChange={taskPlanning.updateDraft}
        tasks={taskPlanning.tasks}
        loading={taskPlanning.loading}
        selectedTaskId={taskPlanning.selected?.task.taskId}
        isNewTaskOpen={taskPlanning.isNewTaskOpen}
        onNewTask={taskPlanning.openNewTask}
        onSelect={taskPlanning.selectTask}
      />
    </div>
  );
}

function TaskPlanningMain({
  taskPlanning,
}: {
  taskPlanning: TaskPlanningController;
}) {
  return (
    <div className="min-h-[560px] xl:min-h-0 flex flex-col bg-bg-secondary">
      <TaskDetail
        selected={taskPlanning.selected}
        isNewTaskOpen={taskPlanning.isNewTaskOpen}
        draft={taskPlanning.draft}
        selectedRepository={taskPlanning.selectedRepository}
        sortedArtifacts={taskPlanning.sortedArtifacts}
        messageBody={taskPlanning.messageBody}
        messageAttachments={taskPlanning.messageAttachments}
        messageExecutionMode={taskPlanning.messageExecutionMode}
        busyAction={taskPlanning.busyAction}
        onDraftChange={taskPlanning.updateDraft}
        onDraftAttachmentsChange={(attachments) =>
          taskPlanning.setDraft((previous) => ({ ...previous, attachments }))
        }
        onCreateTask={taskPlanning.createTask}
        onMessageChange={taskPlanning.setMessageBody}
        onMessageAttachmentsChange={taskPlanning.setMessageAttachments}
        onMessageExecutionModeChange={taskPlanning.setMessageExecutionMode}
        onSubmitMessage={taskPlanning.submitMessageFromFlow}
        onCancelAgentRun={taskPlanning.cancelAgentRun}
        onAction={taskPlanning.handleFlowAction}
      />
    </div>
  );
}

export function TaskPlanningView() {
  const taskPlanning = useTaskPlanningController();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div
      className={`flex-1 min-h-0 grid grid-cols-1 ${
        sidebarCollapsed
          ? 'xl:grid-cols-[56px_minmax(0,1fr)]'
          : 'xl:grid-cols-[320px_minmax(0,1fr)]'
      } border-t border-border-color overflow-auto xl:overflow-hidden`}
    >
      <TaskPlanningSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
        taskPlanning={taskPlanning}
      />
      <TaskPlanningMain taskPlanning={taskPlanning} />
    </div>
  );
}
