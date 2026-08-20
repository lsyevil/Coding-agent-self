import { useState, useEffect } from 'react';
import { Tabs, Table, Switch, Empty, message } from 'antd';
import { useAuthStore } from '../stores/authStore';
import { apiFetch } from '../api/http';

interface Skill {
  name: string;
  displayName: string;
  description: string;
  enabled: boolean;
}

function AgentManagement() {
  return (
    <div style={{ padding: '48px 0' }}>
      <Empty description="Agent 管理功能将在后续版本提供" />
    </div>
  );
}

function SkillManagement() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSkills = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/settings/skills');
      if (res.ok) {
        const data = await res.json();
        setSkills(data.skills);
      } else {
        message.error('获取 Skill 列表失败');
      }
    } catch {
      message.error('获取 Skill 列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSkills();
  }, []);

  const handleToggle = async (name: string, enabled: boolean) => {
    try {
      const res = await apiFetch(`/api/settings/skills/${name}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        setSkills((prev) =>
          prev.map((s) => (s.name === name ? { ...s, enabled } : s))
        );
        message.success(enabled ? '已启用' : '已禁用');
      } else {
        message.error('操作失败');
      }
    } catch {
      message.error('操作失败');
    }
  };

  const columns = [
    {
      title: 'Skill 名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
    },
    {
      title: '启用状态',
      dataIndex: 'enabled',
      key: 'enabled',
      width: 120,
      render: (enabled: boolean, record: Skill) => (
        <Switch
          checked={enabled}
          onChange={(checked) => handleToggle(record.name, checked)}
        />
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      dataSource={skills}
      rowKey="name"
      loading={loading}
      pagination={false}
    />
  );
}

export function SettingsPage() {
  const isAdmin = useAuthStore((s) => s.isAdmin());

  const items = [
    {
      key: 'agent',
      label: 'Agent 管理',
      children: <AgentManagement />,
    },
    ...(isAdmin
      ? [
          {
            key: 'skill',
            label: 'Skill 管理',
            children: <SkillManagement />,
          },
        ]
      : []),
  ];

  return (
    <div style={{ padding: 24 }}>
      <Tabs items={items} />
    </div>
  );
}

export default SettingsPage;
