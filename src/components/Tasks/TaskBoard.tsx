import { useState } from 'react';
import { Button, Segmented, Spin, Typography, theme } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useTaskStore } from '../../stores/taskStore';
import { TaskCard } from './TaskCard';
import { NewTaskModal } from './NewTaskModal';
import type { Task } from '../../stores/taskStore';

const { Title } = Typography;

const STATUS_COLUMNS = [
  { key: 'todo', label: '待办', color: '#1890ff' },
  { key: 'in_progress', label: '进行中', color: '#faad14' },
  { key: 'done', label: '已完成', color: '#52c41a' },
  { key: 'blocked', label: '已阻塞', color: '#f5222d' },
];

interface Props {
  tasks: Task[];
  loading: boolean;
  onTaskClick: (id: string) => void;
}

export function TaskBoard({ tasks, loading, onTaskClick }: Props) {
  const { token } = theme.useToken();
  const [filter, setFilter] = useState<string>('all');
  const [modalOpen, setModalOpen] = useState(false);

  const filteredTasks = filter === 'all' ? tasks : tasks.filter((t) => t.status === filter);

  const tasksByStatus = (status: string) => filteredTasks.filter((t) => t.status === status);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={4} style={{ margin: 0 }}>待办管理</Title>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Segmented
            options={[{ label: '全部', value: 'all' }, ...STATUS_COLUMNS.map((c) => ({ label: c.label, value: c.key }))]}
            value={filter}
            onChange={(val) => setFilter(val as string)}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
            新建任务
          </Button>
        </div>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin size="large" />
        </div>
      ) : (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, overflow: 'hidden' }}>
          {STATUS_COLUMNS.map((col) => (
            <div
              key={col.key}
              style={{
                background: token.colorFillAlter,
                borderRadius: 8,
                padding: 12,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: col.color }} />
                <span style={{ fontWeight: 600 }}>{col.label}</span>
                <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>
                  {tasksByStatus(col.key).length}
                </span>
              </div>
              {tasksByStatus(col.key).map((task) => (
                <TaskCard key={task.id} task={task} onClick={() => onTaskClick(task.id)} />
              ))}
            </div>
          ))}
        </div>
      )}

      <NewTaskModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
