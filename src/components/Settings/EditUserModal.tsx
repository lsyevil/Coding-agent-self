import { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, AutoComplete, message } from 'antd';
import { apiFetch } from '../../api/http';
import type { UserInfo } from '../../api/auth';

interface Props {
  open: boolean;
  user: UserInfo | null;
  /** 现有部门去重后的候选值，供 AutoComplete 提示；由父组件从已加载的用户列表算出 */
  departments: string[];
  onClose: () => void;
  onSuccess: () => void;
}

export function EditUserModal({ open, user, departments, onClose, onSuccess }: Props) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && user) {
      form.setFieldsValue({
        displayName: user.displayName,
        role: user.role,
        // 未填部门时回填空串而不是 undefined：undefined 会让 AutoComplete 变成
        // 非受控，之后清空输入框就提交不出「清空部门」这个意图。
        department: user.department ?? '',
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
        // 一律带上（哪怕是空串）：服务端把空串当成「清空部门」，
        // 只在有值时才发的话，管理员就永远删不掉一个填错的部门。
        department: values.department ?? '',
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
        <Form.Item name="department" label={'部门（可选）'}>
          <AutoComplete
            filterOption={(input, option) =>
              String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())
            }
            options={departments.map((d) => ({ value: d }))}
            placeholder={'用于区分同名同事，如：技术部'}
            allowClear
          />
        </Form.Item>
        <Form.Item name="password" label={'新密码（留空不修改）'}>
          <Input.Password placeholder={'留空则不修改密码'} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
