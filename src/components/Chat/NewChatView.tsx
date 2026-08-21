import { Typography, Card, Row, Col, Segmented } from 'antd';
import {
  FileTextOutlined, CalendarOutlined, SearchOutlined, TeamOutlined,
  BookOutlined, EditOutlined, TranslationOutlined, HighlightOutlined,
  MailOutlined, ExperimentOutlined, FileDoneOutlined,
} from '@ant-design/icons';
import { useChatStore } from '../../stores/chatStore';
import { useAvailableAgents } from '../../hooks/useAvailableAgents';

const { Title, Paragraph } = Typography;

interface QuickAction {
  icon: React.ReactNode;
  title: string;
  desc: string;
  prompt: string;
}

const WELCOME: Record<string, { title: string; desc: string }> = {
  default: { title: '你好，我是办公助手 👋', desc: '{welcome.desc}' },
  research: { title: '你好，我是科研助手 📚', desc: '我可以帮助你检索文献、撰写综述、设计研究方案、润色论文' },
  writing: { title: '你好，我是写作助手 ✍️', desc: '我可以帮助你撰写报告、润色文档、翻译内容、调整格式' },
};

const QUICK_ACTIONS: Record<string, QuickAction[]> = {
  default: [
    { icon: <FileTextOutlined style={{ fontSize: 24, color: '#1677ff' }} />, title: '帮我写周报', desc: '整理本周工作内容，生成周报', prompt: '帮我写一份本周的工作周报，主要内容包括：' },
    { icon: <CalendarOutlined style={{ fontSize: 24, color: '#52c41a' }} />, title: '安排会议', desc: '查看日程并安排会议时间', prompt: '帮我查看今天的日程，然后安排一个会议' },
    { icon: <TeamOutlined style={{ fontSize: 24, color: '#fa8c16' }} />, title: '分配任务', desc: '创建任务并分配给团队成员', prompt: '帮我创建一个任务，分配给' },
    { icon: <MailOutlined style={{ fontSize: 24, color: '#eb2f96' }} />, title: '写邮件', desc: '起草一封专业邮件', prompt: '帮我写一封邮件，主题是' },
  ],
  research: [
    { icon: <SearchOutlined style={{ fontSize: 24, color: '#722ed1' }} />, title: '搜索文献', desc: '检索学术论文和研究成果', prompt: '帮我搜索关于' },
    { icon: <BookOutlined style={{ fontSize: 24, color: '#1677ff' }} />, title: '文献综述', desc: '对指定主题的文献进行综述分析', prompt: '请对以下主题的已有研究进行文献综述：' },
    { icon: <ExperimentOutlined style={{ fontSize: 24, color: '#52c41a' }} />, title: '研究方法', desc: '推荐适合的研究方法论', prompt: '针对以下研究问题，推荐合适的研究方法：' },
    { icon: <FileDoneOutlined style={{ fontSize: 24, color: '#fa8c16' }} />, title: '论文润色', desc: '优化学术论文的表达和结构', prompt: '请帮我润色以下论文段落：' },
  ],
  writing: [
    { icon: <EditOutlined style={{ fontSize: 24, color: '#1677ff' }} />, title: '写报告', desc: '起草专业工作报告', prompt: '帮我写一份关于以下主题的工作报告：' },
    { icon: <HighlightOutlined style={{ fontSize: 24, color: '#52c41a' }} />, title: '润色文档', desc: '优化文档的表达和格式', prompt: '请帮我润色以下文档内容：' },
    { icon: <TranslationOutlined style={{ fontSize: 24, color: '#722ed1' }} />, title: '翻译', desc: '中英文互译或翻译为其他语言', prompt: '请将以下内容翻译为英文：' },
    { icon: <FileTextOutlined style={{ fontSize: 24, color: '#fa8c16' }} />, title: '格式调整', desc: '调整文档格式使其更规范', prompt: '请帮我调整以下文档的格式：' },
  ],
};

export function NewChatView() {
  const { currentAgentId, setCurrentAgent, setPendingPrompt } = useChatStore();
  const { agents } = useAvailableAgents();

  const agentOptions = agents.map((a) => ({
    label: `${a.icon} ${a.name}`,
    value: a.id,
  }));

  const welcome = WELCOME[currentAgentId] || WELCOME.default;
  const actions = QUICK_ACTIONS[currentAgentId] || QUICK_ACTIONS['default'];

  return (
    <div style={{ padding: 32, maxWidth: 800, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <Title level={2}>{welcome.title}</Title>
        <Paragraph type="secondary">
          我可以帮助你处理文档、管理日程、检索文献、分配任务等日常工作
        </Paragraph>
      </div>

      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <Segmented
          size="middle"
          value={currentAgentId}
          onChange={(val) => setCurrentAgent(val as string)}
          options={agentOptions}
        />
      </div>

      <Row gutter={[16, 16]}>
        {actions.map((action, index) => (
          <Col key={index} xs={24} sm={12}>
            <Card
              hoverable
              onClick={() => setPendingPrompt(action.prompt)}
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
