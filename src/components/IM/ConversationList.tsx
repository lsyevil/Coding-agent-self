import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, List, Avatar, Typography, Empty, theme } from 'antd';
import { PlusOutlined, TeamOutlined, MessageOutlined } from '@ant-design/icons';
import { useConversationStore, Conversation } from '../../stores/conversationStore';
import { useAuthStore } from '../../stores/authStore';
import { NewConversationModal } from './NewConversationModal';

const { Text, Paragraph } = Typography;

function convTitle(conv: Conversation, currentUserId?: string): string {
  if (conv.type === 'group') return conv.title || '群聊';
  // 私聊：显示对方名称
  const other = conv.members.find((m) => m.id !== currentUserId);
  return other?.displayName || other?.username || '私聊';
}

function formatPreview(conv: Conversation): string {
  return conv.lastMessage || (conv.type === 'group' ? '群聊已创建' : '私聊已创建');
}

export function ConversationList() {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const conversations = useConversationStore((s) => s.conversations);
  const currentConvId = useConversationStore((s) => s.currentConvId);
  const createConversation = useConversationStore((s) => s.createConversation);
  const authUserId = useAuthStore((s) => s.user?.id);
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleCreate = async (type: 'private' | 'group', memberIds: string[], title?: string) => {
    setCreating(true);
    try {
      const id = await createConversation(type, memberIds, title);
      navigate(`/im/${id}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      style={{
        width: 280,
        borderRight: `1px solid ${token.colorBorderSecondary}`,
        display: 'flex',
        flexDirection: 'column',
        background: '#fff',
      }}
    >
      <div
        style={{
          padding: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Text strong>会话</Text>
        <Button size="small" type="primary" icon={<PlusOutlined />} loading={creating} onClick={() => setModalOpen(true)}>
          新建
        </Button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {conversations.length === 0 ? (
          <div style={{ padding: 24 }}>
            <Empty description="还没有会话" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        ) : (
          <List
            dataSource={conversations}
            renderItem={(conv) => {
              const active = conv.id === currentConvId;
              return (
                <List.Item
                  onClick={() => navigate(`/im/${conv.id}`)}
                  style={{
                    cursor: 'pointer',
                    padding: '10px 12px',
                    background: active ? 'rgba(22,119,255,0.08)' : 'transparent',
                    borderLeft: active ? `3px solid ${token.colorPrimary}` : '3px solid transparent',
                  }}
                >
                  <List.Item.Meta
                    avatar={
                      <Badge count={conv.unreadCount} size="small" offset={[-2, 4]}>
                        <Avatar
                          icon={conv.type === 'group' ? <TeamOutlined /> : <MessageOutlined />}
                          style={{ background: conv.type === 'group' ? token.colorSuccess : token.colorPrimary }}
                        />
                      </Badge>
                    }
                    title={
                      <Text ellipsis style={{ maxWidth: 150, fontWeight: active ? 600 : 400 }}>
                        {convTitle(conv, authUserId)}
                      </Text>
                    }
                    description={
                      <Paragraph ellipsis={{ rows: 1 }} style={{ marginBottom: 0, fontSize: 12, color: token.colorTextSecondary }}>
                        {formatPreview(conv)}
                      </Paragraph>
                    }
                  />
                </List.Item>
              );
            }}
          />
        )}
      </div>

      <NewConversationModal open={modalOpen} onClose={() => setModalOpen(false)} onCreate={handleCreate} />
    </div>
  );
}
