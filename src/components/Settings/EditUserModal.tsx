import { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, message } from 'antd';
import { apiFetch } from '../../api/http';
import type { UserInfo } from '../../api/auth';

interface Props {
  open: boolean;
  user: UserInfo | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditUserModal({ open, user, onClose, onSuccess }: Props) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && user) {
      form.setFieldsValue({
        displayName: user.displayName,
        role: user.role,
      });
    }
  }, [open, user, form]);

  const handleOk = async () => {
    if (!user) return;
    try {
      const values = await form.validateFields();
      setLoading(true);
      const body: any = {
        displayName: values.displayName,
        role: values.role,
      };
      if (values.password) body.password = values.password;

      const res = await apiFetch(`/api/auth/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      if (res.ok) {
        message.success('用户已更新');
        onSuccess();
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        message.error(data.error || '更新失败');
      }
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error('更新失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={'编辑用户'}
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      okText={'保存'}
      cancelText={'取消'}
      confirmLoading={loading}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item name="displayName" label={'显示名'} rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="role" label={'角色'}>
          <Select options={[
            { label: '普通成员', value: 'member' },
            { label: '管理员', value: 'admin' },
          ]} />
        </Form.Item>
        <Form.Item name="password" label={'新密码（留空不修改）'}>
          <Input.Password placeholder={'留空则不修改密码'} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
