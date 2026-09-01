import { useState, useEffect } from 'react';
import { Table, Button, Tag, message, Space, Popconfirm, Switch } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, UndoOutlined } from '@ant-design/icons';
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
  const [showDeleted, setShowDeleted] = useState(false);

  const loadUsers = async (includeDeleted = showDeleted) => {
    setLoading(true);
    try {
      const data = await fetchUsers({ includeDeleted });
      setUsers(data);
    } catch (e: any) {
      message.error(e?.message || '获取用户列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers(showDeleted);
  }, [showDeleted]);

  const handleDelete = async (userId: string) => {
    try {
      const res = await apiFetch(`/api/auth/users/${userId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({} as any));
      if (res.ok) {
        // mode 由服务端按「名下有没有关联数据」决定，前端事先并不知道会走哪条路径，
        // 所以提示文案只能等结果回来再定 —— 否则会告诉用户「已删除」而其实只是注销了。
        message.success(data.mode === 'hard' ? '用户已彻底删除' : '用户已注销，其内容与发言记录均已保留');
        loadUsers();
      } else {
        message.error(data.error || '注销失败');
      }
    } catch {
      message.error('注销失败');
    }
  };

  const handleRestore = async (userId: string) => {
    try {
      const res = await apiFetch(`/api/auth/users/${userId}/restore`, { method: 'POST' });
      const data = await res.json().catch(() => ({} as any));
      if (res.ok) {
        message.success('用户已恢复');
        loadUsers();
      } else {
        message.error(data.error || '恢复失败');
      }
    } catch {
      message.error('恢复失败');
    }
  };

  // 部门候选值直接从已加载的用户列表里去重得来，不再单独开一个接口：
  // 这份数据本来就在手上，另开接口只会多一次请求和一处可能不一致的来源。
  // AutoComplete 的作用是把「技术部 / 技术 / 研发部」这类拼写分叉挡在输入之前 ——
  // 部门是自由文本，没有约束能挡，只能靠让「选已有的」比「敲新的」更省事。
  const departments = Array.from(
    new Set(users.map((u) => u.department).filter((d): d is string => !!d))
  ).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

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
      title: '部门',
      dataIndex: 'department',
      key: 'department',
      width: 140,
      render: (department: string | null) =>
        department || <span style={{ color: '#bfbfbf' }}>{'—'}</span>,
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
      title: '状态',
      key: 'status',
      width: 100,
      render: (_: any, record: UserInfo) =>
        record.deletedAt ? <Tag>{'已注销'}</Tag> : <Tag color="green">{'在职'}</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_: any, record: UserInfo) =>
        record.deletedAt ? (
          <Popconfirm
            title={'恢复此用户？'}
            description={'恢复后该用户可以重新登录，原有内容和权限不变。'}
            onConfirm={() => handleRestore(record.id)}
          >
            <Button type="link" size="small" icon={<UndoOutlined />}>{'恢复'}</Button>
          </Popconfirm>
        ) : (
          <Space>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setEditUser(record);
                setEditOpen(true);
              }}
            >
              {'编辑'}
            </Button>
            <Popconfirm
              title={'注销此用户？'}
              // 说明两种结果：前端无法预知会走哪条，所以两条都讲清楚，
              // 免得管理员以为「删除」就是彻底删掉了。
              description={
                <span style={{ display: 'inline-block', maxWidth: 260 }}>
                  该用户名下有内容时将被<b>注销</b>：无法登录，但其发言、任务、文献等记录
                  与归属全部保留，之后可以在此页恢复。
                  <br />
                  若名下没有任何关联数据（误建的账号），则会被<b>彻底删除</b>。
                </span>
              }
              onConfirm={() => handleDelete(record.id)}
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>{'注销'}</Button>
            </Popconfirm>
          </Space>
        ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <Space>
          <Switch checked={showDeleted} onChange={setShowDeleted} size="small" />
          <span>{'显示已注销用户'}</span>
        </Space>
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
        // 已注销的行整体降低对比度，避免管理员在长列表里把它当成在职同事。
        rowClassName={(record) => (record.deletedAt ? 'user-row-deleted' : '')}
      />
      <CreateUserModal
        open={modalOpen}
        departments={departments}
        onClose={() => setModalOpen(false)}
        onSuccess={() => loadUsers()}
      />
      <EditUserModal
        open={editOpen}
        user={editUser}
        departments={departments}
        onClose={() => {
          setEditOpen(false);
          setEditUser(null);
        }}
        onSuccess={() => loadUsers()}
      />
    </div>
  );
}
