import { Tag, Avatar, Typography, theme } from 'antd';
import type { CalendarEvent } from '../../stores/eventStore';
import { useAuthStore } from '../../stores/authStore';

const { Text } = Typography;

interface Props {
  event: CalendarEvent;
  // 卡片嵌在可点击的日期格里，调用方需要 stopPropagation 阻止冒泡，
  // 所以必须把事件对象透传出去。
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
}

const STATUS_COLORS = {
  accepted: '#52c41a',
  pending: '#faad14',
  declined: '#8c8c8c',
};

export function EventCard({ event, onClick }: Props) {
  const { token } = theme.useToken();

  const isAllDay = event.is_all_day === 1;
  const startTime = new Date(event.start_time);
  const endTime = new Date(event.end_time);

  const timeStr = isAllDay
    ? '全天'
    : `${startTime.getHours().toString().padStart(2, '0')}:${startTime.getMinutes().toString().padStart(2, '0')} - ${endTime.getHours().toString().padStart(2, '0')}:${endTime.getMinutes().toString().padStart(2, '0')}`;

  // 获取当前用户的状态
  const currentUserId = useAuthStore((s) => s.user?.id);
  const myParticipant = event.participants.find(p => p.id === currentUserId);
  const statusColor = myParticipant ? STATUS_COLORS[myParticipant.status] : token.colorPrimary;

  return (
    <div
      onClick={onClick}
      style={{
        padding: '4px 8px',
        marginBottom: 4,
        borderRadius: 4,
        backgroundColor: statusColor + '20',
        borderLeft: `3px solid ${statusColor}`,
        cursor: 'pointer',
        fontSize: 12,
      }}
    >
      <Text strong style={{ fontSize: 12, display: 'block' }} ellipsis>
        {event.title}
      </Text>
      <Text type="secondary" style={{ fontSize: 10 }}>
        {timeStr}
      </Text>
      {event.participants.length > 0 && (
        <Avatar.Group size={16} maxCount={3} style={{ marginTop: 4 }}>
          {event.participants.map((p) => (
            <Avatar key={p.id} style={{ backgroundColor: token.colorPrimary, fontSize: 10 }}>
              {p.displayName?.[0] || '?'}
            </Avatar>
          ))}
        </Avatar.Group>
      )}
    </div>
  );
}
