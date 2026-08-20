import { useState } from 'react';
import { Drawer, Form, Input, Select, DatePicker, Button, Divider, List, Avatar, Typography, Popconfirm, message, theme } from 'antd';
import { DeleteOutlined, SendOutlined } from '@ant-design/icons';
import { useTaskStore } from '../../stores/taskStore';
import { useAuthStore } from '../../stores/authStore';
import type { TaskComment } from '../../stores/taskStore';

const { TextArea } = Input;
const { Text } = Typography;

export function TaskDetailDrawer() {
  const { token } = theme.useToken();
  const [form] = Form.useForm();
  const { tasks, currentTaskId, comments, selectTask, updateTask, deleteTask, addComment } = useTaskStore();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [commentText, setCommentText] = useState('');

  const task = tasks.find((t) => t.id === currentTaskId);
  const isCreator = task?.created_by === currentUserId;

  const handleClose = () => selectTask(null);

  const handleSave = async (changedValues: any) => {
    if (!task) return;
    const updates: any = {};
    if (changedValues.title !== undefined) updates.title = changedValues.title;
    if (changedValues.description !== undefined) updates.description = changedValues.description;
    if (changedValues.status !== undefined) updates.status = changedValues.status;
    if (changedValues.priority !== undefined) updates.priority = changedValues.priority;

    if (Object.keys(updates).length > 0) {
      await updateTask(task.id, updates);
      message.success('已保存');
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    await deleteTask(task.id);
    message.success('已删除');
  };

  const handleAddComment = async () => {
    if (!task || !commentText.trim()) return;
    await addComment(task.id, commentText.trim());
    setCommentText('');
  };

  if (!task) {
    return <Drawer open={false} />;
  }

  return (
    <Drawer
      title={null}
      open={!!currentTaskId}
      onClose={handleClose}
      width={480}
      footer={
        isCreator && (
          <Popconfirm title="确定删除此任务？" onConfirm={handleDelete}>
            <Button danger icon={<DeleteOutlined />}>
              删除任务
            </Button>
          </Popconfirm>
        )
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
        }}
        onValuesChange={handleSave}
      >
        <Form.Item name="title" label="标题">
          <Input />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <TextArea rows={3} />
        </Form.Item>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Form.Item name="status" label="状态">
            <Select options={[
              { label: '待办', value: 'todo' },
              { label: '进行中', value: 'in_progress' },
              { label: '已完成', value: 'done' },
              { label: '已阻塞', value: 'blocked' },
            ]} />
          </Form.Item>
          <Form.Item name="priority" label="优先级">
            <Select options={[
              { label: '低', value: 'low' },
              { label: '中', value: 'medium' },
              { label: '高', value: 'high' },
              { label: '紧急', value: 'urgent' },
            ]} />
          </Form.Item>
        </div>
      </Form>

      <div style={{ marginBottom: 12 }}>
        <Text type="secondary">负责人</Text>
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          {task.assignees.map((a) => (
            <Avatar key={a.id} style={{ backgroundColor: token.colorPrimary }}>
              {a.displayName?.[0] || '?'}
            </Avatar>
          ))}
        </div>
      </div>

      <Divider />

      <Text strong>评论 ({comments.length})</Text>

      <div style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="添加评论..."
            onPressEnter={handleAddComment}
          />
          <Button type="primary" icon={<SendOutlined />} onClick={handleAddComment} disabled={!commentText.trim()}>
            发送
          </Button>
        </div>

        <List
          style={{ marginTop: 12 }}
          dataSource={comments}
          renderItem={(c: TaskComment) => (
            <List.Item>
              <List.Item.Meta
                avatar={<Avatar size="small">{c.userName?.[0] || '?'}</Avatar>}
                title={<Text style={{ fontSize: 13 }}>{c.userName}</Text>}
                description={<Text>{c.content}</Text>}
              />
            </List.Item>
          )}
        />
      </div>
    </Drawer>
  );
}
