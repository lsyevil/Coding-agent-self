import { useState } from 'react';
import { Drawer, Form, Input, DatePicker, TimePicker, Switch, Button, Avatar, Typography, Popconfirm, message, Alert, Tag, theme } from 'antd';
import { DeleteOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { useEventStore } from '../../stores/eventStore';
import { useAuthStore } from '../../stores/authStore';
import dayjs from 'dayjs';

const { TextArea } = Input;
const { Text, Title } = Typography;

const STATUS_LABELS = {
  accepted: { text: '已接受', color: 'success' },
  pending: { text: '待确认', color: 'warning' },
  declined: { text: '已拒绝', color: 'error' },
};

export function EventDetailDrawer() {
  const { token } = theme.useToken();
  const [form] = Form.useForm();
  const { events, currentEventId, selectEvent, updateEvent, deleteEvent, rsvp } = useEventStore();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);

  const event = events.find((e) => e.id === currentEventId);
  const isCreator = event?.created_by === currentUserId;
  const myParticipant = event?.participants.find((p) => p.id === currentUserId);

  const handleClose = () => {
    selectEvent(null);
    setConflictWarning(null);
  };

  const handleSave = async (changedValues: any) => {
    if (!event) return;
    const updates: any = {};

    if (changedValues.title !== undefined) updates.title = changedValues.title;
    if (changedValues.description !== undefined) updates.description = changedValues.description;
    if (changedValues.location !== undefined) updates.location = changedValues.location;
    if (changedValues.is_all_day !== undefined) updates.is_all_day = changedValues.is_all_day;

    if (Object.keys(updates).length > 0) {
      const result = await updateEvent(event.id, updates);
      if (result.conflictWarning) {
        setConflictWarning(result.conflictWarning);
      }
      message.success('已保存');
    }
  };

  const handleDelete = async () => {
    if (!event) return;
    await deleteEvent(event.id);
    message.success('已删除');
    setConflictWarning(null);
  };

  const handleRsvp = async (status: 'accepted' | 'declined') => {
    if (!event) return;
    await rsvp(event.id, status);
    message.success(status === 'accepted' ? '已接受' : '已拒绝');
  };

  if (!event) {
    return <Drawer open={false} />;
  }

  const isAllDay = event.is_all_day === 1;
  const startTime = dayjs(event.start_time);
  const endTime = dayjs(event.end_time);

  return (
    <Drawer
      title={null}
      open={!!currentEventId}
      onClose={handleClose}
      width={480}
      footer={
        isCreator && (
          <Popconfirm title="确定删除此日程？" onConfirm={handleDelete}>
            <Button danger icon={<DeleteOutlined />}>
              删除日程
            </Button>
          </Popconfirm>
        )
      }
    >
      {conflictWarning && (
        <Alert message={conflictWarning} type="warning" showIcon style={{ marginBottom: 16 }} />
      )}

      <Form
        form={form}
        layout="vertical"
        initialValues={{
          title: event.title,
          description: event.description,
          location: event.location,
          is_all_day: isAllDay,
        }}
        onValuesChange={handleSave}
      >
        <Form.Item name="title" label="标题">
          <Input />
        </Form.Item>

        <div style={{ marginBottom: 16 }}>
          <Text type="secondary">时间</Text>
          <div style={{ marginTop: 4 }}>
            {isAllDay ? (
              <Text>{startTime.format('YYYY-MM-DD')} 全天</Text>
            ) : (
              <Text>
                {startTime.format('YYYY-MM-DD HH:mm')} - {endTime.format('HH:mm')}
              </Text>
            )}
          </div>
        </div>

        <Form.Item name="location" label="地点">
          <Input />
        </Form.Item>

        <Form.Item name="description" label="描述">
          <TextArea rows={3} />
        </Form.Item>

        <Form.Item name="is_all_day" label="全天事件" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>

      <div style={{ marginBottom: 16 }}>
        <Text type="secondary">参与人</Text>
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {event.participants.map((p) => {
            const statusInfo = STATUS_LABELS[p.status as keyof typeof STATUS_LABELS];
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar style={{ backgroundColor: token.colorPrimary }}>
                  {p.displayName?.[0] || '?'}
                </Avatar>
                <Text>{p.displayName}</Text>
                <Tag color={statusInfo.color}>{statusInfo.text}</Tag>
              </div>
            );
          })}
        </div>
      </div>

      {/* RSVP 按钮 - 仅对非创建者的参与人显示 */}
      {myParticipant && myParticipant.id !== event.created_by && (
        <div style={{ display: 'flex', gap: 8 }}>
          {myParticipant.status !== 'accepted' && (
            <Button type="primary" icon={<CheckOutlined />} onClick={() => handleRsvp('accepted')}>
              接受
            </Button>
          )}
          {myParticipant.status !== 'declined' && (
            <Button danger icon={<CloseOutlined />} onClick={() => handleRsvp('declined')}>
              拒绝
            </Button>
          )}
        </div>
      )}
    </Drawer>
  );
}
