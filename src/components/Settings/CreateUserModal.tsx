import { useState } from 'react';
import { Modal, Form, Input, Select, AutoComplete, message } from 'antd';
import { registerUser } from '../../api/auth';

interface Props {
  open: boolean;
  /** 现有部门去重后的候选值，供 AutoComplete 提示；由父组件从已加载的用户列表算出 */
  departments: string[];
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateUserModal({ open, departments, onClose, onSuccess }: Props) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await registerUser({
        username: values.username,
        password: values.password,
        displayName: values.displayName,
        role: values.role || 'member',
        department: values.department,
      });
      message.success('用户创建成功');
      form.resetFields();
      onSuccess();
      onClose();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.message || '创建失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="创建用户"
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      okText="创建"
      cancelText="取消"
      confirmLoading={loading}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item
          name="username"
          label="用户名"
          rules={[{ required: true, message: '请输入用户名' }]}
        >
          <Input placeholder="输入用户名（唯一）" />
        </Form.Item>
        <Form.Item
          name="password"
          label="密码"
          rules={[{ required: true, message: '请输入密码' }]}
        >
          <Input.Password placeholder="输入密码" />
        </Form.Item>
        <Form.Item
          name="displayName"
          label="显示名"
          rules={[{ required: true, message: '请输入显示名' }]}
        >
          <Input placeholder="输入显示名称" />
        </Form.Item>
        <Form.Item name="department" label="部门（可选）">
          <AutoComplete
            // filterOption 打开才会随输入过滤；默认的 AutoComplete 不过滤，
            // 部门一多就变成一长串跟输入无关的候选。
            filterOption={(input, option) =>
              String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())
            }
            options={departments.map((d) => ({ value: d }))}
            placeholder="用于区分同名同事，如：技术部"
          />
        </Form.Item>
        <Form.Item name="role" label="角色" initialValue="member">
          <Select
            options={[
              { label: '普通成员', value: 'member' },
              { label: '管理员', value: 'admin' },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
