import { useState } from 'react';
import { Drawer, Form, Input, Select, Button, Divider, List, Avatar, Typography, Popconfirm, message, Paragraph } from 'antd';
import { DeleteOutlined, SendOutlined, RobotOutlined } from '@ant-design/icons';
import { usePaperStore } from '../../stores/paperStore';
import { useAuthStore } from '../../stores/authStore';
import type { PaperNote } from '../../stores/paperStore';

const { TextArea } = Input;
const { Text } = Typography;

const STATUS_OPTIONS = [
  { label: '未读', value: 'unread' },
  { label: '阅读中', value: 'reading' },
  { label: '已读完', value: 'finished' },
];

export function PaperDetailDrawer() {
  const [form] = Form.useForm();
  const { papers, currentPaperId, notes, selectPaper, updatePaper, deletePaper, addNote, deleteNote, summarize } = usePaperStore();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [noteText, setNoteText] = useState('');
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  const paper = papers.find((p) => p.id === currentPaperId);
  const isOwner = paper?.added_by === currentUserId;

  const handleClose = () => { selectPaper(null); setSummary(null); };

  const handleSave = async (changedValues: any) => {
    if (!paper) return;
    const updates: any = {};
    if (changedValues.status !== undefined) updates.status = changedValues.status;
    if (changedValues.tags !== undefined) updates.tags = changedValues.tags;
    if (Object.keys(updates).length > 0) { await updatePaper(paper.id, updates); message.success('已保存'); }
  };

  const handleDelete = async () => { if (!paper) return; await deletePaper(paper.id); message.success('已删除'); setSummary(null); };

  const handleAddNote = async () => { if (!paper || !noteText.trim()) return; await addNote(paper.id, noteText.trim()); setNoteText(''); };

  const handleSummarize = async () => {
    if (!paper) return;
    setSummarizing(true);
    const result = await summarize(paper.id);
    setSummary(result);
    setSummarizing(false);
  };

  if (!paper) return <Drawer open={false} />;

  return (
    <Drawer
      title={paper.title}
      open={!!currentPaperId}
      onClose={handleClose}
      width={520}
      footer={isOwner && (
        <Popconfirm title="确定删除此文献？" onConfirm={handleDelete}>
          <Button danger icon={<DeleteOutlined />}> 删除文献 </Button>
        </Popconfirm>
      )}
    >
      <div style={{ marginBottom: 16 }}>
        <Text type="secondary">作者</Text>
        <div style={{ marginTop: 4 }}><Text>{paper.authors.join(', ') || '未知'}</Text></div>
      </div>
      {paper.year && <div style={{ marginBottom: 16 }}><Text type="secondary">年份</Text><div style={{ marginTop: 4 }}><Text>{paper.year}</Text></div></div>}
      {paper.url && <div style={{ marginBottom: 16 }}><Text type="secondary">链接</Text><div style={{ marginTop: 4 }}><a href={paper.url} target="_blank" rel="noopener noreferrer">{paper.url}</a></div></div>}
      {paper.abstract && <div style={{ marginBottom: 16 }}><Text type="secondary">摘要</Text><div style={{ marginTop: 4 }}><Text style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{paper.abstract}</Text></div></div>}

      <Form form={form} layout="vertical" initialValues={{ status: paper.status, tags: paper.tags }} onValuesChange={handleSave}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Form.Item name="status" label="阅读状态"><Select options={STATUS_OPTIONS} /></Form.Item>
          <Form.Item name="tags" label="标签"><Select mode="tags" /></Form.Item>
        </div>
      </Form>

      <div style={{ marginBottom: 16 }}>
        <Button icon={<RobotOutlined />} onClick={handleSummarize} loading={summarizing}>AI 综述</Button>
      </div>
      {summary && <div style={{ marginBottom: 16, padding: 12, background: '#f6f8fa', borderRadius: 6 }}><Text strong><RobotOutlined /> AI 综述</Text><div style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{summary}</div></div>}

      <Divider />
      <Text strong>笔记 ({notes.length})</Text>
      <div style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="添加笔记..." onPressEnter={handleAddNote} />
          <Button type="primary" icon={<SendOutlined />} onClick={handleAddNote} disabled={!noteText.trim()}> 发送 </Button>
        </div>
        <List
          style={{ marginTop: 12 }}
          dataSource={notes}
          renderItem={(n: PaperNote) => (
            <List.Item
              actions={n.user_id === currentUserId ? [<Popconfirm key="del" title="删除？" onConfirm={() => paper && deleteNote(paper.id, n.id)}><Button type="text" size="small" danger>删除</Button></Popconfirm>] : undefined}
            >
              <List.Item.Meta
                avatar={<Avatar size="small">{n.userName?.[0] || '?'}</Avatar>}
                title={<Text style={{ fontSize: 13 }}>{n.userName}</Text>}
                description={<Text>{n.content}</Text>}
              />
            </List.Item>
          )}
        />
      </div>
    </Drawer>
  );
}
