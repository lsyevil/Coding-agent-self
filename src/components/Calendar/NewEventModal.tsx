import { useState, useEffect } from 'react';
import { Modal, Form, Input, DatePicker, TimePicker, Switch, Select, message, Alert } from 'antd';
import { apiFetch } from '../../api/http';
import { userPickerLabel } from '../../utils/user';
import { useEventStore } from '../../stores/eventStore';
import dayjs from 'dayjs';

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
  defaultDate?: string | null;
}

export function NewEventModal({ open, onClose, defaultDate }: Props) {
  const [form] = Form.useForm();
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const createEvent = useEventStore((s) => s.createEvent);

  useEffect(() => {
    if (!open) return;
    apiFetch('/api/auth/users')
      .then((r) => r.json())
      .then((data) => setUsers(data.users || []))
      .catch(() => setUsers([]));
    form.resetFields();
    setConflictWarning(null);

    if (defaultDate) {
      form.setFieldsValue({
        date: dayjs(defaultDate),
        startTime: dayjs().hour(9).minute(0),
        endTime: dayjs().hour(10).minute(0),
      });
    }
  }, [open, defaultDate, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const date = values.date;
      const isAllDay = values.is_all_day || false;

      let startTime: string;
      let endTime: string;

      if (isAllDay) {
        startTime = date.startOf('day').toISOString();
        endTime = date.endOf('day').toISOString();
      } else {
        const start = values.startTime;
        const end = values.endTime;
        startTime = date.hour(start.hour()).minute(start.minute()).toISOString();
        endTime = date.hour(end.hour()).minute(end.minute()).toISOString();
      }

      const result = await createEvent({
        title: values.title,
        description: values.description,
        location: values.location,
        start_time: startTime,
        end_time: endTime,
        is_all_day: isAllDay,
        reminder_minutes: values.reminder_minutes || 15,
        participantIds: values.participantIds,
      });

      if (result.conflictWarning) {
        setConflictWarning(result.conflictWarning);
      }

      message.success('日程创建成功');
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
      title="新建日程"
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      okText="创建"
      cancelText="取消"
      confirmLoading={loading}
      destroyOnClose
      width={600}
    >
      {conflictWarning && (
        <Alert message={conflictWarning} type="warning" showIcon style={{ marginBottom: 16 }} />
      )}

      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="title" label="日程标题" rules={[{ required: true, message: '请输入标题' }]}>
          <Input placeholder="输入日程标题" />
        </Form.Item>

        <Form.Item name="is_all_day" label="全天事件" valuePropName="checked">
          <Switch />
        </Form.Item>

        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.is_all_day !== cur.is_all_day}>
          {({ getFieldValue }) => {
            const isAllDay = getFieldValue('is_all_day');
            return (
              <>
                <Form.Item name="date" label="日期" rules={[{ required: true, message: '请选择日期' }]}>
                  <DatePicker style={{ width: '100%' }} />
                </Form.Item>

                {!isAllDay && (
                  <>
                    <Form.Item name="startTime" label="开始时间" rules={[{ required: true, message: '请选择开始时间' }]}>
                      <TimePicker format="HH:mm" style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item name="endTime" label="结束时间" rules={[{ required: true, message: '请选择结束时间' }]}>
                      <TimePicker format="HH:mm" style={{ width: '100%' }} />
                    </Form.Item>
                  </>
                )}
              </>
            );
          }}
        </Form.Item>

        <Form.Item name="location" label="地点">
          <Input placeholder="地点（可选）" />
        </Form.Item>

        <Form.Item name="description" label="描述">
          <Input.TextArea rows={3} placeholder="日程描述（可选）" />
        </Form.Item>

        <Form.Item name="participantIds" label="参与人">
          <Select
            mode="multiple"
            placeholder="选择参与人"
            options={users.map((u) => ({ label: userPickerLabel(u), value: u.id }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
