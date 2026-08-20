import { useEffect, useRef, useState } from 'react';
import { Avatar, Button, Card, Empty, Spin, Typography, theme } from 'antd';
import { RobotOutlined, UserOutlined } from '@ant-design/icons';
import { apiFetch } from '../../api/http';
import { useAuthStore } from '../../stores/authStore';
import { ImMessage } from '../../stores/conversationStore';

const { Text, Paragraph } = Typography;

interface Props {
  conversationId: string;
  messages: ImMessage[];
  loading: boolean;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { hour12: false });
  } catch {
    return '';
  }
}

export function MessageList({ conversationId, messages, loading }: Props) {
  const currentUserId = useAuthStore((s) => s.user?.id);
  const { token } = theme.useToken();
  const bottomRef = useRef<HTMLDivElement>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSummarize = async () => {
    if (!conversationId) return;
    setSummarizing(true);
    try {
      const res = await apiFetch(`/api/conversations/${conversationId}/summarize`, { method: 'POST' });
      const data = await res.json();
      setSummary(data.summary || '（无内容）');
    } catch (e) {
      console.error('Summarize failed:', e);
      setSummary('总结生成失败，请重试');
    } finally {
      setSummarizing(false);
    }
  };

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin />
      </div>
    );
  }

  if (messages.length === 0 && !summary) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Empty description="暂无消息，开始聊天吧" />
        </div>
        <div style={{ padding: 12, borderTop: '1px solid #f0f0f0', textAlign: 'center' }}>
          <Button icon={<RobotOutlined />} onClick={handleSummarize} loading={summarizing}>
            AI 总结
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {summary && (
          <Card
            size="small"
            style={{ marginBottom: 16, background: token.colorFillAlter, borderColor: token.colorPrimaryBorder }}
            title={<Text strong><RobotOutlined /> AI 总结</Text>}
          >
            <Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{summary}</Paragraph>
          </Card>
        )}

        {messages.map((msg) => {
          const mine = msg.sender_id === currentUserId;
          return (
            <div
              key={msg.id}
              style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 12 }}
            >
              <div style={{ maxWidth: '70%', display: 'flex', flexDirection: mine ? 'row-reverse' : 'row', gap: 8 }}>
                <Avatar size="small" icon={<UserOutlined />} style={{ flexShrink: 0 }}>
                  {msg.senderName?.[0] || '?'}
                </Avatar>
                <div>
                  {!mine && (
                    <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 2 }}>
                      {msg.senderName}
                    </div>
                  )}
                  <div
                    style={{
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: mine ? token.colorPrimary : '#fff',
                      color: mine ? '#fff' : token.colorText,
                      border: mine ? 'none' : `1px solid ${token.colorBorderSecondary}`,
                      wordBreak: 'break-word',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {msg.content}
                  </div>
                  <div style={{ fontSize: 11, color: token.colorTextQuaternary, marginTop: 2, textAlign: mine ? 'right' : 'left' }}>
                    {formatTime(msg.created_at)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: 12, borderTop: '1px solid #f0f0f0', textAlign: 'center' }}>
        <Button icon={<RobotOutlined />} onClick={handleSummarize} loading={summarizing}>
          AI 总结
        </Button>
      </div>
    </div>
  );
}
