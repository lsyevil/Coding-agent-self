import { Card, Tag, Typography } from 'antd';
import type { Paper } from '../../stores/paperStore';

const { Text, Paragraph } = Typography;

const STATUS_MAP: Record<string, { color: string; label: string }> = {
  unread: { color: 'default', label: '未读' },
  reading: { color: 'processing', label: '阅读中' },
  finished: { color: 'success', label: '已读完' },
};

interface Props {
  paper: Paper;
  selected: boolean;
  onClick: () => void;
}

export function PaperCard({ paper, selected, onClick }: Props) {
  const statusInfo = STATUS_MAP[paper.status] || STATUS_MAP.unread;

  return (
    <Card
      size="small"
      hoverable
      onClick={onClick}
      style={{
        marginBottom: 8,
        borderColor: selected ? '#1890ff' : undefined,
        borderWidth: selected ? 2 : 1,
        cursor: 'pointer',
      }}
    >
      <Text strong style={{ display: 'block', marginBottom: 4 }}>{paper.title}</Text>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {paper.authors.slice(0, 3).join(', ')}{paper.authors.length > 3 ? ' et al.' : ''}
        {paper.year ? ` (${paper.year})` : ''}
      </Text>
      <div style={{ marginTop: 6 }}>
        <Tag color={statusInfo.color}>{statusInfo.label}</Tag>
        {paper.tags.slice(0, 3).map((tag: string) => (
          <Tag key={tag} color="blue">{tag}</Tag>
        ))}
      </div>
    </Card>
  );
}
