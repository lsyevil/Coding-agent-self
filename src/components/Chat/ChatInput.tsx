import { Input, Button, Space, Select } from 'antd';
import { SendOutlined, StopOutlined } from '@ant-design/icons';
import { useState, KeyboardEvent, useRef, useEffect } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useAvailableModels } from '../../hooks/useAvailableModels';

const { TextArea } = Input;

export function ChatInput() {
  const [value, setValue] = useState('');
  const textAreaRef = useRef<any>(null);
  const {
    sendMessage,
    isLoading,
    stopGeneration,
    selectedModel,
    setSelectedModel,
    pendingPrompt,
    setPendingPrompt,
  } = useChatStore();
  const { models, loading } = useAvailableModels();

  useEffect(() => {
    if (pendingPrompt) {
      setValue(pendingPrompt);
      setPendingPrompt(null);
      textAreaRef.current?.focus();
    }
  }, [pendingPrompt, setPendingPrompt]);

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

  const modelOptions = models.map((m) => ({ label: m.name, value: m.modelId }));

  return (
    <div style={{ padding: 16, borderTop: '1px solid #f0f0f0', backgroundColor: '#fff' }}>
      <div style={{ maxWidth: 800, margin: '0 auto 8px' }}>
        <Select
          size="small"
          value={selectedModel ?? (models[0]?.modelId || undefined)}
          onChange={(val) => setSelectedModel(val)}
          disabled={models.length <= 1}
          loading={loading}
          placeholder="默认模型"
          style={{ width: 160 }}
          options={modelOptions}
        />
      </div>
      <div style={{ maxWidth: 800, margin: '0 auto', display: 'flex', gap: 8 }}>
        <TextArea
          ref={textAreaRef}
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
