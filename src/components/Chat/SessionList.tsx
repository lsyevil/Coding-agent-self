import { List, Button, Popconfirm, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useChatStore } from '../../stores/chatStore';
import { useNavigate } from 'react-router-dom';

const { Text } = Typography;

export function SessionList() {
  const { sessions, currentSessionId, selectSession, deleteSession, createSession } = useChatStore();
  const navigate = useNavigate();

  const handleNewChat = async () => {
    const id = await createSession();
    navigate(`/chat/${id}`);
  };

  const handleSelect = (id: string) => {
    selectSession(id);
    navigate(`/chat/${id}`);
  };

  return (
    <div style={{ width: 240, borderRight: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: 12, borderBottom: '1px solid #f0f0f0' }}>
        <Button type="primary" icon={<PlusOutlined />} block onClick={handleNewChat}>
          新对话
        </Button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <List
          dataSource={sessions}
          renderItem={(session) => (
            <List.Item
              style={{
                padding: '12px 16px',
                cursor: 'pointer',
                backgroundColor: session.id === currentSessionId ? '#e6f4ff' : 'transparent',
                borderBottom: '1px solid #f5f5f5',
              }}
              onClick={() => handleSelect(session.id)}
              actions={[
                <Popconfirm
                  key="delete"
                  title="确定删除此对话？"
                  onConfirm={(e) => {
                    e?.stopPropagation();
                    deleteSession(session.id);
                  }}
                  onCancel={(e) => e?.stopPropagation()}
                >
                  <Button
                    type="text"
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={(e) => e.stopPropagation()}
                  />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={<Text ellipsis>{session.title}</Text>}
                description={<Text type="secondary" style={{ fontSize: 12 }}>
                  {new Date(session.updated_at).toLocaleDateString()}
                </Text>}
              />
            </List.Item>
          )}
        />
      </div>
    </div>
  );
}
