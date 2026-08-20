import { Input, Button, Space, Select, Segmented } from 'antd';
import { SendOutlined, StopOutlined } from '@ant-design/icons';
import { useState, KeyboardEvent } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useModels } from '../../hooks/useModels';
import { DEFAULT_AGENTS } from '../../config/agents';

const { TextArea } = Input;

export function ChatInput() {
  const [value, setValue] = useState('');
  const {
    sendMessage,
    isLoading,
    stopGeneration,
    selectedModel,
    setSelectedModel,
    currentAgentId,
    setCurrentAgent,
  } = useChatStore();
  const { models, defaultModel, loading } = useModels();

  const handleSend = async () => {
    if (!value.trim() || isLoading) return;
    await sendMessage(value.trim());
    setValue('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const agentOptions = DEFAULT_AGENTS.map((a) => ({
    label: `${a.icon} ${a.name}`,
    value: a.id,
  }));

  const modelOptions = models.map((m) => ({ label: m.name, value: m.modelId }));

  return (
    <div style={{ padding: 16, borderTop: '1px solid #f0f0f0', backgroundColor: '#fff' }}>
      {/* 工具栏：角色切换 + 模型选择（位于输入框上方） */}
      <div style={{ maxWidth: 800, margin: '0 auto 8px' }}>
        <Space size={8} wrap>
          <Segmented
            size="small"
            value={currentAgentId}
            onChange={(val) => setCurrentAgent(val as string)}
            options={agentOptions}
          />
          <Select
            size="small"
            value={selectedModel ?? (defaultModel || undefined)}
            onChange={(val) => setSelectedModel(val)}
            disabled={models.length <= 1}
            loading={loading}
            placeholder="默认模型"
            style={{ width: 160 }}
            options={modelOptions}
          />
        </Space>
      </div>
      <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', gap: 8 }}>
        <TextArea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
          autoSize={{ minRows: 1, maxRows: 4 }}
          style={{ flex: 1 }}
          disabled={isLoading}
        />
        <Space>
          {isLoading ? (
            <Button icon={<StopOutlined />} onClick={stopGeneration} danger>
              停止
            </Button>
          ) : (
            <Button type="primary" icon={<SendOutlined />} onClick={handleSend} disabled={!value.trim()}>
              发送
            </Button>
          )}
        </Space>
      </div>
    </div>
  );
}
