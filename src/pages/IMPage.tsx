import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useConversationStore } from '../stores/conversationStore';
import { ConversationList } from '../components/IM/ConversationList';
import { MessageList } from '../components/IM/MessageList';
import { MessageInput } from '../components/IM/MessageInput';
import { useWebSocket } from '../hooks/useWebSocket';

export function IMPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const { currentConvId, messages, loadingMessages, fetchConversations, selectConversation } =
    useConversationStore();
  const { sendMessage, joinConversation, leaveConversation } = useWebSocket();

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    if (conversationId) {
      selectConversation(conversationId);
      joinConversation(conversationId);
      return () => leaveConversation(conversationId);
    }
  }, [conversationId, selectConversation, joinConversation, leaveConversation]);

  const handleSend = (content: string) => {
    if (currentConvId) {
      sendMessage(currentConvId, content);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <ConversationList />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {currentConvId ? (
          <>
            <MessageList conversationId={currentConvId} messages={messages} loading={loadingMessages} />
            <MessageInput onSend={handleSend} />
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
            选择一个会话开始聊天
          </div>
        )}
      </div>
    </div>
  );
}

export default IMPage;
