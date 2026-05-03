import { TaskDetail } from './task-planning/TaskDetail';
import { NewTaskForm, TaskListPanel } from './task-planning/TaskSidebar';
import { useTaskPlanningController } from './task-planning/useTaskPlanningController';

export function TaskPlanningView() {
  const taskPlanning = useTaskPlanningController();

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)] border-t border-border-color overflow-auto xl:overflow-hidden">
      <div className="min-h-[360px] xl:min-h-0 xl:h-full border-b xl:border-b-0 xl:border-r border-border-color flex flex-col bg-bg-glass">
        <NewTaskForm
          draft={taskPlanning.draft}
          repositories={taskPlanning.repositories}
          selectedRepository={taskPlanning.selectedRepository}
          busyAction={taskPlanning.busyAction}
          repositoriesRefreshing={taskPlanning.repositoriesRefreshing}
          error={taskPlanning.error}
          onSubmit={taskPlanning.createTask}
          onDraftChange={taskPlanning.updateDraft}
          onRefreshRepositories={taskPlanning.refreshRepositories}
        />
        <TaskListPanel
          tasks={taskPlanning.tasks}
          loading={taskPlanning.loading}
          selectedTaskId={taskPlanning.selected?.task.taskId}
          onSelect={taskPlanning.selectTask}
        />
      </div>

      <div className="min-h-[560px] xl:min-h-0 flex flex-col bg-bg-secondary">
        <TaskDetail
          selected={taskPlanning.selected}
          sortedArtifacts={taskPlanning.sortedArtifacts}
          messageBody={taskPlanning.messageBody}
          busyAction={taskPlanning.busyAction}
          onMessageChange={taskPlanning.setMessageBody}
          onSubmitMessage={taskPlanning.submitMessageFromFlow}
          onAction={taskPlanning.handleFlowAction}
        />
      </div>
    </div>
  );
}
