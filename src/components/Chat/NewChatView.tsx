import { Typography, Card, Row, Col } from 'antd';
import { FileTextOutlined, CalendarOutlined, SearchOutlined, TeamOutlined } from '@ant-design/icons';
import { useChatStore } from '../../stores/chatStore';

const { Title, Paragraph } = Typography;

const QUICK_ACTIONS = [
  {
    icon: <FileTextOutlined style={{ fontSize: 24, color: '#1677ff' }} />,
    title: '帮我写周报',
    desc: '整理本周工作内容，生成周报',
    prompt: '帮我写一份本周的工作周报，主要内容包括：',
  },
  {
    icon: <CalendarOutlined style={{ fontSize: 24, color: '#52c41a' }} />,
    title: '安排会议',
    desc: '查看日程并安排会议时间',
    prompt: '帮我查看今天的日程，然后安排一个会议',
  },
  {
    icon: <SearchOutlined style={{ fontSize: 24, color: '#722ed1' }} />,
    title: '搜索文献',
    desc: '检索学术论文和研究成果',
    prompt: '帮我搜索关于',
  },
  {
    icon: <TeamOutlined style={{ fontSize: 24, color: '#fa8c16' }} />,
    title: '分配任务',
    desc: '创建任务并分配给团队成员',
    prompt: '帮我创建一个任务，分配给',
  },
];

export function NewChatView() {
  const { sendMessage } = useChatStore();

  const handleQuickAction = (prompt: string) => {
    sendMessage(prompt);
  };

  return (
    <div style={{ padding: 32, maxWidth: 800, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <Title level={2}>你好，我是办公助手 👋</Title>
        <Paragraph type="secondary">
          我可以帮助你处理文档、管理日程、检索文献、分配任务等日常工作
        </Paragraph>
      </div>
      
      <Row gutter={[16, 16]}>
        {QUICK_ACTIONS.map((action, index) => (
          <Col key={index} xs={24} sm={12}>
            <Card
              hoverable
              onClick={() => handleQuickAction(action.prompt)}
              style={{ height: '100%' }}
            >
              <div style={{ display: 'flex', gap: 12 }}>
                {action.icon}
                <div>
                  <Title level={5} style={{ marginBottom: 4 }}>{action.title}</Title>
                  <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 13 }}>
                    {action.desc}
                  </Paragraph>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
