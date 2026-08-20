import { useEffect, useState } from 'react';
import { Modal, Radio, Input, Select, Checkbox, Button, Space, Typography } from 'antd';
import { apiFetch } from '../../api/http';

const { Text } = Typography;

interface UserOption {
  id: string;
  username: string;
  displayName: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (type: 'private' | 'group', memberIds: string[], title?: string) => Promise<void>;
}

export function NewConversationModal({ open, onClose, onCreate }: Props) {
  const [type, setType] = useState<'private' | 'group'>('private');
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    // 重置
    setType('private');
    setTitle('');
    setSelected([]);
    setLoading(true);
    apiFetch('/api/auth/users')
      .then((res) => res.json())
      .then((data) => {
        setUsers(data.users || []);
      })
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, [open]);

  const handleOk = async () => {
    if (selected.length === 0) return;
    setLoading(true);
    try {
      await onCreate(type, selected, type === 'group' ? title : undefined);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="新建会话"
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      okText="创建"
      cancelText="取消"
      confirmLoading={loading}
      okButtonProps={{ disabled: selected.length === 0 }}
      destroyOnClose
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div>
          <Text type="secondary">会话类型</Text>
          <div style={{ marginTop: 8 }}>
            <Radio.Group
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setSelected([]);
              }}
              optionType="button"
              buttonStyle="solid"
            >
              <Radio value="private">私聊</Radio>
              <Radio value="group">群聊</Radio>
            </Radio.Group>
          </div>
        </div>

        {type === 'group' && (
          <Input
            placeholder="群聊标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}

        <div>
          <Text type="secondary">
            {type === 'private' ? '选择一位成员' : '选择成员（可多选）'}
          </Text>
          <div style={{ marginTop: 8, maxHeight: 240, overflowY: 'auto' }}>
            {users.map((u) => {
              const checked = selected.includes(u.id);
              return (
                <div
                  key={u.id}
                  onClick={() => {
                    if (type === 'private') {
                      setSelected([u.id]);
                    } else {
                      setSelected((prev) =>
                        prev.includes(u.id) ? prev.filter((id) => id !== u.id) : [...prev, u.id]
                      );
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    cursor: 'pointer',
                    borderRadius: 6,
                    background: checked ? 'rgba(22,119,255,0.08)' : 'transparent',
                  }}
                >
                  <Checkbox checked={checked} />
                  <span>{u.displayName}</span>
                  <Text type="secondary" style={{ fontSize: 12 }}>@{u.username}</Text>
                </div>
              );
            })}
          </div>
        </div>
      </Space>
    </Modal>
  );
}
