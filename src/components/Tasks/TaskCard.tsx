import { Card, Tag, Avatar, Typography, theme } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import type { Task } from '../../stores/taskStore';

const { Text } = Typography;

const PRIORITY_COLORS: Record<string, string> = {
  urgent: '#f5222d',
  high: '#fa8c16',
  medium: '#1890ff',
  low: '#52c41a',
};

interface Props {
  task: Task;
  onClick: () => void;
}

export function TaskCard({ task, onClick }: Props) {
  const { token } = theme.useToken();

  const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'done';

  return (
    <Card
      size="small"
      hoverable
      onClick={onClick}
      style={{
        marginBottom: 8,
        borderLeft: `3px solid ${PRIORITY_COLORS[task.priority] || '#1890ff'}`,
        cursor: 'pointer',
      }}
      bodyStyle={{ padding: '10px 12px' }}
    >
      <Text strong style={{ display: 'block', marginBottom: 6 }}>
        {task.title}
      </Text>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Tag color={PRIORITY_COLORS[task.priority]} style={{ marginRight: 0 }}>
          {task.priority}
        </Tag>
        {task.due_date && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            <ClockCircleOutlined style={{ color: isOverdue ? '#f5222d' : undefined }} />{' '}
            <span style={{ color: isOverdue ? '#f5222d' : undefined }}>{task.due_date}</span>
          </Text>
        )}
      </div>

      {task.assignees.length > 0 && (
        <Avatar.Group
          size="small"
          maxCount={3}
          style={{ marginTop: 4 }}
        >
          {task.assignees.map((a) => (
            <Avatar key={a.id} style={{ backgroundColor: token.colorPrimary }}>
              {a.displayName?.[0] || '?'}
            </Avatar>
          ))}
        </Avatar.Group>
      )}
    </Card>
  );
}
