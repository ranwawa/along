import { TaskDetail } from './task-planning/TaskDetail';
import { RepositorySelector, TaskListPanel } from './task-planning/TaskSidebar';
import { useTaskPlanningController } from './task-planning/useTaskPlanningController';

type TaskPlanningController = ReturnType<typeof useTaskPlanningController>;

function TaskPlanningSidebar({
  taskPlanning,
}: {
  taskPlanning: TaskPlanningController;
}) {
  return (
    <div className="min-h-[360px] xl:min-h-0 xl:h-full border-b xl:border-b-0 xl:border-r border-border-color flex flex-col bg-bg-glass">
      <RepositorySelector
        draft={taskPlanning.draft}
        repositories={taskPlanning.repositories}
        selectedRepository={taskPlanning.selectedRepository}
        repositoriesRefreshing={taskPlanning.repositoriesRefreshing}
        error={taskPlanning.error}
        onDraftChange={taskPlanning.updateDraft}
        onRefreshRepositories={taskPlanning.refreshRepositories}
      />
      <TaskListPanel
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
        busyAction={taskPlanning.busyAction}
        onDraftChange={taskPlanning.updateDraft}
        onCreateTask={taskPlanning.createTask}
        onMessageChange={taskPlanning.setMessageBody}
        onSubmitMessage={taskPlanning.submitMessageFromFlow}
        onAction={taskPlanning.handleFlowAction}
      />
    </div>
  );
}

export function TaskPlanningView() {
  const taskPlanning = useTaskPlanningController();

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[420px_minmax(0,1fr)] border-t border-border-color overflow-auto xl:overflow-hidden">
      <TaskPlanningSidebar taskPlanning={taskPlanning} />
      <TaskPlanningMain taskPlanning={taskPlanning} />
    </div>
  );
}
