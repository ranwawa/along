import { PanelLeftClose, PanelLeftOpen, Settings } from 'lucide-react';
import { useState } from 'react';
import { Button } from './components/ui/button';
import { TaskDetail } from './task-planning/TaskDetail';
import { TaskListPanel } from './task-planning/TaskSidebar';
import { useTaskPlanningController } from './task-planning/useTaskPlanningController';

type TaskPlanningController = ReturnType<typeof useTaskPlanningController>;

function SidebarToggleButton({
  ariaLabel,
  icon,
  className,
  onClick,
}: {
  ariaLabel: string;
  icon: 'open' | 'close';
  className: string;
  onClick: () => void;
}) {
  const Icon = icon === 'open' ? PanelLeftOpen : PanelLeftClose;
  return (
    <Button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      size="icon"
      className={className}
    >
      <Icon aria-hidden="true" className="h-4 w-4" />
    </Button>
  );
}

function CollapsedSidebar({
  onToggleCollapsed,
  onNavigateSettings,
}: {
  onToggleCollapsed: () => void;
  onNavigateSettings: () => void;
}) {
  return (
    <div className="min-h-0 xl:h-full border-b xl:border-b-0 xl:border-r border-border-color flex xl:flex-col items-center justify-end xl:justify-start gap-2 bg-bg-glass p-2">
      <SidebarToggleButton
        ariaLabel="展开左侧栏"
        onClick={onToggleCollapsed}
        className="h-9 w-9"
        icon="open"
      />
      <Button
        type="button"
        aria-label="设置"
        onClick={onNavigateSettings}
        size="icon"
        className="h-9 w-9"
      >
        <Settings aria-hidden="true" className="h-4 w-4" />
      </Button>
    </div>
  );
}

function ExpandedSidebar({
  onToggleCollapsed,
  onNavigateSettings,
  taskPlanning,
}: {
  onToggleCollapsed: () => void;
  onNavigateSettings: () => void;
  taskPlanning: TaskPlanningController;
}) {
  return (
    <div className="min-h-[360px] xl:min-h-0 xl:h-full border-b xl:border-b-0 xl:border-r border-border-color flex flex-col bg-bg-glass">
      <div className="shrink-0 px-4 pt-3 flex justify-between">
        <Button
          type="button"
          aria-label="设置"
          onClick={onNavigateSettings}
          size="icon"
          className="h-8 w-8"
        >
          <Settings aria-hidden="true" className="h-4 w-4" />
        </Button>
        <SidebarToggleButton
          ariaLabel="折叠左侧栏"
          onClick={onToggleCollapsed}
          className="h-8 w-8"
          icon="close"
        />
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
        onDelete={taskPlanning.deleteTask}
      />
    </div>
  );
}

function TaskPlanningSidebar({
  collapsed,
  onToggleCollapsed,
  taskPlanning,
  onNavigateSettings,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  taskPlanning: TaskPlanningController;
  onNavigateSettings: () => void;
}) {
  if (collapsed) {
    return (
      <CollapsedSidebar
        onToggleCollapsed={onToggleCollapsed}
        onNavigateSettings={onNavigateSettings}
      />
    );
  }

  return (
    <ExpandedSidebar
      onToggleCollapsed={onToggleCollapsed}
      onNavigateSettings={onNavigateSettings}
      taskPlanning={taskPlanning}
    />
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
        messageRuntimeExecutionMode={taskPlanning.messageRuntimeExecutionMode}
        busyAction={taskPlanning.busyAction}
        onDraftChange={taskPlanning.updateDraft}
        onDraftAttachmentsChange={(attachments) =>
          taskPlanning.setDraft((previous) => ({ ...previous, attachments }))
        }
        onCreateTask={taskPlanning.createTask}
        onMessageChange={taskPlanning.setMessageBody}
        onMessageAttachmentsChange={taskPlanning.setMessageAttachments}
        onMessageExecutionModeChange={taskPlanning.setMessageExecutionMode}
        onMessageRuntimeExecutionModeChange={
          taskPlanning.setMessageRuntimeExecutionMode
        }
        onSubmitMessage={taskPlanning.submitMessageFromFlow}
        onCancelAgentRun={taskPlanning.cancelAgentRun}
        onAction={taskPlanning.handleFlowAction}
      />
    </div>
  );
}

export function TaskPlanningView({
  onNavigateSettings,
}: {
  onNavigateSettings: () => void;
}) {
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
        onNavigateSettings={onNavigateSettings}
      />
      <TaskPlanningMain taskPlanning={taskPlanning} />
    </div>
  );
}
