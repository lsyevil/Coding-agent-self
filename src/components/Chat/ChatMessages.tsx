import { Typography, Collapse, Tag, Spin } from 'antd';
import { UserOutlined, RobotOutlined, CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import { useChatStore, Message } from '../../stores/chatStore';

const { Text, Paragraph } = Typography;

const TOOL_NAME_MAP: Record<string, string> = {
  // coding
  'read_file': '读取文件',
  'write_file': '写入文件',
  'edit_file': '编辑文件',
  'delete_file': '删除文件',
  'list_directory': '列出目录',
  'search_files': '搜索文件',
  'run_command': '执行命令',
  // todo
  'create_task': '创建待办',
  'list_tasks': '查看待办',
  'update_task': '更新待办',
  // calendar
  'create_event': '创建日程',
  'list_events': '查看日程',
  // literature
  'search_papers': '搜索文献',
  'fetch_paper_detail': '获取文献详情',
};

interface ChatMessagesProps {
  messages: Message[];
  streamingContent?: string;
  streamingToolCalls?: any[];
  isLoading?: boolean;
}

export function ChatMessages({ messages, streamingContent, streamingToolCalls, isLoading }: ChatMessagesProps) {
  return (
    <div style={{ padding: 16, maxWidth: 800, margin: '0 auto' }}>
      {messages.map((msg) => (
        <MessageBubble key={msg.id} message={msg} />
      ))}
      
      {/* 流式输出 */}
      {(streamingContent || (streamingToolCalls && streamingToolCalls.length > 0)) && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: '#1677ff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <RobotOutlined style={{ color: '#fff', fontSize: 16 }} />
          </div>
          <div style={{ flex: 1 }}>
            {streamingContent && (
              <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}>
                {streamingContent}
                {isLoading && <span style={{ animation: 'blink 1s infinite' }}>▊</span>}
              </Paragraph>
            )}
            {streamingToolCalls && streamingToolCalls.length > 0 && (
              <ToolCallList toolCalls={streamingToolCalls} />
            )}
          </div>
        </div>
      )}
      
      {isLoading && !streamingContent && !streamingToolCalls?.length && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', backgroundColor: '#1677ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RobotOutlined style={{ color: '#fff', fontSize: 16 }} />
          </div>
          <Spin size="small" />
          <Text type="secondary">思考中...</Text>
        </div>
      )}
      
      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';
  
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexDirection: isUser ? 'row-reverse' : 'row' }}>
      <div style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        backgroundColor: isUser ? '#52c41a' : '#1677ff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}>
        {isUser ? <UserOutlined style={{ color: '#fff', fontSize: 16 }} /> : <RobotOutlined style={{ color: '#fff', fontSize: 16 }} />}
      </div>
      <div style={{ flex: 1, maxWidth: 'calc(100% - 44px)' }}>
        <div style={{
          padding: '12px 16px',
          borderRadius: 8,
          backgroundColor: isUser ? '#f6ffed' : '#fff',
          border: `1px solid ${isUser ? '#b7eb8f' : '#d9d9d9'}`,
        }}>
          <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
            {message.content}
          </Paragraph>
        </div>
        {message.tool_calls && message.tool_calls.length > 0 && (
          <ToolCallList toolCalls={message.tool_calls} />
        )}
      </div>
    </div>
  );
}

function ToolCallList({ toolCalls }: { toolCalls: any[] }) {
  return (
    <Collapse
      size="small"
      style={{ marginTop: 8 }}
      items={toolCalls.map((tc) => ({
        key: tc.id,
        label: (
          <span>
            {tc.status === 'running' && <LoadingOutlined style={{ marginRight: 8 }} />}
            {tc.status === 'completed' && <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />}
            {tc.status === 'error' && <CloseCircleOutlined style={{ color: '#ff4d4f', marginRight: 8 }} />}
            <Text>{TOOL_NAME_MAP[tc.name] || tc.name}</Text>
            {tc.isError && <Tag color="error" style={{ marginLeft: 8 }}>错误</Tag>}
          </span>
        ),
        children: (
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>输入:</Text>
            <pre style={{ fontSize: 12, backgroundColor: '#f5f5f5', padding: 8, borderRadius: 4, overflow: 'auto', marginTop: 4 }}>
              {JSON.stringify(tc.input, null, 2)}
            </pre>
            {tc.result && (
              <>
                <Text type="secondary" style={{ fontSize: 12, marginTop: 8, display: 'block' }}>输出:</Text>
                <pre style={{ fontSize: 12, backgroundColor: '#f5f5f5', padding: 8, borderRadius: 4, overflow: 'auto', marginTop: 4, maxHeight: 200 }}>
                  {tc.result}
                </pre>
              </>
            )}
          </div>
        ),
      }))}
    />
  );
}
