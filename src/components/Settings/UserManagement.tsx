import { useState, useEffect } from 'react';
import { Table, Button, Tag, message, Space, Popconfirm } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { fetchUsers, UserInfo } from '../../api/auth';
import { apiFetch } from '../../api/http';
import { CreateUserModal } from './CreateUserModal';
import { EditUserModal } from './EditUserModal';

export function UserManagement() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserInfo | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await fetchUsers();
      setUsers(data);
    } catch (e: any) {
      message.error(e?.message || '获取用户列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleDelete = async (userId: string) => {
    try {
      const res = await apiFetch(`/api/auth/users/${userId}`, { method: 'DELETE' });
      if (res.ok) {
        message.success('用户已删除');
        loadUsers();
      } else {
        const data = await res.json().catch(() => ({}));
        message.error(data.error || '删除失败');
      }
    } catch { message.error('删除失败'); }
  };

  const columns = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
    },
    {
      title: '显示名',
      dataIndex: 'displayName',
      key: 'displayName',
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 120,
      render: (role: string) => (
        <Tag color={role === 'admin' ? 'red' : 'blue'}>
          {role === 'admin' ? '管理员' : '普通成员'}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      render: (_: any, record: UserInfo) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { setEditUser(record); setEditOpen(true); }}>{'编辑'}</Button>
          <Popconfirm title={'确定删除此用户？'} onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>{'删除'}</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          {'创建用户'}
        </Button>
      </div>
      <Table
        columns={columns}
        dataSource={users}
        rowKey="id"
        loading={loading}
        pagination={false}
      />
      <CreateUserModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={loadUsers}
      />
      <EditUserModal
        open={editOpen}
        user={editUser}
        onClose={() => { setEditOpen(false); setEditUser(null); }}
        onSuccess={loadUsers}
      />
    </div>
  );
}
