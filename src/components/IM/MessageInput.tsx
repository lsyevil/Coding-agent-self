import { Input, Button, Space } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { useState, KeyboardEvent } from 'react';

const { TextArea } = Input;

interface Props {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export function MessageInput({ onSend, disabled }: Props) {
  const [value, setValue] = useState('');

  const handleSend = () => {
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={{ padding: 12, borderTop: '1px solid #f0f0f0', backgroundColor: '#fff' }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <TextArea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
          autoSize={{ minRows: 1, maxRows: 4 }}
          style={{ flex: 1 }}
          disabled={disabled}
        />
        <Space>
          <Button type="primary" icon={<SendOutlined />} onClick={handleSend} disabled={!value.trim() || disabled}>
            发送
          </Button>
        </Space>
      </div>
    </div>
  );
}
