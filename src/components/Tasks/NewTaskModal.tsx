import { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, DatePicker, message } from 'antd';
import { apiFetch } from '../../api/http';
import { userPickerLabel } from '../../utils/user';
import { useTaskStore } from '../../stores/taskStore';

const { TextArea } = Input;

interface UserOption {
  id: string;
  username: string;
  displayName: string;
  /** 部门，null = 未填。用于同名消歧，见 userPickerLabel */
  department?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NewTaskModal({ open, onClose }: Props) {
  const [form] = Form.useForm();
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(false);
  const createTask = useTaskStore((s) => s.createTask);

  useEffect(() => {
    if (!open) return;
    apiFetch('/api/auth/users')
      .then((r) => r.json())
      .then((data) => setUsers(data.users || []))
      .catch(() => setUsers([]));
    form.resetFields();
  }, [open, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await createTask({
        title: values.title,
        description: values.description,
        priority: values.priority || 'medium',
        due_date: values.due_date?.format('YYYY-MM-DD'),
        assigneeIds: values.assigneeIds,
      });
      message.success('任务创建成功');
      onClose();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error('创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="新建任务"
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      okText="创建"
      cancelText="取消"
      confirmLoading={loading}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="title" label="任务标题" rules={[{ required: true, message: '请输入标题' }]}>
          <Input placeholder="输入任务标题" />
        </Form.Item>
        <Form.Item name="description" label="描述">
          <TextArea rows={3} placeholder="任务描述（可选）" />
        </Form.Item>
        <Form.Item name="priority" label="优先级" initialValue="medium">
          <Select options={[
            { label: '低', value: 'low' },
            { label: '中', value: 'medium' },
            { label: '高', value: 'high' },
            { label: '紧急', value: 'urgent' },
          ]} />
        </Form.Item>
        <Form.Item name="due_date" label="截止日期">
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="assigneeIds" label="负责人">
          <Select
            mode="multiple"
            placeholder="选择负责人"
            options={users.map((u) => ({ label: userPickerLabel(u), value: u.id }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
