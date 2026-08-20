import { useEffect } from 'react';
import { useTaskStore } from '../stores/taskStore';
import { TaskBoard } from '../components/Tasks/TaskBoard';
import { TaskDetailDrawer } from '../components/Tasks/TaskDetailDrawer';

export function TasksPage() {
  const { tasks, loading, fetchTasks, selectTask } = useTaskStore();

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TaskBoard tasks={tasks} loading={loading} onTaskClick={(id) => selectTask(id)} />
      <TaskDetailDrawer />
    </div>
  );
}
