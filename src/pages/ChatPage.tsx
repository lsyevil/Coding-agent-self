import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useChatStore } from '../stores/chatStore';
import { SessionList } from '../components/Chat/SessionList';
import { ChatMessages } from '../components/Chat/ChatMessages';
import { ChatInput } from '../components/Chat/ChatInput';
import { NewChatView } from '../components/Chat/NewChatView';

export function ChatPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const {
    messages,
    streamingContent,
    streamingToolCalls,
    isLoading,
    fetchSessions,
    selectSession,
  } = useChatStore();

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    if (sessionId) {
      selectSession(sessionId);
    }
  }, [sessionId, selectSession]);

  const hasMessages = messages.length > 0 || streamingContent;

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <SessionList />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {hasMessages ? (
            <ChatMessages
              messages={messages}
              streamingContent={streamingContent}
              streamingToolCalls={streamingToolCalls}
              isLoading={isLoading}
            />
          ) : (
            <NewChatView />
          )}
        </div>
        <ChatInput />
      </div>
    </div>
  );
}
