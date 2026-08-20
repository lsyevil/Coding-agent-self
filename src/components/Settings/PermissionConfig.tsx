import { useState, useEffect } from 'react';
import { Checkbox, Typography, Button, message, Spin, Divider } from 'antd';
import { apiFetch } from '../../api/http';

const { Title, Text } = Typography;

interface ModelInfo { modelId: string; name: string; }
interface AgentInfo { id: string; name: string; icon: string; }

export function PermissionConfig() {
  const [allModels, setAllModels] = useState<ModelInfo[]>([]);
  const [allAgents, setAllAgents] = useState<AgentInfo[]>([]);
  const [memberModels, setMemberModels] = useState<string[] | null>(null);
  const [memberAgents, setMemberAgents] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch('/api/models').then(r => r.json()),
      apiFetch('/api/settings/member-models').then(r => r.json()),
      apiFetch('/api/settings/member-agents').then(r => r.json()),
      apiFetch('/api/settings/available-agents').then(r => r.json()),
    ]).then(([modelsData, mmData, maData, agentsData]) => {
      setAllModels(modelsData.models || []);
      setMemberModels(mmData.models);
      setMemberAgents(maData.agents);
      setAllAgents(agentsData.agents || []);
    }).catch(() => {
      message.error('加载配置失败');
    }).finally(() => setLoading(false));
  }, []);

  const handleSaveModels = async () => {
    setSaving(true);
    try {
      await apiFetch('/api/settings/member-models', {
        method: 'PATCH',
        body: JSON.stringify({ models: memberModels || [] }),
      });
      message.success('模型配置已保存');
    } catch { message.error('保存失败'); }
    finally { setSaving(false); }
  };

  const handleSaveAgents = async () => {
    setSaving(true);
    try {
      await apiFetch('/api/settings/member-agents', {
        method: 'PATCH',
        body: JSON.stringify({ agents: memberAgents || [] }),
      });
      message.success('助手配置已保存');
    } catch { message.error('保存失败'); }
    finally { setSaving(false); }
  };

  if (loading) return <div style={{ padding: 48, textAlign: 'center' }}><Spin /></div>;

  return (
    <div>
      <Title level={5}>{'普通成员可用模型'}</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        {'未选择表示成员可使用所有模型'}
      </Text>
      <Checkbox.Group
        value={memberModels || []}
        onChange={(vals) => setMemberModels(vals as string[])}
        options={allModels.map(m => ({ label: m.name, value: m.modelId }))}
      />
      <div style={{ marginTop: 12 }}>
        <Button type="primary" onClick={handleSaveModels} loading={saving}>{'保存'}</Button>
      </div>

      <Divider />

      <Title level={5}>{'普通成员可用助手'}</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        {'未选择表示成员可使用所有助手'}
      </Text>
      <Checkbox.Group
        value={memberAgents || []}
        onChange={(vals) => setMemberAgents(vals as string[])}
        options={allAgents.map(a => ({ label: a.icon + ' ' + a.name, value: a.id }))}
      />
      <div style={{ marginTop: 12 }}>
        <Button type="primary" onClick={handleSaveAgents} loading={saving}>{'保存'}</Button>
      </div>
    </div>
  );
}
