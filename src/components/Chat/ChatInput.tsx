import { Input, Button, Space } from 'antd';
import { SendOutlined, StopOutlined } from '@ant-design/icons';
import { useState, KeyboardEvent } from 'react';
import { useChatStore } from '../../stores/chatStore';

const { TextArea } = Input;

export function ChatInput() {
  const [value, setValue] = useState('');
  const { sendMessage, isLoading, stopGeneration } = useChatStore();

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

  return (
    <div style={{ padding: 16, borderTop: '1px solid #f0f0f0', backgroundColor: '#fff' }}>
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
